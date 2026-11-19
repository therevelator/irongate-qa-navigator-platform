import type { Client } from 'pg';
import { hash } from 'bcrypt';
import { backendUp, get, localDb, login, post, put } from './helpers/http';
import { DEFAULT_REMINDER_SETTINGS, effectiveReminderSettings, validateReminderSettings, addDays } from '../../server/lib/pulseRules';
import { canSetPulseReminders, type PolicyActor } from '../../server/lib/userPolicy';
import { pendingSurveysFor, runPulseReminders, reminderState, dailyNonResponders } from '../../server/lib/pulseSend';
import { submitPulseResponse } from '../../server/lib/pulse';
import { setMailerForTests, type MailMessage } from '../../server/lib/mailer';
import { pool } from '../../src/lib/db';

/**
 * Wellbeing pulse: non-response warning, automatic reminders and escalation (names of members who
 * have not answered only; answers stay anonymous).
 *
 * Fixture company "prem-co": department D (manager mgr) with team T (lead + e1..e4 + viewer; a
 * weekly period in 2030 driven through the library with a fixed "today") and team B (lead + b1..b3;
 * a weekly period around the real today, used through the live API); department D2 (manager mgr2);
 * department D3 without a manager, with team N (no lead) for the fallback to super admins.
 *
 *   PREM-001  settings validation and effective values (shortened for short periods)
 *   PREM-002  who may change the settings: lead, department manager, super admin; not engineer,
 *             viewer or a manager of another department; audited
 *   PREM-003  the warning banner: only the member's own pending surveys, only after the delay
 *   PREM-004  reminders: only members who have not answered, at the chosen frequency, at most one
 *             a day, never after the period ends; logged in pulse_sends
 *   PREM-005  escalation: once per period, to the chosen people, with the fallback; names only
 *   PREM-006  the non-responder list on the team screen: only for the people told; a member who
 *             answers drops off
 *   PREM-007  anonymity: nothing in escalation, notifications, participation or the APIs can be
 *             joined to an answer
 */

const CO = 'prem-co';
const D = 'prem-d';
const D2 = 'prem-d2';
const D3 = 'prem-d3';
const T = 'prem-team-t';
const B = 'prem-team-b';
const N = 'prem-team-n';
const PW = 'demo123';
const email = (id: string) => `${id}@prem.example`;
const MARK = `PREMCOMMENT${Date.now()}`;
const ans = (v: number) => ({ workload: v, focus: v, support: v, energy: v, outlook: v });
const T_START = '2030-01-07';
const T_END = '2030-01-14';

let up = true;
let db: Client;
let today = '';
const c: Record<string, string> = {};
const outbox: MailMessage[] = [];
const captureMailer = { channel: 'smtp' as const, async send(m: MailMessage) { outbox.push(m); return { delivered: true, channel: 'smtp' as const }; } };

async function cleanup() {
  for (const t of ['notifications', 'notification_deliveries', 'pulse_links', 'pulse_recipients', 'pulse_sends', 'pulse_settings', 'pulse_participation', 'pulse_responses', 'pulse_cadences', 'pulse_nonresponder_days', 'audit_log', 'user_activity']) {
    await db.query(`DELETE FROM ${t} WHERE company_id = $1`, [CO]).catch(() => undefined);
  }
  await db.query(`DELETE FROM role_assignments WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM team_members WHERE team_id LIKE 'prem-team-%'`);
  await db.query(`DELETE FROM users WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM teams WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM departments WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM companies WHERE id = $1`, [CO]);
}

async function addUser(id: string, role: string, scopeType: string, scopeId: string, dept = D) {
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, is_active, email_verified)
     VALUES ($1, $2, $3, 'Pr', $4, $5, $6, $7, $8, TRUE, TRUE)`,
    [id, email(id), await hash(PW, 4), id, role, CO, dept, scopeType === 'team' ? scopeId : null],
  );
  await db.query(`INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [`prem-ra-${id}`, CO, id, role, scopeType, scopeId]);
}

const surveySent = (team: string, start: string, end: string, at: string) => db.query(
  `INSERT INTO pulse_sends (company_id, team_id, period_start, period_end, kind, trigger, channel, recipients, delivered, created_at)
   VALUES ($1, $2, $3::date, $4::date, 'survey', 'manual', 'smtp', 6, 6, $5::timestamptz)`, [CO, team, start, end, at]);

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  await cleanup();
  today = (await db.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`)).rows[0].d;
  await db.query(`INSERT INTO companies (id, name, domain, is_active) VALUES ($1, 'Pulse Reminder Co', 'prem.example', TRUE)`, [CO]);
  await db.query(`INSERT INTO departments (id, company_id, name, is_active) VALUES ($1, $4, 'D', TRUE), ($2, $4, 'D2', TRUE), ($3, $4, 'D3', TRUE)`, [D, D2, D3, CO]);
  for (const [id, dept, name] of [[T, D, 'Team T'], [B, D, 'Team B'], [N, D3, 'Team N']]) {
    await db.query(`INSERT INTO teams (id, company_id, department_id, name, is_active, ai_enabled, exclude_from_auto_sync) VALUES ($1, $2, $3, $4, TRUE, FALSE, TRUE)`, [id, CO, dept, name]);
  }
  await addUser('prem-admin', 'super_admin', 'company', CO);
  await addUser('prem-mgr', 'qa_manager', 'department', D);
  await addUser('prem-mgr2', 'qa_manager', 'department', D2, D2);
  await addUser('prem-lead', 'team_lead', 'team', T);
  for (const id of ['prem-e1', 'prem-e2', 'prem-e3', 'prem-e4']) await addUser(id, 'qa_engineer', 'team', T);
  await addUser('prem-viewer', 'viewer', 'team', T);
  await addUser('prem-blead', 'team_lead', 'team', B);
  for (const id of ['prem-b1', 'prem-b2', 'prem-b3']) await addUser(id, 'qa_engineer', 'team', B);
  for (const id of ['prem-n1', 'prem-n2']) await addUser(id, 'qa_engineer', 'team', N, D3);
  // Team T: weekly from 2030-01-07; team N the same; team B: weekly from 3 days ago (real dates).
  await db.query(`INSERT INTO pulse_cadences (company_id, team_id, cadence, effective_from) VALUES ($1, $2, 'weekly', $3), ($1, $4, 'weekly', $3), ($1, $5, 'weekly', ($6::date - 3))`,
    [CO, T, T_START, N, B, today]);
  await surveySent(T, T_START, T_END, `${T_START}T09:00:00Z`);
  await surveySent(N, T_START, T_END, `${T_START}T09:00:00Z`);
  await surveySent(B, addDays(today, -3), addDays(today, 4), `${addDays(today, -3)}T09:00:00Z`);
  for (const who of ['prem-admin', 'prem-mgr', 'prem-mgr2', 'prem-lead', 'prem-e1', 'prem-viewer', 'prem-blead', 'prem-b1', 'prem-b2']) c[who] = (await login(email(who))).cookie;
  setMailerForTests(captureMailer);
}, 60000);

afterAll(async () => {
  setMailerForTests(null);
  if (db) { await cleanup(); await db.end(); }
  await pool.end().catch(() => undefined);
});

describe('Pulse reminders: rules', () => {
  test('PREM-001 validation and effective values', () => {
    const d = DEFAULT_REMINDER_SETTINGS;
    expect(d).toEqual({ warningAfterDays: 2, reminderEmails: true, reminderEveryDays: 3, escalateAfterDays: 5, escalateTo: 'both' });
    expect(validateReminderSettings({ warningAfterDays: 5, escalateAfterDays: 5 }, d)).toHaveProperty('error');
    expect(validateReminderSettings({ warningAfterDays: -1 }, d)).toHaveProperty('error');
    expect(validateReminderSettings({ reminderEveryDays: 0 }, d)).toHaveProperty('error');
    expect(validateReminderSettings({ escalateAfterDays: 61 }, d)).toHaveProperty('error');
    expect(validateReminderSettings({ escalateAfterDays: 2.5 }, d)).toHaveProperty('error');
    expect(validateReminderSettings({ escalateTo: 'everyone' }, d)).toHaveProperty('error');
    expect(validateReminderSettings({ reminderEmails: 'yes' }, d)).toHaveProperty('error');
    expect(validateReminderSettings({ escalateAfterDays: 10, escalateTo: 'team_lead' }, d)).toEqual({ settings: { ...d, escalateAfterDays: 10, escalateTo: 'team_lead' } });
    // Weekly (7 days): defaults fit; 10 days becomes 6 (before the period ends), the warning stays before it.
    expect(effectiveReminderSettings(d, 7)).toEqual({ warningAfterDays: 2, reminderEveryDays: 3, escalateAfterDays: 5, shortened: false });
    expect(effectiveReminderSettings({ ...d, warningAfterDays: 8, escalateAfterDays: 10 }, 7)).toEqual({ warningAfterDays: 5, reminderEveryDays: 3, escalateAfterDays: 6, shortened: true });
    expect(effectiveReminderSettings(d, 3).escalateAfterDays).toBe(2);
    expect(effectiveReminderSettings(d, 3).warningAfterDays).toBe(1);
  });

  test('PREM-002a policy: lead, department manager and super admin; not engineer, viewer or another manager', () => {
    const team = { id: 'tm', department_id: 'dep' };
    const a = (role: string, scopeType: string, scopeId: string): PolicyActor => ({ id: 'x', role, grants: [{ role, scopeType, scopeId }] });
    expect(canSetPulseReminders(a('team_lead', 'team', 'tm'), team)).toBe(true);
    expect(canSetPulseReminders(a('team_lead', 'team', 'other'), team)).toBe(false);
    expect(canSetPulseReminders(a('qa_manager', 'department', 'dep'), team)).toBe(true);
    expect(canSetPulseReminders(a('qa_manager', 'department', 'other'), team)).toBe(false);
    expect(canSetPulseReminders(a('super_admin', 'company', 'co'), team)).toBe(true);
    expect(canSetPulseReminders(a('qa_engineer', 'team', 'tm'), team)).toBe(false);
    expect(canSetPulseReminders(a('viewer', 'team', 'tm'), team)).toBe(false);
  });
});

describe('Pulse reminders: live', () => {
  test('PREM-002b settings API: allowed roles save (audited), others refused, invalid values 400', async () => {
    if (!up) return;
    for (const who of ['prem-e1', 'prem-viewer', 'prem-mgr2']) {
      expect({ who, s: (await put(`/api/pulse/teams/${T}/settings`, c[who], { escalateAfterDays: 4 })).status }).toEqual({ who, s: 403 });
    }
    expect((await put(`/api/pulse/teams/${T}/settings`, c['prem-lead'], { warningAfterDays: 6, escalateAfterDays: 5 })).status).toBe(400);
    for (const who of ['prem-lead', 'prem-mgr', 'prem-admin']) {
      const r = await put(`/api/pulse/teams/${T}/settings`, c[who], { escalateAfterDays: 5, reminderEveryDays: 3, escalateTo: 'both' });
      expect({ who, s: r.status }).toEqual({ who, s: 200 });
    }
    const big = await put(`/api/pulse/teams/${T}/settings`, c['prem-mgr'], { escalateAfterDays: 10 });
    expect(big.body.reminders.settings.escalateAfterDays).toBe(10);
    await put(`/api/pulse/teams/${T}/settings`, c['prem-mgr'], { escalateAfterDays: 5 });
    const audit = await db.query(`SELECT summary FROM audit_log WHERE company_id = $1 AND action = 'team.pulse_reminders'`, [CO]);
    expect(audit.rows.length).toBe(5);
    expect(audit.rows[0].summary).toMatch(/warning after 2 days, reminder e-mails every 3 days, escalation after 5 days/);
    // The team screen: settings only for those who may change them; recipients named.
    const lead = await get(`/api/pulse/teams/${T}`, c['prem-lead']);
    expect(lead.body.canSetReminders).toBe(true);
    expect(lead.body.reminders.recipients.sort()).toEqual(['Pr prem-lead', 'Pr prem-mgr']);
    expect(lead.body.reminders.fallbackToAdmins).toBe(false);
    const eng = await get(`/api/pulse/teams/${T}`, c['prem-e1']);
    expect(eng.body).toMatchObject({ canSetReminders: false, reminders: null, nonResponders: null });
    // Saving reminders first must not switch automatic sending on (or decide it).
    const n = await put(`/api/pulse/teams/${N}/settings`, c['prem-admin'], { escalateTo: 'both' });
    expect(n.body.reminders.fallbackToAdmins).toBe(true);
    expect(n.body.reminders.recipients).toEqual(['Pr prem-admin']);
    expect((await db.query(`SELECT auto_send FROM pulse_settings WHERE team_id = $1`, [N])).rows[0].auto_send).toBe(false);
  });

  test('PREM-003 banner: own pending surveys only, after the warning delay', async () => {
    if (!up) return;
    // Library, team T (sent 2030-01-07, warning after 2 days).
    const e1 = { id: 'prem-e1', role: 'qa_engineer', grants: [{ role: 'qa_engineer', scopeType: 'team', scopeId: T }] };
    expect(await pendingSurveysFor(e1, CO, '2030-01-08')).toEqual([]);
    expect((await pendingSurveysFor(e1, CO, '2030-01-09')).map((p) => p.teamId)).toEqual([T]);
    // Live, team B (sent 3 days ago): each member sees only their own state.
    const b1 = await get('/api/pulse/pending', c['prem-b1']);
    expect(b1.status).toBe(200);
    expect(b1.body.pending.map((p: any) => p.teamId)).toEqual([B]);
    expect(Object.keys(b1.body.pending[0]).sort()).toEqual(['period', 'teamId', 'teamName']);
    expect((await get('/api/pulse/pending', c['prem-admin'])).body.pending).toEqual([]); // not a member
    expect((await get('/api/pulse/pending', c['prem-mgr'])).body.pending).toEqual([]);
    expect((await post(`/api/pulse/teams/${B}/responses`, c['prem-b1'], { answers: ans(4), comment: MARK })).status).toBe(201);
    expect((await get('/api/pulse/pending', c['prem-b1'])).body.pending).toEqual([]);
    expect((await get('/api/pulse/pending', c['prem-b2'])).body.pending.map((p: any) => p.teamId)).toEqual([B]);
  });

  test('PREM-004 reminders: non-responders only, every 3 days, once a day, never after the period', async () => {
    if (!up) return;
    await submitPulseResponse({ companyId: CO, teamId: T, userId: 'prem-e1', answers: ans(5), comment: `${MARK}-t`, today: T_START });
    outbox.length = 0;
    expect((await runPulseReminders('2030-01-09', { teamIds: [T] })).reminded).toBe(0); // 2 days < 3
    const r1 = await runPulseReminders('2030-01-10', { teamIds: [T] });
    expect(r1.reminded).toBe(5);
    const to = outbox.map((m) => m.to).sort();
    expect(to).toEqual(['prem-e2', 'prem-e3', 'prem-e4', 'prem-lead', 'prem-viewer'].map(email).sort());
    expect(outbox.every((m) => /Reminder/.test(m.subject) && /token=igp_/.test(m.text))).toBe(true);
    expect(outbox[0].text).toContain('Your manager can see whether you have responded, not what you answered.');
    expect((await runPulseReminders('2030-01-10', { teamIds: [T] })).reminded).toBe(0); // once a day
    expect((await runPulseReminders('2030-01-11', { teamIds: [T] })).reminded).toBe(0); // every 3 days
    await submitPulseResponse({ companyId: CO, teamId: T, userId: 'prem-e2', answers: ans(1), comment: null, today: '2030-01-11' });
    outbox.length = 0;
    const r2 = await runPulseReminders('2030-01-13', { teamIds: [T] });
    expect(r2.reminded).toBe(4);
    expect(outbox.map((m) => m.to)).not.toContain(email('prem-e2'));
    expect(outbox.map((m) => m.to)).not.toContain(email('prem-e1'));
    outbox.length = 0;
    expect((await runPulseReminders(T_END, { teamIds: [T] })).reminded).toBe(0); // next period: nothing sent there
    expect((await runPulseReminders('2030-01-16', { teamIds: [T] })).reminded).toBe(0);
    expect(outbox).toHaveLength(0);
    const sends = await db.query(`SELECT recipients, answered, trigger FROM pulse_sends WHERE team_id = $1 AND kind = 'reminder' ORDER BY created_at`, [T]);
    expect(sends.rows).toEqual([{ recipients: 5, answered: 1, trigger: 'auto' }, { recipients: 4, answered: 2, trigger: 'auto' }]);
  });

  test('PREM-005 escalation: once per period, to lead and managers (fallback: super admins), names only', async () => {
    if (!up) return;
    // T escalated with the 2030-01-13 run above (6 days >= 5).
    const esc = await db.query(`SELECT * FROM pulse_sends WHERE team_id = $1 AND kind = 'escalation'`, [T]);
    expect(esc.rows).toHaveLength(1);
    expect(esc.rows[0].escalated_to.sort()).toEqual(['prem-lead', 'prem-mgr']);
    const notes = await db.query(`SELECT user_id, kind, title, body FROM notifications WHERE company_id = $1 AND team_id = $2 ORDER BY user_id`, [CO, T]);
    expect(notes.rows.map((r: any) => r.user_id)).toEqual(['prem-lead', 'prem-mgr']);
    const body = notes.rows[0].body as string;
    expect(notes.rows[0].kind).toBe('pulse');
    expect(notes.rows[0].title).toBe('Wellbeing pulse: 4 not answered yet · Team T');
    expect(body).toContain('Not answered yet: Pr prem-e3, Pr prem-e4, Pr prem-lead, Pr prem-viewer.');
    expect(body).toContain('Response rate so far: 33% (2 of 6 members)');
    expect(body).not.toMatch(/prem-e1|prem-e2/);
    // Once per period.
    expect((await runPulseReminders('2030-01-13', { teamIds: [T] })).escalated).toBe(0);
    expect((await db.query(`SELECT 1 FROM pulse_sends WHERE team_id = $1 AND kind = 'escalation'`, [T])).rows).toHaveLength(1);
    // Not before the delay; fallback to super admins for team N (no lead, no department manager).
    expect((await runPulseReminders('2030-01-11', { teamIds: [N] })).escalated).toBe(0);
    expect((await runPulseReminders('2030-01-12', { teamIds: [N] })).escalated).toBe(1);
    const nn = await db.query(`SELECT user_id FROM notifications WHERE company_id = $1 AND team_id = $2`, [CO, N]);
    expect(nn.rows.map((r: any) => r.user_id)).toEqual(['prem-admin']);
    const audit = await db.query(`SELECT summary FROM audit_log WHERE company_id = $1 AND action = 'team.pulse_escalation' ORDER BY created_at`, [CO]);
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows[1].summary).toMatch(/super admins \(no one holds the chosen role\)/);
    // Only the lead as recipient.
    await db.query(`UPDATE pulse_settings SET escalate_to = 'team_lead' WHERE team_id = $1`, [T]);
    expect((await reminderState(T, '2030-01-13')).settings.escalateTo).toBe('team_lead');
  });

  test('PREM-006 the non-responder list: only for the people told; a daily snapshot, answering drops you off the next day', async () => {
    if (!up) return;
    await put(`/api/pulse/teams/${B}/settings`, c['prem-mgr'], { warningAfterDays: 1, escalateAfterDays: 3, escalateTo: 'team_lead' });
    expect((await runPulseReminders(today, { teamIds: [B] })).escalated).toBe(1);
    const lead = await get(`/api/pulse/teams/${B}`, c['prem-blead']);
    expect(lead.body.nonResponders.members.map((m: any) => m.name)).toEqual(['Pr prem-b2', 'Pr prem-b3', 'Pr prem-blead']);
    expect(Object.keys(lead.body.nonResponders.members[0]).sort()).toEqual(['id', 'name']);
    expect((await get(`/api/pulse/teams/${B}`, c['prem-mgr'])).body.nonResponders).toBeNull(); // not told (team_lead only)
    expect((await get(`/api/pulse/teams/${B}`, c['prem-b1'])).body.nonResponders).toBeNull();
    expect(lead.body.nonResponders.asOf).toBe(today);
    expect((await post(`/api/pulse/teams/${B}/responses`, c['prem-b2'], { answers: ans(2), comment: null })).status).toBe(201);
    // Same day: the list does not move, whatever runs or whoever looks.
    await runPulseReminders(today, { teamIds: [B] });
    const sameDay = await get(`/api/pulse/teams/${B}`, c['prem-blead']);
    expect(sameDay.body.nonResponders.members.map((m: any) => m.name)).toEqual(['Pr prem-b2', 'Pr prem-b3', 'Pr prem-blead']);
    // The next day's snapshot (the hourly job's first run of that day) drops the member who answered.
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    await runPulseReminders(tomorrow, { teamIds: [B] });
    const next = await dailyNonResponders(B, lead.body.currentPeriod.start, tomorrow);
    expect(next).toEqual({ asOf: tomorrow, members: expect.any(Array) });
    expect(next!.members.map((m) => m.name)).toEqual(['Pr prem-b3', 'Pr prem-blead']);
    const snap = await db.query(`SELECT * FROM pulse_nonresponder_days WHERE team_id = $1 ORDER BY day`, [B]);
    expect(Object.keys(snap.rows[0]).sort()).toEqual(['company_id', 'day', 'period_start', 'team_id', 'user_ids']);
  });

  test('PREM-007 anonymity: nothing here joins a person to an answer', async () => {
    if (!up) return;
    const cols = async (t: string) => (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name`, [t])).rows.map((r: any) => r.column_name);
    expect(await cols('pulse_participation')).toEqual(['company_id', 'period_start', 'team_id', 'user_id']);
    const resp = await cols('pulse_responses');
    expect(resp).not.toContain('user_id');
    expect(resp).not.toContain('created_at');
    const everything = JSON.stringify([
      (await db.query(`SELECT * FROM notifications WHERE company_id = $1`, [CO])).rows,
      (await db.query(`SELECT * FROM notification_deliveries WHERE company_id = $1`, [CO])).rows,
      (await db.query(`SELECT * FROM pulse_sends WHERE company_id = $1`, [CO])).rows,
      (await db.query(`SELECT * FROM audit_log WHERE company_id = $1`, [CO])).rows,
      (await db.query(`SELECT * FROM user_activity WHERE company_id = $1`, [CO])).rows,
      (await get(`/api/pulse/teams/${B}`, c['prem-blead'])).body.nonResponders,
      (await get('/api/pulse/pending', c['prem-b2'])).body,
    ]);
    expect(everything).not.toContain(MARK);
    expect(everything).not.toMatch(/q_workload|q_focus|q_support|q_energy|q_outlook/);
    expect(everything).not.toContain('/api/pulse/teams/:teamId/responses');
    // The team screen of a member never lists anyone.
    const member = (await get(`/api/pulse/teams/${B}`, c['prem-b1'])).body;
    expect(member.nonResponders).toBeNull();
    expect(JSON.stringify(member)).not.toMatch(/prem-b2|prem-b3/);
  });
});
