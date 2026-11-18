import fs from 'fs';
import path from 'path';
import type { Client } from 'pg';
import { backendUp, get, localDb, login } from './helpers/http';
import { createGolden, removeGolden, normaliseDates, GOLDEN_ADMIN_EMAIL, GOLDEN_TEAMS } from './helpers/goldenFixture';

/**
 * Golden outputs of every number the app derives from team KPIs, for a fixed dataset
 * (tests/api/helpers/goldenFixture.ts): the company summary, GET /api/teams (kpiData, qaScore),
 * team detail, KPI history and the TV payload.
 *
 * tests/api/golden/baseline.json was recorded with the code BEFORE metric storage changed
 * (GOLDEN_RECORD=1). Since then every difference must be listed, with its reason, in
 * tests/api/golden/expected-changes.json (staleness exclusions, team-size weighted aggregates,
 * target history); fields that were only added (confidence, staleness, distribution, targets,
 * sample data) are checked in GOLD-002. GOLDEN_DIFF=1 writes the current diff to
 * golden/diff.local.json. Runs against a live backend at API_URL; skips cleanly when none is running.
 */

const GOLDEN_DIR = path.join(__dirname, 'golden');
const BASELINE = path.join(GOLDEN_DIR, 'baseline.json');
const EXPECTED = path.join(GOLDEN_DIR, 'expected-changes.json');

export async function collectGoldenOutputs(cookie: string, today: string) {
  const ids = GOLDEN_TEAMS.filter((t) => t !== 'golden-team-inactive');
  const summary = (await get('/api/analytics/company-summary', cookie)).body;
  const teamsRes = (await get('/api/teams', cookie)).body;
  const teams: Record<string, unknown> = {};
  // updated_at of a team row is the wall-clock time the fixture was written: not an output.
  for (const t of teamsRes.teams ?? []) { delete t.updated_at; teams[t.id] = t; }
  const detail: Record<string, unknown> = {};
  const history: Record<string, unknown> = {};
  const tv: Record<string, unknown> = {};
  for (const id of ids) {
    const d = (await get(`/api/teams/${id}`, cookie)).body.team;
    if (d) delete d.updated_at;
    detail[id] = d;
    history[id] = (await get(`/api/teams/${id}/kpi-history?days=30`, cookie)).body;
    const tvBody = (await get(`/api/tv/teams/${id}`, cookie)).body;
    delete tvBody.generatedAt;
    tv[id] = tvBody;
  }
  return normaliseDates({ summary, teams, detail, history, tv }, today) as any;
}

/** Fields added by the metric-storage phase (confidence, staleness, targets, sample data): additive, checked separately. */
const ADDED_TEAM_FIELDS = ['qaScoreConfidence', 'qaScoreRecorded', 'kpiStaleness', 'kpiThresholds', 'kpiTargets', 'staleKpis', 'sampleData', 'membersHidden'];
const ADDED_SUMMARY_FIELDS = ['globalQaScoreConfidence', 'globalQaScoreDistribution', 'engineeringHealthConfidence', 'deliveryPerformanceConfidence', 'kpiAveragesUnweighted', 'sampleData'];

/** A copy of the outputs without the added fields, to compare with the baseline. */
export function withoutAddedFields(o: any): any {
  const c = JSON.parse(JSON.stringify(o));
  for (const k of ADDED_SUMMARY_FIELDS) delete c.summary[k];
  for (const t of c.summary.kpiStatusTeams ?? []) {
    delete t.qaScoreConfidence;
    for (const ch of t.checks ?? []) delete ch.stale;
  }
  for (const group of [c.teams, c.detail]) {
    for (const t of Object.values<any>(group)) {
      if (!t) continue;
      for (const k of ADDED_TEAM_FIELDS) delete t[k];
      for (const m of t.metrics ?? []) { delete m.stale; delete m.staleSince; }
    }
  }
  for (const h of Object.values<any>(c.history)) { delete h.qaConfidence; delete h.targets; }
  for (const t of Object.values<any>(c.tv)) {
    delete t.targets; delete t.qaConfidence;
    if (t.latest) for (const k of ['qaScoreConfidence', 'kpiStaleness', 'kpiThresholds']) delete t.latest[k];
  }
  return c;
}

/** Path-level differences between two JSON values ("a.b[2].c: before -> after"). */
export function diffPaths(a: any, b: any, path = ''): Array<{ path: string; before: any; after: any }> {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = Array.isArray(a) ? Array.from({ length: Math.max(a.length, b.length) }, (_, i) => i) : Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
    return keys.flatMap((k) => diffPaths(a[k as any], b[k as any], Array.isArray(a) ? `${path}[${k}]` : path ? `${path}.${k}` : String(k)));
  }
  return [{ path, before: a, after: b }];
}

describe('Golden outputs for a fixed dataset', () => {
  let db: Client;
  let up = true;
  let cookie = '';
  let today = '';

  beforeAll(async () => {
    up = await backendUp();
    if (!up) return;
    db = await localDb();
    await createGolden(db);
    today = (await db.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`)).rows[0].d;
    cookie = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  });

  afterAll(async () => {
    if (db) {
      await removeGolden(db);
      await db.end();
    }
  });

  it('GOLD-001: records or matches the baseline outputs', async () => {
    if (!up) return;
    expect(cookie).not.toBe('');
    const outputs = await collectGoldenOutputs(cookie, today);
    if (process.env.GOLDEN_RECORD === '1') {
      fs.mkdirSync(GOLDEN_DIR, { recursive: true });
      fs.writeFileSync(BASELINE, JSON.stringify(outputs, null, 2) + '\n');
      return;
    }
    const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const diffs = diffPaths(baseline, withoutAddedFields(outputs));
    if (process.env.GOLDEN_DIFF === '1') {
      fs.writeFileSync(path.join(GOLDEN_DIR, 'diff.local.json'), JSON.stringify(diffs, null, 2));
      fs.writeFileSync(path.join(GOLDEN_DIR, 'outputs.local.json'), JSON.stringify(outputs, null, 2));
    }
    // Every difference from the baseline must be one of the documented, intentional changes
    // (golden/expected-changes.json: staleness exclusions, team-size weighting, target history),
    // and every documented change must happen.
    const expected: Array<{ path: string; before: any; after: any; reason: string }> = JSON.parse(fs.readFileSync(EXPECTED, 'utf8'));
    const absent = (v: any) => (v === undefined ? '<absent>' : v);
    const actual = diffs.map((d) => ({ path: d.path, before: absent(d.before), after: absent(d.after) }));
    expect(actual).toEqual(expected.map(({ reason: _r, ...rest }) => rest));
    expect(expected.every((e) => e.reason.length > 20)).toBe(true);
  });

  it('GOLD-002: confidence, staleness, distribution and sample-data fields', async () => {
    if (!up) return;
    const o = await collectGoldenOutputs(cookie, today);
    // QA score: stale inputs left out, with what it is based on.
    expect(o.teams['golden-team-big'].qaScoreConfidence).toEqual({ value: 93, inputsUsed: 4, inputsTotal: 4, confidence: 'high', staleInputs: [], missingInputs: [] });
    expect(o.teams['golden-team-partial'].qaScoreConfidence).toEqual({ value: 85, inputsUsed: 3, inputsTotal: 4, confidence: 'medium', staleInputs: ['defect_escape_rate'], missingInputs: [] });
    expect(o.teams['golden-team-stale'].qaScoreConfidence).toEqual({ value: null, inputsUsed: 2, inputsTotal: 4, confidence: 'low', staleInputs: ['test_coverage', 'defect_escape_rate'], missingInputs: [] });
    expect(o.teams['golden-team-stale'].qaScoreRecorded).toBe(80);
    expect(o.teams['golden-team-empty'].qaScoreConfidence).toBeNull();
    expect(o.detail['golden-team-partial'].qaScoreConfidence).toEqual(o.teams['golden-team-partial'].qaScoreConfidence);
    expect(o.tv['golden-team-partial'].latest.qaScoreConfidence).toEqual(o.teams['golden-team-partial'].qaScoreConfidence);
    // Staleness of each value: recorded_at + expected interval.
    expect(o.teams['golden-team-stale'].kpiStaleness.testCoverage).toEqual({ recordedAt: 'D-12T00:00:00.000Z', stale: true, staleSince: 'D-11T00:00:00.000Z', source: 'sonarqube' });
    expect(o.teams['golden-team-stale'].kpiStaleness.changeFailureRate.stale).toBe(false);
    expect(o.teams['golden-team-stale'].metrics[0]).toMatchObject({ status: null, stale: true, staleSince: 'D-11T00:00:00.000Z' });
    expect(o.teams['golden-team-partial'].staleKpis).toEqual(['defectEscapeRate']);
    // Company aggregates: weighted mean with the distribution; confidence = teams with a current score.
    expect(o.summary.globalQaScoreConfidence).toEqual({ value: 88, inputsUsed: 3, inputsTotal: 5, confidence: 'medium' });
    expect(o.summary.globalQaScoreDistribution).toMatchObject({ weightedMean: 88.3, unweightedMean: 86.3, median: 85, p25: 83, min: 81, count: 3 });
    expect(o.summary.engineeringHealthConfidence).toMatchObject({ inputsTotal: 4 });
    expect(o.summary.kpiAveragesUnweighted).toEqual({ avgTestCoverage: 82, avgDefectEscapeRate: 8, automationCoverage: 71.3, avgFlakinessRate: 2.7 });
    // History: the QA score basis per day and the target periods (no stored targets: defaults).
    const hist = o.history['golden-team-stale'];
    // Coverage (daily) is stale from D-11, the escape rate (weekly) from D-5: staleness as of each day.
    expect(hist.qaConfidence.find((d: any) => d.date === 'D-12')).toMatchObject({ inputsUsed: 4, staleInputs: [] });
    expect(hist.qaConfidence.find((d: any) => d.date === 'D-11')).toMatchObject({ inputsUsed: 3, staleInputs: ['test_coverage'] });
    expect(hist.qaConfidence.find((d: any) => d.date === 'D-5')).toMatchObject({ inputsUsed: 2, staleInputs: ['test_coverage', 'defect_escape_rate'] });
    expect(hist.targets.test_coverage).toEqual([{ validFrom: 'D-20T00:00:00.000Z', validTo: null, good: 80, warning: 70, scope: 'default' }]);
    // Sample data: from field_sources source 'synthetic', not from the company name.
    expect(o.teams['golden-team-big'].sampleData).toBe(true);
    expect(o.teams['golden-team-small'].sampleData).toBe(false);
    expect(o.summary.sampleData).toBe(true);
    expect(o.tv['golden-team-big'].latest.sampleData).toBe(true);
  });
});
