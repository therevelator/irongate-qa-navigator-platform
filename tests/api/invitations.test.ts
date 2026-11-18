import { createHash } from 'crypto';
import { backendUp, cookieFrom, del, get, localDb, login, NEW_PW, post } from './helpers/http';

/**
 * Invitations:
 *   GET  /api/admin/invitations            POST /api/admin/invitations { email, role, scopeId }
 *   POST /api/admin/invitations/:id/resend POST /api/admin/invitations/:id/revoke
 *   GET  /api/auth/invitations/:token      POST /api/auth/invitations/accept { token, firstName, lastName, password }
 * Tokens are stored hashed, are single-use, expire and can be revoked; resending replaces the token.
 * Accepting creates the user with exactly the invited assignment. Without SMTP the API returns the
 * link to copy (no silent failure).
 *
 * Runs against a live backend at API_URL (without SMTP configured); skips when none is running.
 */

const STRONG = 'Str0ng-Passw0rd';
const tokenOf = (link: string) => new URL(link).searchParams.get('token') as string;

describe('Invitations', () => {
  let up = true;
  const c: Record<string, string> = {};
  const id: Record<string, string> = {};
  const T: Record<string, string> = {};
  const D: Record<string, string> = {};
  const users: string[] = [];
  let stamp = 0;
  const email = (k: string) => `invite-${k}-${stamp}@irongate.test`;

  beforeAll(async () => {
    up = await backendUp();
    if (!up) return;
    c.admin = (await login('admin@irongate.com')).cookie;
    stamp = Date.now();
    for (const k of ['A', 'B']) D[k] = (await post('/api/admin/departments', c.admin, { name: `Invite ${k} ${stamp}` })).body.id;
    for (const [k, d] of [['A1', 'A'], ['A2', 'A'], ['B1', 'B']] as const) {
      T[k] = (await post('/api/admin/teams', c.admin, { name: `Invite ${k} ${stamp}`, departmentId: D[d] })).body.id;
    }
    const mk = async (key: string, role: string, where: object) => {
      const res = await post('/api/admin/users', c.admin, { email: email(key), password: NEW_PW, firstName: 'Invite', lastName: key, role, ...where });
      if (res.status !== 201) throw new Error(`create ${key}: ${res.status}`);
      id[key] = res.body.id;
      users.push(res.body.id);
      c[key] = (await login(email(key), NEW_PW)).cookie;
    };
    await mk('manager', 'qa_manager', { departmentId: D.A });
    await mk('lead', 'team_lead', { teamId: T.A1 });
    await mk('eng', 'qa_engineer', { teamId: T.A1 });
    const reg = await post('/api/auth/register', '', {
      email: `invite-foreign-${stamp}@other${stamp}.test`, password: NEW_PW, firstName: 'Other', lastName: 'Company',
      companyName: `Other Company ${stamp}`, departmentName: 'Ops', teamName: 'Ops Team',
    });
    c.foreign = cookieFrom(reg);
  });

  afterAll(async () => {
    if (!up) return;
    for (const u of users) await del(`/api/admin/users/${u}`, c.admin);
    for (const t of Object.values(T)) await del(`/api/admin/teams/${t}`, c.admin);
    for (const d of Object.values(D)) await del(`/api/admin/departments/${d}`, c.admin);
  });

  const skip = () => !up || !T.A1;
  const invite = (who: string, body: object) => post('/api/admin/invitations', c[who], body);
  const accept = (token: string, password = STRONG) => post('/api/auth/invitations/accept', '', { token, firstName: 'New', lastName: 'Person', password });

  it('INV-001: an invitation without SMTP returns the link to copy; the token is stored only as a hash', async () => {
    if (skip()) return;
    const res = await invite('admin', { email: email('new1'), role: 'qa_engineer', scopeId: T.A1 });
    expect(res.status).toBe(201);
    expect(res.body.delivery).toMatchObject({ delivered: false, channel: 'log' });
    expect(res.body.delivery.error).toMatch(/SMTP/);
    expect(res.body.link).toMatch(/\/accept-invite\?token=igi_/);
    expect(res.body.invitation).toMatchObject({ email: email('new1'), role: 'qa_engineer', scope_id: T.A1, status: 'open' });
    expect(JSON.stringify(res.body.invitation)).not.toMatch(/token/);

    const token = tokenOf(res.body.link);
    const db = await localDb();
    try {
      const row = (await db.query('SELECT * FROM invitations WHERE id = $1', [res.body.invitation.id])).rows[0];
      expect(row.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
      expect(JSON.stringify(row)).not.toContain(token);
    } finally {
      await db.end();
    }
    const info = await get(`/api/auth/invitations/${encodeURIComponent(token)}`);
    expect(info.status).toBe(200);
    expect(info.body).toMatchObject({ status: 'open', email: email('new1'), role: 'qa_engineer', scopeType: 'team' });
    expect(info.body.scopeName).toBe(`Invite A1 ${stamp}`);
  });

  it('INV-002: accepting enforces the password rules, then grants exactly the invited assignment and signs in', async () => {
    if (skip()) return;
    const res = await invite('admin', { email: email('new2'), role: 'viewer', scopeId: T.A2 });
    const token = tokenOf(res.body.link);
    for (const weak of ['short1A!', 'alllowercaseletters', `Invite-new2-${stamp}X1`]) {
      const r = await accept(token, weak);
      expect({ weak, status: r.status }).toEqual({ weak, status: 400 });
    }
    expect((await post('/api/auth/invitations/accept', '', { token, firstName: '', lastName: 'X', password: STRONG })).status).toBe(400);
    const ok = await accept(token);
    expect(ok.status).toBe(201);
    const cookie = cookieFrom(ok);
    expect(cookie).not.toBe('');
    users.push(ok.body.user.id);
    const me = (await get('/api/auth/me', cookie)).body.user;
    expect(me).toMatchObject({ email: email('new2'), role: 'viewer', primary_team_id: T.A2, department_id: D.A });
    expect(me.assignments.map((a: any) => `${a.role}:${a.scopeType}:${a.scopeId}`)).toEqual([`viewer:team:${T.A2}`]);
    // Access follows the assignment: their team only, read-only.
    expect((await get(`/api/analytics/flaky-tests?teamId=${T.A2}`, cookie)).status).toBe(200);
    expect((await get(`/api/analytics/flaky-tests?teamId=${T.A1}`, cookie)).status).toBe(403);
    // Password login works with the chosen password.
    expect((await login(email('new2'), STRONG)).status).toBe(200);
    // The invitation is accepted, and recorded.
    const list = (await get('/api/admin/invitations?status=accepted', c.admin)).body.invitations as any[];
    expect(list.find((i) => i.id === res.body.invitation.id)?.accepted_user_id).toBe(ok.body.user.id);
    const audit = (await get('/api/admin/audit?action=invitation.accept&limit=50', c.admin)).body.entries as any[];
    expect(audit.some((e) => e.entity_id === res.body.invitation.id)).toBe(true);
  });

  it('INV-003: a token works once', async () => {
    if (skip()) return;
    const res = await invite('admin', { email: email('new3'), role: 'qa_engineer', scopeId: T.A1 });
    const token = tokenOf(res.body.link);
    const first = await accept(token);
    expect(first.status).toBe(201);
    users.push(first.body.user.id);
    const again = await accept(token);
    expect(again.status).toBe(410);
    expect(again.body.error).toMatch(/already been used/);
    expect((await get(`/api/auth/invitations/${encodeURIComponent(token)}`)).status).toBe(410);
  });

  it('INV-004: an expired token is refused', async () => {
    if (skip()) return;
    const res = await invite('admin', { email: email('new4'), role: 'qa_engineer', scopeId: T.A1 });
    const token = tokenOf(res.body.link);
    const db = await localDb();
    try {
      await db.query(`UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE id = $1`, [res.body.invitation.id]);
    } finally {
      await db.end();
    }
    const r = await accept(token);
    expect(r.status).toBe(410);
    expect(r.body.error).toMatch(/expired/);
    const info = await get(`/api/auth/invitations/${encodeURIComponent(token)}`);
    expect(info.body.status).toBe('expired');
    // An expired invitation can be re-sent (new token, new expiry) ...
    const resent = await post(`/api/admin/invitations/${res.body.invitation.id}/resend`, c.admin);
    expect(resent.status).toBe(200);
    expect(resent.body.invitation.status).toBe('open');
    const fresh = tokenOf(resent.body.link);
    expect(fresh).not.toBe(token);
    // ... the old link still fails, the new one works.
    expect((await accept(token)).status).toBe(404);
    const ok = await accept(fresh);
    expect(ok.status).toBe(201);
    users.push(ok.body.user.id);
  });

  it('INV-005: a revoked invitation cannot be used; resend makes the previous link invalid', async () => {
    if (skip()) return;
    const res = await invite('admin', { email: email('new5'), role: 'qa_engineer', scopeId: T.A1 });
    const t1 = tokenOf(res.body.link);
    const resent = await post(`/api/admin/invitations/${res.body.invitation.id}/resend`, c.admin);
    const t2 = tokenOf(resent.body.link);
    expect((await get(`/api/auth/invitations/${encodeURIComponent(t1)}`)).status).toBe(404);
    const revoke = await post(`/api/admin/invitations/${res.body.invitation.id}/revoke`, c.admin);
    expect(revoke.status).toBe(200);
    expect(revoke.body.invitation.status).toBe('revoked');
    const r = await accept(t2);
    expect(r.status).toBe(410);
    expect(r.body.error).toMatch(/withdrawn/);
    expect((await post(`/api/admin/invitations/${res.body.invitation.id}/resend`, c.admin)).status).toBe(409);
    const db = await localDb();
    try {
      expect((await db.query('SELECT COUNT(*)::int AS n FROM users WHERE LOWER(email) = LOWER($1)', [email('new5')])).rows[0].n).toBe(0);
    } finally {
      await db.end();
    }
  });

  it('INV-006: who may invite to what (allowed and forbidden)', async () => {
    if (skip()) return;
    const cases: Array<[string, object, number]> = [
      ['manager', { email: email('m1'), role: 'qa_engineer', scopeId: T.A2 }, 201],
      ['manager', { email: email('m2'), role: 'team_lead', scopeId: T.A2 }, 201],
      ['manager', { email: email('m3'), role: 'qa_engineer', scopeId: T.B1 }, 403],
      ['manager', { email: email('m4'), role: 'qa_manager', scopeId: D.A }, 403],
      ['manager', { email: email('m5'), role: 'super_admin' }, 403],
      ['lead', { email: email('l1'), role: 'viewer', scopeId: T.A1 }, 201],
      ['lead', { email: email('l2'), role: 'qa_engineer', scopeId: T.A2 }, 403],
      ['lead', { email: email('l3'), role: 'team_lead', scopeId: T.A1 }, 403],
      ['eng', { email: email('e1'), role: 'viewer', scopeId: T.A1 }, 403],
      ['admin', { email: email('a1'), role: 'qa_manager', scopeId: D.B }, 201],
      ['admin', { email: email('a2'), role: 'team_lead', scopeId: T.A1 }, 409], // A1 already has a lead
      ['admin', { email: email('eng'), role: 'viewer', scopeId: T.A1 }, 409], // already a user here
      ['admin', { email: 'admin@irongate.com', role: 'viewer', scopeId: T.A1 }, 409],
      ['admin', { email: 'not-an-email', role: 'viewer', scopeId: T.A1 }, 400],
      ['admin', { email: email('a3'), role: 'viewer', scopeId: 'no-such-team' }, 400],
      ['foreign', { email: email('f1'), role: 'viewer', scopeId: T.A1 }, 400],
    ];
    const errors: string[] = [];
    for (const [who, body, expected] of cases) {
      const r = await invite(who, body);
      if (r.status !== expected) errors.push(`${who} ${JSON.stringify(body)} -> ${r.status} ${JSON.stringify(r.body).slice(0, 120)}, expected ${expected}`);
    }
    // A second open invitation for the same address is refused.
    const dup = await invite('admin', { email: email('m1'), role: 'viewer', scopeId: T.A1 });
    if (dup.status !== 409) errors.push(`duplicate -> ${dup.status}`);
    expect((await post('/api/admin/invitations', '', { email: email('x'), role: 'viewer', scopeId: T.A1 })).status).toBe(401);
    expect(errors).toEqual([]);
  });

  it('INV-007: the invitation list, resend and revoke follow the same scope', async () => {
    if (skip()) return;
    const all = (await get('/api/admin/invitations', c.admin)).body.invitations as any[];
    const mgrList = (await get('/api/admin/invitations', c.manager)).body.invitations as any[];
    const leadList = (await get('/api/admin/invitations', c.lead)).body.invitations as any[];
    const bInvite = all.find((i) => i.email === email('a1'));
    expect(bInvite).toBeTruthy();
    expect(mgrList.some((i) => i.id === bInvite.id)).toBe(false);
    expect(mgrList.every((i) => [T.A1, T.A2].includes(i.scope_id))).toBe(true);
    expect(leadList.every((i) => i.scope_id === T.A1 && ['qa_engineer', 'viewer'].includes(i.role))).toBe(true);
    expect((await get('/api/admin/invitations', c.eng)).status).toBe(403);
    expect(((await get('/api/admin/invitations', c.foreign)).body.invitations as any[]).some((i) => i.id === bInvite.id)).toBe(false);
    // Out-of-scope resend / revoke read as not found.
    expect((await post(`/api/admin/invitations/${bInvite.id}/revoke`, c.manager)).status).toBe(404);
    expect((await post(`/api/admin/invitations/${bInvite.id}/resend`, c.lead)).status).toBe(404);
    expect((await post(`/api/admin/invitations/${bInvite.id}/revoke`, c.foreign)).status).toBe(404);
    expect((await post(`/api/admin/invitations/${bInvite.id}/revoke`, c.admin)).status).toBe(200);
    // Withdraw the rest of this suite's open invitations.
    for (const i of all.filter((x) => x.status === 'open' && x.email.includes(String(stamp)))) await post(`/api/admin/invitations/${i.id}/revoke`, c.admin);
  });

  it('INV-008: bad tokens are rejected without revealing anything', async () => {
    if (skip()) return;
    expect((await get('/api/auth/invitations/igi_not-a-real-token')).status).toBe(404);
    expect((await get('/api/auth/invitations/garbage')).status).toBe(404);
    expect((await accept('igi_not-a-real-token')).status).toBe(404);
    expect((await post('/api/auth/invitations/accept', '', {})).status).toBe(400);
  });
});
