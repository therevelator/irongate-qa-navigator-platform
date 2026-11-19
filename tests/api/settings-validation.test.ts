/**
 * Server-side validation of configuration and settings writes (FI-10b, FI-12):
 *   CFGV-01  POST /api/admin/configs refuses what the Parameters page refuses (src/lib/configRules.ts):
 *            negative, non-numeric and too large SLA / financial values; nothing of the request is stored
 *   CFGV-02  valid values (and empty = inherit) are stored; other keys keep free text, but the key must
 *            look like a key and the value must be short plain text
 *   CFGV-03  expected update frequency (PUT /api/settings/metric-intervals[/:key]): a whole number
 *            from 1 to 100 and a known unit; the bulk save stores nothing when one row is refused
 *   CFGV-04  pulse reminder, cadence and auto-send validation speaks the page's language, never the
 *            API field names (warningAfterDays, escalateTo, …)
 *
 * Uses an organisation of its own (registered here, removed afterwards). Skips when no live backend.
 */
import request from 'supertest';
import type { Client } from 'pg';
import { API_URL, NEW_PW, backendUp, cookieFrom, get, localDb, post, put } from './helpers/http';

const stamp = Date.now();
let up = true;
let db: Client;
let cookie = '';
let companyId = '';
let teamId = '';

const stored = async (key: string) =>
  (await db.query('SELECT config_value FROM configs WHERE company_id = $1 AND config_key = $2 AND department_id IS NULL AND team_id IS NULL', [companyId, key])).rows[0]?.config_value ?? null;
const save = (configs: Record<string, unknown>) => post('/api/admin/configs', cookie, { departmentId: 'all', teamId: 'all', configs });

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  const reg = await request(API_URL).post('/api/auth/register').send({
    email: `cfgv-${stamp}@cfgv${stamp}.test`, password: NEW_PW, firstName: 'Cfg', lastName: 'Admin',
    companyName: `Cfgv ${stamp}`, departmentName: 'Ops', teamName: 'Ops Team',
  });
  if (reg.status !== 201) throw new Error(`register: ${reg.status} ${JSON.stringify(reg.body)}`);
  cookie = cookieFrom(reg);
  companyId = reg.body.user.company_id;
  teamId = reg.body.user.primary_team_id;
}, 60000);

afterAll(async () => {
  if (!up) return;
  if (companyId) await db.query('DELETE FROM companies WHERE id = $1', [companyId]);
  await db.end();
});

describe('Configuration values (Parameters)', () => {
  const refused: Array<[string, unknown, RegExp]> = [
    ['sla_response_time_ms', '-5', /^P95 response time \(ms\): enter a number of 0 or more, or leave it empty to inherit\.$/],
    ['sla_response_time_ms', 'abc', /enter a number of 0 or more/],
    ['sla_response_time_ms', '9999999', /^P95 response time \(ms\): enter a number from 0 to 600,000, or leave it empty to inherit\.$/],
    ['sla_error_rate_percent', '101', /Error rate threshold \(%\): enter a number from 0 to 100/],
    ['developer_hourly_rate', -1, /Developer hourly rate/],
    ['support_ticket_cost', 'NaN', /Support ticket cost/],
    ['revenue_per_user_monthly', 'Infinity', /Revenue per user per month/],
    ['downtime_cost_per_minute', '1e12', /Downtime cost per minute/],
    ['sla_breach_penalty', { x: 1 }, /SLA breach penalty/],
  ];
  for (const [key, value, message] of refused) {
    test(`CFGV-01 ${key} = ${JSON.stringify(value)} is refused`, async () => {
      if (!up) return;
      const res = await save({ developer_hourly_rate: '80', [key]: value });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(message);
      // Nothing of the request is stored (the valid value next to it neither).
      if (key !== 'developer_hourly_rate') expect(await stored('developer_hourly_rate')).toBeNull();
      expect(await stored(key)).toBeNull();
    });
  }

  test('CFGV-02 valid values are stored; empty inherits; other keys need a valid name and short text', async () => {
    if (!up) return;
    expect((await save({ sla_response_time_ms: '750', sla_error_rate_percent: 2.5, developer_hourly_rate: '0' })).status).toBe(200);
    expect(await stored('sla_response_time_ms')).toBe('750');
    expect(await stored('sla_error_rate_percent')).toBe('2.5');
    expect(await stored('developer_hourly_rate')).toBe('0');
    expect((await save({ sla_response_time_ms: '' })).status).toBe(200);
    expect(await stored('sla_response_time_ms')).toBeNull();
    expect((await save({ sla_critical_hours: '9' })).status).toBe(200);
    expect((await save({ 'Bad Key!': 'x' })).status).toBe(400);
    expect((await save({ some_note: 'x'.repeat(2001) })).status).toBe(400);
    expect((await save({ some_note: ['a'] })).status).toBe(400);
    expect((await post('/api/admin/configs', cookie, { configs: [1, 2] })).status).toBe(400);
    // The page shows what the API answers.
    const merged = await get('/api/admin/configs', cookie);
    expect(merged.body.configs.sla_error_rate_percent.value).toBe('2.5');
  });
});

describe('Expected update frequency', () => {
  test('CFGV-03 a whole number from 1 to 100 and a known unit', async () => {
    if (!up) return;
    for (const body of [
      { interval_value: 0, interval_unit: 'days' }, { interval_value: 101, interval_unit: 'days' }, { interval_value: 1.5, interval_unit: 'days' },
      { interval_value: '3', interval_unit: 'days' }, { interval_value: 'abc', interval_unit: 'days' }, { interval_value: 3, interval_unit: 'years' },
    ]) {
      const res = await put('/api/settings/metric-intervals/test_coverage', cookie, body);
      expect(res.status).toBe(400);
    }
    expect((await put('/api/settings/metric-intervals/test_coverage', cookie, { interval_value: 3, interval_unit: 'days' })).status).toBe(200);
    const bulk = await put('/api/settings/metric-intervals', cookie, { intervals: [
      { metric_key: 'test_coverage', interval_value: 5, interval_unit: 'days' },
      { metric_key: 'defect_escape_rate', interval_value: 500, interval_unit: 'days' },
    ] });
    expect(bulk.status).toBe(400);
    expect(bulk.body.error).toBe('The update interval must be a whole number from 1 to 100');
    const row = (await db.query('SELECT interval_value FROM metric_update_intervals WHERE company_id = $1 AND metric_key = $2', [companyId, 'test_coverage'])).rows[0];
    expect(row.interval_value).toBe(3); // the valid row of the refused bulk save was not stored
  });
});

describe('Pulse settings messages', () => {
  test('CFGV-04 the reasons are worded as on the page, without API field names', async () => {
    if (!up) return;
    const cases: Array<[string, object, string]> = [
      ['settings', { warningAfterDays: 99 }, 'The in-app warning to members who have not answered must be a whole number of days from 0 to 30.'],
      ['settings', { reminderEveryDays: 0 }, 'The time between e-mail reminders must be a whole number of days from 1 to 30.'],
      ['settings', { escalateAfterDays: 61 }, 'The escalation must be a whole number of days from 1 to 60.'],
      ['settings', { reminderEmails: 'yes' }, 'Choose whether e-mail reminders are sent (on or off).'],
      ['settings', { escalateTo: 'everyone' }, 'Choose who is told about the escalation: the team lead, the department managers, or both.'],
      ['cadence', { cadence: 'daily' }, 'Choose how often the team is asked: every week, every two weeks, every month, every three months.'],
      ['auto-send', { enabled: 'yes' }, 'Choose whether the survey is e-mailed automatically (on or off).'],
    ];
    for (const [what, body, message] of cases) {
      const res = await put(`/api/pulse/teams/${teamId}/${what}`, cookie, body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(message);
      expect(res.body.error).not.toMatch(/warningAfterDays|reminderEveryDays|escalateAfterDays|reminderEmails|escalateTo|cadence must|enabled must/);
    }
  });
});
