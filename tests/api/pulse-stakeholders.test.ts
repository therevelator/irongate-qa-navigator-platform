/**
 * Wellbeing pulse recipients are the team's MEMBERS only (server/lib/assignments.ts PULSE_MEMBER_SQL):
 * the team lead, the software engineers and a viewer listed in team_members (the Product Owner).
 * A stakeholder who only has read access to the team (a viewer assignment without a team_members
 * row: Head of Product, Finance Controller, external auditor) is never a recipient.
 *
 *   PSTK-001 the survey is e-mailed to the members only; "Not sent yet" lists members only
 *   PSTK-002 the response-rate denominator (recipients of the send) counts members only
 *   PSTK-003 a stakeholder cannot answer (403, canRespond false); the Product Owner (viewer in team_members) can
 *   PSTK-004 reminders and the non-responder names (escalation) never include the stakeholder
 *   PSTK-005 the pending-survey banner never asks the stakeholder
 */
import type { Client } from 'pg';
import { hash } from 'bcrypt';
import { backendUp, get, localDb, login, post } from './helpers/http';
import { nonResponders, pendingSurveysFor, remindPulseSurvey, sendPulseSurvey, sendStatus, sentCounts } from '../../server/lib/pulseSend';
import { loadGrants } from '../../server/lib/assignments';
import { setMailerForTests, type MailMessage } from '../../server/lib/mailer';
import { pool } from '../../src/lib/db';

const CO = 'pstk-co';
const D = 'pstk-dept';
const T = 'pstk-team';
const PW = 'demo123';
const email = (id: string) => `${id}@pstk.example`;
const MEMBERS = ['pstk-lead', 'pstk-e1', 'pstk-e2', 'pstk-e3', 'pstk-po'];
const STAKEHOLDER = 'pstk-auditor';
const answers = (v: number) => ({ workload: v, focus: v, support: v, energy: v, outlook: v });

let up = true;
let db: Client;
const c: Record<string, string> = {};
const outbox: MailMessage[] = [];
const captureMailer = { channel: 'smtp' as const, async send(m: MailMessage) { outbox.push(m); return { delivered: true, channel: 'smtp' as const }; } };
const team = { id: T, name: 'Stakeholder Team', department_id: D };

async function cleanup() {
  for (const t of ['notifications', 'notification_deliveries', 'pulse_links', 'pulse_recipients', 'pulse_sends', 'pulse_settings', 'pulse_participation', 'pulse_responses', 'pulse_cadences', 'pulse_nonresponder_days', 'audit_log', 'user_activity']) {
    await db.query(`DELETE FROM ${t} WHERE company_id = $1`, [CO]).catch(() => undefined);
  }
  await db.query(`DELETE FROM role_assignments WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM team_members WHERE team_id = $1`, [T]);
  await db.query(`DELETE FROM users WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM teams WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM departments WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM companies WHERE id = $1`, [CO]);
}

async function addUser(id: string, role: string, scopeType: string, scopeId: string, member: boolean) {
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, is_active, email_verified)
     VALUES ($1, $2, $3, 'Ps', $4, $5, $6, $7, $8, TRUE, TRUE)`,
    [id, email(id), await hash(PW, 4), id, role, CO, D, scopeType === 'team' && member ? scopeId : null],
  );
  await db.query(`INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [`pstk-ra-${id}`, CO, id, role, scopeType, scopeId]);
  if (member) await db.query(`INSERT INTO team_members (user_id, team_id, role) VALUES ($1, $2, $3)`, [id, T, role === 'team_lead' ? 'lead' : 'member']);
}

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  await cleanup();
  await db.query(`INSERT INTO companies (id, name, domain, is_active) VALUES ($1, 'Pulse Stakeholder Co', 'pstk.example', TRUE)`, [CO]);
  await db.query(`INSERT INTO departments (id, company_id, name, is_active) VALUES ($1, $2, 'D', TRUE)`, [D, CO]);
  await db.query(`INSERT INTO teams (id, company_id, department_id, name, is_active, ai_enabled, exclude_from_auto_sync) VALUES ($1, $2, $3, $4, TRUE, FALSE, TRUE)`, [T, CO, D, team.name]);
  await addUser('pstk-admin', 'super_admin', 'company', CO, false);
  await addUser('pstk-lead', 'team_lead', 'team', T, true);
  for (const id of ['pstk-e1', 'pstk-e2', 'pstk-e3']) await addUser(id, 'qa_engineer', 'team', T, true);
  await addUser('pstk-po', 'viewer', 'team', T, true); // Product Owner: works in the team
  await addUser(STAKEHOLDER, 'viewer', 'team', T, false); // read access only
  for (const who of ['pstk-lead', 'pstk-e1', 'pstk-po', STAKEHOLDER]) c[who] = (await login(email(who))).cookie;
  setMailerForTests(captureMailer);
}, 60000);

afterAll(async () => {
  setMailerForTests(null);
  if (db) { await cleanup(); await db.end(); }
  await pool.end().catch(() => undefined);
});

describe('Pulse recipients: team members only', () => {
  it('PSTK-001: the survey goes to the members only; "Not sent yet" lists members only', async () => {
    if (!up) return;
    const before = await sendStatus(team);
    expect(before.members).toBe(MEMBERS.length);
    expect(before.notSent.map((m) => m.id).sort()).toEqual([...MEMBERS].sort());
    const out = await sendPulseSurvey({ companyId: CO, team, actorId: 'pstk-lead', trigger: 'manual' });
    expect(out?.recipients).toBe(MEMBERS.length);
    expect(outbox.map((m) => m.to).sort()).toEqual(MEMBERS.map(email).sort());
    expect(outbox.some((m) => m.to === email(STAKEHOLDER))).toBe(false);
    const rec = (await db.query('SELECT user_id FROM pulse_recipients WHERE team_id = $1', [T])).rows.map((r: any) => r.user_id);
    expect(rec).not.toContain(STAKEHOLDER);
  });

  it('PSTK-002: the response-rate denominator counts the members only', async () => {
    if (!up) return;
    const st = await sendStatus(team);
    expect(st.sent).toBe(MEMBERS.length);
    expect(st.notSent).toEqual([]);
    const counts = await sentCounts(T, [st.period.start]);
    expect(counts.get(st.period.start)).toBe(MEMBERS.length);
    const page = await get(`/api/pulse/teams/${T}`, c['pstk-lead']);
    expect(page.status).toBe(200);
    expect(page.body.sending.members).toBe(MEMBERS.length);
  });

  it('PSTK-003: a stakeholder cannot answer; the Product Owner (a viewer in team_members) can', async () => {
    if (!up) return;
    const s = await get(`/api/pulse/teams/${T}`, c[STAKEHOLDER]);
    expect(s.status).toBe(200);
    expect(s.body.canRespond).toBe(false);
    expect((await post(`/api/pulse/teams/${T}/responses`, c[STAKEHOLDER], { answers: answers(4) })).status).toBe(403);
    expect((await get(`/api/pulse/teams/${T}`, c['pstk-po'])).body.canRespond).toBe(true);
    expect((await post(`/api/pulse/teams/${T}/responses`, c['pstk-po'], { answers: answers(4) })).status).toBe(201);
  });

  it('PSTK-004: reminders and non-responder names never include the stakeholder', async () => {
    if (!up) return;
    const st = await sendStatus(team);
    const pending = (await nonResponders(T, st.period.start)).map((m) => m.id);
    expect(pending).not.toContain(STAKEHOLDER);
    expect(pending.sort()).toEqual(MEMBERS.filter((m) => m !== 'pstk-po').sort());
    outbox.length = 0;
    await remindPulseSurvey({ companyId: CO, team, actorId: 'pstk-lead' });
    expect(outbox.length).toBe(MEMBERS.length - 1);
    expect(outbox.some((m) => m.to === email(STAKEHOLDER))).toBe(false);
  });

  it('PSTK-005: the pending-survey banner never asks the stakeholder (an engineer who has not answered is asked)', async () => {
    if (!up) return;
    // The survey went out on the first day of the current period, and "today" is 4 days later (still inside the
    // period, whatever the weekday the test runs on), long enough ago for the banner.
    const { period } = await sendStatus(team);
    const day = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const today = day(period.start, 4) < period.end ? day(period.start, 4) : day(period.end, -1);
    await db.query(`UPDATE pulse_sends SET created_at = $2::date + interval '9 hours' WHERE team_id = $1`, [T, period.start]);
    await db.query(`UPDATE pulse_recipients SET first_sent_at = $2::date + interval '9 hours' WHERE team_id = $1`, [T, period.start]).catch(() => undefined);
    const actor = async (id: string, role: string) => ({ id, role, grants: await loadGrants(CO, id) });
    const eng = await pendingSurveysFor(await actor('pstk-e1', 'qa_engineer') as any, CO, today);
    const stake = await pendingSurveysFor(await actor(STAKEHOLDER, 'viewer') as any, CO, today);
    expect(stake).toEqual([]);
    expect(eng.map((p) => p.teamId)).toEqual([T]);
  });
});
