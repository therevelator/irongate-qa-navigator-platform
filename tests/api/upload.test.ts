import { gunzipSync } from 'zlib';
import request from 'supertest';
import type { Client } from 'pg';
import { API_URL, backendUp, get, localDb, login, post, put } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';
import { buildZip } from './helpers/zipBuilder';
import { hashPerson } from '../../server/lib/ingest/allowListPolicy';

/**
 * File uploads (POST /api/uploads/preview, /commit, GET /context, GET / PUT /privacy) end to end against a
 * live backend, on the golden fixture company (golden-team-empty and golden-team-partial of department
 * Beta; golden-team-small of department Alpha, led by small-1):
 *
 *   UPL-001  the context: teams in scope, types, limits, the allow-list; roles without the right: 403
 *   UPL-002  preview writes nothing: no issue, incident, raw upload or ingestion log row
 *   UPL-003  upload stores, through the ingestion handlers: issues, sprints, incidents; the ingestion log names
 *            the file (channel "upload", the person); metrics are calculated; a second upload changes nothing
 *   UPL-004  the allow-list: descriptions, comments, notes, e-mail addresses and names never reach the
 *            database (rows and the raw_uploads copy); people only as the salted hash
 *   UPL-005  the API path is minimised too (POST /api/ingest/issues and /incidents with full vendor JSON)
 *   UPL-006  "Store issue and incident titles": super admins only; off clears stored titles and drops new ones
 *   UPL-007  scope: a manager cannot upload to another department's team (preview and upload); map by key
 *            cannot reach it either; a team lead uploads to the team they lead only; an engineer: 403
 *   UPL-008  zip-slip and zip bombs refused; oversize refused (413); not multipart (415); no file (400)
 *   UPL-009  CSV formula text is stored inert (prefixed), never evaluated
 *   UPL-010  a report (JUnit) to a team; the same file again is reported as already uploaded
 */
let up = true;
let db: Client;
let admin = '';
let manager = '';
let lead = '';
let engineer = '';
const EMPTY = 'golden-team-empty';
const PARTIAL = 'golden-team-partial';
const SMALL = 'golden-team-small';

const ago = (days: number, hm = '10:00') => {
  const d = new Date(Date.now() - days * 86_400_000);
  return `${d.toISOString().slice(0, 10)}T${hm}:00.000Z`;
};
/** Jira's CSV date format: 21/Nov/26 3:45 PM. */
const jiraDate = (days: number, h = 10) => {
  const d = new Date(Date.now() - days * 86_400_000);
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${String(d.getUTCDate()).padStart(2, '0')}/${m}/${String(d.getUTCFullYear()).slice(2)} ${h > 12 ? h - 12 : h}:00 ${h >= 12 ? 'PM' : 'AM'}`;
};
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** A Jira "all fields" export: BOM, repeated columns, description and comments with line breaks, people. */
function jiraCsv(prefix: string): string {
  const head = ['Summary', 'Issue key', 'Issue id', 'Issue Type', 'Status', 'Project key', 'Priority', 'Resolution', 'Assignee', 'Reporter', 'Created', 'Updated', 'Resolved', 'Labels', 'Labels', 'Description', 'Environment', 'Sprint', 'Custom field (Story Points)', 'Status Category', 'Status Category Changed', 'Comment', 'Comment'];
  const rows = [
    ['Refund fails', `${prefix}-1`, '1', 'Bug', 'Done', prefix, 'High', 'Fixed', 'dana.wright@corp.example', 'Sam Lee', jiraDate(9), jiraDate(3), jiraDate(4, 15), 'production', 'customer-acme', 'Steps:\nTOP-SECRET-DESCRIPTION', 'Production', 'Sprint 7', '3', 'Done', jiraDate(4, 15), `${jiraDate(4)};dana.wright@corp.example;CONFIDENTIAL-COMMENT`, ''],
    ['Ledger slow', `${prefix}-2`, '2', 'Bug', 'Open', prefix, 'Low', '', '', 'Sam Lee', jiraDate(8), jiraDate(8), '', 'staging', '', 'x', 'Staging', 'Sprint 7', '2', 'To Do', '', '', ''],
    ['=HYPERLINK("http://evil.example","x")', `${prefix}-3`, '3', 'Story', 'Done', prefix, '', 'Done', '', '', jiraDate(10), jiraDate(5), jiraDate(5, 12), '', '', '', '', 'Sprint 7', '5', 'Done', jiraDate(5, 12), '', ''],
  ];
  return '﻿' + [head, ...rows].map((r) => r.map((c) => (/[",\n]/.test(c) ? q(c) : c)).join(',')).join('\r\n') + '\r\n';
}
const sprintsCsv = () => `sprint,startDate,endDate,completedDate\nSprint 7,${ago(12).slice(0, 10)},${ago(2).slice(0, 10)},${ago(2).slice(0, 10)}\n`;
const pdCsv = (id: string) => `id,incident_number,description,status,urgency,priority,service_name,created_on,acknowledged_on,resolved_on,assigned_to,notes\n${id},77,Checkout errors,resolved,high,P1,golden-svc,${ago(6, '09:00')},${ago(6, '09:05')},${ago(6, '10:00')},oncall@corp.example,CONFIDENTIAL-NOTE customer list\n`;

const send = (path: 'preview' | 'commit', cookie: string, files: Array<{ name: string; data: Buffer | string }>, options: object) => {
  let r = request(API_URL).post(`/api/uploads/${path}`).set('Cookie', cookie).field('options', JSON.stringify(options));
  for (const f of files) r = r.attach('files', Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data), f.name);
  return r;
};
const n = async (sql: string, params: any[] = []) => Number((await db.query(sql, params)).rows[0].n);
const counts = async () => ({
  issues: await n(`SELECT COUNT(*)::int AS n FROM issues WHERE company_id = $1`, [GOLDEN_COMPANY]),
  incidents: await n(`SELECT COUNT(*)::int AS n FROM incidents_raw WHERE company_id = $1`, [GOLDEN_COMPANY]),
  sprints: await n(`SELECT COUNT(*)::int AS n FROM issue_sprints WHERE company_id = $1`, [GOLDEN_COMPANY]),
  uploads: await n(`SELECT COUNT(*)::int AS n FROM raw_uploads WHERE company_id = $1`, [GOLDEN_COMPANY]),
  log: await n(`SELECT COUNT(*)::int AS n FROM ingestion_log WHERE company_id = $1`, [GOLDEN_COMPANY]),
  tests: await n(`SELECT COUNT(*)::int AS n FROM test_runs WHERE company_id = $1`, [GOLDEN_COMPANY]),
});
/** Every stored text of the company's issues, incidents and the raw copies (gunzipped). */
async function everythingStored(): Promise<string> {
  const rows = (await db.query(`SELECT row_to_json(i)::text AS t FROM issues i WHERE company_id = $1
                                UNION ALL SELECT row_to_json(x)::text FROM incidents_raw x WHERE company_id = $1
                                UNION ALL SELECT row_to_json(s)::text FROM issue_sprints s WHERE company_id = $1
                                UNION ALL SELECT row_to_json(t)::text FROM issue_transitions t JOIN issues i2 ON i2.id = t.issue_id WHERE i2.company_id = $1
                                UNION ALL SELECT (response - 'upload')::text || items::text FROM ingestion_log WHERE company_id = $1`, [GOLDEN_COMPANY])).rows.map((r: any) => r.t);
  const payloads = (await db.query(`SELECT payload FROM raw_uploads WHERE company_id = $1 AND payload IS NOT NULL AND kind IN ('issues', 'incidents')`, [GOLDEN_COMPANY])).rows.map((r: any) => gunzipSync(r.payload).toString());
  return [...rows, ...payloads].join('\n');
}
const FORBIDDEN = ['TOP-SECRET-DESCRIPTION', 'CONFIDENTIAL-COMMENT', 'CONFIDENTIAL-NOTE', 'corp.example', 'Sam Lee', 'customer-acme', 'Steps:', 'API-DESCRIPTION-SECRET', 'api-comment-secret', 'api.person@corp', 'High'];

beforeAll(async () => {
  up = await backendUp();
  if (!up) { console.warn('Backend not running at', API_URL, '- upload tests skipped'); return; }
  db = await localDb();
  await createGolden(db);
  // A manager of department Beta (Stale, Partial, Empty), as in the ingestion log tests.
  await db.query(`INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, is_active, email_verified)
                  SELECT 'golden-u-mgr', 'mgr@golden.example', password_hash, 'Morgan', 'Manager', 'qa_manager', $1, 'golden-dept-b', TRUE, TRUE FROM users WHERE id = 'golden-u-admin' ON CONFLICT (id) DO NOTHING`, [GOLDEN_COMPANY]);
  await db.query(`INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id) VALUES ('golden-ra-mgr', $1, 'golden-u-mgr', 'qa_manager', 'department', 'golden-dept-b') ON CONFLICT (id) DO NOTHING`, [GOLDEN_COMPANY]);
  await db.query(`INSERT INTO service_teams (company_id, service, team_id) VALUES ($1, 'golden-svc', $2), ($1, 'GSMALL', $3) ON CONFLICT DO NOTHING`, [GOLDEN_COMPANY, EMPTY, SMALL]).catch(() => undefined);
  admin = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  manager = (await login('mgr@golden.example')).cookie;
  lead = (await login('small-1@golden.example')).cookie;
  engineer = (await login('small-2@golden.example')).cookie;
});

afterAll(async () => {
  if (db) { await removeGolden(db); await db.end(); }
});

describe('Upload files', () => {
  it('UPL-001 the context lists the teams in scope, the types, limits and the allow-list; an engineer gets 403', async () => {
    if (!up) return;
    const a = await get('/api/uploads/context', admin);
    expect(a.status).toBe(200);
    expect(a.body.teams.map((t: any) => t.id)).toEqual(expect.arrayContaining([EMPTY, PARTIAL, SMALL]));
    expect(a.body.teams.map((t: any) => t.id)).not.toContain('golden-team-inactive');
    expect(a.body.types.map((t: any) => t.value)).toEqual(expect.arrayContaining(['issues:jira-csv', 'issues:linear-csv', 'incidents:pagerduty-csv', 'incidents:opsgenie-csv', 'deployments:deployments-csv', 'sprints:sprints-csv', 'tests:junit', 'coverage:lcov', 'static-analysis:sarif']));
    expect(a.body.limits.maxBytes).toBe(50 * 1024 * 1024);
    expect(a.body.allowList.issue.map((f: any) => f.field)).toEqual(expect.arrayContaining(['key', 'type', 'transitions', 'storyPoints', 'title', 'assignee']));
    expect(a.body).toMatchObject({ storeTitles: true, canChangePrivacy: true, canViewLog: true });
    const m = await get('/api/uploads/context', manager);
    expect(m.body.teams.map((t: any) => t.id).sort()).toEqual([EMPTY, PARTIAL, 'golden-team-stale']);
    expect(m.body.canChangePrivacy).toBe(false);
    const l = await get('/api/uploads/context', lead);
    expect(l.body.teams.map((t: any) => t.id)).toEqual([SMALL]);
    expect(l.body.canViewLog).toBe(false);
    expect((await get('/api/uploads/context', engineer)).status).toBe(403);
    expect((await get('/api/uploads/context', '')).status).toBe(401);
  });

  it('UPL-002 preview writes nothing at all, and shows the fields, a minimised sample, warnings and the mapping', async () => {
    if (!up) return;
    const before = await counts();
    const r = await send('preview', admin, [{ name: 'jira.csv', data: jiraCsv('GUP') }, { name: 'pd.csv', data: pdCsv('PDGOLD1') }], { mode: 'team', teamId: EMPTY });
    expect(r.status).toBe(200);
    expect(await counts()).toEqual(before);
    const [jira, pd] = r.body.files;
    expect(jira).toMatchObject({ name: 'jira.csv', status: 'ready', records: 3, type: { value: 'issues:jira-csv' }, teams: [{ id: EMPTY, records: 3 }] });
    expect(jira.fields).toEqual(expect.arrayContaining(['key', 'title', 'assigneeHash']));
    expect(jira.dropped).toEqual(expect.arrayContaining(['column “Description”', 'column “Comment”', 'column “Priority”']));
    expect(jira.sample).toHaveLength(3);
    expect(JSON.stringify(jira.sample)).not.toMatch(/TOP-SECRET|CONFIDENTIAL|corp\.example|Sam Lee/);
    expect(jira.limits.join(' ')).toMatch(/no status-change history/);
    expect(jira.csv.mapping).toMatchObject({ key: 'Issue key', storyPoints: 'Custom field (Story Points)' });
    expect(jira).not.toHaveProperty('submissions');
    expect(pd).toMatchObject({ status: 'ready', records: 1, type: { value: 'incidents:pagerduty-csv' } });
    expect(pd.sample[0]).toMatchObject({ id: 'PDGOLD1', severity: 'P1', status: 'resolved', responderHash: hashPerson(GOLDEN_COMPANY, 'oncall@corp.example') });
    expect(JSON.stringify(pd.sample)).not.toMatch(/CONFIDENTIAL|corp\.example/);
  });

  it('UPL-003 upload stores through the ingestion handlers, names the file in the ingestion log and calculates; again: nothing changes', async () => {
    if (!up) return;
    const files = [{ name: 'sprints.csv', data: sprintsCsv() }, { name: 'jira.csv', data: jiraCsv('GUP') }, { name: 'pd.csv', data: pdCsv('PDGOLD1') }];
    const r = await send('commit', admin, files, { mode: 'team', teamId: EMPTY });
    expect(r.status).toBe(200);
    const [sp, jira, pd] = r.body.files;
    expect(sp).toMatchObject({ status: 'stored' });
    expect(jira).toMatchObject({ status: 'stored', stored: 3, unchanged: 0 });
    expect(jira.metrics).toEqual(expect.arrayContaining(['Defect escape rate', 'Sprint velocity']));
    expect(pd).toMatchObject({ status: 'stored', stored: 1 });
    expect((await db.query(`SELECT external_id, found_in, story_points::float8 AS p FROM issues WHERE team_id = $1 ORDER BY 1`, [EMPTY])).rows)
      .toEqual([{ external_id: 'GUP-1', found_in: 'production', p: 3 }, { external_id: 'GUP-2', found_in: 'pre_release', p: 2 }, { external_id: 'GUP-3', found_in: null, p: 5 }]);
    expect((await db.query(`SELECT state FROM issue_sprints WHERE team_id = $1 AND external_id = 'name:Sprint-7'`, [EMPTY])).rows[0].state).toBe('closed');
    const log = (await db.query(`SELECT channel, actor_id, status, response -> 'upload' AS upload FROM ingestion_log WHERE id = $1`, [jira.ingestionIds[0]])).rows[0];
    expect(log).toMatchObject({ channel: 'upload', actor_id: 'golden-u-admin', status: 'accepted', upload: { file: 'jira.csv', type: 'Jira issues (CSV export)', part: 1, parts: 1 } });
    // Velocity of Sprint 7: GUP-1 (3) + GUP-3 (5) completed in the sprint; escape rate: 1 of 2 bugs with an environment.
    const v = (await db.query(`SELECT value::float8 AS v FROM metric_evidence WHERE team_id = $1 AND metric_key = 'velocity' ORDER BY day DESC LIMIT 1`, [EMPTY])).rows[0];
    expect(v?.v).toBe(8);
    const e = (await db.query(`SELECT value::float8 AS v FROM metric_evidence WHERE team_id = $1 AND metric_key = 'escape_rate' ORDER BY day DESC LIMIT 1`, [EMPTY])).rows[0];
    expect(e?.v).toBe(50);
    expect((await db.query(`SELECT COUNT(*)::int AS n FROM metric_evidence WHERE team_id = $1 AND metric_key = 'mttr'`, [EMPTY])).rows[0].n).toBeGreaterThan(0);
    // The log lists the upload with the file (the ingestion log page).
    const list = await get('/api/ingestion-log?channel=upload', admin);
    expect(list.body.entries.find((x: any) => x.id === jira.ingestionIds[0])).toMatchObject({ channel: 'upload', upload: { file: 'jira.csv' } });
    // The same files again: previewed as already stored, uploaded as unchanged.
    const p2 = await send('preview', admin, [{ name: 'jira.csv', data: jiraCsv('GUP') }], { mode: 'team', teamId: EMPTY });
    expect(p2.body.files[0].duplicates).toMatchObject({ count: 3 });
    expect(p2.body.files[0].warnings[0]).toMatch(/3 of these issues are already stored/);
    const again = await send('commit', admin, [{ name: 'jira.csv', data: jiraCsv('GUP') }], { mode: 'team', teamId: EMPTY });
    expect(again.body.files[0]).toMatchObject({ status: 'unchanged', stored: 0, updated: 0, unchanged: 3 });
  });

  it('UPL-004 descriptions, comments, notes, e-mail addresses and names never reach the database; people only as the salted hash', async () => {
    if (!up) return;
    const all = await everythingStored();
    expect(all).toContain('GUP-1');
    for (const s of FORBIDDEN.filter((x) => !x.startsWith('api') && x !== 'High' && !x.startsWith('API'))) expect({ s, found: all.includes(s) }).toEqual({ s, found: false });
    const payload = (await db.query(`SELECT payload FROM raw_uploads WHERE team_id = $1 AND kind = 'issues' AND payload IS NOT NULL ORDER BY received_at DESC LIMIT 1`, [EMPTY])).rows[0];
    const kept = JSON.parse(gunzipSync(payload.payload).toString());
    expect(kept.minimised).toBe(true);
    const gup1 = kept.issues.find((i: any) => i.key === 'GUP-1');
    expect(gup1.assigneeHash).toBe(hashPerson(GOLDEN_COMPANY, 'dana.wright@corp.example'));
    expect(gup1.reporterHash).toBe(hashPerson(GOLDEN_COMPANY, 'Sam Lee'));
    expect(Object.keys(gup1).every((k) => ['key', 'team', 'project', 'type', 'status', 'statusCategory', 'resolution', 'transitions', 'createdAt', 'resolvedAt', 'updatedAt', 'storyPoints', 'sprints', 'environment', 'labels', 'components', 'estimateHours', 'timeLoggedHours', 'url', 'title', 'assigneeHash', 'reporterHash'].includes(k))).toBe(true);
    expect((await db.query(`SELECT priority, labels FROM issues WHERE team_id = $1 AND external_id = 'GUP-1'`, [EMPTY])).rows[0]).toEqual({ priority: null, labels: ['production'] });
  });

  it('UPL-005 the ingestion API path is minimised too: full Jira and PagerDuty JSON leave only allowed fields in the raw copy', async () => {
    if (!up) return;
    const key = (await post('/api/admin/api-keys', admin, { name: 'Upload test key' })).body.plaintextKey;
    const issue = {
      issues: [{
        key: 'GAPI-1', self: 'https://tracker.example.net/rest/api/3/issue/1',
        fields: {
          summary: 'API issue', description: 'API-DESCRIPTION-SECRET', comment: { comments: [{ body: 'api-comment-secret', author: { emailAddress: 'api.person@corp.example' } }] },
          issuetype: { name: 'Bug' }, status: { name: 'Open', statusCategory: { key: 'new' } }, project: { key: 'GAPI' }, priority: { name: 'High' }, labels: ['customer-acme'],
          assignee: { emailAddress: 'api.person@corp.example', displayName: 'Api Person' }, created: ago(3).replace('Z', '+0000'), environment: 'Production',
        },
      }],
    };
    const r = await request(API_URL).post(`/api/ingest/issues?team=${PARTIAL}`).set('Authorization', `Bearer ${key}`).send(issue);
    expect(r.status).toBe(201);
    const inc = { incidents: [{ id: 'PDAPI1', incident_number: 5, title: 'API incident', urgency: 'high', status: 'resolved', created_at: ago(2), resolved_at: ago(2, '11:00'), service: { summary: 'x' }, assignments: [{ assignee: { summary: 'api.person@corp.example' } }], body: { details: 'API-DESCRIPTION-SECRET' } }] };
    const r2 = await request(API_URL).post(`/api/ingest/incidents?team=${PARTIAL}&format=pagerduty`).set('Authorization', `Bearer ${key}`).send(inc);
    expect(r2.status).toBe(201);
    const payloads = (await db.query(`SELECT payload FROM raw_uploads WHERE team_id = $1 AND kind IN ('issues', 'incidents') AND payload IS NOT NULL`, [PARTIAL])).rows.map((x: any) => gunzipSync(x.payload).toString());
    expect(payloads).toHaveLength(2);
    for (const p of payloads) for (const s of ['API-DESCRIPTION-SECRET', 'api-comment-secret', 'api.person@corp', 'Api Person', 'customer-acme', 'High']) expect({ s, found: p.includes(s) }).toEqual({ s, found: false });
    expect(payloads.join('')).toContain(hashPerson(GOLDEN_COMPANY, 'api.person@corp.example'));
    const all = await everythingStored();
    for (const s of FORBIDDEN) expect({ s, found: all.includes(s) }).toEqual({ s, found: false });
  });

  it('UPL-006 "Store issue and incident titles": only a super admin may switch it; off clears stored titles and drops new ones', async () => {
    if (!up) return;
    expect((await put('/api/uploads/privacy', manager, { storeTitles: false })).status).toBe(403);
    expect((await put('/api/uploads/privacy', admin, { storeTitles: 'no' })).status).toBe(400);
    expect(await n(`SELECT COUNT(*)::int AS n FROM issues WHERE company_id = $1 AND title IS NOT NULL`, [GOLDEN_COMPANY])).toBeGreaterThan(0);
    const off = await put('/api/uploads/privacy', admin, { storeTitles: false });
    expect(off.status).toBe(200);
    expect(off.body.cleared.issues).toBeGreaterThan(0);
    expect(await n(`SELECT COUNT(*)::int AS n FROM issues WHERE company_id = $1 AND title IS NOT NULL`, [GOLDEN_COMPANY])).toBe(0);
    expect(await n(`SELECT COUNT(*)::int AS n FROM incidents_raw WHERE company_id = $1 AND title IS NOT NULL`, [GOLDEN_COMPANY])).toBe(0);
    const p = await send('preview', admin, [{ name: 'jira.csv', data: jiraCsv('GOFF') }], { mode: 'team', teamId: EMPTY });
    expect(p.body.files[0].fields).not.toContain('title');
    expect(JSON.stringify(p.body.files[0].sample)).not.toContain('Refund fails');
    await send('commit', admin, [{ name: 'jira.csv', data: jiraCsv('GOFF') }], { mode: 'team', teamId: EMPTY });
    expect(await n(`SELECT COUNT(*)::int AS n FROM issues WHERE company_id = $1 AND external_id LIKE 'GOFF-%' AND title IS NULL`, [GOLDEN_COMPANY])).toBe(3);
    const ev = await get(`/api/ci/teams/${EMPTY}/work`, admin);
    expect(JSON.stringify(ev.body)).not.toContain('Refund fails');
    expect((await db.query(`SELECT action FROM audit_log WHERE company_id = $1 AND action = 'company.data_minimisation'`, [GOLDEN_COMPANY])).rows.length).toBe(1);
    expect((await put('/api/uploads/privacy', admin, { storeTitles: true })).body.storeTitles).toBe(true);
    expect((await get('/api/uploads/privacy', admin)).body.storeTitles).toBe(true);
  });

  it('UPL-007 scope: a manager cannot upload to another department\'s team, nor reach it by key mapping; a team lead only to the team they lead', async () => {
    if (!up) return;
    const before = await counts();
    const pv = await send('preview', manager, [{ name: 'jira.csv', data: jiraCsv('GMGR') }], { mode: 'team', teamId: SMALL });
    expect(pv.status).toBe(403);
    expect(pv.body.error).toMatch(/You may not upload to team Small Team/);
    const cm = await send('commit', manager, [{ name: 'jira.csv', data: jiraCsv('GMGR') }], { mode: 'team', teamId: SMALL });
    expect(cm.status).toBe(403);
    // Map by key: project GSMALL is mapped to Small Team (department Alpha): the file is refused, not stored.
    const mapped = await send('commit', manager, [{ name: 'jira.csv', data: jiraCsv('GSMALL') }], { mode: 'map' });
    expect(mapped.status).toBe(200);
    expect(mapped.body.files[0]).toMatchObject({ status: 'rejected', stored: 0 });
    expect(mapped.body.files[0].error).toMatch(/Small Team, which you may not upload to/);
    // A team id written into the file does not reach another team either.
    const own = JSON.stringify({ issues: [{ key: 'GOWN-1', team: SMALL, type: 'Bug', status: 'Open', createdAt: ago(2) }] });
    const ownR = await send('commit', manager, [{ name: 'own.json', data: own }], { mode: 'map' });
    expect(ownR.body.files[0]).toMatchObject({ status: 'rejected' });
    expect(await counts()).toEqual(before);
    // Their own department's team: fine.
    const ok = await send('preview', manager, [{ name: 'jira.csv', data: jiraCsv('GMGR') }], { mode: 'team', teamId: PARTIAL });
    expect(ok.body.files[0].status).toBe('ready');
    // Team lead of Small Team: their team yes, another no; engineer: 403.
    expect((await send('preview', lead, [{ name: 'jira.csv', data: jiraCsv('GLEAD') }], { mode: 'team', teamId: SMALL })).body.files[0].status).toBe('ready');
    expect((await send('preview', lead, [{ name: 'jira.csv', data: jiraCsv('GLEAD') }], { mode: 'team', teamId: EMPTY })).status).toBe(403);
    expect((await send('preview', engineer, [{ name: 'jira.csv', data: jiraCsv('GENG') }], { mode: 'team', teamId: SMALL })).status).toBe(403);
    expect((await send('preview', '', [{ name: 'jira.csv', data: jiraCsv('GENG') }], { mode: 'team', teamId: SMALL })).status).toBe(401);
    // A team of another company is "not found".
    const other = (await db.query(`SELECT id FROM teams WHERE company_id <> $1 LIMIT 1`, [GOLDEN_COMPANY])).rows[0]?.id ?? 'nope';
    expect((await send('preview', admin, [{ name: 'jira.csv', data: jiraCsv('GX') }], { mode: 'team', teamId: other })).status).toBe(403);
  });

  it('UPL-008 zip-slip and zip bombs are refused; oversize 413; not multipart 415; no file 400; a good zip is unpacked', async () => {
    if (!up) return;
    const before = await counts();
    const slip = await send('preview', admin, [{ name: 'evil.zip', data: buildZip([{ name: 'ok.csv', data: 'a' }, { name: '../../etc/cron.d/x.csv', data: 'b' }]) }], { mode: 'team', teamId: EMPTY });
    expect(slip.status).toBe(400);
    expect(slip.body.error).toMatch(/zip-slip/);
    const bomb = await send('commit', admin, [{ name: 'bomb.zip', data: buildZip([{ name: 'zeros.csv', data: Buffer.alloc(30 * 1024 * 1024) }]) }], { mode: 'team', teamId: EMPTY });
    expect(bomb.status).toBe(413);
    expect(bomb.body.error).toMatch(/zip bomb/);
    const lie = await send('commit', admin, [{ name: 'lie.zip', data: buildZip([{ name: 'x.csv', data: Buffer.from('id,environment\n'.repeat(2000)), declaredSize: 100 }]) }], { mode: 'team', teamId: EMPTY });
    expect(lie.status).toBe(413);
    const big = await send('preview', admin, [{ name: 'big.csv', data: Buffer.alloc(51 * 1024 * 1024, 'a') }], { mode: 'team', teamId: EMPTY });
    expect(big.status).toBe(413);
    const json = await request(API_URL).post('/api/uploads/preview').set('Cookie', admin).send({ files: [] });
    expect(json.status).toBe(415);
    const none = await request(API_URL).post('/api/uploads/preview').set('Cookie', admin).field('options', JSON.stringify({ mode: 'team', teamId: EMPTY }));
    expect(none.status).toBe(400);
    expect(await counts()).toEqual(before);
    const good = await send('preview', admin, [{ name: 'export.zip', data: buildZip([{ name: 'jira.csv', data: jiraCsv('GZIP') }, { name: '__MACOSX/._jira.csv', data: 'x' }]) }], { mode: 'team', teamId: EMPTY });
    expect(good.status).toBe(200);
    expect(good.body.files.map((f: any) => f.name)).toEqual(['export.zip/jira.csv']);
    expect(good.body.notes[0].message).toMatch(/system file/);
  });

  it('UPL-009 CSV formula text is stored inert (prefixed with an apostrophe), never evaluated', async () => {
    if (!up) return;
    const t = (await db.query(`SELECT title FROM issues WHERE team_id = $1 AND external_id = 'GUP-3'`, [EMPTY])).rows[0].title;
    // Titles were cleared in UPL-006 (setting off); upload the row again with titles on.
    if (t === null) await send('commit', admin, [{ name: 'jira.csv', data: jiraCsv('GFX') }], { mode: 'team', teamId: EMPTY });
    const title = (await db.query(`SELECT title FROM issues WHERE team_id = $1 AND external_id IN ('GUP-3', 'GFX-3') AND title IS NOT NULL LIMIT 1`, [EMPTY])).rows[0].title;
    expect(title).toBe('\'=HYPERLINK("http://evil.example","x")');
  });

  it('UPL-010 a JUnit report to a team; the same file again is shown as already uploaded and stores nothing', async () => {
    if (!up) return;
    const xml = `<?xml version="1.0"?><testsuites><testsuite name="s" timestamp="${ago(1).slice(0, 19)}"><testcase classname="a" name="t1" time="0.1"/><testcase classname="a" name="t2" time="0.2"><failure message="boom">trace</failure></testcase></testsuite></testsuites>`;
    const r = await send('commit', admin, [{ name: 'junit.xml', data: xml }], { mode: 'team', teamId: EMPTY });
    expect(r.body.files[0]).toMatchObject({ status: 'stored', stored: 2 });
    expect(r.body.files[0].metrics).toEqual(expect.arrayContaining(['Pass rate']));
    const p = await send('preview', admin, [{ name: 'junit.xml', data: xml }], { mode: 'team', teamId: EMPTY });
    expect(p.body.files[0].warnings[0]).toMatch(/This exact file was already uploaded/);
    const before = await counts();
    const again = await send('commit', admin, [{ name: 'junit.xml', data: xml }], { mode: 'team', teamId: EMPTY });
    expect(again.body.files[0]).toMatchObject({ status: 'unchanged' });
    expect((await counts()).tests).toBe(before.tests);
    // A map-by-key upload of a report is refused with the reason (a report carries no team).
    const m = await send('preview', admin, [{ name: 'junit.xml', data: xml }], { mode: 'map' });
    expect(m.body.files[0]).toMatchObject({ status: 'error' });
    expect(m.body.files[0].error).toMatch(/carries no team/);
  });
});
