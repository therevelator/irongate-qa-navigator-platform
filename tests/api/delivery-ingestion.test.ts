import request from 'supertest';
import type { Client } from 'pg';
import { API_URL, backendUp, del, get, localDb, login, post, put } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';

/**
 * v2 phase 2 (delivery and reliability) end to end against a live backend: POST /api/ingest/deployments,
 * /commits and /incidents with the company API key (auth, tenant check, 400 / 413 / 415, idempotency,
 * batches across teams through the service → team mapping, dry runs, the ingestion log), the DORA
 * values calculated from a hand-built history (worked out in the comments), change failure linking
 * (rollback, rolled back, hotfix within 72 h, linked incident), recalculation when late events arrive,
 * the incident status stream, the GitHub / PagerDuty / Opsgenie mappings, and the evidence endpoints
 * (deliveries, How this was calculated, service mappings) with their access rules.
 * Uses the golden fixture company (golden-team-empty: no other data; golden-team-small). Skips when no backend runs.
 */
const TEAM = 'golden-team-empty';
const SMALL = 'golden-team-small';

let up = true;
let db: Client;
let adminCookie = '';
let apiKey = '';
let foreignTeam = '';

const DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);
const dayAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
/** n days ago at hh:mm UTC. */
const at = (n: number, hhmm: string) => `${dayAgo(n)}T${hhmm}:00Z`;
const send = (kind: string, body: unknown, params: Record<string, string> = {}, headers: Record<string, string> = {}) => {
  let r = request(API_URL).post(`/api/ingest/${kind}?${new URLSearchParams(params)}`).set('Authorization', `Bearer ${apiKey}`).set('Content-Type', headers['Content-Type'] ?? 'application/json');
  for (const [k, v] of Object.entries(headers)) if (k !== 'Content-Type') r = r.set(k, v);
  return r.send(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const evidence = async (team: string, metric: string, day: string) =>
  (await db.query(`SELECT value::float8 AS value, sample_size, inputs, sources, computed_at FROM metric_evidence WHERE team_id = $1 AND day = $2::date AND metric_key = $3`, [team, day, metric])).rows[0] ?? null;
const snapshot = async (team: string, day: string, col: string) =>
  (await db.query(`SELECT ${col}::float8 AS v, field_sources -> '${col}' ->> 'source' AS source FROM kpi_snapshots WHERE team_id = $1 AND snapshot_date = $2::date`, [team, day])).rows[0] ?? null;
const count = async (sql: string, params: any[] = []) => Number((await db.query(sql, params)).rows[0].n);

const prod = (id: string, finishedAt: string, extra: Record<string, unknown> = {}) => ({ id, environment: 'production', service: 'checkout', commit: `${id.toLowerCase()}aaa1`, finishedAt, result: 'success', ...extra });

beforeAll(async () => {
  up = await backendUp();
  if (!up) { console.warn('Backend not running at', API_URL, '- delivery ingestion tests skipped'); return; }
  db = await localDb();
  await createGolden(db);
  adminCookie = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  apiKey = (await post('/api/admin/api-keys', adminCookie, { name: 'Delivery ingestion test key' })).body.plaintextKey;
  foreignTeam = (await db.query(`SELECT id FROM teams WHERE company_id <> $1 LIMIT 1`, [GOLDEN_COMPANY])).rows[0]?.id ?? 'no-such-team';
});

afterAll(async () => {
  if (db) {
    await db.query(`DELETE FROM service_teams WHERE company_id = $1`, [GOLDEN_COMPANY]);
    await removeGolden(db);
    await db.end();
  }
});

describe('Authentication, tenant and request errors', () => {
  it('DEL-001 no key or a wrong key: 401; a team of another company (query or event): 403, logged as rejected', async () => {
    if (!up) return;
    expect((await request(API_URL).post(`/api/ingest/deployments?team=${TEAM}`).send(prod('X', at(1, '10:00')))).status).toBe(401);
    expect((await request(API_URL).post(`/api/ingest/incidents?team=${TEAM}`).set('Authorization', 'Bearer igk_nope').send({})).status).toBe(401);
    const foreign = await send('deployments', prod('X', at(1, '10:00')), { team: foreignTeam });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toMatch(/not accessible with this API key/);
    const log = (await db.query(`SELECT status, http_status, source FROM ingestion_log WHERE id = $1`, [foreign.body.ingestionId])).rows[0];
    expect(log).toMatchObject({ status: 'rejected', http_status: 403, source: 'deployments (json)' });
    const mixed = await send('incidents', [{ id: 'I-x', openedAt: at(1, '10:00'), team: TEAM }, { id: 'I-y', openedAt: at(1, '10:00'), team: foreignTeam }]);
    expect(mixed.status).toBe(403);
    expect(mixed.body.error).toContain(foreignTeam);
    expect(await count(`SELECT COUNT(*) AS n FROM incidents_raw WHERE external_id IN ('I-x', 'I-y')`)).toBe(0);
  });

  it('DEL-002 400s name the problem: empty, not JSON, no team, missing fields, a future time, computed values, too many events', async () => {
    if (!up) return;
    expect((await send('deployments', '', { team: TEAM })).body.error).toMatch(/Empty body/);
    expect((await send('deployments', 'id=1', { team: TEAM })).body.error).toMatch(/must be JSON/);
    const noTeam = await send('deployments', prod('X', at(1, '10:00'), { service: 'unmapped-svc' }));
    expect(noTeam.status).toBe(400);
    expect(noTeam.body.error).toMatch(/team is required.*service "unmapped-svc" is not mapped to a team/);
    expect((await send('deployments', { environment: 'production', commit: 'abcd123', finishedAt: at(1, '10:00'), result: 'success' }, { team: TEAM })).body.error).toMatch(/deployment\.id is required/);
    expect((await send('deployments', prod('X', at(1, '10:00'), { result: 'kind of' }), { team: TEAM })).body.error).toMatch(/result must be success, failure or rolled_back/);
    const future = await send('deployments', prod('X', new Date(Date.now() + DAY).toISOString()), { team: TEAM });
    expect(future.status).toBe(400);
    expect(future.body.error).toMatch(/in the future/);
    const computed = await send('deployments', { changeFailureRate: 12.5, deployments: [prod('X', at(1, '10:00'))] }, { team: TEAM });
    expect(computed.status).toBe(400);
    expect(computed.body.error).toMatch(/changeFailureRate: QE Navigator calculates this from the raw events/);
    expect((await send('incidents', { id: 'I-1', openedAt: at(1, '10:00'), mttr_hours: 2 }, { team: TEAM })).body.error).toMatch(/mttr_hours: QE Navigator calculates/);
    const many = Array.from({ length: 501 }, (_, i) => prod(`M${i}`, at(1, '10:00')));
    expect((await send('deployments', many, { team: TEAM })).body.error).toBe('Too many deployments in one request: at most 500 (send several requests)');
    expect((await send('incidents', { id: 'I-new', status: 'acknowledged', at: at(1, '10:00') }, { team: TEAM })).body.error).toMatch(/openedAt is required: incident I-new is new/);
    expect(await count(`SELECT COUNT(*) AS n FROM deployments_raw WHERE team_id = $1`, [TEAM])).toBe(0);
  });

  it('DEL-003 XML or multipart: 415; an unknown format: 415 with the supported list; over 5 MB: 413', async () => {
    if (!up) return;
    const xml = await send('deployments', '<deployment/>', { team: TEAM }, { 'Content-Type': 'application/xml' });
    expect(xml.status).toBe(415);
    expect(xml.body.error).toMatch(/send the events as JSON/);
    const fmt = await send('incidents', { id: 'x' }, { team: TEAM, format: 'servicenow' });
    expect(fmt.status).toBe(415);
    expect(fmt.body.supported).toEqual(['json', 'pagerduty', 'opsgenie']);
    const big = await send('commits', Buffer.alloc(6 * 1024 * 1024, 0x20), { team: TEAM });
    expect(big.status).toBe(413);
    expect(big.body.error).toMatch(/at most 5 MB/);
  });
});

describe('DORA values from a hand-built history (golden-team-empty)', () => {
  // Production deploys of service "checkout":
  //   A 27 days ago (the first: the period is 28 days = 4 weeks), commit authored 28 days ago → lead 1 day
  //   B 10 days ago, commits authored 12 and 11 days ago → lead 2 days
  //   C 6 days ago, rolled back (commits arrive late: authored 9 days ago → lead 3 days)
  //   E 4 days ago 09:00, followed by hotfix F at 15:00 (commit authored 13:00 → lead 2 h) → E failed
  //   G staging (not production), H 2 days ago did not complete (not counted)
  // → 5 production deploys: 1.25 per week; failed C and E: 40 %; lead times 1, 2, 0.083 days → median 1 day.
  it('DEL-010 commits and deployments: frequency, lead time and change failure rate per day, written as "computed"', async () => {
    if (!up) return;
    const commits = await send('commits', { deployment: 'B', commits: [{ sha: 'b1b1b1b', authoredAt: at(12, '10:00'), author: 'dev.one@golden.example' }, { sha: 'b2b2b2b', authoredAt: at(11, '10:00'), author: 'dev.two@golden.example' }] }, { team: TEAM });
    expect(commits.status).toBe(201);
    expect(commits.body.events[0]).toMatchObject({ id: 'B', status: 'written', commits: 2 });
    const r = await send('deployments', [
      prod('A', at(27, '10:00'), { commits: [{ sha: 'a1a1a1a', authoredAt: at(28, '10:00') }] }),
      prod('B', at(10, '10:00'), { commit: 'b2b2b2b', commitRange: 'a1a1a1a..b2b2b2b' }),
      prod('C', at(6, '10:00'), { result: 'rolled_back' }),
      prod('E', at(4, '09:00')),
      prod('F', at(4, '15:00'), { hotfix: true, commits: [{ sha: 'f1f1f1f', authoredAt: at(4, '13:00') }] }),
      prod('G', at(3, '10:00'), { environment: 'staging' }),
      prod('H', at(2, '10:00'), { result: 'failed' }),
    ], { team: TEAM });
    expect(r.status).toBe(201);
    expect(r.body.events.map((e: any) => e.status)).toEqual(Array(7).fill('written'));
    const freq = await evidence(TEAM, 'deployment_frequency', today());
    expect(freq.value).toBe(1.25);
    expect(freq.inputs).toMatchObject({ productionDeploys: 5, periodDays: 28, notCompleted: 1 });
    expect((await evidence(TEAM, 'change_failure_rate', today())).value).toBe(40);
    const lead = await evidence(TEAM, 'lead_time', today());
    expect(lead.value).toBe(1);
    expect(lead.inputs).toMatchObject({ deploysWithCommits: 3, deploysWithoutCommitTimes: 2 });
    // Eleven days ago only A was out, in a period from A's day: 1 deploy in 17 days → 0.41 per week.
    expect((await evidence(TEAM, 'deployment_frequency', dayAgo(11))).value).toBe(0.41);
    expect(await snapshot(TEAM, today(), 'deployment_frequency_per_week')).toEqual({ v: 1.25, source: 'computed' });
    expect(await snapshot(TEAM, today(), 'change_failure_rate')).toEqual({ v: 40, source: 'computed' });
    // Authors are kept as a hash only.
    const rows = (await db.query(`SELECT author_hash, row_to_json(c)::text AS j FROM deployment_commits c WHERE team_id = $1 AND sha = 'b1b1b1b'`, [TEAM])).rows;
    expect(rows[0].author_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(rows[0].j).not.toContain('golden.example');
  });

  // Incidents: I1 5 days ago 00:00–02:00, SEV1 (an outage); I2 3 days ago 12:00–13:00, low, linked to deploy B.
  it('DEL-011 incidents: MTTR, availability, MTBF, incidents per deploy; a linked incident makes its deploy a failed change from its own day on', async () => {
    if (!up) return;
    const r = await send('incidents', { incidents: [
      { id: 'I1', title: 'Checkout down', severity: 'SEV1', service: 'checkout', openedAt: at(5, '00:00'), acknowledgedAt: at(5, '00:10'), resolvedAt: at(5, '02:00') },
      { id: 'I2', severity: 'low', service: 'checkout', openedAt: at(3, '12:00'), resolvedAt: at(3, '13:00'), deploymentId: 'B' },
    ] }, { team: TEAM });
    expect(r.status).toBe(201);
    const y = dayAgo(1);
    expect((await evidence(TEAM, 'mttr', y)).value).toBe(1.5); // median(2 h, 1 h)
    expect((await evidence(TEAM, 'availability', y)).value).toBe(99.691); // the period starts at A's day: (1 − 2 h ÷ 648 h) × 100
    expect((await evidence(TEAM, 'mtbf', y)).value).toBe(60); // 5 days ago 00:00 → 3 days ago 12:00
    expect((await evidence(TEAM, 'incidents_per_deploy', y)).value).toBe(0.4); // 2 incidents ÷ 5 deploys
    // Late event: CFR 40 % until the day before I2 opened, 60 % (B, C, E) from that day on.
    expect((await evidence(TEAM, 'change_failure_rate', dayAgo(4))).value).toBe(40);
    expect((await evidence(TEAM, 'change_failure_rate', dayAgo(3))).value).toBe(60);
    const cfr = await evidence(TEAM, 'change_failure_rate', today());
    expect(cfr.value).toBe(60);
    const failed = cfr.sources.failedDeployments.map((f: any) => [f.externalId, f.reasons.map((x: any) => x.type).join('+')]).sort();
    expect(failed).toEqual([['B', 'incident'], ['C', 'rolled_back'], ['E', 'hotfix']]);
    expect(await snapshot(TEAM, today(), 'mttr_hours')).toEqual({ v: 1.5, source: 'computed' });
  });

  it('DEL-012 late commits: lead time recalculated from the deploy’s day on; the days before keep their values', async () => {
    if (!up) return;
    const before = await evidence(TEAM, 'lead_time', dayAgo(7));
    const r = await send('commits', [{ sha: 'c1c1c1c', authoredAt: at(9, '10:00') }], { team: TEAM, deployment: 'C' });
    expect(r.status).toBe(201);
    const lead = await evidence(TEAM, 'lead_time', today());
    expect(lead.value).toBe(1.5); // 0.083, 1, 2, 3 days
    expect(lead.inputs.deploysWithCommits).toBe(4);
    const after = await evidence(TEAM, 'lead_time', dayAgo(7));
    expect(after.value).toBe(before.value);
    expect(new Date(after.computed_at).getTime()).toBe(new Date(before.computed_at).getTime());
  });

  it('DEL-013 idempotency: the same events again are duplicates; an Idempotency-Key retry is replayed; a changed event updates and recalculates', async () => {
    if (!up) return;
    const n = await count(`SELECT COUNT(*) AS n FROM deployments_raw WHERE team_id = $1`, [TEAM]);
    const again = await send('deployments', [prod('E', at(4, '09:00')), prod('F', at(4, '15:00'), { hotfix: true, commits: [{ sha: 'f1f1f1f', authoredAt: at(4, '13:00') }] })], { team: TEAM });
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('duplicate');
    expect(again.body.events.map((e: any) => e.status)).toEqual(['duplicate', 'duplicate']);
    const key = `del-key-${Date.now()}`;
    const a = await send('incidents', { id: 'I3', severity: 'low', service: 'checkout', openedAt: at(2, '08:00'), resolvedAt: at(2, '08:30') }, { team: TEAM }, { 'Idempotency-Key': key });
    const b = await send('incidents', { id: 'I3', severity: 'low', service: 'checkout', openedAt: at(2, '08:00'), resolvedAt: at(2, '08:30') }, { team: TEAM }, { 'Idempotency-Key': key });
    expect(a.status).toBe(201);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.ingestionId).toBe(a.body.ingestionId);
    // H completed after all (re-sent with result success): 6 deploys → 1.5 per week, 3 of 6 failed → 50 %.
    const upd = await send('deployments', prod('H', at(2, '10:00')), { team: TEAM });
    expect(upd.status).toBe(201);
    expect(upd.body.events[0].status).toBe('updated');
    expect(await count(`SELECT COUNT(*) AS n FROM deployments_raw WHERE team_id = $1`, [TEAM])).toBe(n);
    expect((await evidence(TEAM, 'deployment_frequency', today())).value).toBe(1.5);
    expect((await evidence(TEAM, 'change_failure_rate', today())).value).toBe(50);
  });

  it('DEL-014 a dry run checks key, team and events and stores nothing; it is logged as a test call', async () => {
    if (!up) return;
    const n = await count(`SELECT COUNT(*) AS n FROM deployments_raw WHERE team_id = $1`, [TEAM]);
    const r = await send('deployments', prod('DRY', at(1, '10:00')), { team: TEAM, dryRun: 'true' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'dry-run', kind: 'deployments', events: 1, teams: [TEAM] });
    expect(await count(`SELECT COUNT(*) AS n FROM deployments_raw WHERE team_id = $1`, [TEAM])).toBe(n);
    expect(await count(`SELECT COUNT(*) AS n FROM ingestion_log WHERE id = $1 AND source = 'deployments (json, test call)'`, [r.body.ingestionId])).toBe(1);
  });
});

describe('Change failure linking, the incident stream, mappings and formats (golden-team-small)', () => {
  it('DEL-020 the service → team mapping routes events without a team; a batch can span teams; super admins only', async () => {
    if (!up) return;
    const eng = (await login('small-2@golden.example')).cookie;
    expect((await put('/api/ci/services', eng, { service: 'small-svc', teamId: SMALL })).status).toBe(403);
    expect((await get('/api/ci/services', eng)).status).toBe(403);
    expect((await put('/api/ci/services', adminCookie, { service: '', teamId: SMALL })).status).toBe(400);
    expect((await put('/api/ci/services', adminCookie, { service: 'small-svc', teamId: foreignTeam })).status).toBe(404);
    const m = await put('/api/ci/services', adminCookie, { service: 'small-svc', teamId: SMALL });
    expect(m.status).toBe(200);
    expect(m.body).toMatchObject({ service: 'small-svc', teamId: SMALL });
    const r = await send('deployments', [
      { id: 'S1', environment: 'production', service: 'small-svc', commit: 's1s1s1s', finishedAt: at(9, '10:00'), result: 'success' },
      { id: 'S2', environment: 'production', service: 'small-svc', commit: 's2s2s2s', finishedAt: at(8, '10:00'), result: 'success' },
      { id: 'S3', environment: 'production', service: 'small-svc', commit: 's3s3s3s', finishedAt: at(4, '10:00'), result: 'success' },
      { id: 'S4', environment: 'production', service: 'small-svc', commit: 's4s4s4s', finishedAt: at(4, '12:00'), result: 'success', hotfix: true, url: 'https://ci.example/runs/4' },
      { id: 'S5', environment: 'production', service: 'other-svc', team: SMALL, commit: 's5s5s5s', finishedAt: at(3, '10:00'), result: 'success' },
      { id: 'S6', environment: 'production', service: 'small-svc', commit: 's6s6s6s', finishedAt: at(1, '14:00'), result: 'success', hotfix: true },
      { id: 'S7', environment: 'production', service: 'small-svc', commit: 's7s7s7s', finishedAt: at(1, '15:00'), result: 'success', rollbackOf: 'S2' },
      { id: 'T1', environment: 'production', service: 'checkout', team: TEAM, commit: 't1t1t1t', finishedAt: at(1, '09:00'), result: 'success' },
    ]);
    expect(r.status).toBe(201);
    expect(r.body.events.filter((e: any) => e.team === SMALL)).toHaveLength(7);
    expect(r.body.events.find((e: any) => e.id === 'T1').team).toBe(TEAM);
    expect(r.body.computed.map((c: any) => c.team).sort()).toEqual([TEAM, SMALL].sort());
    const list = await get('/api/ci/services', adminCookie);
    expect(list.body.mappings).toEqual([expect.objectContaining({ service: 'small-svc', teamId: SMALL })]);
    expect(list.body.seen.some((x: any) => x.service === 'other-svc')).toBe(true);
  });

  // S2 rolled back by S7; S3 followed by hotfix S4 2 h later; S6 is a hotfix 2 days after S5 but S5 is another
  // service, and 74 h after S4 (the last small-svc deploy) → it blames nobody. Counted: S1–S6 (S7 is a rollback).
  it('DEL-021 change failure linking: rollback deploy, hotfix within 72 h of the same service, a link added by an incident update', async () => {
    if (!up) return;
    let cfr = await evidence(SMALL, 'change_failure_rate', today());
    expect(cfr.inputs).toMatchObject({ productionDeploys: 6, failedChanges: 2, rolledBack: 1, followedByHotfix: 1 });
    expect(cfr.value).toBe(33.33);
    // An incident opened 2 days ago, first without a link, then linked to S5 by an update.
    expect((await send('incidents', { id: 'IS-1', severity: 'P3', service: 'other-svc', openedAt: at(2, '10:00') }, { team: SMALL })).status).toBe(201);
    expect((await evidence(SMALL, 'change_failure_rate', today())).value).toBe(33.33);
    const link = await send('incidents', { id: 'IS-1', deploymentId: 'S5' }, { team: SMALL });
    expect(link.body.events[0].status).toBe('updated');
    cfr = await evidence(SMALL, 'change_failure_rate', today());
    expect(cfr.value).toBe(50);
    expect(cfr.sources.failedDeployments.find((f: any) => f.externalId === 'S5').reasons[0]).toMatchObject({ type: 'incident', ref: 'IS-1' });
    expect((await evidence(SMALL, 'change_failure_rate', dayAgo(3))).value).toBe(20); // as of 3 days ago: S1–S5, only S3 failed (S7 and IS-1 came later)
  });

  it('DEL-022 the incident stream: open (an open outage counts until now), acknowledged, resolved, a duplicate, reopened', async () => {
    if (!up) return;
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    const open = await send('incidents', { id: 'IS-2', title: 'Payments latency', severity: 'critical', service: 'small-svc', openedAt: ago(120) }, { team: SMALL });
    expect(open.status).toBe(201);
    const avail = await evidence(SMALL, 'availability', today());
    expect(avail.inputs.openOutages).toBe(1);
    expect(avail.value).toBeLessThan(100);
    expect(await evidence(SMALL, 'mttr', today())).toBeNull();
    expect((await send('incidents', { id: 'IS-2', status: 'acknowledged', at: ago(115) }, { team: SMALL })).body.events[0].status).toBe('updated');
    const resolvedAt = ago(90);
    expect((await send('incidents', { id: 'IS-2', status: 'resolved', at: resolvedAt }, { team: SMALL })).body.events[0].status).toBe('updated');
    expect((await evidence(SMALL, 'mttr', today())).value).toBe(0.5);
    const dup = await send('incidents', { id: 'IS-2', status: 'resolved', at: resolvedAt }, { team: SMALL });
    expect(dup.status).toBe(200);
    expect(dup.body.events[0].status).toBe('duplicate');
    const row = (await db.query(`SELECT id, status, acknowledged_at, resolved_at FROM incidents_raw WHERE team_id = $1 AND external_id = 'IS-2'`, [SMALL])).rows[0];
    expect(row.status).toBe('resolved');
    expect((await db.query(`SELECT status FROM incident_updates WHERE incident_id = $1 ORDER BY at`, [row.id])).rows.map((x) => x.status)).toEqual(['open', 'acknowledged', 'resolved']);
    // Reopened after the resolve: open again, no resolve time.
    const re = await send('incidents', { id: 'IS-2', status: 'reopened', at: ago(80) }, { team: SMALL });
    expect(re.body.events[0].status).toBe('updated');
    expect((await db.query(`SELECT status, resolved_at FROM incidents_raw WHERE id = $1`, [row.id])).rows[0]).toEqual({ status: 'acknowledged', resolved_at: null });
    await send('incidents', { id: 'IS-2', status: 'resolved', at: ago(75) }, { team: SMALL });
  });

  it('DEL-023 GitHub deployment_status, GitHub push, PagerDuty and Opsgenie payloads are mapped as they are', async () => {
    if (!up) return;
    const gh = await send('deployments', {
      action: 'created',
      deployment_status: { state: 'success', environment: 'production', created_at: at(1, '14:00'), target_url: 'https://github.com/acme/small/actions/runs/1' },
      deployment: { id: 4242, sha: 'ghghghgh', ref: 'main', environment: 'production', created_at: at(1, '13:50'), payload: {} },
      repository: { name: 'small-svc' },
    });
    expect(gh.status).toBe(201);
    expect(gh.body).toMatchObject({ format: 'github', events: [{ id: '4242', team: SMALL, status: 'written' }] });
    const pending = await send('deployments', { deployment_status: { state: 'queued', environment: 'production' }, deployment: { id: 4243, sha: 'abcd' }, repository: { name: 'small-svc' } });
    expect(pending.status).toBe(200);
    expect(pending.body.status).toBe('ignored');
    const push = await send('commits', {
      ref: 'refs/heads/main', repository: { name: 'small-svc' }, pusher: { name: 'x' },
      commits: [{ id: 'ghghghgh', timestamp: at(2, '09:00'), author: { name: 'Dev Small', email: 'dev.small@golden.example' } }],
    });
    expect(push.status).toBe(201);
    expect(push.body.format).toBe('github');
    // The push commit is the deployed commit of 4242: its lead time (29 h) is now known.
    const dep = (await get(`/api/ci/teams/${SMALL}/delivery`, adminCookie)).body.deployments.find((d: any) => d.deploymentId === '4242');
    expect(dep.leadTimeHours).toBe(29);
    const pd = await send('incidents', { event: { id: 'ev1', event_type: 'incident.triggered', occurred_at: at(1, '15:00'), data: { id: 'PDSMALL1', title: 'Errors', status: 'triggered', urgency: 'high', priority: { summary: 'P2' }, service: { summary: 'small-svc' }, created_at: at(1, '15:00') } } });
    expect(pd.status).toBe(201);
    expect(pd.body).toMatchObject({ format: 'pagerduty', events: [{ id: 'PDSMALL1', team: SMALL, status: 'written' }] });
    const pdRes = await send('incidents', { event: { id: 'ev2', event_type: 'incident.resolved', occurred_at: at(1, '15:45'), data: { id: 'PDSMALL1', status: 'resolved', service: { summary: 'small-svc' }, created_at: at(1, '15:00') } } });
    expect(pdRes.body.events[0].status).toBe('updated');
    const og = await send('incidents', { action: 'Create', alert: { alertId: 'OG-SMALL', message: 'Disk full', priority: 'P4', entity: 'small-svc', createdAt: Date.parse(at(1, '16:00')) } });
    expect(og.body).toMatchObject({ format: 'opsgenie', events: [{ id: 'OG-SMALL', team: SMALL }] });
    const rows = (await db.query(`SELECT external_id, severity, severity_label, status, source FROM incidents_raw WHERE team_id = $1 AND external_id IN ('PDSMALL1', 'OG-SMALL') ORDER BY 1`, [SMALL])).rows;
    expect(rows).toEqual([
      { external_id: 'OG-SMALL', severity: 'low', severity_label: 'P4', status: 'open', source: 'opsgenie' },
      { external_id: 'PDSMALL1', severity: 'high', severity_label: 'P2', status: 'resolved', source: 'pagerduty' },
    ]);
  });
});

describe('Evidence, How this was calculated, Connect your CI status, ingestion log', () => {
  it('DEL-030 deliveries evidence: DORA values, recent production deploys with commits and lead time, failed changes with reasons, incidents with duration and linked deploy', async () => {
    if (!up) return;
    const r = await get(`/api/ci/teams/${TEAM}/delivery`, adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.sample).toBe(false);
    expect(r.body.metrics.map((m: any) => m.key).sort()).toEqual(['availability', 'change_failure_rate', 'deployment_frequency', 'incidents_per_deploy', 'lead_time', 'mtbf', 'mttr']);
    const ids = r.body.deployments.map((d: any) => d.deploymentId);
    expect(ids).toEqual(expect.arrayContaining(['T1', 'H', 'F', 'E', 'C', 'B']));
    expect(ids).not.toContain('G'); // staging
    const b = r.body.deployments.find((d: any) => d.deploymentId === 'B');
    expect(b).toMatchObject({ commitCount: 2, leadTimeHours: 48, result: 'success' });
    expect(r.body.failedChanges.map((d: any) => d.deploymentId).sort()).toEqual(['B', 'C', 'E']);
    expect(r.body.failedChanges.find((d: any) => d.deploymentId === 'E').failedBecause[0]).toMatchObject({ type: 'hotfix', ref: 'F' });
    const i1 = r.body.incidents.find((i: any) => i.incidentId === 'I1');
    expect(i1).toMatchObject({ severity: 'critical', outage: true, status: 'resolved', durationHours: 2 });
    expect(r.body.incidents.find((i: any) => i.incidentId === 'I2').deployment).toMatchObject({ deploymentId: 'B' });
    expect(r.body.lastReceived.deployments.uploads).toBeGreaterThan(0);
    // The CI evidence keeps its own metrics only.
    expect((await get(`/api/ci/teams/${TEAM}/evidence`, adminCookie)).body.metrics.some((m: any) => m.key === 'change_failure_rate')).toBe(false);
  });

  it('DEL-031 How this was calculated by KPI column: formula, values used and the deploys / incidents behind it', async () => {
    if (!up) return;
    const cfr = await get(`/api/ci/teams/${TEAM}/metrics/change_failure_rate`, adminCookie);
    expect(cfr.status).toBe(200);
    // B, C, E failed of A, B, C, E, F, H and T1 (DEL-020).
    expect(cfr.body).toMatchObject({ metric: 'change_failure_rate', kpiColumn: 'change_failure_rate', value: 42.86, sample: false });
    expect(cfr.body.formula).toMatch(/rolled back, followed within 72 h by a hotfix/);
    expect(cfr.body.sources.deployments.find((d: any) => d.deploymentId === 'C').failedBecause[0].type).toBe('rolled_back');
    const freq = await get(`/api/ci/teams/${TEAM}/metrics/deployment_frequency_per_week`, adminCookie);
    expect(freq.body).toMatchObject({ metric: 'deployment_frequency', unit: '/week' });
    const mttr = await get(`/api/ci/teams/${TEAM}/metrics/mttr_hours`, adminCookie);
    expect(mttr.body.sources.incidents.map((i: any) => i.incidentId).sort()).toEqual(['I1', 'I2', 'I3']);
  });

  it('DEL-032 access: an engineer of another team is refused; the CI status lists deployments and incidents per team; the ingestion log has every request', async () => {
    if (!up) return;
    const eng = (await login('small-2@golden.example')).cookie;
    expect((await get(`/api/ci/teams/${TEAM}/delivery`, eng)).status).toBe(403);
    expect((await get(`/api/ci/teams/${SMALL}/delivery`, eng)).status).toBe(200);
    const status = await get('/api/ci/status', adminCookie);
    const row = status.body.teams.find((t: any) => t.id === TEAM);
    expect(row.deployments.uploads).toBeGreaterThan(0);
    expect(row.incidents.uploads).toBeGreaterThan(0);
    expect(status.body.rejectedLast7Days).toBeGreaterThan(0);
    const rows = (await db.query(`SELECT source, status FROM ingestion_log WHERE company_id = $1 AND source ~ '^(deployments|commits|incidents)'`, [GOLDEN_COMPANY])).rows;
    for (const s of ['deployments (json)', 'commits (json)', 'incidents (json)', 'deployments (github)', 'commits (github)', 'incidents (pagerduty)', 'incidents (opsgenie)']) {
      expect(rows.some((x) => x.source === s && x.status === 'accepted')).toBe(true);
    }
    expect(rows.filter((x) => x.status === 'rejected').length).toBeGreaterThanOrEqual(8);
    expect((await del(`/api/ci/services/${encodeURIComponent('small-svc')}`, eng)).status).toBe(403);
    expect((await del(`/api/ci/services/${encodeURIComponent('small-svc')}`, adminCookie)).status).toBe(200);
    expect((await del(`/api/ci/services/${encodeURIComponent('small-svc')}`, adminCookie)).status).toBe(404);
  });
});
