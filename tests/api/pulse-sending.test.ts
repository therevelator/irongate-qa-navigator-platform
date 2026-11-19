import fs from 'fs';
import { createHash } from 'crypto';
import type { Client } from 'pg';
import { hash } from 'bcrypt';
import { backendUp, get, localDb, login, post, put } from './helpers/http';
import {
  addDays, addMonths, calendarUnitStart, nextCalendarBoundary, nextPeriod, periodDays, periodFor, planCadenceChange, previousPeriod,
  type CadenceRow,
} from '../../server/lib/pulseRules';
import { canSendPulseSurvey, canSetPulseCadence, type PolicyActor } from '../../server/lib/userPolicy';
import {
  autoSendWindowDays, hashPulseToken, inAutoSendWindow, remindPulseSurvey, reminderCountShown, responseRate, runPulseAutoSend,
  sendPulseSurvey, sendStatus,
} from '../../server/lib/pulseSend';
import { PulseError } from '../../server/lib/pulse';
import { setMailerForTests, type MailMessage } from '../../server/lib/mailer';
import { pool } from '../../src/lib/db';

/**
 * Wellbeing pulse: cadences (every week / two weeks / month / three months, managers decide),
 * e-mailing the survey with personal single-use links, reminders, automatic sending per period,
 * answering through a link, response rates, and that none of it reveals who answered what.
 *
 * Fixture company "psend-co": department D with team T (lead, 4 engineers, viewer) and team S
 * (lead + 3 engineers); department D2 with team U. The pure rules run always; the rest against a
 * live backend at API_URL (log mailer: e-mail not configured) and, for delivered mail, in-process
 * with a capturing test mailer on the same LOCAL database. Skips the live part when no backend runs.
 */

const CO = 'psend-co';
const D = 'psend-dept';
const D2 = 'psend-dept-2';
const T = 'psend-team-t';
const S = 'psend-team-s';
const U = 'psend-team-u';
const PW = 'demo123';
const MEMBERS_T = ['psend-lead', 'psend-e1', 'psend-e2', 'psend-e3', 'psend-e4', 'psend-viewer'];
const MEMBERS_S = ['psend-slead', 'psend-s1', 'psend-s2', 'psend-s3'];
const email = (id: string) => `${id}@psend.example`;
const answers = (v: number) => ({ workload: v, focus: v, support: v, energy: v, outlook: v });

let up = true;
let db: Client;
const c: Record<string, string> = {};
let today = '';

/* ------------------------------------------------------------------------------------------
 * Pure rules (no backend needed)
 * ---------------------------------------------------------------------------------------- */

describe('Cadence arithmetic (server/lib/pulseRules.ts)', () => {
  const monthly: CadenceRow[] = [{ cadence: 'monthly', effective_from: '2026-01-01' }];
  const quarterly: CadenceRow[] = [{ cadence: 'quarterly', effective_from: '2026-01-01' }];

  it('PSEND-001: calendar helpers: unit starts, month addition across years, next boundary', () => {
    expect(calendarUnitStart('2026-08-15', 1)).toBe('2026-08-01');
    expect(calendarUnitStart('2026-08-15', 3)).toBe('2026-07-01');
    expect(calendarUnitStart('2026-12-31', 3)).toBe('2026-10-01');
    expect(addMonths('2026-11-01', 3)).toBe('2027-02-01');
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
    expect(nextCalendarBoundary('2026-12-31', 1)).toBe('2027-01-01');
    expect(nextCalendarBoundary('2026-10-01', 3)).toBe('2027-01-01');
  });

  it('PSEND-002: monthly periods are calendar months (28, 29, 30, 31 days; leap years; year end)', () => {
    expect(periodFor(monthly, '2026-01-15')).toEqual({ start: '2026-01-01', end: '2026-02-01', cadence: 'monthly' });
    expect(periodFor(monthly, '2026-02-28')).toMatchObject({ start: '2026-02-01', end: '2026-03-01' });
    expect(periodDays(periodFor(monthly, '2026-02-10'))).toBe(28);
    expect(periodDays(periodFor(monthly, '2026-04-30'))).toBe(30);
    expect(periodDays(periodFor(monthly, '2026-07-31'))).toBe(31);
    expect(periodFor(monthly, '2026-12-31')).toMatchObject({ start: '2026-12-01', end: '2027-01-01' });
    expect(periodFor(monthly, '2027-01-01')).toMatchObject({ start: '2027-01-01', end: '2027-02-01' });
    const leap: CadenceRow[] = [{ cadence: 'monthly', effective_from: '2028-01-01' }];
    expect(periodFor(leap, '2028-02-29')).toMatchObject({ start: '2028-02-01', end: '2028-03-01' });
    expect(periodDays(periodFor(leap, '2028-02-29'))).toBe(29);
    expect(periodDays(periodFor(monthly, '2027-02-14'))).toBe(28); // 2027 is not a leap year
    expect(previousPeriod(monthly, '2026-03-10')).toMatchObject({ start: '2026-02-01', end: '2026-03-01' });
    expect(nextPeriod(monthly, '2026-12-10')).toMatchObject({ start: '2027-01-01', end: '2027-02-01' });
  });

  it('PSEND-003: quarterly periods are calendar quarters (boundaries, lengths 90-92, leap Q1, across the year)', () => {
    expect(periodFor(quarterly, '2026-03-31')).toEqual({ start: '2026-01-01', end: '2026-04-01', cadence: 'quarterly' });
    expect(periodFor(quarterly, '2026-04-01')).toMatchObject({ start: '2026-04-01', end: '2026-07-01' });
    expect(periodFor(quarterly, '2026-11-18')).toMatchObject({ start: '2026-10-01', end: '2027-01-01' });
    expect(periodFor(quarterly, '2027-02-01')).toMatchObject({ start: '2027-01-01', end: '2027-04-01' });
    expect(previousPeriod(quarterly, '2027-01-01')).toMatchObject({ start: '2026-10-01', end: '2027-01-01' });
    expect(periodDays(periodFor(quarterly, '2026-02-01'))).toBe(90);
    expect(periodDays(periodFor([{ cadence: 'quarterly', effective_from: '2028-01-01' }], '2028-02-01'))).toBe(91);
    expect(periodDays(periodFor(quarterly, '2026-08-01'))).toBe(92);
  });

  it('PSEND-004: a calendar cadence starting mid-month runs to the month / quarter end; a stub under 7 days joins the next one', () => {
    const rows: CadenceRow[] = [{ cadence: 'weekly', effective_from: '2026-01-05' }, { cadence: 'monthly', effective_from: '2026-11-23' }];
    expect(periodFor(rows, '2026-11-20')).toEqual({ start: '2026-11-16', end: '2026-11-23', cadence: 'weekly' });
    expect(periodFor(rows, '2026-11-23')).toEqual({ start: '2026-11-23', end: '2026-12-01', cadence: 'monthly' });
    expect(periodFor(rows, '2026-12-05')).toMatchObject({ start: '2026-12-01', end: '2027-01-01' });
    const short: CadenceRow[] = [{ cadence: 'monthly', effective_from: '2026-11-27' }];
    expect(periodFor(short, '2026-12-15')).toMatchObject({ start: '2026-11-27', end: '2027-01-01' });
    expect(periodFor(short, '2027-01-02')).toMatchObject({ start: '2027-01-01', end: '2027-02-01' });
    expect(periodFor([{ cadence: 'quarterly', effective_from: '2026-11-23' }], '2026-12-01')).toMatchObject({ start: '2026-11-23', end: '2027-01-01' });
    expect(periodFor([{ cadence: 'quarterly', effective_from: '2026-12-28' }], '2027-02-01')).toMatchObject({ start: '2026-12-28', end: '2027-04-01' });
  });

  it('PSEND-005: a change takes effect from the next period; the running period keeps its length; same cadence cancels', () => {
    // Default: biweekly from Monday 2026-01-05 -> 9-23 Nov 2026.
    expect(periodFor([], '2026-11-18')).toMatchObject({ start: '2026-11-09', end: '2026-11-23', cadence: 'biweekly' });
    const plan = planCadenceChange([], '2026-11-18', 'monthly');
    expect(plan).toEqual({ current: 'biweekly', insert: { cadence: 'monthly', effective_from: '2026-11-23' } });
    const rows = [plan.insert!];
    expect(periodFor(rows, '2026-11-18')).toMatchObject({ start: '2026-11-09', end: '2026-11-23', cadence: 'biweekly' });
    expect(periodFor(rows, '2026-11-25')).toMatchObject({ start: '2026-11-23', end: '2026-12-01', cadence: 'monthly' });
    expect(planCadenceChange([], '2026-11-18', 'biweekly')).toEqual({ current: 'biweekly', insert: null });
    // Monthly -> weekly: weeks counted from the first of the next month.
    const m: CadenceRow[] = [{ cadence: 'monthly', effective_from: '2026-01-01' }];
    const toWeekly = planCadenceChange(m, '2026-11-18', 'weekly');
    expect(toWeekly.insert).toEqual({ cadence: 'weekly', effective_from: '2026-12-01' });
    expect(periodFor([...m, toWeekly.insert!], '2026-12-09')).toMatchObject({ start: '2026-12-08', end: '2026-12-15', cadence: 'weekly' });
    expect(planCadenceChange(m, '2026-11-18', 'quarterly').insert).toEqual({ cadence: 'quarterly', effective_from: '2026-12-01' });
  });

  it('PSEND-006: automatic sending only in the first days of a period; reminder counts and response rates', () => {
    const week = { start: '2026-11-23', end: '2026-11-30' };
    expect(autoSendWindowDays(week)).toBe(2);
    expect(inAutoSendWindow(week, '2026-11-23', null)).toBe(true);
    expect(inAutoSendWindow(week, '2026-11-24', null)).toBe(true);
    expect(inAutoSendWindow(week, '2026-11-25', null)).toBe(false);
    expect(inAutoSendWindow(week, '2026-11-23', '2026-11-30')).toBe(false); // switched on for the next period
    expect(autoSendWindowDays({ start: '2026-10-01', end: '2027-01-01' })).toBe(23);
    expect([0, 1, 2, 3, null].map(reminderCountShown)).toEqual([true, false, false, true, true]);
    expect(responseRate(4, 5)).toBe(80);
    expect(responseRate(6, 5)).toBe(100);
    expect(responseRate(3, 0)).toBeNull();
    expect(responseRate(null, 5)).toBeNull();
  });
});

describe('Policy: managers decide the cadence; leads, managers and admins send', () => {
  const team = { id: 'tm', department_id: 'dep' };
  const actor = (role: string, scopeType: string, scopeId: string): PolicyActor => ({ id: 'x', role, grants: [{ role, scopeType, scopeId }] });
  it('PSEND-007: canSetPulseCadence: QA manager of the department and super_admin, not the lead; canSendPulseSurvey adds the lead', () => {
    expect(canSetPulseCadence(actor('team_lead', 'team', 'tm'), team)).toBe(false);
    expect(canSetPulseCadence(actor('qa_manager', 'department', 'dep'), team)).toBe(true);
    expect(canSetPulseCadence(actor('qa_manager', 'department', 'other'), team)).toBe(false);
    expect(canSetPulseCadence(actor('super_admin', 'company', 'co'), team)).toBe(true);
    expect(canSetPulseCadence(actor('qa_engineer', 'team', 'tm'), team)).toBe(false);
    expect(canSendPulseSurvey(actor('team_lead', 'team', 'tm'), team)).toBe(true);
    expect(canSendPulseSurvey(actor('team_lead', 'team', 'other'), team)).toBe(false);
    expect(canSendPulseSurvey(actor('qa_manager', 'department', 'dep'), team)).toBe(true);
    expect(canSendPulseSurvey(actor('qa_manager', 'department', 'other'), team)).toBe(false);
    expect(canSendPulseSurvey(actor('super_admin', 'company', 'co'), team)).toBe(true);
    expect(canSendPulseSurvey(actor('qa_engineer', 'team', 'tm'), team)).toBe(false);
    expect(canSendPulseSurvey(actor('viewer', 'team', 'tm'), team)).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------
 * Live: fixture
 * ---------------------------------------------------------------------------------------- */

async function cleanup(db: Client) {
  for (const t of ['pulse_links', 'pulse_recipients', 'pulse_sends', 'pulse_settings', 'pulse_participation', 'pulse_responses', 'pulse_cadences']) {
    await db.query(`DELETE FROM ${t} WHERE company_id = $1`, [CO]);
  }
  await db.query(`DELETE FROM role_assignments WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM team_members WHERE team_id LIKE 'psend-team-%'`);
  await db.query(`DELETE FROM audit_log WHERE company_id = $1`, [CO]).catch(() => undefined);
  await db.query(`DELETE FROM users WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM teams WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM departments WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM companies WHERE id = $1`, [CO]);
}

async function addUser(id: string, role: string, scopeType: string, scopeId: string, dept = D) {
  const pw = await hash(PW, 4);
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, is_active, email_verified)
     VALUES ($1, $2, $3, 'Ps', $4, $5, $6, $7, $8, TRUE, TRUE)`,
    [id, email(id), pw, id, role, CO, dept, scopeType === 'team' ? scopeId : null]
  );
  await db.query(
    `INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [`psend-ra-${id}`, CO, id, role, scopeType, scopeId]
  );
}

/** Test mailer: records every message and reports it delivered (as SMTP would). */
const outbox: MailMessage[] = [];
const captureMailer = { channel: 'smtp' as const, async send(m: MailMessage) { outbox.push(m); return { delivered: true, channel: 'smtp' as const }; } };
const tokenIn = (text: string) => (text.match(/token=([A-Za-z0-9_%-]+)/)?.[1] ? decodeURIComponent(text.match(/token=([A-Za-z0-9_%-]+)/)![1]) : null);
const tokens: Record<string, string> = {};

const teamRow = (id: string) => ({ id, name: id === T ? 'Team T' : id === S ? 'Team S' : 'Team U', department_id: id === U ? D2 : D });
const auditCount = async (action: string) =>
  (await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND action = $2`, [CO, action])).rows[0].n;

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  await cleanup(db);
  today = (await db.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`)).rows[0].d;
  await db.query(`INSERT INTO companies (id, name, domain, is_active) VALUES ($1, 'Pulse Sending Co', 'psend.example', TRUE)`, [CO]);
  await db.query(`INSERT INTO departments (id, company_id, name, is_active) VALUES ($1, $2, 'Send', TRUE), ($3, $2, 'Other', TRUE)`, [D, CO, D2]);
  for (const [id, dept, name] of [[T, D, 'Team T'], [S, D, 'Team S'], [U, D2, 'Team U']]) {
    await db.query(`INSERT INTO teams (id, company_id, department_id, name, is_active, ai_enabled, exclude_from_auto_sync) VALUES ($1, $2, $3, $4, TRUE, FALSE, TRUE)`, [id, CO, dept, name]);
  }
  await addUser('psend-admin', 'super_admin', 'company', CO);
  await addUser('psend-mgr', 'qa_manager', 'department', D);
  await addUser('psend-mgr2', 'qa_manager', 'department', D2, D2);
  await addUser('psend-lead', 'team_lead', 'team', T);
  for (const id of ['psend-e1', 'psend-e2', 'psend-e3', 'psend-e4']) await addUser(id, 'qa_engineer', 'team', T);
  await addUser('psend-viewer', 'viewer', 'team', T);
  await addUser('psend-slead', 'team_lead', 'team', S);
  for (const id of ['psend-s1', 'psend-s2', 'psend-s3']) await addUser(id, 'qa_engineer', 'team', S);
  for (const who of ['psend-admin', 'psend-mgr', 'psend-mgr2', 'psend-lead', 'psend-e1', 'psend-e2', 'psend-e3', 'psend-e4', 'psend-viewer', 'psend-slead']) {
    c[who] = (await login(email(who))).cookie;
  }
  c.foreign = (await login('alex.morgan@northwind.example')).cookie;
}, 60000);

afterAll(async () => {
  setMailerForTests(null);
  if (db) {
    await cleanup(db);
    await db.end();
  }
  await pool.end().catch(() => undefined);
});

/* ------------------------------------------------------------------------------------------
 * Live: cadence and automatic sending settings
 * ---------------------------------------------------------------------------------------- */

describe('Cadence and automatic sending (managers decide)', () => {
  it('PSEND-010: the lead may not set the cadence; a QA manager and an admin may (all four); auto-send switches on with the first change', async () => {
    if (!up) return;
    const cur = periodFor([], today);
    const lead = await put(`/api/pulse/teams/${T}/cadence`, c['psend-lead'], { cadence: 'monthly' });
    expect(lead.status).toBe(403);
    expect(lead.body.error).toMatch(/Managers decide/);
    for (const who of ['psend-e1', 'psend-viewer', 'psend-mgr2', 'foreign']) {
      expect((await put(`/api/pulse/teams/${T}/cadence`, c[who], { cadence: 'monthly' })).status).toBe(403);
    }
    expect((await put(`/api/pulse/teams/${T}/cadence`, c['psend-mgr'], { cadence: 'yearly' })).status).toBe(400);
    expect((await get(`/api/pulse/teams/${T}`, c['psend-lead'])).body).toMatchObject({ canSetCadence: false, canSend: true });

    const m = await put(`/api/pulse/teams/${T}/cadence`, c['psend-mgr'], { cadence: 'monthly' });
    expect(m.status).toBe(200);
    expect(m.body).toMatchObject({ cadence: 'biweekly', pendingCadence: { cadence: 'monthly', from: cur.end }, autoSendEnabled: true });
    const q = await put(`/api/pulse/teams/${T}/cadence`, c['psend-admin'], { cadence: 'quarterly' });
    expect(q.body).toMatchObject({ pendingCadence: { cadence: 'quarterly', from: cur.end }, autoSendEnabled: false });
    const w = await put(`/api/pulse/teams/${T}/cadence`, c['psend-mgr'], { cadence: 'weekly' });
    expect(w.body.pendingCadence).toEqual({ cadence: 'weekly', from: cur.end });
    const st = await get(`/api/pulse/teams/${T}`, c['psend-mgr']);
    expect(st.body.cadences.map((x: any) => x.value)).toEqual(['weekly', 'biweekly', 'monthly', 'quarterly']);
    expect(st.body.currentPeriod).toMatchObject({ start: cur.start, end: cur.end });
    expect(st.body.sending.autoSend).toMatchObject({ enabled: true, from: cur.end });
    // Back to the cadence in force: the waiting change is cancelled (the period stays as it is).
    expect((await put(`/api/pulse/teams/${T}/cadence`, c['psend-mgr'], { cadence: 'biweekly' })).body.pendingCadence).toBeNull();
    expect(await auditCount('team.pulse_cadence')).toBe(4);
  });

  it('PSEND-011: auto-send toggle: managers and admins only; audited; on again means from the next period', async () => {
    if (!up) return;
    const cur = periodFor([], today);
    for (const who of ['psend-lead', 'psend-e1', 'psend-mgr2', 'foreign']) {
      expect((await put(`/api/pulse/teams/${T}/auto-send`, c[who], { enabled: false })).status).toBe(403);
    }
    expect((await put(`/api/pulse/teams/${T}/auto-send`, c['psend-mgr'], { enabled: 'no' })).status).toBe(400);
    const off = await put(`/api/pulse/teams/${T}/auto-send`, c['psend-mgr'], { enabled: false });
    expect(off.body.autoSend).toEqual({ enabled: false, from: null });
    const on = await put(`/api/pulse/teams/${T}/auto-send`, c['psend-admin'], { enabled: true });
    expect(on.body.autoSend).toEqual({ enabled: true, from: cur.end });
    expect(await auditCount('team.pulse_auto_send')).toBe(2);
  });
});

/* ------------------------------------------------------------------------------------------
 * Live: sending
 * ---------------------------------------------------------------------------------------- */

describe('Sending the survey', () => {
  it('PSEND-020: only the lead, managers and admins in scope may send; without SMTP nothing is delivered and no link is returned', async () => {
    if (!up) return;
    for (const who of ['psend-e1', 'psend-viewer', 'psend-mgr2', 'psend-slead', 'foreign']) {
      expect((await post(`/api/pulse/teams/${T}/send`, c[who])).status).toBe(403);
      expect((await post(`/api/pulse/teams/${T}/remind`, c[who])).status).toBe(403);
    }
    expect((await post(`/api/pulse/teams/${T}/send`, '')).status).toBe(401);
    const capture = process.env.MAIL_CAPTURE_FILE;
    const before = capture && fs.existsSync(capture) ? fs.readFileSync(capture, 'utf8').length : 0;
    const res = await post(`/api/pulse/teams/${T}/send`, c['psend-lead']);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: 'survey', recipients: MEMBERS_T.length, delivered: 0, channel: 'log', emailConfigured: false });
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/igp_|\/pulse\/answer|token/);
    expect(res.body.sending).toMatchObject({ emailConfigured: false, members: MEMBERS_T.length, sent: 0 });
    expect(res.body.sending.notSent.map((m: any) => m.id).sort()).toEqual([...MEMBERS_T].sort());
    const links = (await db.query(`SELECT token_hash, user_id, to_char(period_start, 'YYYY-MM-DD') AS ps, used FROM pulse_links WHERE team_id = $1`, [T])).rows;
    expect(links).toHaveLength(MEMBERS_T.length);
    expect(links.every((l: any) => /^[0-9a-f]{64}$/.test(l.token_hash) && l.ps === periodFor([], today).start && !l.used)).toBe(true);
    expect(await auditCount('team.pulse_send')).toBe(1);
    // With MAIL_CAPTURE_FILE (development aid) the log channel's messages carry the links; only their hash is stored.
    if (capture && fs.existsSync(capture)) {
      const mails = fs.readFileSync(capture, 'utf8').slice(before).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
        .filter((m: any) => m.to.endsWith('@psend.example'));
      expect(mails).toHaveLength(MEMBERS_T.length);
      for (const m of mails) {
        const tok = tokenIn(m.text)!;
        expect(tok).toMatch(/^igp_/);
        expect(links.some((l: any) => l.token_hash === createHash('sha256').update(tok).digest('hex'))).toBe(true);
      }
    }
  });

  it('PSEND-021: delivered mail: every member gets one personal link; "sent to N of M"; a second send is refused; a new member is sent the rest', async () => {
    if (!up) return;
    setMailerForTests(captureMailer);
    outbox.length = 0;
    const r = await sendPulseSurvey({ companyId: CO, team: teamRow(T), actorId: 'psend-lead', trigger: 'manual', today });
    expect(r).toMatchObject({ recipients: MEMBERS_T.length, delivered: MEMBERS_T.length, emailConfigured: true });
    expect(outbox.map((m) => m.to).sort()).toEqual(MEMBERS_T.map(email).sort());
    for (const m of outbox) {
      const id = m.to.split('@')[0];
      tokens[id] = tokenIn(m.text)!;
      expect(m.subject).toMatch(/Wellbeing pulse for Team T/);
      expect(m.html).toContain('/pulse/answer?token=');
    }
    expect(new Set(Object.values(tokens)).size).toBe(MEMBERS_T.length);
    const st = await sendStatus({ id: T }, today);
    expect(st).toMatchObject({ members: MEMBERS_T.length, sent: MEMBERS_T.length, notSent: [] });
    await expect(sendPulseSurvey({ companyId: CO, team: teamRow(T), actorId: 'psend-lead', trigger: 'manual', today })).rejects.toThrow(PulseError);
    const http = await get(`/api/pulse/teams/${T}`, c['psend-lead']);
    expect(http.body.sending).toMatchObject({ sent: MEMBERS_T.length, members: MEMBERS_T.length });
    expect(http.body.sending.lastSentAt).toBeTruthy();
    expect(http.body.currentPeriod.sent).toBe(MEMBERS_T.length);
  });
});

/* ------------------------------------------------------------------------------------------
 * Live: answering through a personal link
 * ---------------------------------------------------------------------------------------- */

describe('Personal links: single use, expiry, binding', () => {
  const inspect = (token: unknown) => post('/api/pulse/link', '', { token });
  const respond = (token: unknown, v = 4, comment?: string) => post('/api/pulse/link/respond', '', { token, answers: answers(v), comment });

  it('PSEND-030: the link opens the survey without a session and without personal data', async () => {
    if (!up) return;
    const res = await inspect(tokens['psend-e1']);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'open', team: { name: 'Team T' }, period: { start: periodFor([], today).start } });
    expect(res.body.questions).toHaveLength(5);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('psend-e1');
    expect(text).not.toContain('@psend.example');
    expect(res.headers['set-cookie']).toBeUndefined();
    for (const bad of ['igp_not-a-real-token-123456', 'nope', 42, null]) {
      expect((await inspect(bad)).body.status).toBe('invalid');
      expect((await respond(bad)).status).toBe(404);
    }
  });

  it('PSEND-031: answering through the link stores the answer anonymously, records participation and uses the link up', async () => {
    if (!up) return;
    expect((await post('/api/pulse/link/respond', '', { token: tokens['psend-e1'], answers: { ...answers(3), focus: 9 } })).status).toBe(400);
    const res = await respond(tokens['psend-e1'], 5, 'Through the link');
    expect(res.status).toBe(201);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body).toMatchObject({ success: true, team: { name: 'Team T' } });
    const rows = (await db.query(`SELECT * FROM pulse_responses WHERE team_id = $1`, [T])).rows;
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(['comment', 'company_id', 'id', 'period_end', 'period_start', 'q_energy', 'q_focus', 'q_outlook', 'q_support', 'q_workload', 'team_id']);
    const part = (await db.query(`SELECT user_id FROM pulse_participation WHERE team_id = $1`, [T])).rows.map((r: any) => r.user_id);
    expect(part).toEqual(['psend-e1']);
    // Single use: the same link again, and the same person in the app.
    expect((await respond(tokens['psend-e1'])).status).toBe(410);
    expect((await inspect(tokens['psend-e1'])).body.status).toBe('used');
    expect((await post(`/api/pulse/teams/${T}/responses`, c['psend-e1'], { answers: answers(2) })).status).toBe(409);
    // Answering in the app uses the person's link up too.
    expect((await post(`/api/pulse/teams/${T}/responses`, c['psend-e2'], { answers: answers(3) })).status).toBe(201);
    expect((await inspect(tokens['psend-e2'])).body.status).toBe('used');
    expect((await respond(tokens['psend-e2'])).status).toBe(410);
  });

  it('PSEND-032: a link answers only for its own person; expiry, an ended period and leaving the team stop it', async () => {
    if (!up) return;
    expect((await respond(tokens['psend-e3'], 2)).status).toBe(201);
    const st = await get(`/api/pulse/teams/${T}`, c['psend-e4']);
    expect(st.body.currentPeriod.responded).toBe(false); // e3's link did not answer for e4
    expect((await get(`/api/pulse/teams/${T}`, c['psend-e3'])).body.currentPeriod.responded).toBe(true);
    // Expired (expires_at in the past).
    await db.query(`UPDATE pulse_links SET expires_at = now() - interval '1 minute' WHERE token_hash = $1`, [hashPulseToken(tokens['psend-e4'])]);
    expect((await inspect(tokens['psend-e4'])).body.status).toBe('expired');
    expect((await respond(tokens['psend-e4'])).status).toBe(410);
    // A link of an earlier period.
    const prev = previousPeriod([], today);
    await db.query(`UPDATE pulse_links SET period_start = $2, period_end = $3, expires_at = now() + interval '1 day' WHERE token_hash = $1`,
      [hashPulseToken(tokens['psend-e4']), prev.start, prev.end]);
    expect((await respond(tokens['psend-e4'])).status).toBe(410);
    // The viewer leaves the team: the link stops working; back in the team it works again.
    await db.query(`UPDATE role_assignments SET revoked_at = now() WHERE id = 'psend-ra-psend-viewer'`);
    expect((await inspect(tokens['psend-viewer'])).body.status).toBe('invalid');
    expect((await respond(tokens['psend-viewer'])).status).toBe(404);
    await db.query(`UPDATE role_assignments SET revoked_at = NULL WHERE id = 'psend-ra-psend-viewer'`);
    expect((await inspect(tokens['psend-viewer'])).body.status).toBe('open');
    // No audit entry for any answer.
    const actions = (await db.query(`SELECT DISTINCT action FROM audit_log WHERE company_id = $1`, [CO])).rows.map((r: any) => r.action);
    expect(actions.some((a: string) => /respon|answer/.test(a))).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------
 * Live: reminders and anonymity
 * ---------------------------------------------------------------------------------------- */

describe('Reminders and anonymity', () => {
  it('PSEND-040: nothing returned to anyone tells who answered; only counts from 3 answers on', async () => {
    if (!up) return;
    for (const who of ['psend-admin', 'psend-mgr', 'psend-lead', 'psend-e4']) {
      const res = await get(`/api/pulse/teams/${T}`, c[who]);
      const text = JSON.stringify(res.body);
      for (const uid of ['psend-e1', 'psend-e2', 'psend-e3']) expect(text).not.toContain(uid);
      expect(text).not.toContain('Through the link'); // running-period comment
      expect(res.body.currentPeriod.responsesSoFar).toBe(3);
    }
    // The new tables share nothing with the answers.
    const cols = async (t: string) => (await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [t]
    )).rows.map((r: any) => r.column_name);
    expect(await cols('pulse_links')).toEqual(['token_hash', 'company_id', 'team_id', 'user_id', 'period_start', 'period_end', 'expires_at', 'used']);
    // last_reminder_on (reminders of members who have not answered) is a day per recipient, never linked to an answer.
    expect(await cols('pulse_recipients')).toEqual(['company_id', 'team_id', 'user_id', 'period_start', 'period_end', 'first_sent_at', 'delivered', 'last_reminder_on']);
    expect(await cols('pulse_sends')).not.toContain('user_id');
    const fks = (await db.query(
      `SELECT confrelid::regclass::text AS ref FROM pg_constraint WHERE contype = 'f'
         AND conrelid IN ('pulse_links'::regclass, 'pulse_recipients'::regclass, 'pulse_sends'::regclass, 'pulse_settings'::regclass)`
    )).rows.map((r: any) => r.ref);
    expect(fks).not.toContain('pulse_responses');
    expect(fks).not.toContain('pulse_participation');
  });

  it('PSEND-041: a reminder goes only to those who have not answered; its count is shown from 3 answers; once per 24 hours', async () => {
    if (!up) return;
    outbox.length = 0;
    const res = await post(`/api/pulse/teams/${T}/remind`, c['psend-lead']);
    expect(res.status).toBe(200);
    // e1, e2, e3 answered -> lead, e4, viewer reminded (count shown: 3 answers).
    expect(res.body).toMatchObject({ kind: 'reminder', recipients: 3 });
    expect(JSON.stringify(res.body)).not.toMatch(/psend-e[1-4]|psend-viewer@|igp_/);
    expect((await post(`/api/pulse/teams/${T}/remind`, c['psend-mgr'])).status).toBe(409);
    expect(await auditCount('team.pulse_reminder')).toBe(1);
    const audit = (await db.query(`SELECT summary, after::text AS after FROM audit_log WHERE company_id = $1 AND action = 'team.pulse_reminder'`, [CO])).rows[0];
    expect(audit.after).not.toMatch(/psend-/);
    expect(audit.summary).not.toMatch(/psend-/);
    // In-process with delivered mail: exactly the non-respondents get a reminder link.
    await db.query(`UPDATE pulse_sends SET created_at = created_at - interval '25 hours' WHERE company_id = $1 AND kind = 'reminder'`, [CO]);
    setMailerForTests(captureMailer);
    const r = await remindPulseSurvey({ companyId: CO, team: teamRow(T), actorId: 'psend-lead', today });
    expect(outbox.map((m) => m.to).sort()).toEqual(['psend-e4', 'psend-lead', 'psend-viewer'].map(email).sort());
    expect(outbox.every((m) => /^Reminder:/.test(m.subject))).toBe(true);
    expect(r.recipients).toBe(3);
  });

  it('PSEND-042: with 1 or 2 answers the reminder count is withheld (it would reveal how many answered)', async () => {
    if (!up) return;
    setMailerForTests(captureMailer);
    expect((await sendPulseSurvey({ companyId: CO, team: teamRow(S), actorId: 'psend-slead', trigger: 'manual', today }))!.recipients).toBe(MEMBERS_S.length);
    expect((await post(`/api/pulse/teams/${S}/responses`, (await login(email('psend-s1'))).cookie, { answers: answers(4) })).status).toBe(201);
    const res = await post(`/api/pulse/teams/${S}/remind`, c['psend-slead']);
    expect(res.status).toBe(200);
    expect(res.body.recipients).toBeNull();
    expect(res.body.delivered).toBeNull();
    const st = await get(`/api/pulse/teams/${S}`, c['psend-slead']);
    expect(st.body.sending.log.find((e: any) => e.kind === 'reminder').recipients).toBeNull();
    expect(st.body.currentPeriod.responsesSoFar).toBeNull();
    const audit = (await db.query(`SELECT summary, after FROM audit_log WHERE company_id = $1 AND action = 'team.pulse_reminder' AND entity_id = $2`, [CO, S])).rows[0];
    expect(audit.after.recipients).toBeNull();
    expect(audit.summary).not.toMatch(/\(\d+\)/);
  });
});

/* ------------------------------------------------------------------------------------------
 * Live: automatic sending and results
 * ---------------------------------------------------------------------------------------- */

describe('Automatic sending and response rates', () => {
  it('PSEND-050: the scheduled run sends once per team and period (dedupe), only early in a period, never when off', async () => {
    if (!up) return;
    setMailerForTests(captureMailer);
    const cur = periodFor([], today);
    const next = nextPeriod((await db.query(`SELECT cadence, to_char(effective_from, 'YYYY-MM-DD') AS effective_from FROM pulse_cadences WHERE team_id = $1`, [T])).rows, today);
    // T: on from the next period (PSEND-011). Running period: not covered.
    expect((await runPulseAutoSend(cur.start, { teamIds: [T] })).sent).toBe(0);
    outbox.length = 0;
    const first = await runPulseAutoSend(next.start, { teamIds: [T] });
    expect(first).toMatchObject({ teams: 1, sent: 1 });
    expect(outbox.map((m) => m.to).sort()).toEqual(MEMBERS_T.map(email).sort());
    expect((await runPulseAutoSend(next.start, { teamIds: [T] })).sent).toBe(0);
    expect((await runPulseAutoSend(addDays(next.start, 1), { teamIds: [T] })).sent).toBe(0);
    // Two schedulers at once: still one send.
    await db.query(`DELETE FROM pulse_sends WHERE team_id = $1 AND trigger = 'auto'`, [T]);
    const both = await Promise.all([
      sendPulseSurvey({ companyId: CO, team: teamRow(T), actorId: null, trigger: 'auto', today: next.start }),
      sendPulseSurvey({ companyId: CO, team: teamRow(T), actorId: null, trigger: 'auto', today: next.start }),
    ]);
    expect(both.filter(Boolean)).toHaveLength(1);
    const autos = (await db.query(`SELECT count(*)::int AS n FROM pulse_sends WHERE team_id = $1 AND trigger = 'auto' AND period_start = $2`, [T, next.start])).rows[0].n;
    expect(autos).toBe(1);
    // Late in the period: no automatic send. Off: the team is not even looked at.
    const nextNext = nextPeriod([], next.start);
    expect((await runPulseAutoSend(addDays(nextNext.start, 5), { teamIds: [T] })).sent).toBe(0);
    await put(`/api/pulse/teams/${T}/auto-send`, c['psend-mgr'], { enabled: false });
    expect((await runPulseAutoSend(nextNext.start, { teamIds: [T] }))).toMatchObject({ teams: 0, sent: 0 });
    const auditAuto = (await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND action = 'team.pulse_send' AND actor_id IS NULL`, [CO])).rows[0].n;
    expect(auditAuto).toBe(2);
  });

  it('PSEND-051: closed periods show the response rate (responses ÷ members sent); suppressed periods do not', async () => {
    if (!up) return;
    const prev = previousPeriod([], today);
    const older = previousPeriod([], addDays(prev.start, -1));
    const ins = async (start: string, end: string, values: number[]) => {
      for (const v of values) {
        await db.query(
          `INSERT INTO pulse_responses (company_id, team_id, period_start, period_end, q_workload, q_focus, q_support, q_energy, q_outlook)
           VALUES ($1, $2, $3, $4, $5, $5, $5, $5, $5)`, [CO, U, start, end, v]);
      }
    };
    await ins(prev.start, prev.end, [4, 3, 5, 4]);
    await ins(older.start, older.end, [2, 3]);
    await db.query(`INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, is_active)
      SELECT 'psend-u' || g, 'psend-u' || g || '@psend.example', 'x', 'U', 'U', 'qa_engineer', $1, $2, TRUE FROM generate_series(1, 5) g`, [CO, D2]);
    for (const p of [prev, older]) {
      await db.query(`INSERT INTO pulse_recipients (company_id, team_id, user_id, period_start, period_end, delivered)
        SELECT $1, $2, 'psend-u' || g, $3, $4, TRUE FROM generate_series(1, 5) g`, [CO, U, p.start, p.end]);
    }
    const res = await get(`/api/pulse/teams/${U}`, c['psend-admin']);
    expect(res.body.latest).toMatchObject({ start: prev.start, responses: 4, sent: 5, responseRate: 80 });
    const o = res.body.periods.find((p: any) => p.start === older.start);
    expect(o).toMatchObject({ suppressed: true, responses: null, responseRate: null });
    // Engineers (no send rights) get no send status.
    const asMember = await get(`/api/pulse/teams/${T}`, c['psend-e4']);
    expect(asMember.body).toMatchObject({ canSend: false, sending: null });
  });
});
