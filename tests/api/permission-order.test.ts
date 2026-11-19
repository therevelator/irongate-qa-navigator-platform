/**
 * Permission before validation (FI-15): a caller who may not use an endpoint at all gets 403 for an
 * empty or broken body, never a 400 / 404 that tells them what the body should look like.
 *
 *   PERM-01  viewer and software engineer: every representative mutating admin endpoint answers 403
 *            to an empty body (users, passwords, assignments, configs, targets, alert rules, manual
 *            metrics, developer metrics, business impact, teams, departments, API keys, intervals)
 *   PERM-02  the same endpoints still validate for someone who may use them (400 for the empty body)
 *   PERM-03  a person who may not change an action gets 403, not "Nothing to change"
 *
 * Uses the demo company's viewer, engineer and super admin. Skips when no live backend is running.
 */
import { backendUp, del, get, login, patch, post, put } from './helpers/http';

let up = true;
const c: Record<string, string> = {};
let adminId = '';
let viewerId = '';
let someTeam = '';

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  for (const k of ['admin', 'viewer', 'engineer']) c[k] = (await login(`${k}@irongate.com`)).cookie;
  const users = await get('/api/admin/users', c.admin);
  adminId = users.body.find((u: any) => u.email === 'admin@irongate.com').id;
  viewerId = users.body.find((u: any) => u.email === 'viewer@irongate.com').id;
  someTeam = (await get('/api/teams', c.admin)).body.teams[0].id;
});

type Call = [string, (cookie: string) => Promise<{ status: number }>];
const calls = (): Call[] => [
  ['POST /admin/users', (k) => post('/api/admin/users', k, {})],
  ['POST /admin/users/:id/reset-password', (k) => post(`/api/admin/users/${adminId}/reset-password`, k, {})],
  ['POST /admin/users/:id/assignments', (k) => post(`/api/admin/users/${viewerId}/assignments`, k, {})],
  ['DELETE /admin/users/:id/assignments/:x', (k) => del(`/api/admin/users/${viewerId}/assignments/nope`, k)],
  ['POST /admin/configs', (k) => post('/api/admin/configs', k, {})],
  ['PUT /targets', (k) => put('/api/targets', k, {})],
  ['PUT /alerts/rules', (k) => put('/api/alerts/rules', k, {})],
  ['POST /metrics/manual', (k) => post('/api/metrics/manual', k, {})],
  ['POST /metrics/developer', (k) => post('/api/metrics/developer', k, {})],
  ['POST /analytics/business-impact-v2/:team/quality-metrics', (k) => post(`/api/analytics/business-impact-v2/no-such-team/quality-metrics`, k, {})],
  ['POST /admin/teams', (k) => post('/api/admin/teams', k, {})],
  ['POST /admin/departments', (k) => post('/api/admin/departments', k, {})],
  ['POST /admin/api-keys', (k) => post('/api/admin/api-keys', k, {})],
  ['PUT /settings/metric-intervals/:key', (k) => put('/api/settings/metric-intervals/test_coverage', k, {})],
  ['PUT /settings/metric-intervals', (k) => put('/api/settings/metric-intervals', k, {})],
  ['POST /admin/invitations', (k) => post('/api/admin/invitations', k, {})],
  ['PUT /admin/session-settings', (k) => put('/api/admin/session-settings', k, {})],
  ['PUT /admin/teams/:id/department', (k) => put(`/api/admin/teams/${someTeam}/department`, k, {})],
];

describe('Permission before validation', () => {
  test('PERM-01 a viewer and a software engineer get 403 for an empty body', async () => {
    if (!up) return;
    const wrong: string[] = [];
    for (const who of ['viewer', 'engineer']) {
      for (const [name, call] of calls()) {
        const res = await call(c[who]);
        if (res.status !== 403) wrong.push(`${who} ${name}: ${res.status}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test('PERM-02 for someone who may use them, the empty body is still a 400', async () => {
    if (!up) return;
    const wrong: string[] = [];
    for (const [name, call] of calls()) {
      if (name.startsWith('DELETE') || name.includes('quality-metrics') || name.includes('/department')) continue; // 404 / plan answers
      const res = await call(c.admin);
      if (res.status !== 400) wrong.push(`admin ${name}: ${res.status}`);
    }
    expect(wrong).toEqual([]);
  });

  test('PERM-03 someone who may not change an action gets 403, not "Nothing to change"', async () => {
    if (!up) return;
    const me = (await get('/api/auth/me', c.viewer)).body.user;
    const list = await get(`/api/actions?teamId=${me.primary_team_id}`, c.viewer);
    expect(list.status).toBe(200);
    const action = (list.body.actions ?? []).find((a: any) => !a.canUpdateStatus && !a.canEdit);
    if (!action) return; // no action of someone else on the viewer's team in this data set
    const res = await patch(`/api/actions/${action.id}`, c.viewer, {});
    expect(res.status).toBe(403);
  });
});
