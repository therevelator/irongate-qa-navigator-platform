/**
 * The calculation does not depend on the order the data arrived in (server/lib/calc/dependents.ts). For every metric
 * that combines records of two kinds, the same records sent in one order to one team and in the other order to
 * another team give the same values on the same days (metric_evidence: day, metric, value and inputs), after the
 * calculation queue drained. Run against the live API (API_URL) and the local database.
 *
 *   OI-001  issues and coverage: defect density (and every work metric)
 *   OI-002  SARIF without lines of code and coverage: the code quality score (and every quality metric)
 *   OI-003  deployments and incidents: change failure rate, MTTR, availability, MTBF, incidents per deploy,
 *           infrastructure failures, deployment frequency
 *   OI-004  deployments and commits: lead time for changes
 *   OI-005  pipeline runs and test reports: first-time pass rate (and every CI metric)
 *   OI-006  an outage still open and a deployment 38 days later (beyond the 28-day window): availability and
 *           incidents per deploy on the deployment's days
 *
 * The inputs are the documented examples (docs/examples/ingest), moved to today like ingest-examples.test.ts does.
 */
import fs from 'fs';
import path from 'path';
import type { Client } from 'pg';
import { API_URL, backendUp, localDb, login, post } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';
import { METRICS } from '../../packages/engine/src/calc/metrics';

const EX = path.join(__dirname, '..', '..', 'docs', 'examples', 'ingest');
const DEPT = 'golden-dept-b';
const DAY = 86_400_000;
const SHIFT = Math.floor((Date.now() - Date.parse('2026-11-23T00:00:00Z')) / DAY);
const shiftDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + SHIFT * DAY).toISOString().slice(0, 10);
const TS = /\b(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})?/g;

function load(kind: string, team: string): any {
  const text = fs.readFileSync(path.join(EX, `${kind}.json`), 'utf8')
    .replace(/<companyId>/g, GOLDEN_COMPANY).replace(/<departmentId>/g, DEPT).replace(/<teamId>/g, team)
    .replace(TS, (_m, d, t, z) => `${shiftDay(d)}T${t}${z ?? ''}`);
  return JSON.parse(text);
}
/** The SARIF example without any lines of code (item loc and the SARIF run properties): the score uses the coverage. */
function sarifWithoutLoc(team: string): any {
  const env = load('sarif', team);
  for (const it of env.items) {
    delete it.loc;
    for (const f of it.files) {
      const doc = JSON.parse(f.content);
      for (const r of doc.runs ?? []) if (r.properties) { delete r.properties.linesOfCode; delete r.properties.ncloc; delete r.properties.metrics; }
      f.content = JSON.stringify(doc);
    }
  }
  return env;
}

let up = true;
let db: Client;
let apiKey = '';
const CASES = ['oi-work', 'oi-quality', 'oi-delivery', 'oi-lead', 'oi-ci', 'oi-outage'];
const teamsOf = (c: string) => [`golden-team-${c}-a`, `golden-team-${c}-b`];

async function send(body: unknown) {
  const r = await fetch(`${API_URL}/api/ingest/exporter/batch`, {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'qe-exporter/0.3.0 (order test)' }, body: JSON.stringify(body),
  });
  const out = await r.json() as any;
  expect({ status: r.status, kind: (body as any).kind, rejected: out.rejected ?? out.error }).toEqual({ status: 201, kind: (body as any).kind, rejected: 0 });
}

async function drained(teams: string[]) {
  const until = Date.now() + 240_000;
  for (;;) {
    const [q] = (await db.query(`SELECT COUNT(*) FILTER (WHERE status IN ('pending', 'running'))::int AS waiting, COUNT(*) FILTER (WHERE status = 'failed')::int AS failed FROM calc_queue WHERE team_id = ANY($1::text[])`, [teams])).rows;
    expect(q.failed).toBe(0);
    if (q.waiting === 0) return;
    if (Date.now() > until) throw new Error(`calc_queue still has ${q.waiting} entries`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** The evidence of a team for the given metrics: day|metric → value and inputs. */
async function evidence(team: string, keys: string[]): Promise<Record<string, unknown>> {
  const rows = (await db.query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, metric_key, value::float8 AS value, inputs FROM metric_evidence WHERE team_id = $1 AND metric_key = ANY($2::text[]) ORDER BY 1, 2`, [team, keys])).rows;
  return Object.fromEntries(rows.map((r: any) => [`${r.day}|${r.metric_key}`, { value: r.value, inputs: r.inputs }]));
}

/** Send `first` then `second` to team a, `second` then `first` to team b; the evidence of `keys` must be the same. */
async function bothOrders(c: string, kinds: Array<(team: string) => any>, keys: string[], mustHave: string[]) {
  const [a, b] = teamsOf(c);
  for (const k of kinds) await send(k(a));
  for (const k of [...kinds].reverse()) await send(k(b));
  await drained([a, b]);
  const ea = await evidence(a, keys);
  const eb = await evidence(b, keys);
  for (const m of mustHave) expect({ m, days: Object.keys(ea).filter((x) => x.endsWith(`|${m}`)).length > 0 }).toEqual({ m, days: true });
  expect(eb).toEqual(ea);
}
const groupKeys = (g: string) => Object.values(METRICS).filter((m) => (m.group ?? 'ci') === g).map((m) => m.key);

beforeAll(async () => {
  up = await backendUp();
  if (!up) { console.warn('Backend not running - order tests skipped'); return; }
  db = await localDb();
  await createGolden(db);
  for (const c of CASES) for (const id of teamsOf(c)) {
    await db.query(`INSERT INTO teams (id, company_id, department_id, name, is_active) VALUES ($1, $2, $3, $4, true)`, [id, GOLDEN_COMPANY, DEPT, `Order ${id.slice(12)}`]);
  }
  const cookie = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  apiKey = (await post('/api/admin/api-keys', cookie, { name: 'Order test key' })).body.plaintextKey;
}, 60_000);

afterAll(async () => {
  if (db) {
    await db.query(`DELETE FROM calc_queue_kicks WHERE company_id = $1`, [GOLDEN_COMPANY]).catch(() => undefined);
    await removeGolden(db);
    await db.end();
  }

});

describe('the order of arrival does not change any value', () => {
  it('OI-001 issues then coverage = coverage then issues (defect density and every work metric)', async () => {
    if (!up) return;
    await bothOrders('oi-work', [(t) => load('issues', t), (t) => load('coverage', t)], groupKeys('work'), ['defect_density', 'escape_rate']);
  }, 300_000);

  it('OI-002 SARIF (no lines of code) then coverage = coverage then SARIF (code quality score)', async () => {
    if (!up) return;
    await bothOrders('oi-quality', [(t) => sarifWithoutLoc(t), (t) => load('coverage', t)], groupKeys('quality'), ['code_quality', 'findings']);
  }, 300_000);

  it('OI-003 deployments then incidents = incidents then deployments (change failure rate, MTTR, availability, MTBF, …)', async () => {
    if (!up) return;
    await bothOrders('oi-delivery', [(t) => load('deployments', t), (t) => load('incidents', t)], groupKeys('delivery'),
      ['change_failure_rate', 'mttr', 'availability', 'deployment_frequency', 'incidents_per_deploy', 'infrastructure_failures']);
  }, 300_000);

  it('OI-004 deployments then commits = commits then deployments (lead time)', async () => {
    if (!up) return;
    await bothOrders('oi-lead', [(t) => load('deployments', t), (t) => load('commits', t)], groupKeys('delivery'), ['lead_time', 'deployment_frequency']);
  }, 300_000);

  it('OI-005 pipeline runs then test reports = test reports then pipeline runs (first-time pass rate and every CI metric)', async () => {
    if (!up) return;
    await bothOrders('oi-ci', [(t) => load('pipeline-runs', t), (t) => load('test-report', t)], groupKeys('ci'), ['first_time_pass_rate', 'pass_rate', 'pipeline_success_rate']);
  }, 300_000);

  it('OI-006 an open outage then a deployment 38 days later = the deployment then the outage (availability beyond the window)', async () => {
    if (!up) return;
    const at = (daysAgo: number, h = 10) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10) + `T${String(h).padStart(2, '0')}:00:00Z`;
    const env = (team: string, kind: string, items: unknown[]) => ({ companyId: GOLDEN_COMPANY, departmentId: DEPT, teamId: team, source: 'order-test', kind, items });
    const incident = (t: string) => env(t, 'incidents', [{ id: 'INC-OPEN-1', severity: 'critical', service: 'payments', status: 'open', openedAt: at(40), category: 'infrastructure' }]);
    const deploy = (t: string) => env(t, 'deployments', [{ id: 'dep-late-1', environment: 'production', service: 'payments', commit: 'abc1234def', finishedAt: at(2), result: 'success' }]);
    await bothOrders('oi-outage', [incident, deploy], groupKeys('delivery'), ['availability', 'incidents_per_deploy', 'deployment_frequency']);
  }, 300_000);
});
