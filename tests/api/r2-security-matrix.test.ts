import request, { Response } from 'supertest';
import { API_URL, NEW_PW, backendUp, cookieFrom, del, get, login, patch, post, put } from './helpers/http';

/**
 * Release R2 security matrix: one request per role for every endpoint added in R2 (and the
 * existing endpoints whose access rule R2 changed), so a regression in any policy check fails CI.
 *
 * Callers
 *   admin     admin@irongate.com (super_admin of the company)
 *   manager   qa_manager of department A
 *   lead      team_lead of team A1
 *   engineer  qa_engineer on team A1
 *   viewer    viewer on team A1
 *   foreign   super_admin of another company (registered here)
 *   anon      no session
 * Fixture teams: A1 and A2 (department A), B1 (department B), F (the other company).
 *
 * Expectations: 'ok' = the caller passed the access check (2xx, or a 400 / 409 validation answer
 * to a deliberately incomplete body, so nothing is written); 401 / 403 / 404 = refused with exactly
 * that status. Requests that would write use invalid bodies or a team without members where
 * possible; everything created is removed in afterAll.
 */

type Who = 'admin' | 'manager' | 'lead' | 'engineer' | 'viewer' | 'foreign' | 'anon';
type Expect = 'ok' | 401 | 403 | 404;
const WHO: Who[] = ['admin', 'manager', 'lead', 'engineer', 'viewer', 'foreign', 'anon'];

const OK = (s: number, body?: any) => (s >= 200 && s < 300) || s === 400 || s === 409 || (s === 404 && /^No metrics found/.test(body?.error ?? ''));

let up = true;
const c: Record<string, string> = { anon: '' };
const id: Record<string, string> = {};
const T: Record<string, string> = {};
const D: Record<string, string> = {};
const createdUsers: string[] = [];
let stamp = 0;

beforeAll(async () => {
  up = await backendUp();
  if (!up) { console.warn('Backend not running at', API_URL, '- R2 security matrix skipped'); return; }
  c.admin = (await login('admin@irongate.com')).cookie;
  stamp = Date.now();
  for (const k of ['A', 'B']) D[k] = (await post('/api/admin/departments', c.admin, { name: `SecMatrix ${k} ${stamp}` })).body.id;
  for (const [k, dept] of [['A1', 'A'], ['A2', 'A'], ['B1', 'B']] as const) {
    T[k] = (await post('/api/admin/teams', c.admin, { name: `SecMatrix ${k} ${stamp}`, departmentId: D[dept] })).body.id;
  }
  const mk = async (key: string, role: string, where: { teamId?: string; departmentId?: string }) => {
    const email = `secmatrix-${key}-${stamp}@irongate.test`;
    const res = await post('/api/admin/users', c.admin, { email, password: NEW_PW, firstName: 'Sec', lastName: key, role, ...where });
    if (res.status !== 201) throw new Error(`create ${key}: ${res.status} ${JSON.stringify(res.body)}`);
    id[key] = res.body.id;
    createdUsers.push(res.body.id);
    c[key] = (await login(email, NEW_PW)).cookie;
  };
  await mk('manager', 'qa_manager', { departmentId: D.A });
  await mk('lead', 'team_lead', { teamId: T.A1 });
  await mk('engineer', 'qa_engineer', { teamId: T.A1 });
  await mk('viewer', 'viewer', { teamId: T.A1 });
  const reg = await post('/api/auth/register', '', {
    email: `secmatrix-foreign-${stamp}@other${stamp}.test`, password: NEW_PW, firstName: 'Other', lastName: 'Company',
    companyName: `SecMatrix Other ${stamp}`, departmentName: 'Ops', teamName: 'Ops Team',
  });
  c.foreign = cookieFrom(reg);
  T.F = (await get('/api/analytics/scope', c.foreign)).body?.teams?.[0]?.id || '';
});

afterAll(async () => {
  if (!up) return;
  const views = (await get('/api/saved-views?kind=dashboard', c.admin)).body?.views ?? [];
  for (const v of views) if (String(v.name).startsWith(`SecMatrix ${stamp}`)) await del(`/api/saved-views/${v.id}`, c.admin);
  for (const u of createdUsers) await del(`/api/admin/users/${u}`, c.admin);
  for (const t of ['A1', 'A2', 'B1']) if (T[t]) await del(`/api/admin/teams/${T[t]}`, c.admin);
  for (const d of ['A', 'B']) if (D[d]) await del(`/api/admin/departments/${D[d]}`, c.admin);
});

const skip = () => !up || !T.A1 || !T.F;

/** Run one endpoint for every caller and collect every mismatch. */
async function matrix(label: string, call: (cookie: string, who: Who) => Promise<Response>, exp: Record<Who, Expect>, errors: string[]) {
  for (const who of WHO) {
    const res = await call(c[who] ?? '', who);
    const want = exp[who];
    const pass = want === 'ok' ? OK(res.status, res.body) : res.status === want;
    if (!pass) errors.push(`${label}: ${who} -> ${res.status}, expected ${want} ${JSON.stringify(res.body).slice(0, 140)}`);
    if (res.status >= 500) errors.push(`${label}: ${who} -> server error ${res.status}`);
  }
}

// Common expectation rows.
const ALL_A1: Record<Who, Expect> = { admin: 'ok', manager: 'ok', lead: 'ok', engineer: 'ok', viewer: 'ok', foreign: 403, anon: 401 };
const ADMIN_MANAGER: Record<Who, Expect> = { admin: 'ok', manager: 'ok', lead: 403, engineer: 403, viewer: 403, foreign: 403, anon: 401 };
const ADMIN_ONLY: Record<Who, Expect> = { admin: 'ok', manager: 403, lead: 403, engineer: 403, viewer: 403, foreign: 'ok', anon: 401 };
const OUT_OF_SCOPE_B1: Record<Who, Expect> = { admin: 'ok', manager: 403, lead: 403, engineer: 403, viewer: 403, foreign: 403, anon: 401 };
const SIGNED_IN: Record<Who, Expect> = { admin: 'ok', manager: 'ok', lead: 'ok', engineer: 'ok', viewer: 'ok', foreign: 'ok', anon: 401 };

describe('R2 security matrix', () => {
  it('SEC-R2-001: TV mode shows any team of the company; compare and revenue impact follow the analytics scope', async () => {
    if (skip()) return;
    const e: string[] = [];
    await matrix('GET /tv/teams/A1', (k) => get(`/api/tv/teams/${T.A1}`, k), ALL_A1, e);
    // TV mode (the wall screen): every role, any team of the own company (canViewTeamTv).
    await matrix('GET /tv/teams/B1', (k) => get(`/api/tv/teams/${T.B1}`, k), ALL_A1, e);
    await matrix('GET /tv/teams/F', (k) => get(`/api/tv/teams/${T.F}`, k), { admin: 403, manager: 403, lead: 403, engineer: 403, viewer: 403, foreign: 'ok', anon: 401 }, e);
    const cmp = { ...ADMIN_MANAGER };
    await matrix('GET /compare/teams A1,A2', (k) => get(`/api/compare/teams?ids=${T.A1},${T.A2}`, k), cmp, e);
    await matrix('GET /compare/teams.csv A1,A2', (k) => get(`/api/compare/teams.csv?ids=${T.A1},${T.A2}`, k), cmp, e);
    await matrix('GET /compare/teams A1,B1', (k) => get(`/api/compare/teams?ids=${T.A1},${T.B1}`, k), OUT_OF_SCOPE_B1, e);
    await matrix('GET /compare/teams A1,F', (k) => get(`/api/compare/teams?ids=${T.A1},${T.F}`, k),
      { admin: 403, manager: 403, lead: 403, engineer: 403, viewer: 403, foreign: 403, anon: 401 }, e);
    await matrix('GET /revenue-impact/teams/A1', (k) => get(`/api/revenue-impact/teams/${T.A1}`, k), ALL_A1, e);
    await matrix('GET /revenue-impact/teams/B1', (k) => get(`/api/revenue-impact/teams/${T.B1}`, k), OUT_OF_SCOPE_B1, e);
    await matrix('GET /revenue-impact/teams/A1/what-if', (k) => get(`/api/revenue-impact/teams/${T.A1}/what-if`, k), ALL_A1, e);
    await matrix('GET /revenue-impact/rollup', (k) => get('/api/revenue-impact/rollup', k), { ...ADMIN_MANAGER, foreign: 'ok' }, e);
    await matrix('GET /revenue-impact/rollup?departmentId=B', (k) => get(`/api/revenue-impact/rollup?departmentId=${D.B}`, k),
      { admin: 'ok', manager: 403, lead: 403, engineer: 403, viewer: 403, foreign: 403, anon: 401 }, e);
    expect(e).toEqual([]);
  });

  it('SEC-R2-002: team detail reads follow the analytics scope (QA managers: their departments only)', async () => {
    if (skip()) return;
    const e: string[] = [];
    await matrix('GET /metrics/teams/A1', (k) => get(`/api/metrics/teams/${T.A1}`, k), { ...ALL_A1, foreign: 404 }, e);
    await matrix('GET /metrics/teams/B1', (k) => get(`/api/metrics/teams/${T.B1}`, k), { ...OUT_OF_SCOPE_B1, foreign: 404 }, e);
    await matrix('GET /metrics/teams/B1/history', (k) => get(`/api/metrics/teams/${T.B1}/history`, k), { ...OUT_OF_SCOPE_B1, foreign: 404 }, e);
    await matrix('GET /metrics/teams/B1/velocity', (k) => get(`/api/metrics/teams/${T.B1}/velocity`, k), { ...OUT_OF_SCOPE_B1, foreign: 404 }, e);
    await matrix('GET /teams/B1/kpi-history', (k) => get(`/api/teams/${T.B1}/kpi-history`, k), OUT_OF_SCOPE_B1, e);
    expect(e).toEqual([]);
  });

  it('SEC-R2-003: wellbeing pulse survey', async () => {
    if (skip()) return;
    const e: string[] = [];
    await matrix('GET /pulse/teams/A1', (k) => get(`/api/pulse/teams/${T.A1}`, k), ALL_A1, e);
    await matrix('GET /pulse/teams/B1', (k) => get(`/api/pulse/teams/${T.B1}`, k), OUT_OF_SCOPE_B1, e);
    // Answering: people assigned to the team only (an invalid body, so nothing is stored).
    await matrix('POST /pulse/teams/A1/responses', (k) => post(`/api/pulse/teams/${T.A1}/responses`, k, {}),
      { admin: 403, manager: 403, lead: 'ok', engineer: 'ok', viewer: 'ok', foreign: 403, anon: 401 }, e);
    const managers: Record<Who, Expect> = { admin: 'ok', manager: 'ok', lead: 403, engineer: 403, viewer: 403, foreign: 403, anon: 401 };
    await matrix('PUT /pulse/teams/A1/cadence', (k) => put(`/api/pulse/teams/${T.A1}/cadence`, k, { cadence: 'never' }), managers, e);
    await matrix('PUT /pulse/teams/A1/auto-send', (k) => put(`/api/pulse/teams/${T.A1}/auto-send`, k, { enabled: 'maybe' }), managers, e);
    // Sending: lead / manager / admin in scope. A2 has no members, so nothing is e-mailed.
    await matrix('POST /pulse/teams/A2/send', (k) => post(`/api/pulse/teams/${T.A2}/send`, k), managers, e);
    await matrix('POST /pulse/teams/A2/remind', (k) => post(`/api/pulse/teams/${T.A2}/remind`, k), managers, e);
    await matrix('POST /pulse/teams/B1/send', (k) => post(`/api/pulse/teams/${T.B1}/send`, k), OUT_OF_SCOPE_B1, e);
    // Personal links need no session but a valid token; a made-up token reveals nothing.
    for (const who of WHO) {
      const link = await post('/api/pulse/link', c[who], { token: 'igp_not-a-real-token' });
      if (link.status >= 500 || link.body?.team || link.body?.questions?.length && link.body?.valid) e.push(`POST /pulse/link ${who}: ${link.status} ${JSON.stringify(link.body).slice(0, 120)}`);
      const ans = await post('/api/pulse/link/respond', c[who], { token: 'igp_not-a-real-token', answers: { energy: 3, workload: 3, focus: 3, support: 3, safety: 3 } });
      if (ans.status < 400 || ans.status >= 500) e.push(`POST /pulse/link/respond ${who}: ${ans.status}`);
    }
    expect(e).toEqual([]);
  });

  it('SEC-R2-004: alerts, alert rules and evaluation', async () => {
    if (skip()) return;
    const e: string[] = [];
    await matrix('GET /alerts?teamId=A1', (k) => get(`/api/alerts?teamId=${T.A1}`, k), ALL_A1, e);
    await matrix('GET /alerts?teamId=B1', (k) => get(`/api/alerts?teamId=${T.B1}`, k), OUT_OF_SCOPE_B1, e);
    await matrix('GET /alerts', (k) => get('/api/alerts', k), SIGNED_IN, e);
    await matrix('POST /alerts/unknown/acknowledge', (k) => post('/api/alerts/00000000-0000-0000-0000-000000000000/acknowledge', k),
      { admin: 404, manager: 404, lead: 404, engineer: 404, viewer: 404, foreign: 404, anon: 401 }, e);
    await matrix('GET /alerts/rules company', (k) => get('/api/alerts/rules?scopeType=company', k), { ...ADMIN_MANAGER, foreign: 'ok' }, e);
    await matrix('PUT /alerts/rules company', (k) => put('/api/alerts/rules', k, { scopeType: 'company', rules: 'x' }), ADMIN_ONLY, e);
    await matrix('PUT /alerts/rules department A', (k) => put('/api/alerts/rules', k, { scopeType: 'department', scopeId: D.A, rules: 'x' }),
      { admin: 'ok', manager: 'ok', lead: 403, engineer: 403, viewer: 403, foreign: 404, anon: 401 }, e);
    await matrix('PUT /alerts/rules department B', (k) => put('/api/alerts/rules', k, { scopeType: 'department', scopeId: D.B, rules: 'x' }),
      { admin: 'ok', manager: 403, lead: 403, engineer: 403, viewer: 403, foreign: 404, anon: 401 }, e);
    await matrix('POST /alerts/evaluate', (k) => post('/api/alerts/evaluate', k), ADMIN_ONLY, e);
    expect(e).toEqual([]);
  });

  it('SEC-R2-005: notifications, digest and Slack settings', async () => {
    if (skip()) return;
    const e: string[] = [];
    await matrix('GET /notifications', (k) => get('/api/notifications', k), SIGNED_IN, e);
    await matrix('GET /notifications/unread-count', (k) => get('/api/notifications/unread-count', k), SIGNED_IN, e);
    await matrix('POST /notifications/unknown/read', (k) => post('/api/notifications/00000000-0000-0000-0000-000000000000/read', k),
      { admin: 404, manager: 404, lead: 404, engineer: 404, viewer: 404, foreign: 404, anon: 401 }, e);
    await matrix('GET /notifications/preferences', (k) => get('/api/notifications/preferences', k), SIGNED_IN, e);
    await matrix('PUT /notifications/preferences (invalid)', (k) => put('/api/notifications/preferences', k, { minSeverity: 'loud' }), SIGNED_IN, e);
    const digest: Record<Who, Expect> = { admin: 'ok', manager: 'ok', lead: 'ok', engineer: 403, viewer: 403, foreign: 'ok', anon: 401 };
    await matrix('GET /notifications/digest/preview', (k) => get('/api/notifications/digest/preview', k), digest, e);
    await matrix('GET /notifications/settings', (k) => get('/api/notifications/settings', k), ADMIN_ONLY, e);
    await matrix('PUT /notifications/settings (invalid)', (k) => put('/api/notifications/settings', k, { slackWebhookUrl: 'http://evil.example/x' }), ADMIN_ONLY, e);
    await matrix('POST /notifications/settings/slack-test', (k) => post('/api/notifications/settings/slack-test', k), ADMIN_ONLY, e);
    // The webhook URL is write-only: no response carries it.
    const s = await get('/api/notifications/settings', c.admin);
    expect(JSON.stringify(s.body)).not.toMatch(/hooks\.slack\.com\/services\/[A-Za-z0-9]{6,}/);
    expect(e).toEqual([]);
  });

  it('SEC-R2-006: tracked actions', async () => {
    if (skip()) return;
    const e: string[] = [];
    await matrix('GET /actions?teamId=A1', (k) => get(`/api/actions?teamId=${T.A1}`, k), ALL_A1, e);
    await matrix('GET /actions?teamId=B1', (k) => get(`/api/actions?teamId=${T.B1}`, k), OUT_OF_SCOPE_B1, e);
    const writers: Record<Who, Expect> = { admin: 'ok', manager: 'ok', lead: 'ok', engineer: 403, viewer: 403, foreign: 403, anon: 401 };
    await matrix('GET /actions/owners?teamId=A1', (k) => get(`/api/actions/owners?teamId=${T.A1}`, k), writers, e);
    await matrix('POST /actions A1 (invalid)', (k) => post('/api/actions', k, { teamId: T.A1, title: '' }), writers, e);
    await matrix('POST /actions B1 (invalid)', (k) => post('/api/actions', k, { teamId: T.B1, title: '' }), OUT_OF_SCOPE_B1, e);
    // An action of A1, then every caller tries to change / delete it.
    const created = await post('/api/actions', c.admin, { teamId: T.A1, title: `SecMatrix ${stamp}` });
    expect(created.status).toBe(201);
    const aid = created.body.action.id;
    await matrix('PATCH /actions/:id title', (k) => patch(`/api/actions/${aid}`, k, { title: `SecMatrix ${stamp} edited` }),
      { admin: 'ok', manager: 'ok', lead: 'ok', engineer: 403, viewer: 403, foreign: 404, anon: 401 }, e);
    await matrix('DELETE /actions/:id (foreign / anon / engineer / viewer)', (k, who) =>
      ['foreign', 'anon', 'engineer', 'viewer'].includes(who) ? del(`/api/actions/${aid}`, k) : Promise.resolve({ status: 200, body: {} } as Response),
      { admin: 'ok', manager: 'ok', lead: 'ok', engineer: 403, viewer: 403, foreign: 404, anon: 401 }, e);
    expect((await del(`/api/actions/${aid}`, c.lead)).status).toBe(200);
    expect(e).toEqual([]);
  });

  it('SEC-R2-007: ingestion log, targets, onboarding, saved views', async () => {
    if (skip()) return;
    const e: string[] = [];
    await matrix('GET /ingestion-log', (k) => get('/api/ingestion-log', k), { ...ADMIN_MANAGER, foreign: 'ok' }, e);
    await matrix('GET /ingestion-log/sources', (k) => get('/api/ingestion-log/sources', k), { ...ADMIN_MANAGER, foreign: 'ok' }, e);
    await matrix('GET /ingestion-log/unknown', (k) => get('/api/ingestion-log/00000000-0000-0000-0000-000000000000', k),
      { admin: 404, manager: 404, lead: 403, engineer: 403, viewer: 403, foreign: 404, anon: 401 }, e);
    await matrix('GET /targets company', (k) => get('/api/targets?scopeType=company', k), SIGNED_IN, e);
    await matrix('PUT /targets company (invalid)', (k) => put('/api/targets', k, { scopeType: 'company', targets: [] }), ADMIN_ONLY, e);
    await matrix('PUT /targets department A (invalid)', (k) => put('/api/targets', k, { scopeType: 'department', scopeId: D.A, targets: [] }),
      { admin: 'ok', manager: 'ok', lead: 403, engineer: 403, viewer: 403, foreign: 404, anon: 401 }, e);
    await matrix('PUT /targets team B1 (invalid)', (k) => put('/api/targets', k, { scopeType: 'team', scopeId: T.B1, targets: [] }),
      { admin: 'ok', manager: 403, lead: 403, engineer: 403, viewer: 403, foreign: 404, anon: 401 }, e);
    await matrix('GET /onboarding', (k) => get('/api/onboarding', k), ADMIN_ONLY, e);
    await matrix('POST /onboarding/restore', (k) => post('/api/onboarding/restore', k), ADMIN_ONLY, e);
    await matrix('GET /saved-views', (k) => get('/api/saved-views?kind=dashboard', k), SIGNED_IN, e);
    // A private view of the admin: invisible (404) to everyone else; only its owner shares it.
    const v = await post('/api/saved-views', c.admin, { kind: 'dashboard', name: `SecMatrix ${stamp} private`, state: {} });
    expect(v.status).toBe(201);
    const vid = v.body.view.id;
    await matrix('PUT /saved-views/:id', (k) => put(`/api/saved-views/${vid}`, k, { name: `SecMatrix ${stamp} renamed` }),
      { admin: 'ok', manager: 404, lead: 404, engineer: 404, viewer: 404, foreign: 404, anon: 401 }, e);
    await matrix('DELETE /saved-views/:id (others)', (k, who) => who === 'admin' ? Promise.resolve({ status: 200, body: {} } as Response) : del(`/api/saved-views/${vid}`, k),
      { admin: 'ok', manager: 404, lead: 404, engineer: 404, viewer: 404, foreign: 404, anon: 401 }, e);
    await matrix('POST /saved-views/:id/share (others)', (k, who) => who === 'admin' ? Promise.resolve({ status: 200, body: {} } as Response) : post(`/api/saved-views/${vid}/share`, k, { shared: true }),
      { admin: 'ok', manager: 404, lead: 404, engineer: 404, viewer: 404, foreign: 404, anon: 401 }, e);
    // A view naming a team outside the caller's scope is refused.
    const outside = await post('/api/saved-views', c.lead, { kind: 'compare', name: `SecMatrix ${stamp} outside`, state: { teamIds: [T.A1, T.B1] } });
    expect(outside.status).toBe(403);
    expect((await del(`/api/saved-views/${vid}`, c.admin)).status).toBe(200);
    expect(e).toEqual([]);
  });

  it('SEC-R2-008: role assignments, change history, invitations', async () => {
    if (skip()) return;
    const e: string[] = [];
    await matrix('GET /admin/users/:engineer/assignments', (k) => get(`/api/admin/users/${id.engineer}/assignments`, k),
      { admin: 'ok', manager: 'ok', lead: 'ok', engineer: 'ok', viewer: 403, foreign: 404, anon: 401 }, e);
    // Writers send an invalid role (nothing is granted); engineer and viewer try a real grant.
    await matrix('POST /admin/users/:viewer/assignments', (k, who) => post(`/api/admin/users/${id.viewer}/assignments`, k,
      who === 'engineer' || who === 'viewer' ? { role: 'viewer', scopeId: T.A2 } : { role: 'owner', scopeId: T.A1 }),
      { admin: 'ok', manager: 'ok', lead: 'ok', engineer: 403, viewer: 403, foreign: 404, anon: 401 }, e);
    const viewerA1 = ((await get(`/api/admin/users/${id.viewer}/assignments`, c.admin)).body.assignments as any[]).find((a) => a.scope_id === T.A1);
    await matrix('DELETE /admin/users/:viewer/assignments/:A1', (k, who) => ['engineer', 'foreign', 'anon'].includes(who)
      ? del(`/api/admin/users/${id.viewer}/assignments/${viewerA1.id}`, k) : Promise.resolve({ status: 200, body: {} } as Response),
      { admin: 'ok', manager: 'ok', lead: 'ok', engineer: 403, viewer: 'ok', foreign: 404, anon: 401 }, e);
    await matrix('GET /admin/audit', (k) => get('/api/admin/audit', k), { ...ADMIN_MANAGER, foreign: 'ok' }, e);
    await matrix('GET /admin/audit/facets', (k) => get('/api/admin/audit/facets', k), { ...ADMIN_MANAGER, foreign: 'ok' }, e);
    await matrix('POST /admin/audit/unknown/undo', (k) => post('/api/admin/audit/00000000-0000-0000-0000-000000000000/undo', k),
      { admin: 404, manager: 404, lead: 403, engineer: 403, viewer: 403, foreign: 404, anon: 401 }, e);
    const inviters: Record<Who, Expect> = { admin: 'ok', manager: 'ok', lead: 'ok', engineer: 403, viewer: 403, foreign: 'ok', anon: 401 };
    await matrix('GET /admin/invitations', (k) => get('/api/admin/invitations', k), inviters, e);
    await matrix('POST /admin/invitations (invalid email)', (k) => post('/api/admin/invitations', k, { email: 'not-an-email', role: 'viewer', scopeId: T.A1 }), inviters, e);
    // A real invitation (viewer of A1): only people who may handle it see / resend / revoke it.
    const inv = await post('/api/admin/invitations', c.admin, { email: `secmatrix-invitee-${stamp}@irongate.test`, role: 'viewer', scopeId: T.A1 });
    expect(inv.status).toBe(201);
    const invId = inv.body.invitation?.id ?? inv.body.id;
    const notHandlers: Record<Who, Expect> = { admin: 'ok', manager: 'ok', lead: 'ok', engineer: 404, viewer: 404, foreign: 404, anon: 401 };
    await matrix('POST /admin/invitations/:id/resend (non-handlers)', (k, who) => ['engineer', 'viewer', 'foreign', 'anon'].includes(who)
      ? post(`/api/admin/invitations/${invId}/resend`, k) : Promise.resolve({ status: 200, body: {} } as Response), notHandlers, e);
    await matrix('POST /admin/invitations/:id/revoke (non-handlers)', (k, who) => ['engineer', 'viewer', 'foreign', 'anon'].includes(who)
      ? post(`/api/admin/invitations/${invId}/revoke`, k) : Promise.resolve({ status: 200, body: {} } as Response), notHandlers, e);
    expect((await post(`/api/admin/invitations/${invId}/revoke`, c.lead)).status).toBe(200);
    expect(e).toEqual([]);
  });

  it('SEC-R2-009: public sign-in routes reveal nothing and never 500', async () => {
    if (!up) return;
    const providers = await get('/api/auth/providers');
    expect(providers.status).toBe(200);
    expect(JSON.stringify(providers.body)).not.toMatch(/secret/i);
    expect((await get('/api/auth/invitations/igi_not-a-real-token')).status).toBe(404);
    expect((await get('/api/auth/invitations/garbage')).status).toBe(404);
    const accept = await post('/api/auth/invitations/accept', '', { token: 'igi_not-a-real-token', firstName: 'A', lastName: 'B', password: 'Passw0rd!x' });
    expect(accept.status).toBeGreaterThanOrEqual(400);
    expect(accept.status).toBeLessThan(500);
    expect(cookieFrom(accept)).toBe('');
    expect((await post('/api/auth/invitations/accept', '', {})).status).toBe(400);
    // SSO without configured providers: 404, never a redirect to an unconfigured provider.
    const sso = await request(API_URL).get('/api/auth/sso/github/start').redirects(0);
    expect(sso.status).toBe(404);
    // A callback without the state cookie never starts a session.
    const cb = await request(API_URL).get('/api/auth/sso/google/callback?code=x&state=y').redirects(0);
    expect(cookieFrom(cb)).toBe('');
  });

  it('SEC-R2-010: developer data and team writes', async () => {
    if (skip()) return;
    const e: string[] = [];
    // Team data writes: admin, the department's manager, the team's lead.
    const writers: Record<Who, Expect> = { admin: 'ok', manager: 'ok', lead: 'ok', engineer: 403, viewer: 403, foreign: 404, anon: 401 };
    await matrix('POST /metrics/manual A1 (invalid)', (k) => post('/api/metrics/manual', k, { teamId: T.A1, test_coverage: 'abc' }), writers, e);
    await matrix('POST /metrics/manual B1 (invalid)', (k) => post('/api/metrics/manual', k, { teamId: T.B1, test_coverage: 'abc' }),
      { admin: 'ok', manager: 403, lead: 403, engineer: 403, viewer: 403, foreign: 404, anon: 401 }, e);
    await matrix('POST /metrics/developer A1 (invalid value)', (k) => post('/api/metrics/developer', k, { teamId: T.A1, developerId: id.engineer, focusTimeHours: -4 }), writers, e);
    await matrix('GET /analytics/developer-metrics A1', (k) => get(`/api/analytics/developer-metrics?teamId=${T.A1}`, k), ALL_A1, e);
    await matrix('GET /analytics/developer-metrics B1', (k) => get(`/api/analytics/developer-metrics?teamId=${T.B1}`, k), OUT_OF_SCOPE_B1, e);
    // Sample data and the executive briefing: shared helpers (company admin / insight roles).
    await matrix('GET /analytics/seed-data/status', (k) => get('/api/analytics/seed-data/status', k), ADMIN_ONLY, e);
    expect(e).toEqual([]);
  });
});
