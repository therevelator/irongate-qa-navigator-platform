import request from 'supertest';
import { API_URL, backendUp, cookieFrom, del, get, localDb, login, NEW_PW, post, put } from './helpers/http';
import { csvCell, parseCsv, toCsv } from '../../src/lib/csv';

/**
 * Phase 3B: team comparison (GET /api/compare/teams[.csv]), saved views (/api/saved-views),
 * CSV export (src/lib/csv.ts) and the onboarding checklist (/api/onboarding).
 *
 * Scope of a comparison = the shared analytics rule (canCompareTeams → canViewTeamAnalytics):
 * super_admin any team of the company, qa_manager the teams of their departments,
 * team_lead / qa_engineer / viewer their own teams. Out of scope, unknown and foreign: one 403.
 *
 * Runs against a live backend at API_URL; skips cleanly when none is running.
 */

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

describe('CSV util (src/lib/csv.ts)', () => {
  it('quotes commas, quotes and line breaks; doubles quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(Number.NaN)).toBe('');
  });

  it('neutralises formula injection in text cells (= + - @ TAB CR)', () => {
    for (const evil of ['=HYPERLINK("http://x","y")', '+1+2', '-2+3', '@SUM(A1)', '\t=1', '\r=1', '=cmd|\' /C calc\'!A0']) {
      const cell = parseCsv(toCsv([{ header: 'v', value: (r: string) => r }], [evil]))[1][0];
      expect(cell.startsWith("'")).toBe(true);
      expect(cell.slice(1)).toBe(evil);
    }
  });

  it('keeps plain numbers (also signed, with % or a unit) unchanged', () => {
    for (const ok of ['-3.5%', '-12', '+0.8', '-0.02 h', '-5e3']) expect(csvCell(ok)).toBe(ok);
    expect(csvCell(-4)).toBe('-4');
  });

  it('adds a "(raw)" column next to each column that has a raw value and round-trips', () => {
    const csv = toCsv(
      [{ header: 'Team', value: (r: any) => r.n }, { header: 'Coverage', value: (r: any) => `${r.c.toFixed(1)}%`, raw: (r: any) => r.c }],
      [{ n: 'Alpha, "A"', c: 82.4312 }],
    );
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(parseCsv(csv)).toEqual([['Team', 'Coverage', 'Coverage (raw)'], ['Alpha, "A"', '82.4%', '82.4312']]);
  });
});

describe('Compare, saved views, onboarding API', () => {
  let up = true;
  const c: Record<string, string> = {};
  const u: Record<string, any> = {};
  let adminTeams: Array<{ id: string; name: string; department_id: string | null }> = [];
  let foreignTeamId = '';
  const createdViews: Array<{ id: string; who: string }> = [];

  beforeAll(async () => {
    up = await backendUp();
    if (!up) { console.warn('Backend not running at', API_URL, '- 3B tests skipped'); return; }
    for (const [k, email] of Object.entries({
      admin: 'admin@irongate.com', manager: 'manager@irongate.com', lead: 'lead@irongate.com',
      engineer: 'engineer@irongate.com', viewer: 'viewer@irongate.com', foreign: 'alex.morgan@northwind.example',
    })) {
      const r = await login(email);
      c[k] = r.cookie;
      u[k] = r.user;
    }
    adminTeams = (await get('/api/analytics/scope', c.admin)).body.teams || [];
    foreignTeamId = (await get('/api/analytics/scope', c.foreign)).body.teams?.[0]?.id || '';
  });

  afterAll(async () => {
    if (!up) return;
    for (const v of createdViews) await del(`/api/saved-views/${v.id}`, c[v.who]);
  });

  const scopeOf = async (k: string) => ((await get('/api/analytics/scope', c[k])).body.teams || []) as Array<{ id: string }>;
  const outsideOf = async (k: string) => {
    const mine = await scopeOf(k);
    return adminTeams.find((t) => !mine.some((m) => m.id === t.id))?.id;
  };
  const compare = (ids: string[], who: string, csv = false) => get(`/api/compare/teams${csv ? '.csv' : ''}?ids=${ids.map(encodeURIComponent).join(',')}`, c[who]);

  /* ---------------------------------------------------------------- compare */

  it('CMP-001: requires a session', async () => {
    if (!up) return;
    const res = await request(API_URL).get(`/api/compare/teams?ids=${adminTeams[0].id},${adminTeams[1].id}`);
    expect(res.status).toBe(401);
  });

  it('CMP-002: 2 to 4 distinct teams, days 7–90', async () => {
    if (!up) return;
    expect((await compare([adminTeams[0].id], 'admin')).status).toBe(400);
    expect((await compare([adminTeams[0].id, adminTeams[0].id], 'admin')).status).toBe(400);
    expect((await compare(adminTeams.slice(0, 5).map((t) => t.id), 'admin')).status).toBe(400);
    expect((await get(`/api/compare/teams?ids=${adminTeams[0].id},${adminTeams[1].id}&days=3`, c.admin)).status).toBe(400);
  });

  it('CMP-003: super_admin compares any teams of the company; team aggregates only', async () => {
    if (!up) return;
    const ids = adminTeams.slice(0, 3).map((t) => t.id);
    const res = await compare(ids, 'admin');
    expect(res.status).toBe(200);
    expect(res.body.teams.map((t: any) => t.id)).toEqual(ids);
    expect(res.body.metrics[0]).toMatchObject({ key: 'qa_score' });
    for (const t of res.body.teams) {
      expect(Object.keys(t.cells).sort()).toEqual(res.body.metrics.map((m: any) => m.key).sort());
      expect(t.members).toBeUndefined();
      if (t.cells.qa_score.value !== null) expect(t.qaScoreConfidence).toEqual(expect.objectContaining({ inputsUsed: expect.any(Number), inputsTotal: 4 }));
    }
    // Each value is judged with a target; stale values are not judged.
    const cov = res.body.teams[0].cells.test_coverage;
    if (cov.value !== null) {
      expect(cov.target).toEqual(expect.objectContaining({ good: expect.any(Number), lowerIsBetter: false }));
      expect(cov.status === null).toBe(cov.stale);
    }
    expect(res.body.differences.qa_score).toEqual(expect.objectContaining({ best: expect.any(Array), differs: expect.any(Boolean) }));
    expect(JSON.stringify(res.body)).not.toMatch(EMAIL_RE);
  });

  it.each(['lead', 'engineer', 'viewer'])('CMP-004: %s may compare only teams of their own scope', async (k) => {
    if (!up) return;
    const mine = await scopeOf(k);
    const outside = await outsideOf(k);
    if (mine.length >= 2) expect((await compare([mine[0].id, mine[1].id], k)).status).toBe(200);
    const res = await compare([mine[0].id, outside!], k);
    expect(res.status).toBe(403);
    expect(res.body.teams).toBeUndefined();
    expect((await compare([mine[0].id, outside!], k, true)).status).toBe(403);
  });

  it('CMP-005: qa_manager compares teams of their department, not others', async () => {
    if (!up) return;
    const mine = await scopeOf('manager');
    if (mine.length >= 2) expect((await compare([mine[0].id, mine[1].id], 'manager')).status).toBe(200);
    const outside = await outsideOf('manager');
    if (outside) expect((await compare([mine[0].id, outside], 'manager')).status).toBe(403);
  });

  it('CMP-006: another company\'s team and an unknown id get the same 403', async () => {
    if (!up) return;
    const a = await compare([adminTeams[0].id, foreignTeamId], 'admin');
    const b = await compare([adminTeams[0].id, 'no-such-team'], 'admin');
    expect(a.status).toBe(403);
    expect(b.status).toBe(403);
    expect(a.body).toEqual(b.body);
  });

  it('CMP-007: CSV has one row per team and metric with the values as shown and the raw numbers', async () => {
    if (!up) return;
    const ids = adminTeams.slice(0, 2).map((t) => t.id);
    const [json, csv] = await Promise.all([compare(ids, 'admin'), compare(ids, 'admin', true)]);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/attachment; filename="irongate-team-comparison-\d{4}-\d{2}-\d{2}\.csv"/);
    const rows = parseCsv(csv.text);
    const [header, ...body] = rows;
    expect(header.slice(0, 6)).toEqual(['Team', 'Department', 'Group', 'Metric', 'Value', 'Value (raw)']);
    expect(body.length).toBe(json.body.metrics.length * ids.length);
    const col = (h: string) => header.indexOf(h);
    for (const t of json.body.teams) {
      for (const m of json.body.metrics) {
        const row = body.find((r) => r[col('Team')] === t.name && r[col('Metric')] === m.label)!;
        const cell = t.cells[m.key];
        expect(row[col('Value')]).toBe(cell.display);
        expect(row[col('Value (raw)')]).toBe(cell.value === null ? '' : String(cell.value));
      }
    }
    // Team aggregates only: no e-mail addresses, no member names.
    expect(csv.text).not.toMatch(EMAIL_RE);
  });

  it('CMP-008: a team name that looks like a formula is exported as text', async () => {
    if (!up) return;
    const db = await localDb();
    const team = adminTeams[0];
    try {
      await db.query('UPDATE teams SET name = $1 WHERE id = $2', ['=HYPERLINK("http://evil.test","x")', team.id]);
      const res = await compare([team.id, adminTeams[1].id], 'admin', true);
      expect(res.status).toBe(200);
      const rows = parseCsv(res.text);
      const names = rows.slice(1).map((r) => r[0]);
      expect(names).toContain(`'=HYPERLINK("http://evil.test","x")`);
      expect(names.some((n) => n.startsWith('='))).toBe(false);
    } finally {
      await db.query('UPDATE teams SET name = $1 WHERE id = $2', [team.name, team.id]);
      await db.end();
    }
  });

  /* ------------------------------------------------------------ saved views */

  const create = async (who: string, body: object) => {
    const res = await post('/api/saved-views', c[who], body);
    if (res.status === 201) createdViews.push({ id: res.body.view.id, who });
    return res;
  };
  const stamp = Date.now().toString(36);

  it('SV-001: requires a session; kind is required', async () => {
    if (!up) return;
    expect((await request(API_URL).get('/api/saved-views?kind=dashboard')).status).toBe(401);
    expect((await get('/api/saved-views', c.admin)).status).toBe(400);
  });

  it('SV-002: create, list, update and delete your own view', async () => {
    if (!up) return;
    const res = await create('engineer', { kind: 'dashboard', name: `Mine ${stamp}`, state: { filter: 'attention', sort: { key: 'coverage', dir: 'asc' }, columns: 2 } });
    expect(res.status).toBe(201);
    expect(res.body.view).toMatchObject({ name: `Mine ${stamp}`, kind: 'dashboard', shared: false, isOwner: true, canEdit: true, canShare: false });
    const id = res.body.view.id;
    const list = (await get('/api/saved-views?kind=dashboard', c.engineer)).body.views;
    expect(list.some((v: any) => v.id === id)).toBe(true);
    const upd = await put(`/api/saved-views/${id}`, c.engineer, { name: `Renamed ${stamp}`, state: { filter: 'high', view: 'list' } });
    expect(upd.status).toBe(200);
    expect(upd.body.view).toMatchObject({ name: `Renamed ${stamp}`, state: { filter: 'high', view: 'list' } });
    expect((await del(`/api/saved-views/${id}`, c.engineer)).status).toBe(200);
    expect((await get('/api/saved-views?kind=dashboard', c.engineer)).body.views.some((v: any) => v.id === id)).toBe(false);
  });

  it('SV-003: the state is validated per kind', async () => {
    if (!up) return;
    expect((await create('admin', { kind: 'dashboard', name: `Bad ${stamp}`, state: { filter: 'all', evil: 1 } })).status).toBe(400);
    expect((await create('admin', { kind: 'dashboard', name: `Bad ${stamp}`, state: { columns: 7 } })).status).toBe(400);
    expect((await create('admin', { kind: 'nope', name: `Bad ${stamp}`, state: {} })).status).toBe(400);
    expect((await create('admin', { kind: 'analytics', module: 'flaky-test-intelligence', name: `Bad ${stamp}`, state: {} })).status).toBe(400);
    expect((await create('admin', { kind: 'analytics', module: 'not-a-module', name: `Bad ${stamp}`, state: { teamId: adminTeams[0].id } })).status).toBe(400);
    expect((await create('admin', { kind: 'compare', name: `Bad ${stamp}`, state: { teamIds: [adminTeams[0].id] } })).status).toBe(400);
    expect((await create('admin', { kind: 'dashboard', name: '   ', state: {} })).status).toBe(400);
  });

  it('SV-004: a view may only hold teams of your analytics scope', async () => {
    if (!up) return;
    const mine = await scopeOf('lead');
    const outside = await outsideOf('lead');
    expect((await create('lead', { kind: 'compare', name: `Out ${stamp}`, state: { teamIds: [mine[0].id, outside] } })).status).toBe(403);
    expect((await create('lead', { kind: 'analytics', module: 'technical-debt', name: `Out ${stamp}`, state: { teamId: outside } })).status).toBe(403);
    expect((await create('admin', { kind: 'compare', name: `Foreign ${stamp}`, state: { teamIds: [adminTeams[0].id, foreignTeamId] } })).status).toBe(403);
    const ok = await create('lead', { kind: 'analytics', module: 'technical-debt', name: `In ${stamp}`, state: { teamId: mine[0].id } });
    expect(ok.status).toBe(201);
  });

  it('SV-005: names are unique per owner and kind', async () => {
    if (!up) return;
    expect((await create('manager', { kind: 'dashboard', name: `Dup ${stamp}`, state: {} })).status).toBe(201);
    expect((await create('manager', { kind: 'dashboard', name: `dup ${stamp}`, state: {} })).status).toBe(409);
  });

  it('SV-006: private views are invisible to others; only a super_admin shares; shared views are read-only for others', async () => {
    if (!up) return;
    const priv = await create('manager', { kind: 'dashboard', name: `Private ${stamp}`, state: { filter: 'all' } });
    const pid = priv.body.view.id;
    expect((await get('/api/saved-views?kind=dashboard', c.viewer)).body.views.some((v: any) => v.id === pid)).toBe(false);
    expect((await put(`/api/saved-views/${pid}`, c.viewer, { name: 'x' })).status).toBe(404);
    expect((await del(`/api/saved-views/${pid}`, c.viewer)).status).toBe(404);
    // A QA manager cannot share, not even their own view.
    expect((await post(`/api/saved-views/${pid}/share`, c.manager, { shared: true })).status).toBe(403);
    // super_admin cannot share someone else's private view (it is not even visible to them).
    expect((await post(`/api/saved-views/${pid}/share`, c.admin, { shared: true })).status).toBe(404);

    const mine = await create('admin', { kind: 'compare', name: `Shared ${stamp}`, state: { teamIds: [adminTeams[0].id, adminTeams[1].id], days: 30 } });
    const sid = mine.body.view.id;
    expect(mine.body.view.canShare).toBe(true);
    const share = await post(`/api/saved-views/${sid}/share`, c.admin, { shared: true });
    expect(share.status).toBe(200);
    expect(share.body.view).toMatchObject({ shared: true, canUnshare: true });

    const seen = (await get('/api/saved-views?kind=compare', c.viewer)).body.views.find((v: any) => v.id === sid);
    expect(seen).toMatchObject({ shared: true, isOwner: false, canEdit: false, canDelete: false, canShare: false, canUnshare: false });
    expect(seen.owner.name).toEqual(expect.any(String));
    expect((await put(`/api/saved-views/${sid}`, c.viewer, { name: 'Hijack' })).status).toBe(403);
    expect((await del(`/api/saved-views/${sid}`, c.viewer)).status).toBe(403);
    expect((await post(`/api/saved-views/${sid}/share`, c.manager, { shared: false })).status).toBe(403);

    // Recorded in the change history.
    const audit = (await get('/api/admin/audit?entityType=saved_view', c.admin)).body;
    const entries = audit.entries ?? audit;
    expect(JSON.stringify(entries)).toContain(sid);

    // Another company never sees it.
    expect((await get('/api/saved-views?kind=compare', c.foreign)).body.views.some((v: any) => v.id === sid)).toBe(false);
    expect((await put(`/api/saved-views/${sid}`, c.foreign, { name: 'x' })).status).toBe(404);

    expect((await post(`/api/saved-views/${sid}/share`, c.admin, { shared: false })).status).toBe(200);
    expect((await get('/api/saved-views?kind=compare', c.viewer)).body.views.some((v: any) => v.id === sid)).toBe(false);
  });

  it('SV-007: a shared view of an administrator offers no unshare or delete to a QA manager', async () => {
    if (!up) return;
    // The demo seed shares "Needs attention" per company; its owner is the first super_admin.
    const shared = (await get('/api/saved-views?kind=dashboard', c.manager)).body.views.find((v: any) => v.shared && !v.isOwner);
    if (!shared) return;
    expect(shared.canUnshare).toBe(false);
    expect(shared.canDelete).toBe(false);
  });

  /* ------------------------------------------------------------- onboarding */

  it('ONB-001: company administrators only', async () => {
    if (!up) return;
    expect((await request(API_URL).get('/api/onboarding')).status).toBe(401);
    for (const k of ['manager', 'lead', 'engineer', 'viewer']) {
      expect((await get('/api/onboarding', c[k])).status).toBe(403);
      expect((await post('/api/onboarding/dismiss', c[k])).status).toBe(403);
    }
    const res = await get('/api/onboarding', c.admin);
    expect(res.status).toBe(200);
    expect(res.body.steps.map((s: any) => s.key)).toEqual(['departments', 'teams', 'people', 'targets', 'collection', 'data']);
    expect(res.body.completed).toBe(res.body.steps.filter((s: any) => s.done).length);
  });

  it('ONB-002: a new organisation: progress follows the real state; dismiss and restore', async () => {
    if (!up) return;
    const s = `${Date.now()}`;
    const reg = await post('/api/auth/register', '', {
      email: `onb-${s}@onb${s}.test`, password: NEW_PW, firstName: 'New', lastName: 'Org',
      companyName: `Onboarding Org ${s}`, departmentName: 'Engineering', teamName: 'First Team',
    });
    expect(reg.status).toBeLessThan(300);
    const cookie = cookieFrom(reg);
    const me = (await get('/api/auth/me', cookie)).body.user ?? (await get('/api/auth/me', cookie)).body;
    const companyId = me.companyId ?? me.company_id;
    const teamId = (await get('/api/analytics/scope', cookie)).body.teams[0].id;
    const steps = async () => Object.fromEntries(((await get('/api/onboarding', cookie)).body.steps as any[]).map((x) => [x.key, x.done]));
    try {
      let st = (await get('/api/onboarding', cookie)).body;
      expect(st).toMatchObject({ completed: 2, total: 6, show: true, dismissed: false });
      expect(await steps()).toEqual({ departments: true, teams: true, people: false, targets: false, collection: false, data: false });

      // Saving the company-wide targets unchanged ("Save for all departments") confirms them.
      const confirm = await put('/api/targets', cookie, { scopeType: 'company', scopeId: companyId, targets: {}, applyToAll: true });
      expect(confirm.status).toBe(200);
      expect(confirm.body).toMatchObject({ changed: [], replaced: 0 });
      expect((await steps()).targets).toBe(true);
      expect((await put('/api/targets', cookie, { scopeType: 'company', scopeId: companyId, targets: { test_coverage: { good: 82, warning: 72 } } })).status).toBe(200);

      expect((await post('/api/metrics/manual', cookie, { teamId, test_coverage: 71.5 })).status).toBeLessThan(300);
      expect((await steps()).data).toBe(true);

      expect((await post('/api/admin/invitations', cookie, { email: `onb-invitee-${s}@onb${s}.test`, role: 'qa_engineer', scopeId: teamId })).status).toBe(201);
      st = (await get('/api/onboarding', cookie)).body;
      expect(st).toMatchObject({ completed: 5, complete: true, show: false });
      expect(st.completedAt).toBeTruthy();

      // Completed once = never shown again, even when a step reads as open later.
      const inv = (await get('/api/admin/invitations', cookie)).body;
      const invId = (inv.invitations ?? inv)[0]?.id;
      if (invId) expect((await post(`/api/admin/invitations/${invId}/revoke`, cookie)).status).toBeLessThan(300);
      st = (await get('/api/onboarding', cookie)).body;
      expect(st).toMatchObject({ show: false });
      expect(st.completedAt).toBeTruthy();

      const dis = await post('/api/onboarding/dismiss', cookie);
      expect(dis.status).toBe(200);
      expect(dis.body).toMatchObject({ dismissed: true, show: false });
      const res = await post('/api/onboarding/restore', cookie);
      expect(res.body).toMatchObject({ dismissed: false });
      // Each company has its own checklist state.
      expect((await get('/api/onboarding', c.admin)).body.dismissed).toBe(false);
    } finally {
      const db = await localDb();
      try {
        await db.query('DELETE FROM companies WHERE id = $1', [companyId]);
      } catch { /* leave the test organisation if a foreign key keeps it */ } finally {
        await db.end();
      }
    }
  });
});
