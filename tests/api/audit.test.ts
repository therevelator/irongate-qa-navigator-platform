import { Response } from 'supertest';
import { backendUp, cookieFrom, del, get, localDb, login, NEW_PW, patch, post, put } from './helpers/http';

/**
 * Change history (audit_log) and undo:
 *   GET  /api/admin/audit             super_admin: company; qa_manager: their departments; others 403
 *   GET  /api/admin/audit/facets
 *   POST /api/admin/audit/:id/undo    reversible changes only; refuses when a newer change touches
 *                                     the same people / team / department, or the state drifted
 * Every audited action is performed once and its entry checked; every reversible action is undone.
 *
 * Fixture: departments X (manager mgrX; teams X1 with lead, eng, eng2, viewer; X2) and Y (team Y1
 * with engY). Runs against a live backend at API_URL; skips cleanly when none is running.
 */

describe('Change history and undo', () => {
  let up = true;
  const c: Record<string, string> = {};
  const id: Record<string, string> = {};
  const T: Record<string, string> = {};
  const D: Record<string, string> = {};
  const users: string[] = [];
  let stamp = 0;

  beforeAll(async () => {
    up = await backendUp();
    if (!up) return;
    c.admin = (await login('admin@irongate.com')).cookie;
    stamp = Date.now();
    for (const k of ['X', 'Y']) D[k] = (await post('/api/admin/departments', c.admin, { name: `Audit ${k} ${stamp}` })).body.id;
    for (const [k, d] of [['X1', 'X'], ['X2', 'X'], ['Y1', 'Y']] as const) {
      T[k] = (await post('/api/admin/teams', c.admin, { name: `Audit ${k} ${stamp}`, departmentId: D[d] })).body.id;
    }
    const mk = async (key: string, role: string, where: object) => {
      const email = `audit-${key.toLowerCase()}-${stamp}@irongate.test`;
      const res = await post('/api/admin/users', c.admin, { email, password: NEW_PW, firstName: 'Audit', lastName: key, role, ...where });
      if (res.status !== 201) throw new Error(`create ${key}: ${res.status} ${JSON.stringify(res.body)}`);
      id[key] = res.body.id;
      users.push(res.body.id);
      c[key] = (await login(email, NEW_PW)).cookie;
    };
    await mk('mgrX', 'qa_manager', { departmentId: D.X });
    await mk('lead', 'team_lead', { teamId: T.X1 });
    await mk('eng', 'qa_engineer', { teamId: T.X1 });
    await mk('eng2', 'qa_engineer', { teamId: T.X1 });
    await mk('viewer', 'viewer', { teamId: T.X1 });
    await mk('engY', 'qa_engineer', { teamId: T.Y1 });
    const reg = await post('/api/auth/register', '', {
      email: `audit-foreign-${stamp}@other${stamp}.test`, password: NEW_PW, firstName: 'Other', lastName: 'Company',
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

  const skip = () => !up || !T.X1;

  /** The newest entry of this action for this entity (as the admin sees it). */
  async function entry(action: string, entityId?: string): Promise<any> {
    const res = await get(`/api/admin/audit?action=${encodeURIComponent(action)}&limit=200`, c.admin);
    expect(res.status).toBe(200);
    return (res.body.entries as any[]).find((e) => !entityId || e.entity_id === entityId);
  }
  const undo = (who: string, entryId: string) => post(`/api/admin/audit/${entryId}/undo`, c[who]);
  const userRow = async (key: string) => ((await get('/api/admin/users', c.admin)).body as any[]).find((u) => u.id === id[key]);
  const grantsOf = async (key: string) => ((await userRow(key)).assignments as any[]).map((a) => `${a.role}:${a.scope_id}`).sort();
  const expectOk = (res: Response, label: string) => { if (res.status >= 300) throw new Error(`${label}: ${res.status} ${JSON.stringify(res.body)}`); };

  it('AUDIT-001: every audited action is recorded, with the departments it concerns and no secrets', async () => {
    if (skip()) return;
    // Performed here (the fixture already recorded department.create, team.create, user.create).
    expectOk(await put(`/api/admin/users/${id.eng}`, c.admin, { firstName: 'Audited' }), 'user.update');
    expectOk(await post(`/api/admin/users/${id.eng}/assignments`, c.admin, { role: 'viewer', scopeId: T.X2 }), 'grant');
    const a = ((await userRow('eng')).assignments as any[]).find((x) => x.scope_id === T.X2);
    expectOk(await del(`/api/admin/users/${id.eng}/assignments/${a.id}`, c.admin), 'revoke');
    expectOk(await post(`/api/admin/users/${id.viewer}/toggle-status`, c.admin), 'deactivate');
    expectOk(await post(`/api/admin/users/${id.viewer}/toggle-status`, c.admin), 'activate');
    expectOk(await post(`/api/admin/users/${id.eng}/reset-password`, c.admin, { newPassword: NEW_PW }), 'password');
    // A password reset ends the person's sessions (server/lib/sessions.ts): they sign in again.
    c.eng = (await login(`audit-eng-${stamp}@irongate.test`, NEW_PW)).cookie;
    expectOk(await patch(`/api/admin/users/${id.eng}/developer-insights-toggle`, c.admin, { enabled: true }), 'insights');
    expectOk(await put(`/api/admin/teams/${T.X2}`, c.admin, { name: `Audit X2 ${stamp}`, description: 'changed' }), 'team.update');
    expectOk(await post(`/api/admin/teams/${T.X2}/toggle-status`, c.admin), 'team.deactivate');
    expectOk(await post(`/api/admin/teams/${T.X2}/toggle-status`, c.admin), 'team.activate');
    expectOk(await put(`/api/admin/departments/${D.Y}`, c.admin, { name: `Audit Y ${stamp} renamed`, description: null }), 'department.rename');
    expectOk(await post('/api/admin/configs', c.admin, { departmentId: D.X, configs: { sla_response_time_ms: '777', smtp_password: 'not-logged-123' } }), 'config.update');
    // Metric interval: changed and put back as it was (company-wide setting).
    const before = ((await get('/api/settings/metric-intervals', c.admin)).body.intervals as any[]).find((i) => i.metric_key === 'test_coverage');
    expectOk(await put('/api/settings/metric-intervals/test_coverage', c.admin, { interval_value: 2, interval_unit: 'days' }), 'config.metric_interval');
    if (before?.is_default) expectOk(await del('/api/settings/metric-intervals/test_coverage', c.admin), 'reset interval');
    else if (before) expectOk(await put('/api/settings/metric-intervals/test_coverage', c.admin, { interval_value: before.interval_value, interval_unit: before.interval_unit, custom_label: before.custom_label }), 'restore interval');
    const key = await post('/api/admin/api-keys', c.admin, { name: `Audit key ${stamp}` });
    expectOk(key, 'api_key.create');
    expectOk(await post(`/api/admin/api-keys/${key.body.key.id}/revoke`, c.admin), 'api_key.revoke');
    const tmp = (await post('/api/admin/departments', c.admin, { name: `Audit tmp ${stamp}` })).body.id;
    expectOk(await del(`/api/admin/departments/${tmp}`, c.admin), 'department.deactivate');

    const expected: Array<[string, string | undefined]> = [
      ['department.create', D.X], ['team.create', T.X1], ['user.create', id.eng], ['user.update', id.eng],
      ['assignment.grant', id.eng], ['assignment.revoke', id.eng], ['user.deactivate', id.viewer], ['user.activate', id.viewer],
      ['user.password_reset', id.eng], ['user.developer_insights', id.eng], ['team.update', T.X2], ['team.deactivate', T.X2],
      ['team.activate', T.X2], ['department.rename', D.Y], ['config.update', D.X], ['config.metric_interval', 'test_coverage'],
      ['api_key.create', key.body.key.id], ['api_key.revoke', key.body.key.id], ['department.deactivate', tmp],
    ];
    const missing: string[] = [];
    for (const [action, entity] of expected) if (!(await entry(action, entity))) missing.push(`${action} ${entity}`);
    expect(missing).toEqual([]);

    const grant = await entry('assignment.grant', id.eng);
    expect(grant.department_ids).toEqual(expect.arrayContaining([D.X]));
    expect(grant.actor_id).toBeTruthy();
    expect(grant.before.users[id.eng].grants.some((g: any) => g.scopeId === T.X2)).toBe(false);
    expect(grant.after.users[id.eng].grants.some((g: any) => g.scopeId === T.X2 && g.role === 'viewer')).toBe(true);
    // No secrets: password resets carry no value; secret config values are masked.
    const pwd = await entry('user.password_reset', id.eng);
    expect(JSON.stringify(pwd)).not.toContain(NEW_PW);
    const cfg = await entry('config.update', D.X);
    expect(JSON.stringify(cfg)).not.toContain('not-logged-123');
    expect(cfg.after.sla_response_time_ms).toBe('777');
  });

  it('AUDIT-002: each reversible action can be undone', async () => {
    if (skip()) return;
    // assignment.grant
    expectOk(await post(`/api/admin/users/${id.eng2}/assignments`, c.admin, { role: 'viewer', scopeId: T.X2 }), 'grant');
    expectOk(await undo('admin', (await entry('assignment.grant', id.eng2)).id), 'undo grant');
    expect(await grantsOf('eng2')).toEqual([`qa_engineer:${T.X1}`]);
    expect((await get(`/api/analytics/flaky-tests?teamId=${T.X2}`, c.eng2)).status).toBe(403);

    // assignment.revoke
    const a = ((await userRow('eng2')).assignments as any[])[0];
    expectOk(await del(`/api/admin/users/${id.eng2}/assignments/${a.id}`, c.admin), 'revoke');
    expect((await get(`/api/analytics/flaky-tests?teamId=${T.X1}`, c.eng2)).status).toBe(403);
    expectOk(await undo('admin', (await entry('assignment.revoke', id.eng2)).id), 'undo revoke');
    expect(await grantsOf('eng2')).toEqual([`qa_engineer:${T.X1}`]);
    expect((await get(`/api/analytics/flaky-tests?teamId=${T.X1}`, c.eng2)).status).toBe(200);

    // user.update (role change through the edit form)
    expectOk(await put(`/api/admin/users/${id.eng2}`, c.admin, { role: 'viewer', departmentId: D.X, primaryTeamId: T.X1 }), 'update');
    expect((await userRow('eng2')).role).toBe('viewer');
    expectOk(await undo('admin', (await entry('user.update', id.eng2)).id), 'undo update');
    expect((await userRow('eng2')).role).toBe('qa_engineer');
    expect(await grantsOf('eng2')).toEqual([`qa_engineer:${T.X1}`]);

    // user.deactivate
    expectOk(await del(`/api/admin/users/${id.eng2}`, c.admin), 'deactivate');
    expect((await get('/api/analytics/scope', c.eng2)).status).toBe(401);
    expectOk(await undo('admin', (await entry('user.deactivate', id.eng2)).id), 'undo deactivate');
    expect((await get('/api/analytics/scope', c.eng2)).status).toBe(200);

    // department.manager_assign
    expectOk(await post(`/api/admin/departments/${D.X}/managers`, c.admin, { userId: id.engY }), 'assign manager');
    expect((await userRow('engY')).role).toBe('qa_manager');
    expectOk(await undo('admin', (await entry('department.manager_assign', id.engY)).id), 'undo assign manager');
    expect(await userRow('engY')).toMatchObject({ role: 'qa_engineer', department_id: D.Y, primary_team_id: T.Y1 });
    expect(await grantsOf('engY')).toEqual([`qa_engineer:${T.Y1}`]);

    // department.manager_remove
    expectOk(await post(`/api/admin/departments/${D.X}/managers/${id.mgrX}/remove`, c.admin, { teamId: T.X1 }), 'remove manager');
    expect((await get(`/api/analytics/flaky-tests?teamId=${T.X2}`, c.mgrX)).status).toBe(403);
    expectOk(await undo('admin', (await entry('department.manager_remove', id.mgrX)).id), 'undo remove manager');
    expect((await userRow('mgrX')).role).toBe('qa_manager');
    expect((await get(`/api/analytics/flaky-tests?teamId=${T.X2}`, c.mgrX)).status).toBe(200);

    // team.lead_change (eng2 replaces lead)
    expectOk(await put(`/api/admin/teams/${T.X1}/lead`, c.admin, { userId: id.eng2 }), 'lead change');
    expect((await patch(`/api/teams/${T.X1}/ai-toggle`, c.eng2, { enabled: false })).status).toBe(200);
    expectOk(await undo('admin', (await entry('team.lead_change', T.X1)).id), 'undo lead change');
    expect((await patch(`/api/teams/${T.X1}/ai-toggle`, c.eng2, { enabled: false })).status).toBe(403);
    expect((await patch(`/api/teams/${T.X1}/ai-toggle`, c.lead, { enabled: false })).status).toBe(200);
    expect(await grantsOf('lead')).toEqual([`team_lead:${T.X1}`]);
    const detail = (await get(`/api/admin/departments/${D.X}/teams`, c.admin)).body.teams as any[];
    expect(detail.find((t) => t.id === T.X1).team_lead_id).toBe(id.lead);

    // team.move (X2 to Y): the manager of X loses it; undo restores
    expectOk(await put(`/api/admin/teams/${T.X2}/department`, c.admin, { departmentId: D.Y }), 'move');
    expect((await get(`/api/analytics/flaky-tests?teamId=${T.X2}`, c.mgrX)).status).toBe(403);
    expectOk(await undo('admin', (await entry('team.move', T.X2)).id), 'undo move');
    expect((await get(`/api/analytics/flaky-tests?teamId=${T.X2}`, c.mgrX)).status).toBe(200);
    const xTeams = ((await get(`/api/admin/departments/${D.X}/teams`, c.admin)).body.teams as any[]).map((t) => t.id);
    expect(xTeams).toContain(T.X2);

    // department.rename
    expectOk(await put(`/api/admin/departments/${D.X}`, c.admin, { name: `Audit X ${stamp} new`, description: 'd' }), 'rename');
    expectOk(await undo('admin', (await entry('department.rename', D.X)).id), 'undo rename');
    const depts = (await get('/api/admin/departments/all', c.admin)).body as any[];
    expect(depts.find((d) => d.id === D.X)).toMatchObject({ name: `Audit X ${stamp}`, description: null });

    // The undo itself is recorded, and the original shows as undone.
    const undone = (await get('/api/admin/audit?action=undo&limit=20', c.admin)).body.entries as any[];
    expect(undone.some((e) => e.entity_id === D.X)).toBe(true);
    expect((await entry('department.rename', D.X)).undone_at).toBeTruthy();
  });

  it('AUDIT-003: a newer change on the same people blocks the undo of an older one, with an explanation', async () => {
    if (skip()) return;
    expectOk(await post(`/api/admin/users/${id.eng2}/assignments`, c.admin, { role: 'viewer', scopeId: T.X2 }), 'older');
    const older = await entry('assignment.grant', id.eng2);
    expectOk(await post(`/api/admin/users/${id.eng2}/assignments`, c.admin, { role: 'qa_engineer', scopeId: T.Y1 }), 'newer');
    const newer = (await get('/api/admin/audit?action=assignment.grant&limit=5', c.admin)).body.entries[0];
    expect(newer.id).not.toBe(older.id);

    const blocked = await undo('admin', older.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/newer change/i);
    expect(blocked.body.error).toContain(newer.summary);
    expect(blocked.body.blockingId).toBe(newer.id);
    expect(await grantsOf('eng2')).toEqual([`qa_engineer:${T.X1}`, `qa_engineer:${T.Y1}`, `viewer:${T.X2}`].sort());

    expectOk(await undo('admin', newer.id), 'undo newer');
    expectOk(await undo('admin', older.id), 'undo older after the newer one');
    expect(await grantsOf('eng2')).toEqual([`qa_engineer:${T.X1}`]);
  });

  it('AUDIT-004: a state changed outside the history is detected and nothing is undone', async () => {
    if (skip()) return;
    expectOk(await put(`/api/admin/departments/${D.Y}`, c.admin, { name: `Audit Y ${stamp} drift`, description: null }), 'rename');
    const e = await entry('department.rename', D.Y);
    const db = await localDb();
    try {
      await db.query('UPDATE departments SET name = $1 WHERE id = $2', [`Audit Y ${stamp} edited in SQL`, D.Y]);
    } finally {
      await db.end();
    }
    const res = await undo('admin', e.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no longer matches/i);
    const depts = (await get('/api/admin/departments/all', c.admin)).body as any[];
    expect(depts.find((d) => d.id === D.Y).name).toBe(`Audit Y ${stamp} edited in SQL`);
    expect((await entry('department.rename', D.Y)).undone_at).toBeNull();
  });

  it('AUDIT-005: double undo, non-reversible and unknown entries are refused', async () => {
    if (skip()) return;
    const renamed = (await get(`/api/admin/audit?action=undo&limit=50`, c.admin)).body.entries.find((e: any) => e.entity_id === D.X);
    const original = await entry('department.rename', D.X);
    expect((await undo('admin', original.id)).status).toBe(409); // already undone
    expect((await undo('admin', renamed.id)).status).toBe(403); // an undo entry is not reversible
    expect((await undo('admin', (await entry('user.password_reset', id.eng)).id)).status).toBe(403);
    expect((await undo('admin', 'no-such-entry')).status).toBe(404);
  });

  it('AUDIT-006: who may read and undo the history', async () => {
    if (skip()) return;
    for (const who of ['lead', 'eng', 'viewer']) {
      expect({ who, status: (await get('/api/admin/audit', c[who])).status }).toEqual({ who, status: 403 });
      expect({ who, status: (await get('/api/admin/audit/facets', c[who])).status }).toEqual({ who, status: 403 });
    }
    expect((await get('/api/admin/audit')).status).toBe(401);

    // The QA manager of X sees X's entries only (never Y-only ones).
    const mine = (await get('/api/admin/audit?limit=200', c.mgrX)).body.entries as any[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((e) => e.department_ids.includes(D.X))).toBe(true);
    expect(mine.some((e) => e.entity_id === T.Y1)).toBe(false);
    const facets = (await get('/api/admin/audit/facets', c.mgrX)).body;
    expect(facets.departments.map((d: any) => d.id)).toEqual([D.X]);

    // ... and may undo an assignment change in X, but not a team move or a change to themselves.
    expectOk(await post(`/api/admin/users/${id.eng2}/assignments`, c.mgrX, { role: 'viewer', scopeId: T.X2 }), 'manager grant');
    const g = await entry('assignment.grant', id.eng2);
    expect(g.actor_id).toBe(id.mgrX);
    expectOk(await undo('mgrX', g.id), 'manager undo');
    expect(await grantsOf('eng2')).toEqual([`qa_engineer:${T.X1}`]);
    expectOk(await put(`/api/admin/teams/${T.X2}/department`, c.admin, { departmentId: D.Y }), 'move');
    const move = await entry('team.move', T.X2);
    expect((await undo('mgrX', move.id)).status).toBe(403);
    expectOk(await undo('admin', move.id), 'admin undo move');
    const selfEntry = (await get(`/api/admin/audit?action=department.manager_remove&limit=50`, c.admin)).body.entries.find((e: any) => e.entity_id === id.mgrX);
    expect((await undo('mgrX', selfEntry.id)).status).toBe(409); // already undone in AUDIT-002 ...
    expectOk(await post(`/api/admin/departments/${D.X}/managers/${id.mgrX}/remove`, c.admin, { teamId: T.X1 }), 'remove again');
    expectOk(await post(`/api/admin/departments/${D.X}/managers`, c.admin, { userId: id.mgrX }), 'assign again');
    const own = await entry('department.manager_assign', id.mgrX);
    expect((await undo('mgrX', own.id)).status).toBe(403); // ... and a change to their own access is never theirs to undo
    const list = (await get('/api/admin/audit?limit=200', c.mgrX)).body.entries as any[];
    expect(list.find((e) => e.id === own.id)?.canUndo).toBe(false);

    // Another company never sees or undoes these entries.
    const foreign = (await get('/api/admin/audit?limit=200', c.foreign)).body.entries as any[];
    expect(foreign.some((e) => e.id === own.id)).toBe(false);
    expect((await undo('foreign', own.id)).status).toBe(404);
  });
});
