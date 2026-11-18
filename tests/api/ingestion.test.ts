import request from 'supertest';
import type { Client } from 'pg';
import { API_URL, backendUp, get, localDb, login, post } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';
import { computeQaScore } from '../../server/lib/metricFormulas';

/**
 * Metric storage and ingestion quality (migration 20261120000000):
 *   - per-metric values (metric_values) with recordedAt honoured; snapshots derived from them;
 *   - backdated ingestion updates that day's snapshot and the later derived days without
 *     overwriting newer values; a day without a snapshot gets one;
 *   - corrections (same moment twice) supersede the earlier value;
 *   - Idempotency-Key (request) and idempotencyKey (item): retries never write twice,
 *     concurrent duplicates write once, a reused key with another body is refused;
 *   - partial batches (?partial=true) and all-or-nothing batches (default);
 *   - every request in the ingestion log; GET /api/ingestion-log policy per role.
 *
 * Uses the golden fixture company (tests/api/helpers/goldenFixture.ts) with its snapshots turned
 * into metric_values exactly as the migration does (backfill_metric_values).
 * Runs against a live backend at API_URL; skips cleanly when none is running.
 */

let up = true;
let db: Client;
let today = '';
let adminCookie = '';
let apiKey = '';
let foreignTeam = '';

const day = (t: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - t);
  return d.toISOString().slice(0, 10);
};
const ingest = (body: unknown, opts: { key?: string; partial?: boolean; auth?: string } = {}) => {
  let r = request(API_URL).post(`/api/ingest/kpis${opts.partial ? '?partial=true' : ''}`).set('Authorization', `Bearer ${opts.auth ?? apiKey}`);
  if (opts.key) r = r.set('Idempotency-Key', opts.key);
  return r.send(body as object);
};
const cell = async (teamId: string, d: string, col = 'test_coverage') => {
  const { rows } = await db.query(
    `SELECT ${col}::float8 AS v, field_sources -> '${col}' AS fs, qa_score, test_coverage, defect_escape_rate, change_failure_rate, code_quality_score
       FROM kpi_snapshots WHERE team_id = $1 AND snapshot_date = $2::date`,
    [teamId, d]
  );
  return rows[0] ?? null;
};
const valueCount = async (teamId: string) =>
  Number((await db.query('SELECT count(*) FROM metric_values WHERE team_id = $1', [teamId])).rows[0].count);

beforeAll(async () => {
  up = await backendUp();
  if (!up) {
    console.warn('Backend not running at', API_URL, '- ingestion tests skipped');
    return;
  }
  db = await localDb();
  await createGolden(db);
  // As the migration (and the seed) do for existing snapshots.
  await db.query(`SELECT count(public.backfill_metric_values(id)) FROM teams WHERE company_id = $1`, [GOLDEN_COMPANY]);
  today = (await db.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`)).rows[0].d;
  adminCookie = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  const created = await post('/api/admin/api-keys', adminCookie, { name: 'Ingestion test key' });
  apiKey = created.body.plaintextKey;
  const other = await db.query(`SELECT id FROM teams WHERE company_id <> $1 AND is_active LIMIT 1`, [GOLDEN_COMPANY]);
  foreignTeam = other.rows[0]?.id ?? 'no-such-team';
});

afterAll(async () => {
  if (db) {
    await removeGolden(db);
    await db.end();
  }
});

describe('Backdated ingestion and derived snapshots', () => {
  it('ING-001: a backdated value updates that day only where no newer value exists; later days keep their own values', async () => {
    if (!up) return;
    const team = 'golden-team-small';
    const before = { d4: await cell(team, day(4)), d0: await cell(team, day(0)) };
    const res = await ingest({ teamId: team, source: 'jenkins-test', recordedAt: `${day(5)}T12:00:00Z`, metrics: { test_coverage: 55.5 } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
    expect(res.body.result).toMatchObject({ snapshotDate: day(5), duplicate: false, updated: ['test_coverage'] });
    const d5 = await cell(team, day(5));
    expect(d5.v).toBe(55.5);
    expect(d5.fs).toMatchObject({ source: 'jenkins-test', recorded_at: `${day(5)}T12:00:00.000Z` });
    expect(d5.fs.carried_forward).toBeUndefined();
    // The trigger recomputed that day's QA score from its inputs.
    expect(d5.qa_score).toBe(computeQaScore(d5).score);
    // Newer real values (recorded on D-4 .. D0) still win on their days.
    expect((await cell(team, day(4))).v).toBe(before.d4.v);
    expect((await cell(team, day(0))).v).toBe(before.d0.v);
    expect((await cell(team, day(0))).fs.recorded_at).toBe(before.d0.fs.recorded_at);
  });

  it('ING-002: a backdated value fills the later days that only carried an older value forward', async () => {
    if (!up) return;
    const team = 'golden-team-stale'; // coverage last recorded D-12, carried forward since
    const d7 = await cell(team, day(7));
    const res = await ingest({ teamId: team, source: 'sonarqube', recordedAt: `${day(6)}T08:30:00Z`, metrics: { test_coverage: 90 } });
    expect(res.status).toBe(200);
    expect((await cell(team, day(7))).v).toBe(d7.v); // before the value: unchanged
    const d6 = await cell(team, day(6));
    expect(d6.v).toBe(90);
    expect(d6.fs.carried_forward).toBeUndefined();
    for (const t of [5, 3, 0]) {
      const c = await cell(team, day(t));
      expect(c.v).toBe(90);
      expect(c.fs).toMatchObject({ source: 'sonarqube', recorded_at: `${day(6)}T08:30:00.000Z`, carried_forward: true });
      expect(c.qa_score).toBe(computeQaScore(c).score);
    }
    // Recorded D-6, so still older than its daily interval: shown as stale.
    const team1 = (await get(`/api/teams/${team}`, adminCookie)).body.team;
    expect(team1.kpiStaleness.testCoverage).toMatchObject({ stale: true, recordedAt: `${day(6)}T08:30:00.000Z` });
  });

  it('ING-003: a value for a day before the first snapshot creates that day, derived from the values held then', async () => {
    if (!up) return;
    const team = 'golden-team-small';
    expect(await cell(team, day(30))).toBeNull();
    const res = await ingest({ teamId: team, source: 'jenkins-test', recordedAt: `${day(30)}T10:00:00Z`, metrics: { test_coverage: 60, change_failure_rate: 20 } });
    expect(res.status).toBe(200);
    const d30 = await cell(team, day(30));
    expect(d30.v).toBe(60);
    // No other metric had a value as of D-30: not invented.
    expect(d30.defect_escape_rate).toBeNull();
    expect(d30.qa_score).toBe(computeQaScore(d30).score);
    // The fixture's own first day (D-20) keeps its value.
    expect((await cell(team, day(20))).fs.recorded_at).toBe(`${day(20)}T00:00:00.000Z`);
  });

  it('ING-004: the same moment sent again is a correction: the earlier value is superseded', async () => {
    if (!up) return;
    const team = 'golden-team-big';
    const at = `${day(2)}T09:00:00Z`;
    expect((await ingest({ teamId: team, source: 'sonarqube', recordedAt: at, metrics: { code_quality_score: 70 } })).status).toBe(200);
    expect((await ingest({ teamId: team, source: 'sonarqube', recordedAt: at, metrics: { code_quality_score: 72 } })).status).toBe(200);
    const { rows } = await db.query(
      `SELECT value::float8 AS v, superseded_by FROM metric_values WHERE team_id = $1 AND metric_key = 'code_quality_score' AND recorded_at = $2::timestamptz ORDER BY received_at`,
      [team, at]
    );
    expect(rows.map((r) => r.v)).toEqual([70, 72]);
    expect(rows[0].superseded_by).not.toBeNull();
    expect(rows[1].superseded_by).toBeNull();
    expect((await cell(team, day(2), 'code_quality_score')).v).toBe(72);
    // The next day has its own (newer) value.
    expect((await cell(team, day(1), 'code_quality_score')).v).not.toBe(72);
  });

  it('ING-005: recordedAt older than 365 days or in the future is rejected and logged', async () => {
    if (!up) return;
    const old = await ingest({ teamId: 'golden-team-small', source: 'jenkins', recordedAt: `${day(400)}T00:00:00Z`, metrics: { test_coverage: 50 } });
    expect(old.status).toBe(400);
    expect(JSON.stringify(old.body)).toContain('365 days');
    const future = await ingest({ teamId: 'golden-team-small', source: 'jenkins', recordedAt: '2999-01-01T00:00:00Z', metrics: { test_coverage: 50 } });
    expect(future.status).toBe(400);
    const { rows } = await db.query(`SELECT status, http_status FROM ingestion_log WHERE id = $1`, [old.body.ingestionId]);
    expect(rows[0]).toEqual({ status: 'rejected', http_status: 400 });
  });
});

describe('Idempotency', () => {
  it('ING-010: a retry with the same Idempotency-Key returns the stored result and writes nothing', async () => {
    if (!up) return;
    const team = 'golden-team-partial';
    const body = { teamId: team, source: 'jenkins', recordedAt: `${day(1)}T06:00:00Z`, metrics: { automation_coverage: 77, test_flakiness_rate: 1.9 } };
    const first = await ingest(body, { key: 'ing-010-key' });
    expect(first.status).toBe(200);
    const count = await valueCount(team);
    const again = await ingest(body, { key: 'ing-010-key' });
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body).toEqual(first.body);
    expect(await valueCount(team)).toBe(count);
    const { rows } = await db.query(`SELECT count(*)::int AS n, min(status) AS s FROM ingestion_log WHERE company_id = $1 AND idempotency_key = 'ing-010-key'`, [GOLDEN_COMPANY]);
    expect(rows[0]).toEqual({ n: 1, s: 'accepted' });
    // Same key, different body: refused, nothing written.
    const other = await ingest({ ...body, metrics: { automation_coverage: 10 } }, { key: 'ing-010-key' });
    expect(other.status).toBe(422);
    expect(await valueCount(team)).toBe(count);
  });

  it('ING-011: concurrent requests with the same Idempotency-Key write once and return the same result', async () => {
    if (!up) return;
    const team = 'golden-team-big';
    const count = await valueCount(team);
    const body = { teamId: team, source: 'jenkins', recordedAt: `${day(3)}T07:15:00Z`, metrics: { mttr_hours: 0.4 } };
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => ingest(body, { key: 'ing-011-key' })));
    for (const r of [a, b, c]) expect(r.status).toBe(200);
    expect(b.body).toEqual(a.body);
    expect(c.body).toEqual(a.body);
    expect(await valueCount(team)).toBe(count + 1);
  });

  it('ING-012: a per-item idempotencyKey makes a re-sent item a duplicate (nothing written again)', async () => {
    if (!up) return;
    const team = 'golden-team-small';
    const item = { teamId: team, source: 'jira', recordedAt: `${day(2)}T05:00:00Z`, metrics: { sprint_velocity: 25 }, idempotencyKey: 'jira-sprint-77' };
    const first = await ingest([item]);
    expect(first.status).toBe(200);
    expect(first.body.items[0].status).toBe('written');
    const count = await valueCount(team);
    const second = await ingest([item, { ...item, idempotencyKey: 'jira-sprint-78', metrics: { sprint_velocity: 26 }, recordedAt: `${day(1)}T05:00:00Z` }]);
    expect(second.status).toBe(200);
    expect(second.body.items.map((i: any) => i.status)).toEqual(['duplicate', 'written']);
    expect(second.body.results[0]).toMatchObject({ duplicate: true, updated: [] });
    expect(await valueCount(team)).toBe(count + 1);
  });

  it('ING-013: a rejected request does not bind its key: the corrected retry is processed', async () => {
    if (!up) return;
    const bad = await ingest({ teamId: 'golden-team-small', source: 'jenkins', metrics: { test_coverage: 500 } }, { key: 'ing-013-key' });
    expect(bad.status).toBe(400);
    const good = await ingest({ teamId: 'golden-team-small', source: 'jenkins', metrics: { test_coverage: 79 } }, { key: 'ing-013-key' });
    expect(good.status).toBe(200);
    expect(good.headers['idempotent-replayed']).toBeUndefined();
  });
});

describe('Partial batches', () => {
  const batch = () => [
    { teamId: 'golden-team-big', source: 'jenkins', recordedAt: `${day(1)}T03:00:00Z`, metrics: { lead_time_days: 0.7 } },
    { teamId: 'golden-team-big', source: 'jenkins', metrics: { not_a_metric: 1 } },
    { teamId: foreignTeam, source: 'jenkins', metrics: { test_coverage: 50 } },
  ];

  it('ING-020: by default a batch with an invalid item writes nothing (400, logged as rejected)', async () => {
    if (!up) return;
    const count = await valueCount('golden-team-big');
    const res = await ingest(batch());
    expect(res.status).toBe(400);
    expect(res.body.details.map((d: any) => d.index)).toEqual([1, 2]);
    expect(await valueCount('golden-team-big')).toBe(count);
    const { rows } = await db.query(`SELECT status, item_count, errors FROM ingestion_log WHERE id = $1`, [res.body.ingestionId]);
    expect(rows[0].status).toBe('rejected');
    expect(rows[0].item_count).toBe(3);
  });

  it('ING-021: with ?partial=true the valid items are written and the others reported (207, partial)', async () => {
    if (!up) return;
    const count = await valueCount('golden-team-big');
    const res = await ingest(batch(), { partial: true });
    expect(res.status).toBe(207);
    expect(res.body.status).toBe('partial');
    expect(res.body.items.map((i: any) => i.status)).toEqual(['written', 'error', 'error']);
    expect(res.body.items[2].errors[0]).toContain('not accessible');
    expect(await valueCount('golden-team-big')).toBe(count + 1);
    expect((await cell('golden-team-big', day(1), 'lead_time_days')).v).toBe(0.7);
    const { rows } = await db.query(`SELECT status, http_status, value_count, team_ids FROM ingestion_log WHERE id = $1`, [res.body.ingestionId]);
    expect(rows[0]).toMatchObject({ status: 'partial', http_status: 207, value_count: 1, team_ids: ['golden-team-big'] });
  });

  it('ING-022: another company\'s team alone is 403 and nothing is written', async () => {
    if (!up) return;
    const res = await ingest({ teamId: foreignTeam, source: 'jenkins', metrics: { test_coverage: 50 } });
    expect(res.status).toBe(403);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM metric_values WHERE team_id = $1 AND source = 'jenkins' AND received_at > now() - interval '1 minute'`, [foreignTeam]);
    expect(rows[0].n).toBe(0);
  });

  it('ING-023: without a valid API key: 401', async () => {
    if (!up) return;
    expect((await ingest({ teamId: 'golden-team-big', source: 'x', metrics: { test_coverage: 1 } }, { auth: 'igk_not-a-key' })).status).toBe(401);
  });
});

describe('Manual metrics: same path, backdating and idempotency', () => {
  it('ING-030: a manual value with recordedAt updates that day, is logged (channel manual) and a retried submit is not written twice', async () => {
    if (!up) return;
    const team = 'golden-team-partial';
    const body = { teamId: team, recordedAt: `${day(3)}T14:00:00Z`, defect_escape_rate: 6.5 };
    const send = () => request(API_URL).post('/api/metrics/manual').set('Cookie', adminCookie).set('Idempotency-Key', 'manual-030').send(body);
    const first = await send();
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ snapshotDate: day(3), updated: ['defect_escape_rate'] });
    const d3 = await cell(team, day(3), 'defect_escape_rate');
    expect(d3.v).toBe(6.5);
    expect(d3.fs).toMatchObject({ source: 'manual', recorded_by: 'golden-u-admin' });
    const count = await valueCount(team);
    const again = await send();
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(await valueCount(team)).toBe(count);
    const { rows } = await db.query(`SELECT channel, status, actor_id FROM ingestion_log WHERE company_id = $1 AND idempotency_key = 'manual-030'`, [GOLDEN_COMPANY]);
    expect(rows).toEqual([{ channel: 'manual', status: 'accepted', actor_id: 'golden-u-admin' }]);
  });

  it('ING-031: manual entry by someone who may not write the team: 403, nothing written', async () => {
    if (!up) return;
    const engineer = (await login('small-2@golden.example')).cookie; // qa_engineer of Small Team
    const count = await valueCount('golden-team-small');
    const res = await request(API_URL).post('/api/metrics/manual').set('Cookie', engineer).send({ teamId: 'golden-team-small', test_coverage: 99 });
    expect(res.status).toBe(403);
    expect(await valueCount('golden-team-small')).toBe(count);
  });
});

describe('GET /api/ingestion-log (policy per role)', () => {
  let managerCookie = '';
  beforeAll(async () => {
    if (!up) return;
    // A QA manager of department B (Stale + Partial + Empty teams).
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, is_active, email_verified)
       SELECT 'golden-u-mgr', 'mgr@golden.example', password_hash, 'Morgan', 'Manager', 'qa_manager', $1, 'golden-dept-b', TRUE, TRUE
         FROM users WHERE id = 'golden-u-admin' ON CONFLICT (id) DO NOTHING`,
      [GOLDEN_COMPANY]
    );
    await db.query(
      `INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id)
       VALUES ('golden-ra-mgr', $1, 'golden-u-mgr', 'qa_manager', 'department', 'golden-dept-b') ON CONFLICT (id) DO NOTHING`,
      [GOLDEN_COMPANY]
    );
    managerCookie = (await login('mgr@golden.example')).cookie;
  });

  it('ING-040: super admin sees every entry of the company, with sources summary and entry detail', async () => {
    if (!up) return;
    const res = await get('/api/ingestion-log?limit=200', adminCookie);
    expect(res.status).toBe(200);
    const statuses = new Set(res.body.entries.map((e: any) => e.status));
    expect([...statuses].sort()).toEqual(['accepted', 'partial', 'rejected']);
    expect(res.body.entries.every((e: any) => e.channel === 'api' || e.channel === 'manual')).toBe(true);
    const partial = res.body.entries.find((e: any) => e.status === 'partial');
    expect(partial.api_key_name).toBe('Ingestion test key');
    const one = await get(`/api/ingestion-log/${partial.id}`, adminCookie);
    expect(one.status).toBe(200);
    expect(one.body.entry.errors.length).toBe(2);
    const sources = await get('/api/ingestion-log/sources', adminCookie);
    expect(sources.status).toBe(200);
    const jenkins = sources.body.sources.find((s: any) => s.source === 'jenkins');
    expect(jenkins.last_received_at).toBeTruthy();
    expect(jenkins.accepted_7d).toBeGreaterThan(0);
    const filtered = await get('/api/ingestion-log?status=rejected&channel=api', adminCookie);
    expect(filtered.body.entries.every((e: any) => e.status === 'rejected' && e.channel === 'api')).toBe(true);
  });

  it('ING-041: a QA manager sees only entries touching teams of the departments they manage', async () => {
    if (!up) return;
    const res = await get('/api/ingestion-log?limit=200', managerCookie);
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeGreaterThan(0);
    for (const e of res.body.entries) expect(e.department_ids).toContain('golden-dept-b');
    const adminAll = (await get('/api/ingestion-log?limit=200', adminCookie)).body.entries;
    const deptAOnly = adminAll.find((e: any) => e.department_ids.length && !e.department_ids.includes('golden-dept-b'));
    expect(deptAOnly).toBeTruthy();
    expect((await get(`/api/ingestion-log/${deptAOnly.id}`, managerCookie)).status).toBe(404);
  });

  it('ING-042: team leads, engineers and other companies are refused', async () => {
    if (!up) return;
    const lead = (await login('small-1@golden.example')).cookie;
    const engineer = (await login('small-2@golden.example')).cookie;
    expect((await get('/api/ingestion-log', lead)).status).toBe(403);
    expect((await get('/api/ingestion-log/sources', engineer)).status).toBe(403);
    expect((await get('/api/ingestion-log', '')).status).toBe(401);
    const foreign = (await login('alex.morgan@northwind.example')).cookie;
    if (foreign) {
      const res = await get('/api/ingestion-log?limit=200', foreign);
      expect(res.status).toBe(200);
      expect(res.body.entries.some((e: any) => (e.team_ids ?? []).some((t: string) => t.startsWith('golden-')))).toBe(false);
      const someGolden = (await get('/api/ingestion-log', adminCookie)).body.entries[0];
      expect((await get(`/api/ingestion-log/${someGolden.id}`, foreign)).status).toBe(404);
    }
  });
});
