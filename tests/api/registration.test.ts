/**
 * Registration (POST /api/auth/register): the organisation's e-mail domain and the password rules.
 *
 *   REGAPI-01  people with a public e-mail address (gmail.com, outlook.com, …) can each create an
 *              organisation; many organisations share the domain (FI-05b)
 *   REGAPI-02  nothing joins or matches anyone by a public domain: a second gmail.com registrant
 *              gets a new, separate organisation and sees nothing of the first one
 *   REGAPI-03  a company domain still belongs to one organisation: the second registration gets 409
 *              with a clear message, and no account is created
 *   REGAPI-04  someone with a public address can be invited into another organisation (team lead)
 *   REGAPI-05  registration uses the invitation / reset password rules (FI-18): 10+ characters,
 *              three character classes, not containing the e-mail name; nothing is created
 *   REGAPI-06  an invalid e-mail address is refused
 *
 * Every organisation created here is removed afterwards. Skips when no live backend is running.
 */
import request from 'supertest';
import type { Client } from 'pg';
import { API_URL, NEW_PW, backendUp, cookieFrom, get, localDb, login, post } from './helpers/http';

const stamp = Date.now();
let up = true;
let db: Client;
const companies = new Set<string>();
let ipSeq = 0;

const register = async (email: string, companyName: string, password = NEW_PW) => {
  // A client address of its own per request: refused registrations count toward the per-address
  // attempt limit (20 per 15 minutes), which the other suites need too.
  const res = await request(API_URL).post('/api/auth/register').set('X-Forwarded-For', `198.18.${(stamp >> 8) % 250}.${(++ipSeq % 250) + 1}`).send({
    email, password, firstName: 'Reg', lastName: 'Api', companyName, departmentName: 'Ops', teamName: `${companyName} Team`,
  });
  if (res.body?.user?.company_id) companies.add(res.body.user.company_id);
  return res;
};

beforeAll(async () => {
  up = await backendUp();
  if (up) db = await localDb();
});

afterAll(async () => {
  if (!up) return;
  if (companies.size) await db.query('DELETE FROM companies WHERE id = ANY($1::varchar[])', [[...companies]]);
  await db.end();
});

describe('Registration: e-mail domains', () => {
  test('REGAPI-01 two people with gmail.com addresses each create an organisation', async () => {
    if (!up) return;
    const a = await register(`reg-a-${stamp}@gmail.com`, `RegApi Gmail A ${stamp}`);
    const b = await register(`reg-b-${stamp}@GMAIL.com`, `RegApi Gmail B ${stamp}`);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.user.company_id).not.toBe(b.body.user.company_id);
    const rows = (await db.query('SELECT domain, email_domain_public FROM companies WHERE id = ANY($1::varchar[]) ORDER BY name',
      [[a.body.user.company_id, b.body.user.company_id]])).rows;
    expect(rows).toEqual([{ domain: 'gmail.com', email_domain_public: true }, { domain: 'gmail.com', email_domain_public: true }]);
    // Other public providers too.
    for (const domain of ['outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'proton.me']) {
      expect((await register(`reg-${stamp}@${domain}`, `RegApi ${domain} ${stamp}`)).status).toBe(201);
    }
  });

  test('REGAPI-02 a public domain never joins or matches anyone to another organisation', async () => {
    if (!up) return;
    const first = await register(`reg-first-${stamp}@outlook.com`, `RegApi First ${stamp}`);
    const second = await register(`reg-second-${stamp}@outlook.com`, `RegApi Second ${stamp}`);
    expect(second.status).toBe(201);
    const firstCo = first.body.user.company_id;
    const secondCo = second.body.user.company_id;
    expect(secondCo).not.toBe(firstCo);
    // The second registrant is super admin of their own organisation only, with only themselves in it.
    const users = await get('/api/admin/users', cookieFrom(second));
    expect(users.status).toBe(200);
    expect(users.body.map((u: any) => u.email)).toEqual([`reg-second-${stamp}@outlook.com`]);
    const members = (await db.query('SELECT company_id FROM users WHERE lower(email) = ANY($1::text[]) ORDER BY email',
      [[`reg-first-${stamp}@outlook.com`, `reg-second-${stamp}@outlook.com`]])).rows.map((r) => r.company_id);
    expect(members).toEqual([firstCo, secondCo]);
    // Nothing of the first organisation is readable with the second session.
    const firstTeam = (await db.query('SELECT id FROM teams WHERE company_id = $1 LIMIT 1', [firstCo])).rows[0].id;
    expect([403, 404]).toContain((await get(`/api/teams/${firstTeam}`, cookieFrom(second))).status);
  });

  test('REGAPI-03 a company domain belongs to one organisation: the second registration gets 409', async () => {
    if (!up) return;
    const domain = `regcorp${stamp}.test`;
    expect((await register(`owner@${domain}`, `RegApi Corp ${stamp}`)).status).toBe(201);
    const again = await register(`someone.else@${domain.toUpperCase()}`, `RegApi Corp Two ${stamp}`);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe(`An organisation already uses the e-mail domain ${domain}. Ask its administrator to invite you.`);
    expect(cookieFrom(again)).toBe('');
    expect((await db.query('SELECT 1 FROM users WHERE lower(email) = $1', [`someone.else@${domain}`])).rowCount).toBe(0);
  });

  test('REGAPI-04 a person with a public address can be invited as team lead of another organisation', async () => {
    if (!up) return;
    const corp = await register(`boss@regcorp-inv${stamp}.test`, `RegApi Inviter ${stamp}`);
    const cookie = cookieFrom(corp);
    const teamId = corp.body.user.primary_team_id;
    const invitee = `reg-lead-${stamp}@gmail.com`;
    const inv = await post('/api/admin/invitations', cookie, { email: invitee, role: 'team_lead', scopeType: 'team', scopeId: teamId });
    expect(inv.status).toBe(201);
    const link: string = inv.body.link ?? '';
    const token = new URL(link || 'http://x/?token=').searchParams.get('token');
    expect(token).toBeTruthy();
    const accept = await request(API_URL).post('/api/auth/invitations/accept').send({ token, firstName: 'Lead', lastName: 'Person', password: NEW_PW });
    expect(accept.status).toBe(201);
    expect(accept.body.user.company_id).toBe(corp.body.user.company_id);
    const me = await get('/api/auth/me', (await login(invitee, NEW_PW)).cookie);
    expect(me.body.user.assignments.map((a: any) => `${a.role}:${a.scopeId}`)).toEqual([`team_lead:${teamId}`]);
  });
});

describe('Registration: password rules (same as invitations and resets)', () => {
  const tries: Array<[string, string, RegExp]> = [
    ['8 characters', 'Abcdef1!', /10 to 128 characters/],
    ['9 characters (the old minimum was 8)', 'Abcdefg1!', /10 to 128 characters/],
    ['one character class', 'abcdefghijkl', /three of/],
    ['two character classes', 'abcdefghij12', /three of/],
    ['contains the e-mail name', 'Weakling-2024x', /must not contain your email name/],
  ];
  for (const [what, password, message] of tries) {
    test(`REGAPI-05 ${what} is refused and nothing is created`, async () => {
      if (!up) return;
      const email = `weakling@regpw${stamp}-${Math.floor(Math.random() * 1e6)}.test`;
      const name = `RegApi Weak ${stamp} ${Math.floor(Math.random() * 1e6)}`;
      const res = await register(email, name, password);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(message);
      expect((await db.query('SELECT 1 FROM companies WHERE name = $1', [name])).rowCount).toBe(0);
    });
  }

  test('REGAPI-05 a password that meets the rules is accepted', async () => {
    if (!up) return;
    expect((await register(`strong@regpw-ok${stamp}.test`, `RegApi Strong ${stamp}`, 'Correct-Horse-42')).status).toBe(201);
  });

  test('REGAPI-06 an invalid e-mail address is refused', async () => {
    if (!up) return;
    for (const email of ['no-at-sign', 'a@b', 'two@@x.test']) {
      const res = await register(email, `RegApi Bad ${stamp} ${email}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Enter a valid e-mail address.');
    }
  });
});
