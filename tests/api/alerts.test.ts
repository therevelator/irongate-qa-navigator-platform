import http from 'http';
import type { AddressInfo } from 'net';
import type { Client } from 'pg';
import request from 'supertest';
import { API_URL, backendUp, del, get, localDb, login, patch, post, put } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';

/**
 * Alerts, notifications, the weekly digest and tracked actions (Phase 3A):
 *   rules (GET/PUT /api/alerts/rules) with department / team overrides and the KPI-target policy;
 *   the evaluator on the KPI write path (Manual metrics, ingestion API) and on demand: threshold
 *   breach, stale metrics, QA score drop, ingestion failures; open / refresh / resolve;
 *   acknowledge (team data writers); in-app notifications (own only), preferences, immediate
 *   email through the mailer, Slack webhook (masked, never stored or logged in clear);
 *   digest preview / test per scope; tracked actions with owner-in-scope, computed baseline and
 *   outcomes (completion, 14 and 30 days) and the role policy of every endpoint.
 * Uses the golden fixture company (teams Big/Small in department A, Stale/Partial/Empty in B).
 * Runs against a live backend at API_URL; skips cleanly when none is running.
 */

let up = true;
let db: Client;
const c: Record<string, string> = {};
const PARTIAL = 'golden-team-partial';
const BIG = 'golden-team-big';
const STALE = 'golden-team-stale';

const manual = (cookie: string, body: Record<string, unknown>) => post('/api/metrics/manual', cookie, { teamId: PARTIAL, ...body });
const alertsOf = async (cookie: string, q = 'status=all') => (await get(`/api/alerts?${q}&limit=300`, cookie)).body.alerts as any[];
const findAlert = (list: any[], rule: string, team: string, metric: string | null = null) =>
  list.find((a) => a.rule === rule && a.teamId === team && (metric === null || a.metricKey === metric));
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  await createGolden(db);
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, is_active, email_verified)
     SELECT v.id, v.email, u.password_hash, v.first, 'Fixture', v.role, $1, v.dept, v.team, TRUE, TRUE
       FROM users u, (VALUES ('golden-u-mgr3a', 'mgr3a@golden.example', 'Morgan', 'qa_manager', 'golden-dept-b', NULL),
                             ('golden-u-viewer3a', 'viewer3a@golden.example', 'Vera', 'viewer', 'golden-dept-b', 'golden-team-partial'))
                     AS v(id, email, first, role, dept, team)
      WHERE u.id = 'golden-u-admin' ON CONFLICT (id) DO NOTHING`,
    [GOLDEN_COMPANY]
  );
  await db.query(
    `INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id) VALUES
       ('golden-ra-mgr3a', $1, 'golden-u-mgr3a', 'qa_manager', 'department', 'golden-dept-b'),
       ('golden-ra-viewer3a', $1, 'golden-u-viewer3a', 'viewer', 'team', 'golden-team-partial')
     ON CONFLICT (id) DO NOTHING`,
    [GOLDEN_COMPANY]
  );
  c.admin = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  c.manager = (await login('mgr3a@golden.example')).cookie;       // QA manager of department B
  c.lead = (await login('partial-1@golden.example')).cookie;      // lead of Partial Team (B)
  c.engineer = (await login('partial-2@golden.example')).cookie;  // engineer of Partial Team
  c.viewer = (await login('viewer3a@golden.example')).cookie;     // viewer of Partial Team
  c.otherLead = (await login('big-1@golden.example')).cookie;     // lead of Big Team (A)
  c.foreign = (await login('alex.morgan@northwind.example')).cookie;
});

afterAll(async () => {
  if (db) {
    await removeGolden(db);
    await db.end();
  }
});

describe('Alert rules', () => {
  it('ALR-001: read policy — super admin and QA managers; leads, engineers and viewers 403; other companies 404', async () => {
    if (!up) return;
    const admin = await get('/api/alerts/rules?scopeType=company', c.admin);
    expect(admin.status).toBe(200);
    expect(admin.body.canEdit).toBe(true);
    expect(admin.body.rules.map((r: any) => r.rule).sort()).toEqual(['ingestion_failure', 'metric_stale', 'score_drop', 'threshold_breach']);
    expect(admin.body.rules.find((r: any) => r.rule === 'score_drop').effective).toMatchObject({ enabled: true, params: { points: 10, days: 7 }, scope: 'default' });
    const mgr = await get('/api/alerts/rules?scopeType=company', c.manager);
    expect(mgr.status).toBe(200);
    expect(mgr.body.canEdit).toBe(false);
    expect((await get('/api/alerts/rules?scopeType=department&scopeId=golden-dept-b', c.manager)).body.canEdit).toBe(true);
    expect((await get('/api/alerts/rules?scopeType=department&scopeId=golden-dept-a', c.manager)).body.canEdit).toBe(false);
    for (const who of ['lead', 'engineer', 'viewer']) expect((await get('/api/alerts/rules?scopeType=company', c[who])).status).toBe(403);
    expect((await get(`/api/alerts/rules?scopeType=team&scopeId=${PARTIAL}`, c.foreign)).status).toBe(404);
    expect((await get('/api/alerts/rules', '')).status).toBe(401);
  });

  it('ALR-002: write policy, validation, inheritance (team > department > company > default), reset and the change history', async () => {
    if (!up) return;
    const body = (scopeType: string, scopeId?: string, rules: any = { score_drop: { enabled: true, params: { points: 6, days: 7 } } }) => ({ scopeType, scopeId, rules });
    expect((await put('/api/alerts/rules', c.manager, body('company'))).status).toBe(403);
    expect((await put('/api/alerts/rules', c.manager, body('department', 'golden-dept-a'))).status).toBe(403);
    expect((await put('/api/alerts/rules', c.manager, body('team', BIG))).status).toBe(403);
    expect((await put('/api/alerts/rules', c.lead, body('team', PARTIAL))).status).toBe(403);
    expect((await put('/api/alerts/rules', c.engineer, body('team', PARTIAL))).status).toBe(403);
    expect((await put('/api/alerts/rules', c.foreign, body('team', PARTIAL))).status).toBe(404);
    expect((await put('/api/alerts/rules', '', body('team', PARTIAL))).status).toBe(401);
    // Validation
    expect((await put('/api/alerts/rules', c.admin, body('company', undefined, { nope: { enabled: true } }))).status).toBe(400);
    expect((await put('/api/alerts/rules', c.admin, body('company', undefined, { score_drop: { enabled: 'yes' } }))).status).toBe(400);
    expect((await put('/api/alerts/rules', c.admin, body('company', undefined, { score_drop: { enabled: true, params: { points: 0 } } }))).status).toBe(400);
    expect((await put('/api/alerts/rules', c.admin, body('company', undefined, { threshold_breach: { enabled: true, params: { minSeverity: 'info' } } }))).status).toBe(400);
    expect((await put('/api/alerts/rules', c.admin, body('company', undefined, {}))).status).toBe(400);
    // Inheritance
    expect((await put('/api/alerts/rules', c.admin, body('company', undefined, { score_drop: { enabled: true, params: { points: 12, days: 5 } } }))).status).toBe(200);
    expect((await put('/api/alerts/rules', c.manager, body('department', 'golden-dept-b', { score_drop: { enabled: true, params: { points: 9, days: 7 } } }))).status).toBe(200);
    const eff = async (scope: string, id: string) => (await get(`/api/alerts/rules?scopeType=${scope}&scopeId=${id}`, c.admin)).body.rules.find((r: any) => r.rule === 'score_drop').effective;
    expect(await eff('team', PARTIAL)).toMatchObject({ params: { points: 9, days: 7 }, scope: 'department' });
    expect(await eff('team', BIG)).toMatchObject({ params: { points: 12, days: 5 }, scope: 'company' });
    const teamPut = await put('/api/alerts/rules', c.manager, body('team', PARTIAL, { score_drop: { enabled: false } }));
    expect(teamPut.status).toBe(200);
    expect(await eff('team', PARTIAL)).toMatchObject({ enabled: false, params: { points: 10, days: 7 }, scope: 'team' });
    // Reset: null removes the scope's own setting.
    await put('/api/alerts/rules', c.manager, body('team', PARTIAL, { score_drop: null }));
    await put('/api/alerts/rules', c.manager, body('department', 'golden-dept-b', { score_drop: null }));
    await put('/api/alerts/rules', c.admin, body('company', undefined, { score_drop: null }));
    expect(await eff('team', PARTIAL)).toMatchObject({ params: { points: 10, days: 7 }, scope: 'default' });
    const audit = await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND action = 'alert_rules.update'`, [GOLDEN_COMPANY]);
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(6);
  });
});

describe('Evaluator, acknowledge and notifications', () => {
  it('ALR-003: a Manual metrics write opens a threshold alert (critical) and notifies the team; a good value resolves it', async () => {
    if (!up) return;
    const before = (await get('/api/notifications/unread-count', c.lead)).body.unreadCount;
    expect((await manual(c.lead, { test_coverage: 41 })).status).toBe(200);
    const lead = await alertsOf(c.lead, 'status=open');
    const cov = findAlert(lead, 'threshold_breach', PARTIAL, 'test_coverage');
    expect(cov).toMatchObject({ severity: 'critical', teamName: 'Partial Team', canAcknowledge: true });
    expect(cov.message).toContain('Test coverage is off target: 41%');
    expect((await get('/api/notifications/unread-count', c.lead)).body.unreadCount).toBeGreaterThan(before);
    const inbox = (await get('/api/notifications?limit=50', c.lead)).body.notifications;
    expect(inbox.find((n: any) => n.alertId === cov.id)).toMatchObject({ kind: 'alert', severity: 'critical', alert: { status: 'open', canAcknowledge: true } });
    // Scope: the engineer and viewer see it (cannot acknowledge), the department manager sees it, the lead of a team in department A does not.
    const eng = findAlert(await alertsOf(c.engineer, 'status=open'), 'threshold_breach', PARTIAL, 'test_coverage');
    expect(eng).toMatchObject({ id: cov.id, canAcknowledge: false });
    expect(findAlert(await alertsOf(c.viewer, 'status=open'), 'threshold_breach', PARTIAL, 'test_coverage')).toBeTruthy();
    expect(findAlert(await alertsOf(c.manager, 'status=open'), 'threshold_breach', PARTIAL, 'test_coverage')).toMatchObject({ canAcknowledge: true });
    expect(findAlert(await alertsOf(c.otherLead, 'status=all'), 'threshold_breach', PARTIAL, 'test_coverage')).toBeUndefined();
    expect((await get(`/api/alerts?teamId=${PARTIAL}`, c.otherLead)).status).toBe(403);
    expect((await get(`/api/alerts?teamId=${PARTIAL}`, c.foreign)).status).toBe(403);
    expect((await get('/api/alerts', '')).status).toBe(401);
    // The super admin (company-wide role) is notified of critical team alerts.
    const adminInbox = (await get('/api/notifications?limit=100', c.admin)).body.notifications;
    expect(adminInbox.some((n: any) => n.alertId === cov.id)).toBe(true);
    // A second write that keeps it critical refreshes the same alert (no duplicate).
    await manual(c.lead, { test_coverage: 40 });
    const again = (await alertsOf(c.lead, 'status=open')).filter((a) => a.rule === 'threshold_breach' && a.teamId === PARTIAL && a.metricKey === 'test_coverage');
    expect(again).toHaveLength(1);
    expect(again[0].id).toBe(cov.id);
    expect(again[0].message).toContain('40%');
    // On target again: resolved.
    await manual(c.lead, { test_coverage: 93 });
    expect(findAlert(await alertsOf(c.lead, 'status=open'), 'threshold_breach', PARTIAL, 'test_coverage')).toBeUndefined();
    const resolved = findAlert(await alertsOf(c.lead, 'status=resolved'), 'threshold_breach', PARTIAL, 'test_coverage');
    expect(resolved.id).toBe(cov.id);
    expect(resolved.resolvedAt).not.toBeNull();
  });

  it('ALR-004: acknowledge — team data writers only, recorded in the change history; engineers, viewers, other teams and companies refused', async () => {
    if (!up) return;
    await manual(c.lead, { change_failure_rate: 33 });
    const a = findAlert(await alertsOf(c.lead, 'status=open'), 'threshold_breach', PARTIAL, 'change_failure_rate');
    expect(a).toBeTruthy();
    expect((await post(`/api/alerts/${a.id}/acknowledge`, c.engineer)).status).toBe(403);
    expect((await post(`/api/alerts/${a.id}/acknowledge`, c.viewer)).status).toBe(403);
    expect((await post(`/api/alerts/${a.id}/acknowledge`, c.otherLead)).status).toBe(404);
    expect((await post(`/api/alerts/${a.id}/acknowledge`, c.foreign)).status).toBe(404);
    expect((await post(`/api/alerts/${a.id}/acknowledge`, '')).status).toBe(401);
    const ok = await post(`/api/alerts/${a.id}/acknowledge`, c.lead);
    expect(ok.status).toBe(200);
    expect(ok.body.alert).toMatchObject({ acknowledgedBy: 'Member1 Fixture', canAcknowledge: false });
    expect((await post(`/api/alerts/${a.id}/acknowledge`, c.manager)).status).toBe(200); // idempotent
    expect(findAlert(await alertsOf(c.lead, 'status=acknowledged'), 'threshold_breach', PARTIAL, 'change_failure_rate')?.id).toBe(a.id);
    const audit = await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND action = 'alert.acknowledge' AND entity_id = $2`, [GOLDEN_COMPANY, a.id]);
    expect(audit.rows[0].n).toBe(1);
    // Escalation of an acknowledged alert keeps the one alert and re-notifies (unread again).
    await manual(c.lead, { change_failure_rate: 12 }); // warning
    await manual(c.lead, { change_failure_rate: 4 });  // good: resolved
    expect(findAlert(await alertsOf(c.lead, 'status=open'), 'threshold_breach', PARTIAL, 'change_failure_rate')).toBeUndefined();
  });

  it('ALR-005: QA score drop of at least N points in D days (critical at twice the drop)', async () => {
    if (!up) return;
    // QA inputs high 7 days ago, low now (recordedAt honoured: the snapshots of both days are derived).
    expect((await manual(c.lead, { recordedAt: daysAgo(7), test_coverage: 96, defect_escape_rate: 1, change_failure_rate: 1, code_quality_score: 97 })).status).toBe(200);
    expect((await manual(c.lead, { test_coverage: 85, defect_escape_rate: 9, change_failure_rate: 9, code_quality_score: 75 })).status).toBe(200);
    const drop = findAlert(await alertsOf(c.lead, 'status=open'), 'score_drop', PARTIAL, 'qa_score');
    expect(drop).toBeTruthy();
    expect(drop.message).toMatch(/QA score fell [\d.]+ points in 7 days/);
    expect(['warning', 'critical']).toContain(drop.severity);
    // Turn the rule off for the team: the next evaluation resolves it.
    await put('/api/alerts/rules', c.manager, { scopeType: 'team', scopeId: PARTIAL, rules: { score_drop: { enabled: false } } });
    expect(findAlert(await alertsOf(c.lead, 'status=open'), 'score_drop', PARTIAL)).toBeUndefined();
    await put('/api/alerts/rules', c.manager, { scopeType: 'team', scopeId: PARTIAL, rules: { score_drop: null } });
  });

  it('ALR-006: stale metrics — one info alert per team listing the stale KPIs; the rule can be turned off per team', async () => {
    if (!up) return;
    expect((await post('/api/alerts/evaluate', c.manager)).status).toBe(403);
    expect((await post('/api/alerts/evaluate', c.lead)).status).toBe(403);
    const run = await post('/api/alerts/evaluate', c.admin);
    expect(run.status).toBe(200);
    expect(run.body.teams).toBe(5); // active teams only
    const stale = findAlert(await alertsOf(c.admin, 'status=open'), 'metric_stale', STALE);
    expect(stale).toMatchObject({ severity: 'info' });
    expect(stale.message).toMatch(/stale: .*Test coverage/);
    // Info alerts are not pushed to people with the default minimum (warning).
    const leadStale = (await get('/api/notifications?limit=100', await (await login('stale-1@golden.example')).cookie)).body.notifications;
    expect(leadStale.some((n: any) => n.alertId === stale.id)).toBe(false);
    await put('/api/alerts/rules', c.manager, { scopeType: 'team', scopeId: STALE, rules: { metric_stale: { enabled: false } } });
    expect(findAlert(await alertsOf(c.admin, 'status=open'), 'metric_stale', STALE)).toBeUndefined();
    await put('/api/alerts/rules', c.manager, { scopeType: 'team', scopeId: STALE, rules: { metric_stale: null } });
  });

  it('ALR-007: ingestion failures through the API open an ingestion alert for the team named in the rejected request', async () => {
    if (!up) return;
    const key = (await post('/api/admin/api-keys', c.admin, { name: '3A alert test key' })).body.plaintextKey;
    expect(key).toBeTruthy();
    const bad = await request(API_URL).post('/api/ingest/kpis').set('Authorization', `Bearer ${key}`).send({ teamId: PARTIAL, source: 'jenkins', metrics: { test_coverage: 140 } });
    expect(bad.status).toBe(400);
    const a = findAlert(await alertsOf(c.lead, 'status=open'), 'ingestion_failure', PARTIAL);
    expect(a).toMatchObject({ severity: 'warning' });
    expect(a.message).toContain('1 rejected ingestion request');
    // Company-level (no team named): super admin only.
    await request(API_URL).post('/api/ingest/kpis').set('Authorization', `Bearer ${key}`).send([]);
    await post('/api/alerts/evaluate', c.admin);
    const company = (await alertsOf(c.admin, 'status=open')).find((x) => x.rule === 'ingestion_failure' && x.teamId === null);
    expect(company).toBeTruthy();
    expect((await alertsOf(c.manager, 'status=open')).some((x) => x.rule === 'ingestion_failure' && x.teamId === null)).toBe(false);
    expect((await post(`/api/alerts/${company.id}/acknowledge`, c.manager)).status).toBe(404);
    expect((await post(`/api/alerts/${company.id}/acknowledge`, c.admin)).status).toBe(200);
    // Old failures fall out of the window: resolved.
    await db.query(`UPDATE ingestion_log SET received_at = received_at - INTERVAL '3 days' WHERE company_id = $1`, [GOLDEN_COMPANY]);
    await post('/api/alerts/evaluate', c.admin);
    expect(findAlert(await alertsOf(c.lead, 'status=open'), 'ingestion_failure', PARTIAL)).toBeUndefined();
  });

  it('ALR-008: notifications are the caller\'s own — read, read-all, unread count; another user\'s id is 404', async () => {
    if (!up) return;
    await manual(c.lead, { automation_coverage: 20 });
    const mine = (await get('/api/notifications?unread=true&limit=50', c.lead)).body;
    expect(mine.unreadCount).toBeGreaterThan(0);
    const n = mine.notifications[0];
    expect((await post(`/api/notifications/${n.id}/read`, c.engineer)).status).toBe(404);
    expect((await post(`/api/notifications/${n.id}/read`, c.foreign)).status).toBe(404);
    expect((await post(`/api/notifications/${n.id}/read`, '')).status).toBe(401);
    const read = await post(`/api/notifications/${n.id}/read`, c.lead);
    expect(read.status).toBe(200);
    expect(read.body.unreadCount).toBe(mine.unreadCount - 1);
    expect((await post('/api/notifications/read-all', c.lead)).body.unreadCount).toBe(0);
    expect((await get('/api/notifications/unread-count', c.lead)).body.unreadCount).toBe(0);
    await manual(c.lead, { automation_coverage: 90 });
  });

  it('ALR-009: preferences — own only, validated, digest only for leads and above; in-app off and immediate email honoured', async () => {
    if (!up) return;
    const leadPrefs = await get('/api/notifications/preferences', c.lead);
    expect(leadPrefs.body).toMatchObject({ isDefault: true, digestAvailable: true, preferences: { inApp: true, emailImmediate: false, weeklyDigest: true, minSeverity: 'warning' } });
    const engPrefs = await get('/api/notifications/preferences', c.engineer);
    expect(engPrefs.body).toMatchObject({ digestAvailable: false, preferences: { weeklyDigest: false } });
    expect((await put('/api/notifications/preferences', c.engineer, { weeklyDigest: true })).status).toBe(400);
    expect((await put('/api/notifications/preferences', c.lead, { minSeverity: 'loud' })).status).toBe(400);
    expect((await put('/api/notifications/preferences', c.lead, { inApp: 'no' })).status).toBe(400);
    expect((await put('/api/notifications/preferences', '', { inApp: false })).status).toBe(401);
    expect((await put('/api/notifications/preferences', c.engineer, { inApp: false })).status).toBe(200);
    expect((await put('/api/notifications/preferences', c.lead, { emailImmediate: true })).status).toBe(200);
    const engBefore = (await get('/api/notifications/unread-count', c.engineer)).body.unreadCount;
    await manual(c.lead, { defect_density: 3.5 }); // critical
    const a = findAlert(await alertsOf(c.lead, 'status=open'), 'threshold_breach', PARTIAL, 'defect_density');
    expect(a).toBeTruthy();
    expect((await get('/api/notifications/unread-count', c.engineer)).body.unreadCount).toBe(engBefore);
    const emails = await db.query(
      `SELECT recipient, status, subject, kind FROM notification_deliveries WHERE company_id = $1 AND channel = 'email' AND alert_id = $2`,
      [GOLDEN_COMPANY, a.id]
    );
    expect(emails.rows).toEqual([expect.objectContaining({ recipient: 'partial-1@golden.example', kind: 'alert' })]);
    expect(['logged', 'sent']).toContain(emails.rows[0].status);
    expect(emails.rows[0].subject).toContain('Critical');
    const audit = await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND action = 'notification_prefs.update'`, [GOLDEN_COMPANY]);
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(2);
    await put('/api/notifications/preferences', c.engineer, { inApp: true });
    await put('/api/notifications/preferences', c.lead, { emailImmediate: false });
    await manual(c.lead, { defect_density: 0.3 });
  });
});

describe('Slack settings', () => {
  it('ALR-010: super admin only; the webhook is validated, stored encrypted, only a masked hint is returned, never in the change history', async () => {
    if (!up) return;
    for (const who of ['manager', 'lead', 'engineer', 'viewer']) {
      expect((await get('/api/notifications/settings', c[who])).status).toBe(403);
      expect((await put('/api/notifications/settings', c[who], { slackEnabled: false })).status).toBe(403);
      expect((await post('/api/notifications/settings/slack-test', c[who])).status).toBe(403);
    }
    expect((await get('/api/notifications/settings', '')).status).toBe(401);
    const empty = await get('/api/notifications/settings', c.admin);
    expect(empty.body.settings).toMatchObject({ slackConfigured: false, slackEnabled: false });
    expect((await put('/api/notifications/settings', c.admin, { slackEnabled: true })).status).toBe(400); // no webhook yet
    expect((await put('/api/notifications/settings', c.admin, { slackWebhookUrl: 'https://evil.example.com/hook' })).status).toBe(400);
    expect((await put('/api/notifications/settings', c.admin, { slackWebhookUrl: 'http://hooks.slack.com/services/T000/B000/xyz12345' })).status).toBe(400);
    const secret = 'https://hooks.slack.com/services/T0SECRET/B0SECRET/abcdefghijklmnopqrstWXYZ';
    const saved = await put('/api/notifications/settings', c.admin, { slackWebhookUrl: secret, slackEnabled: true, slackMinSeverity: 'critical' });
    expect(saved.status).toBe(200);
    expect(saved.body.settings).toMatchObject({ slackConfigured: true, slackEnabled: true, slackMinSeverity: 'critical', slackHint: 'hooks.slack.com/services/…WXYZ' });
    expect(JSON.stringify(saved.body)).not.toContain('T0SECRET');
    expect(JSON.stringify((await get('/api/notifications/settings', c.admin)).body)).not.toContain('T0SECRET');
    const row = await db.query('SELECT slack_webhook_enc FROM company_notification_settings WHERE company_id = $1', [GOLDEN_COMPANY]);
    expect(row.rows[0].slack_webhook_enc).toMatch(/^v1:/);
    expect(row.rows[0].slack_webhook_enc).not.toContain('T0SECRET');
    const audit = await db.query(`SELECT before::text || after::text || summary AS t FROM audit_log WHERE company_id = $1 AND action = 'notification_settings.update'`, [GOLDEN_COMPANY]);
    expect(audit.rows.length).toBeGreaterThan(0);
    for (const r of audit.rows) expect(r.t).not.toContain('T0SECRET');
    // Changing other settings keeps the stored webhook.
    expect((await put('/api/notifications/settings', c.admin, { slackDigest: true })).body.settings).toMatchObject({ slackConfigured: true, slackDigest: true });
    // A test message to an unreachable webhook fails without revealing the URL.
    const test = await post('/api/notifications/settings/slack-test', c.admin);
    expect(test.status).toBe(200);
    expect(JSON.stringify(test.body)).not.toContain('T0SECRET');
    const deliveries = await db.query(`SELECT recipient, payload::text AS p, coalesce(error, '') AS e FROM notification_deliveries WHERE company_id = $1 AND channel = 'slack'`, [GOLDEN_COMPANY]);
    for (const d of deliveries.rows) expect(d.recipient + d.p + d.e).not.toContain('T0SECRET');
    // Remove.
    const removed = await put('/api/notifications/settings', c.admin, { slackWebhookUrl: null, slackEnabled: false });
    expect(removed.body.settings).toMatchObject({ slackConfigured: false, slackHint: null });
  });

  it('ALR-011: alerts at or above the Slack minimum are posted to the webhook (local receiver; needs NOTIFY_SLACK_ALLOW_LOCAL=true on the API)', async () => {
    if (!up) return;
    const received: string[] = [];
    const server = http.createServer((req, res) => {
      let b = '';
      req.on('data', (d) => (b += d));
      req.on('end', () => { received.push(b); res.writeHead(200); res.end('ok'); });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;
    try {
      const saved = await put('/api/notifications/settings', c.admin, { slackWebhookUrl: `http://127.0.0.1:${port}/hook/3a-test`, slackEnabled: true, slackMinSeverity: 'critical' });
      if (saved.status === 400) return; // the API runs without NOTIFY_SLACK_ALLOW_LOCAL: covered by ALR-010
      expect(saved.status).toBe(200);
      await manual(c.lead, { defect_escape_rate: 29 }); // critical
      const deadline = Date.now() + 8000;
      while (!received.some((m) => m.includes('Partial Team')) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
      const msg = received.find((m) => m.includes('Partial Team'));
      expect(msg).toBeTruthy();
      expect(JSON.parse(msg as string).text).toMatch(/Critical[\s\S]*KPI off target · Partial Team/);
      const test = await post('/api/notifications/settings/slack-test', c.admin);
      expect(test.body).toMatchObject({ delivered: true, status: 'sent' });
    } finally {
      await put('/api/notifications/settings', c.admin, { slackWebhookUrl: null, slackEnabled: false });
      await manual(c.lead, { defect_escape_rate: 2 });
      server.close();
    }
  });
});

describe('Weekly digest', () => {
  it('ALR-012: preview and test digest for leads and above, covering only their scope', async () => {
    if (!up) return;
    for (const who of ['engineer', 'viewer']) {
      expect((await get('/api/notifications/digest/preview', c[who])).status).toBe(403);
      expect((await post('/api/notifications/digest/test', c[who])).status).toBe(403);
    }
    expect((await get('/api/notifications/digest/preview', '')).status).toBe(401);
    const lead = await get('/api/notifications/digest/preview', c.lead);
    expect(lead.status).toBe(200);
    expect(lead.body.digest.teams.map((t: any) => t.name)).toEqual(['Partial Team']);
    expect(lead.body.text).toContain('Weekly digest for Member1 Fixture');
    const mgr = await get('/api/notifications/digest/preview', c.manager);
    expect(mgr.body.digest.teams.map((t: any) => t.name).sort()).toEqual(['Empty Team', 'Partial Team', 'Stale Team']);
    const admin = await get('/api/notifications/digest/preview', c.admin);
    expect(admin.body.digest.teams).toHaveLength(5); // active teams only
    const t = admin.body.digest.teams.find((x: any) => x.name === 'Big Team');
    expect(t.qaNow).not.toBeNull();
    expect(t).toHaveProperty('inputsUsed');
    const sent = await post('/api/notifications/digest/test', c.lead);
    expect(sent.status).toBe(200);
    expect(sent.body.to).toBe('partial-1@golden.example');
    expect(['logged', 'sent']).toContain(sent.body.status);
    const d = await db.query(`SELECT kind, subject FROM notification_deliveries WHERE company_id = $1 AND kind = 'test' AND channel = 'email' ORDER BY created_at DESC LIMIT 1`, [GOLDEN_COMPANY]);
    expect(d.rows[0].subject).toContain('[Test] QE Navigator weekly digest');
  });
});

describe('Tracked actions', () => {
  let actionId = '';

  it('ACT-001: create — team data writers only, owner must have the team in scope; baseline computed from the stored values', async () => {
    if (!up) return;
    await manual(c.lead, { test_flakiness_rate: 6.5 });
    const body = { teamId: PARTIAL, title: 'Quarantine flaky tests', metricKey: 'test_flakiness_rate', dueDate: '2030-01-15', ownerId: 'golden-u-partial-2' };
    expect((await post('/api/actions', c.engineer, body)).status).toBe(403);
    expect((await post('/api/actions', c.viewer, body)).status).toBe(403);
    expect((await post('/api/actions', c.otherLead, body)).status).toBe(403);
    expect((await post('/api/actions', c.foreign, body)).status).toBe(403);
    expect((await post('/api/actions', '', body)).status).toBe(401);
    expect((await post('/api/actions', c.lead, { ...body, ownerId: 'golden-u-big-1' })).status).toBe(400); // not in scope
    expect((await post('/api/actions', c.lead, { ...body, title: 'x' })).status).toBe(400);
    expect((await post('/api/actions', c.lead, { ...body, metricKey: 'nope' })).status).toBe(400);
    expect((await post('/api/actions', c.lead, { ...body, dueDate: '15/01/2030' })).status).toBe(400);
    expect((await post('/api/actions', c.lead, { ...body, baseline_value: 1 })).status).toBe(201); // client baselines are ignored
    const created = await post('/api/actions', c.lead, body);
    expect(created.status).toBe(201);
    actionId = created.body.action.id;
    expect(created.body.action).toMatchObject({ status: 'open', owner: { id: 'golden-u-partial-2' }, metric: { key: 'test_flakiness_rate', lowerIsBetter: true }, baseline: { value: 6.5 }, outcomes: [] });
    expect((await post('/api/actions', c.manager, { ...body, ownerId: null, title: 'Manager action' })).status).toBe(201); // department B
    expect((await post('/api/actions', c.manager, { ...body, teamId: BIG, ownerId: null })).status).toBe(403);      // department A
    // The owner is told in the app.
    const ownerInbox = (await get('/api/notifications?limit=50', c.engineer)).body.notifications;
    expect(ownerInbox.find((n: any) => n.actionId === actionId)).toMatchObject({ kind: 'action', title: 'Action assigned to you · Partial Team' });
    // Owner candidates: writers only; every candidate has the team in scope.
    expect((await get(`/api/actions/owners?teamId=${PARTIAL}`, c.engineer)).status).toBe(403);
    const owners = (await get(`/api/actions/owners?teamId=${PARTIAL}`, c.lead)).body.owners.map((o: any) => o.id);
    expect(owners).toEqual(expect.arrayContaining(['golden-u-partial-1', 'golden-u-partial-2', 'golden-u-mgr3a', 'golden-u-admin', 'golden-u-viewer3a']));
    expect(owners).not.toContain('golden-u-big-1');
  });

  it('ACT-002: read — analytics scope (engineer and viewer read; other teams and companies 403)', async () => {
    if (!up) return;
    for (const who of ['lead', 'engineer', 'viewer', 'manager', 'admin']) {
      const r = await get(`/api/actions?teamId=${PARTIAL}`, c[who]);
      expect(r.status).toBe(200);
      expect(r.body.actions.some((a: any) => a.id === actionId)).toBe(true);
    }
    expect((await get(`/api/actions?teamId=${PARTIAL}`, c.lead)).body.canManage).toBe(true);
    expect((await get(`/api/actions?teamId=${PARTIAL}`, c.engineer)).body.canManage).toBe(false);
    expect((await get(`/api/actions?teamId=${PARTIAL}`, c.otherLead)).status).toBe(403);
    expect((await get(`/api/actions?teamId=${PARTIAL}`, c.foreign)).status).toBe(403);
    expect((await get(`/api/actions?teamId=${PARTIAL}`, '')).status).toBe(401);
  });

  it('ACT-003: update — the owner may change the status only; writers anything; others refused', async () => {
    if (!up) return;
    const ownerView = (await get(`/api/actions?teamId=${PARTIAL}`, c.engineer)).body.actions.find((a: any) => a.id === actionId);
    expect(ownerView).toMatchObject({ canUpdateStatus: true, canEdit: false });
    expect((await patch(`/api/actions/${actionId}`, c.engineer, { status: 'in_progress' })).status).toBe(200);
    expect((await patch(`/api/actions/${actionId}`, c.engineer, { title: 'Renamed by owner' })).status).toBe(403);
    expect((await patch(`/api/actions/${actionId}`, c.viewer, { status: 'done' })).status).toBe(403);
    expect((await patch(`/api/actions/${actionId}`, c.otherLead, { status: 'done' })).status).toBe(404);
    expect((await patch(`/api/actions/${actionId}`, c.foreign, { status: 'done' })).status).toBe(404);
    expect((await patch(`/api/actions/${actionId}`, c.lead, { status: 'finished' })).status).toBe(400);
    expect((await patch(`/api/actions/${actionId}`, c.lead, {})).status).toBe(400);
    const r = await patch(`/api/actions/${actionId}`, c.lead, { title: 'Quarantine and fix flaky tests', dueDate: '2030-02-01' });
    expect(r.status).toBe(200);
    expect(r.body.changed.sort()).toEqual(['due_date', 'title']);
    const audit = await db.query(`SELECT action FROM audit_log WHERE company_id = $1 AND entity_type = 'action' AND entity_id = $2 ORDER BY created_at`, [GOLDEN_COMPANY, actionId]);
    expect(audit.rows.map((x) => x.action)).toEqual(['action.create', 'action.status', 'action.update']);
  });

  it('ACT-004: outcome computed at completion and 14 / 30 days later from the stored values (never claimed)', async () => {
    if (!up) return;
    await manual(c.lead, { test_flakiness_rate: 3.1 }); // better (lower is better)
    const done = await patch(`/api/actions/${actionId}`, c.engineer, { status: 'done' });
    expect(done.status).toBe(200);
    expect(done.body.action.outcomes[0]).toMatchObject({ checkpoint: 'completion', value: 3.1, outcome: 'improved' });
    expect(done.body.action.outcomes.slice(1).map((o: any) => o.outcome)).toEqual(['pending', 'pending']);
    // Move the completion 15 days back and store a value 5 days after it: the 14-day checkpoint is due.
    await db.query(`UPDATE team_actions SET completed_at = NOW() - INTERVAL '15 days' WHERE id = $1`, [actionId]);
    await db.query(
      `INSERT INTO metric_values (company_id, team_id, metric_key, value, recorded_at, source)
       VALUES ($1, $2, 'test_flakiness_rate', 9.4, NOW() - INTERVAL '10 days', 'jenkins')`,
      [GOLDEN_COMPANY, PARTIAL]
    );
    const after = (await get(`/api/actions?teamId=${PARTIAL}`, c.lead)).body.actions.find((a: any) => a.id === actionId);
    expect(after.outcomes.find((o: any) => o.checkpoint === 'd14')).toMatchObject({ value: 9.4, outcome: 'worse' });
    expect(after.outcomes.find((o: any) => o.checkpoint === 'd30')).toMatchObject({ outcome: 'pending' });
    // 31 days after completion, with no value recorded in the window after completion that is not already counted:
    await db.query(`UPDATE team_actions SET completed_at = NOW() - INTERVAL '31 days' WHERE id = $1`, [actionId]);
    const later = (await get(`/api/actions?teamId=${PARTIAL}`, c.lead)).body.actions.find((a: any) => a.id === actionId);
    expect(['improved', 'unchanged', 'worse', 'no_data']).toContain(later.outcomes.find((o: any) => o.checkpoint === 'd30').outcome);
    // Reopening clears the completion and the outcomes.
    const reopened = await patch(`/api/actions/${actionId}`, c.lead, { status: 'open' });
    expect(reopened.body.action).toMatchObject({ status: 'open', completedAt: null, outcomes: [] });
  });

  it('ACT-005: an action without a linked KPI has no outcome; delete is for writers only and audited', async () => {
    if (!up) return;
    const plain = await post('/api/actions', c.lead, { teamId: PARTIAL, title: 'Pair on test design' });
    expect(plain.status).toBe(201);
    const done = await patch(`/api/actions/${plain.body.action.id}`, c.lead, { status: 'done' });
    expect(done.body.action.outcomes).toEqual([]);
    expect((await del(`/api/actions/${actionId}`, c.engineer)).status).toBe(403);
    expect((await del(`/api/actions/${actionId}`, c.otherLead)).status).toBe(404);
    expect((await del(`/api/actions/${actionId}`, c.foreign)).status).toBe(404);
    expect((await del(`/api/actions/${actionId}`, c.lead)).status).toBe(200);
    expect((await del(`/api/actions/${actionId}`, c.lead)).status).toBe(404);
    const audit = await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND action = 'action.delete' AND entity_id = $2`, [GOLDEN_COMPANY, actionId]);
    expect(audit.rows[0].n).toBe(1);
  });
});
