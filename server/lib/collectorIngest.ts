/**
 * Values calculated by a customer's QE Navigator Collector (privacy modes evidence and metrics), received at
 * POST /api/ingest/collector/metrics, and its heartbeat (POST /api/ingest/collector/heartbeat).
 *
 * The Collector runs the shared engine (packages/engine) inside the customer's network and sends, per team and
 * UTC day, the metric values with their sample size, the time they are for, the numeric inputs (counts,
 * medians) and the engine version; in evidence mode also the evidence lists the app shows. Everything is
 * validated against a strict allow-list here (the Collector applies the same one before sending): an unknown
 * metric, field or evidence list is refused with the path of the offending value, a text in metrics mode is
 * refused, numbers must be finite and within range, days within 400 days and not in the future.
 *
 * Stored as metric_evidence rows with origin 'collector' (engine and Collector versions, privacy mode, local
 * evidence page) and, for the metrics with a KPI column, written through the one KPI write path
 * (recordKpiValues, source 'collector'), so dashboards, KPI history, alerts, targets, the QA score, forecasts,
 * recommendations, Business impact and TV mode use them exactly as values calculated here. A day's set
 * replaces the Collector values of that day (a metric without data any more is removed); the same set again
 * changes nothing (idempotent), and the Idempotency-Key of a retried request is answered from the log.
 */
import type pg from 'pg';
import { KPI_COLUMNS, recordKpiValues, type KpiColumn } from './kpiIngest';
import { METRICS, confidenceFor, ENGINE_VERSION } from './calc/engine';

export class CollectorValidationError extends Error {
  constructor(public errors: string[]) { super(errors[0] ?? 'Invalid body'); }
}

export type CollectorMode = 'evidence' | 'metrics';

export interface CollectorMetric { key: string; value: number; sampleSize: number; recordedAt: string; inputs: Record<string, number>; evidence: Record<string, unknown> | null }
export interface CollectorBody {
  collector: string;
  engineVersion: string;
  mode: CollectorMode;
  localEvidenceUrl: string | null;
  teams: Array<{ teamId: string; days: Array<{ day: string; metrics: CollectorMetric[] }>; evidence: (Record<string, unknown> & { asOf: string }) | null }>;
}

export const LIMITS = { teams: 50, daysPerTeam: 400, metricsPerDay: 40, values: 5000, inputs: 30, maxAgeDays: 400 };
const SEMVER = /^\d{1,4}\.\d{1,5}\.\d{1,6}$/;
const COLLECTOR = /^qe-collector\/(\d{1,4}\.\d{1,5}\.\d{1,6}[0-9A-Za-z.+-]{0,20})$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** One field's rule in an evidence item. */
type Field = { t: 'text'; max: number; optional?: boolean } | { t: 'num'; optional?: boolean } | { t: 'time'; optional?: boolean } | { t: 'texts'; max: number; items: number } | { t: 'enum'; values: string[] } | { t: 'list'; of: Record<string, Field>; items: number };

/** Evidence lists a metric may carry (evidence mode). */
export const METRIC_EVIDENCE: Record<string, Record<string, Field>> = {
  flaky_tests: { flakyTests: { t: 'list', items: 25, of: { name: { t: 'text', max: 1000 }, suite: { t: 'text', max: 500, optional: true }, commit: { t: 'text', max: 80, optional: true }, failedRuns: { t: 'num' }, passedRuns: { t: 'num' } } } },
  line_coverage: { lowestFiles: { t: 'list', items: 10, of: { path: { t: 'text', max: 1000 }, linesFound: { t: 'num' }, linesHit: { t: 'num' } } } },
  change_failure_rate: {
    failedDeployments: { t: 'list', items: 50, of: { deploymentId: { t: 'text', max: 200 }, reasons: { t: 'list', items: 10, of: { type: { t: 'enum', values: ['rolled_back', 'rollback', 'hotfix', 'incident', 'other'] }, ref: { t: 'text', max: 200, optional: true }, at: { t: 'time', optional: true } } } } },
  },
  escape_rate: { escaped: { t: 'texts', max: 200, items: 50 } },
};
METRIC_EVIDENCE.test_flakiness_rate = METRIC_EVIDENCE.flaky_tests;
METRIC_EVIDENCE.defect_density = METRIC_EVIDENCE.escape_rate;

/** The team's evidence panel (evidence mode). */
export const TEAM_EVIDENCE: Record<string, Field> = {
  flakyTests: { t: 'list', items: 20, of: { name: { t: 'text', max: 1000 }, suite: { t: 'text', max: 500, optional: true }, commits: { t: 'texts', max: 80, items: 5 }, failedRuns: { t: 'num' }, passedRuns: { t: 'num' }, lastSeen: { t: 'time', optional: true } } },
  lowestFiles: { t: 'list', items: 15, of: { path: { t: 'text', max: 1000 }, linesFound: { t: 'num' }, linesHit: { t: 'num' }, branchesFound: { t: 'num' }, branchesHit: { t: 'num' }, coverage: { t: 'num' } } },
  slowestStages: { t: 'list', items: 10, of: { name: { t: 'text', max: 255 }, runs: { t: 'num' }, medianSeconds: { t: 'num' }, maxSeconds: { t: 'num' } } },
  failingStages: { t: 'list', items: 10, of: { name: { t: 'text', max: 255 }, runs: { t: 'num' }, failed: { t: 'num' }, failureRate: { t: 'num' }, medianSeconds: { t: 'num', optional: true } } },
};

function checkFields(v: unknown, rules: Record<string, Field>, path: string, errors: string[]): Record<string, unknown> {
  if (!isObj(v)) { errors.push(`${path} must be an object`); return {}; }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) if (!rules[k]) errors.push(`${path}.${k} is not an allowed field (allowed: ${Object.keys(rules).join(', ')})`);
  for (const [k, r] of Object.entries(rules)) {
    const x = v[k];
    const p = `${path}.${k}`;
    if (x === undefined || x === null) {
      if (!('optional' in r && r.optional) && r.t !== 'list' && r.t !== 'texts') errors.push(`${p} is required`);
      continue;
    }
    switch (r.t) {
      case 'text':
        if (typeof x !== 'string' || !x.trim() || x.length > r.max) errors.push(`${p} must be a text of 1 to ${r.max} characters`);
        else if (EMAIL.test(x)) errors.push(`${p} contains an e-mail address`);
        else out[k] = x.trim();
        break;
      case 'num':
        if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1e9) errors.push(`${p} must be a number from 0`);
        else out[k] = x;
        break;
      case 'time':
        if (typeof x !== 'string' || Number.isNaN(Date.parse(x)) || x.length > 40) errors.push(`${p} must be an ISO 8601 time`);
        else out[k] = new Date(x).toISOString();
        break;
      case 'enum':
        if (typeof x !== 'string' || !r.values.includes(x)) errors.push(`${p} must be one of ${r.values.join(', ')}`);
        else out[k] = x;
        break;
      case 'texts':
        if (!Array.isArray(x) || x.length > r.items) errors.push(`${p} must be a list of at most ${r.items} texts`);
        else out[k] = x.map((s, i) => {
          if (typeof s !== 'string' || !s.trim() || s.length > r.max) { errors.push(`${p}[${i}] must be a text of 1 to ${r.max} characters`); return null; }
          if (EMAIL.test(s)) { errors.push(`${p}[${i}] contains an e-mail address`); return null; }
          return s.trim();
        }).filter(Boolean);
        break;
      case 'list':
        if (!Array.isArray(x) || x.length > r.items) errors.push(`${p} must be a list of at most ${r.items} items`);
        else out[k] = x.map((item, i) => checkFields(item, r.of, `${p}[${i}]`, errors));
        break;
    }
  }
  return out;
}

/** Validate and normalise a body; throws CollectorValidationError with every problem found (at most 50). */
export function validateCollectorBody(body: unknown, now = Date.now()): CollectorBody {
  const errors: string[] = [];
  const fail = () => { throw new CollectorValidationError(errors.slice(0, 50)); };
  if (!isObj(body)) { errors.push('The body must be a JSON object'); fail(); }
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b)) if (!['collector', 'engineVersion', 'mode', 'localEvidenceUrl', 'teams'].includes(k)) errors.push(`${k} is not an allowed field`);
  if (typeof b.collector !== 'string' || !COLLECTOR.test(b.collector)) errors.push('collector must be "qe-collector/<version>"');
  if (typeof b.engineVersion !== 'string' || !SEMVER.test(b.engineVersion)) errors.push('engineVersion must be a version such as 1.0.0');
  if (b.mode !== 'evidence' && b.mode !== 'metrics') errors.push('mode must be evidence or metrics (full mode sends raw records to the other ingestion endpoints)');
  const mode = b.mode as CollectorMode;
  let localEvidenceUrl: string | null = null;
  if (b.localEvidenceUrl !== undefined && b.localEvidenceUrl !== null) {
    try {
      const u = new URL(String(b.localEvidenceUrl));
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || String(b.localEvidenceUrl).length > 500) throw new Error();
      localEvidenceUrl = u.toString();
    } catch { errors.push('localEvidenceUrl must be an http(s) URL without credentials, at most 500 characters'); }
  }
  if (!Array.isArray(b.teams) || b.teams.length === 0 || b.teams.length > LIMITS.teams) { errors.push(`teams must list 1 to ${LIMITS.teams} teams`); fail(); }
  const today = new Date(now).toISOString().slice(0, 10);
  const oldest = new Date(now - LIMITS.maxAgeDays * 86_400_000).toISOString().slice(0, 10);
  let values = 0;
  const teams: CollectorBody['teams'] = [];
  (b.teams as unknown[]).forEach((t, ti) => {
    const tp = `teams[${ti}]`;
    if (!isObj(t)) { errors.push(`${tp} must be an object`); return; }
    for (const k of Object.keys(t)) if (!['teamId', 'days', 'evidence'].includes(k)) errors.push(`${tp}.${k} is not an allowed field`);
    if (typeof t.teamId !== 'string' || !/^[A-Za-z0-9_.:-]{1,36}$/.test(t.teamId)) errors.push(`${tp}.teamId must be a team id`);
    const days: CollectorBody['teams'][number]['days'] = [];
    const list = t.days === undefined ? [] : t.days;
    if (!Array.isArray(list) || list.length > LIMITS.daysPerTeam) errors.push(`${tp}.days must be a list of at most ${LIMITS.daysPerTeam} days`);
    else list.forEach((d, di) => {
      const dp = `${tp}.days[${di}]`;
      if (!isObj(d)) { errors.push(`${dp} must be an object`); return; }
      for (const k of Object.keys(d)) if (!['day', 'metrics'].includes(k)) errors.push(`${dp}.${k} is not an allowed field`);
      if (typeof d.day !== 'string' || !DAY_RE.test(d.day) || Number.isNaN(Date.parse(`${d.day}T00:00:00Z`))) { errors.push(`${dp}.day must be YYYY-MM-DD`); return; }
      if (d.day > today) errors.push(`${dp}.day ${d.day} is in the future`);
      if (d.day < oldest) errors.push(`${dp}.day ${d.day} is more than ${LIMITS.maxAgeDays} days ago`);
      if (!Array.isArray(d.metrics) || d.metrics.length > LIMITS.metricsPerDay) { errors.push(`${dp}.metrics must be a list of at most ${LIMITS.metricsPerDay}`); return; }
      const seen = new Set<string>();
      const metrics: CollectorMetric[] = [];
      d.metrics.forEach((m, mi) => {
        const mp = `${dp}.metrics[${mi}]`;
        if (!isObj(m)) { errors.push(`${mp} must be an object`); return; }
        for (const k of Object.keys(m)) if (!['key', 'value', 'sampleSize', 'recordedAt', 'inputs', 'evidence'].includes(k)) errors.push(`${mp}.${k} is not an allowed field`);
        const key = String(m.key);
        if (!METRICS[key]) { errors.push(`${mp}.key "${key.slice(0, 60)}" is not a metric QE Navigator calculates`); return; }
        if (seen.has(key)) errors.push(`${mp}.key ${key} is sent twice for ${d.day}`);
        seen.add(key);
        if (typeof m.value !== 'number' || !Number.isFinite(m.value) || Math.abs(m.value) > 1e9) errors.push(`${mp}.value must be a finite number`);
        const unit = METRICS[key].unit;
        if (unit === '%' && typeof m.value === 'number' && (m.value < 0 || m.value > 100)) errors.push(`${mp}.value must be from 0 to 100 (%)`);
        if (!Number.isInteger(m.sampleSize) || (m.sampleSize as number) < 0 || (m.sampleSize as number) > 1e9) errors.push(`${mp}.sampleSize must be a whole number from 0`);
        if (typeof m.recordedAt !== 'string' || !ISO.test(m.recordedAt)) errors.push(`${mp}.recordedAt must be an ISO 8601 UTC time`);
        else if (Date.parse(m.recordedAt) > now + 5 * 60_000) errors.push(`${mp}.recordedAt is in the future`);
        const inputs: Record<string, number> = {};
        if (m.inputs !== undefined) {
          if (!isObj(m.inputs) || Object.keys(m.inputs).length > LIMITS.inputs) errors.push(`${mp}.inputs must be an object of at most ${LIMITS.inputs} numbers`);
          else for (const [k, v] of Object.entries(m.inputs)) {
            if (!/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k)) errors.push(`${mp}.inputs.${k.slice(0, 40)} is not a valid name`);
            else if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${mp}.inputs.${k} must be a number (inputs are counts and figures; no text)`);
            else inputs[k] = v;
          }
        }
        let evidence: Record<string, unknown> | null = null;
        if (m.evidence !== undefined && m.evidence !== null) {
          if (mode !== 'evidence') errors.push(`${mp}.evidence is not allowed in metrics mode (values and counts only)`);
          else if (!METRIC_EVIDENCE[key]) errors.push(`${mp}.evidence is not allowed for ${key}`);
          else evidence = checkFields(m.evidence, METRIC_EVIDENCE[key], `${mp}.evidence`, errors);
        }
        values++;
        metrics.push({ key, value: m.value as number, sampleSize: m.sampleSize as number, recordedAt: String(m.recordedAt), inputs, evidence });
      });
      days.push({ day: d.day, metrics });
    });
    let evidence: CollectorBody['teams'][number]['evidence'] = null;
    if (t.evidence !== undefined && t.evidence !== null) {
      if (mode !== 'evidence') errors.push(`${tp}.evidence is not allowed in metrics mode`);
      else if (!isObj(t.evidence) || typeof t.evidence.asOf !== 'string' || !DAY_RE.test(t.evidence.asOf) || t.evidence.asOf > today) errors.push(`${tp}.evidence.asOf must be a day (YYYY-MM-DD), not in the future`);
      else {
        const { asOf, ...rest } = t.evidence as Record<string, unknown>;
        evidence = { asOf: asOf as string, ...checkFields(rest, TEAM_EVIDENCE, `${tp}.evidence`, errors) };
      }
    }
    teams.push({ teamId: String(t.teamId), days, evidence });
  });
  if (values > LIMITS.values) errors.push(`At most ${LIMITS.values} values per request (send several requests)`);
  if (errors.length) fail();
  return { collector: b.collector as string, engineVersion: b.engineVersion as string, mode, localEvidenceUrl, teams };
}

/** Store the values of a validated body for the teams given (already checked to belong to the key's company). Returns the KPI columns written per team. */
export async function storeCollectorValues(client: pg.PoolClient, companyId: string, body: CollectorBody, opts: { actorId: string | null; ingestionId: string | null; apiKeyId: string | null }): Promise<{ values: number; changed: number; kpis: Record<string, string[]> }> {
  const version = COLLECTOR.exec(body.collector)![1];
  let values = 0;
  let changed = 0;
  const kpis: Record<string, string[]> = {};
  for (const t of body.teams) {
    for (const d of t.days) {
      const prev = new Map((await client.query(
        `SELECT metric_key, value::float8 AS value, recorded_at, origin FROM metric_evidence WHERE team_id = $1 AND day = $2::date`, [t.teamId, d.day])).rows.map((r: any) => [r.metric_key, r]));
      const kpiValues: Record<string, number> = {};
      let recordedAt = '';
      for (const m of d.metrics) {
        const spec = METRICS[m.key];
        values++;
        const r = await client.query(
          `INSERT INTO metric_evidence (company_id, team_id, day, metric_key, value, unit, formula, inputs, sources, sample_size, confidence, kpi_column, recorded_at, computed_at,
                                        origin, engine_version, collector_version, privacy_mode, local_evidence_url)
           VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13::timestamptz, now(), 'collector', $14, $15, $16, $17)
           ON CONFLICT (team_id, day, metric_key) DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit, formula = EXCLUDED.formula, inputs = EXCLUDED.inputs,
             sources = EXCLUDED.sources, sample_size = EXCLUDED.sample_size, confidence = EXCLUDED.confidence, kpi_column = EXCLUDED.kpi_column, recorded_at = EXCLUDED.recorded_at,
             computed_at = now(), origin = 'collector', engine_version = EXCLUDED.engine_version, collector_version = EXCLUDED.collector_version,
             privacy_mode = EXCLUDED.privacy_mode, local_evidence_url = EXCLUDED.local_evidence_url
           WHERE metric_evidence.value IS DISTINCT FROM EXCLUDED.value OR metric_evidence.inputs IS DISTINCT FROM EXCLUDED.inputs OR metric_evidence.sources IS DISTINCT FROM EXCLUDED.sources
              OR metric_evidence.sample_size IS DISTINCT FROM EXCLUDED.sample_size OR metric_evidence.recorded_at IS DISTINCT FROM EXCLUDED.recorded_at
              OR metric_evidence.origin <> 'collector' OR metric_evidence.engine_version IS DISTINCT FROM EXCLUDED.engine_version
              OR metric_evidence.privacy_mode IS DISTINCT FROM EXCLUDED.privacy_mode OR metric_evidence.local_evidence_url IS DISTINCT FROM EXCLUDED.local_evidence_url
           RETURNING id`,
          [companyId, t.teamId, d.day, m.key, m.value, spec.unit, spec.formula, JSON.stringify(m.inputs), JSON.stringify(m.evidence ?? {}), m.sampleSize, confidenceFor(m.sampleSize), spec.kpi,
            m.recordedAt, body.engineVersion, version, body.mode, body.mode === 'metrics' ? body.localEvidenceUrl : null]);
        if (r.rowCount) changed++;
        const old = prev.get(m.key);
        const valueChanged = !old || Number(old.value) !== Math.round(m.value * 10000) / 10000 || new Date(old.recorded_at).toISOString() !== new Date(m.recordedAt).toISOString() || old.origin !== 'collector';
        if (spec.kpi && valueChanged) {
          const range = KPI_COLUMNS[spec.kpi as KpiColumn];
          kpiValues[spec.kpi] = Math.min(range.max, Math.max(range.min, m.value));
          if (m.recordedAt > recordedAt) recordedAt = m.recordedAt;
        }
      }
      // The day's set replaces the Collector values of that day: a metric without data any more is removed.
      const del = await client.query(`DELETE FROM metric_evidence WHERE team_id = $1 AND day = $2::date AND origin = 'collector' AND NOT (metric_key = ANY($3::text[]))`, [t.teamId, d.day, d.metrics.map((m) => m.key)]);
      changed += del.rowCount ?? 0;
      if (Object.keys(kpiValues).length) {
        const at = new Date(Math.min(Date.parse(recordedAt), Date.now()));
        await recordKpiValues(t.teamId, kpiValues, { source: 'collector', recordedAt: at, client, notify: false, actorId: opts.actorId, ingestionId: opts.ingestionId });
        kpis[t.teamId] = Array.from(new Set([...(kpis[t.teamId] ?? []), ...Object.keys(kpiValues)]));
      }
    }
    if (t.evidence) {
      const { asOf, ...payload } = t.evidence;
      await client.query(
        `INSERT INTO collector_evidence (team_id, company_id, as_of, engine_version, collector_version, payload, api_key_id, received_at)
         VALUES ($1, $2, $3::date, $4, $5, $6::jsonb, $7, now())
         ON CONFLICT (team_id) DO UPDATE SET company_id = EXCLUDED.company_id, as_of = EXCLUDED.as_of, engine_version = EXCLUDED.engine_version, collector_version = EXCLUDED.collector_version,
           payload = EXCLUDED.payload, api_key_id = EXCLUDED.api_key_id, received_at = now()`,
        [t.teamId, companyId, asOf, body.engineVersion, version, JSON.stringify(payload), opts.apiKeyId]);
    }
  }
  return { values, changed, kpis };
}

export interface HeartbeatBody { collector: string; version: string; engineVersion: string; mode: 'full' | 'evidence' | 'metrics'; localEvidenceUrl: string | null; sources: Array<Record<string, unknown>>; details: Record<string, unknown> }

/** Validate a heartbeat: versions, mode, the sources with their status (no data). */
export function validateHeartbeat(body: unknown): HeartbeatBody {
  const errors: string[] = [];
  if (!isObj(body)) throw new CollectorValidationError(['The body must be a JSON object']);
  const b = body;
  const allowed = ['collector', 'version', 'engineVersion', 'mode', 'localEvidenceUrl', 'node', 'platform', 'sources', 'teams', 'store'];
  for (const k of Object.keys(b)) if (!allowed.includes(k)) errors.push(`${k} is not an allowed field`);
  if (typeof b.collector !== 'string' || !COLLECTOR.test(b.collector)) errors.push('collector must be "qe-collector/<version>"');
  if (typeof b.version !== 'string' || !SEMVER.test(b.version)) errors.push('version must be a version such as 0.2.0');
  if (typeof b.engineVersion !== 'string' || !SEMVER.test(b.engineVersion)) errors.push('engineVersion must be a version');
  if (!['full', 'evidence', 'metrics'].includes(String(b.mode))) errors.push('mode must be full, evidence or metrics');
  let localEvidenceUrl: string | null = null;
  if (b.localEvidenceUrl !== undefined && b.localEvidenceUrl !== null) {
    try { const u = new URL(String(b.localEvidenceUrl)); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || String(b.localEvidenceUrl).length > 500) throw new Error(); localEvidenceUrl = u.toString(); } catch { errors.push('localEvidenceUrl must be an http(s) URL'); }
  }
  const types = ['jira', 'linear', 'pagerduty', 'opsgenie', 'github', 'gitlab', 'jenkins', 'azure-devops', 'sonarqube'];
  const sources: Array<Record<string, unknown>> = [];
  if (!Array.isArray(b.sources) || b.sources.length > 100) errors.push('sources must be a list of at most 100');
  else b.sources.forEach((s, i) => {
    if (!isObj(s)) { errors.push(`sources[${i}] must be an object`); return; }
    for (const k of Object.keys(s)) if (!['name', 'type', 'lastSuccessAt', 'errors', 'lastErrorAt', 'lastErrorKind'].includes(k)) errors.push(`sources[${i}].${k} is not an allowed field`);
    if (typeof s.name !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,49}$/.test(s.name)) errors.push(`sources[${i}].name must be a source name`);
    if (!types.includes(String(s.type))) errors.push(`sources[${i}].type must be one of ${types.join(', ')}`);
    const time = (v: unknown, f: string) => { if (v === null || v === undefined) return null; if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) { errors.push(`sources[${i}].${f} must be an ISO time`); return null; } return new Date(v).toISOString(); };
    const n = Number(s.errors ?? 0);
    if (!Number.isInteger(n) || n < 0 || n > 1e6) errors.push(`sources[${i}].errors must be a whole number`);
    const kind = s.lastErrorKind === null || s.lastErrorKind === undefined ? null : String(s.lastErrorKind);
    if (kind !== null && !/^(auth|network|http \d{3}|qe-navigator|config|internal)$/.test(kind)) errors.push(`sources[${i}].lastErrorKind is not a known kind`);
    sources.push({ name: s.name, type: s.type, lastSuccessAt: time(s.lastSuccessAt, 'lastSuccessAt'), errors: n, lastErrorAt: time(s.lastErrorAt, 'lastErrorAt'), lastErrorKind: kind });
  });
  const store = isObj(b.store) ? { records: Number(b.store.records) || 0, files: Number(b.store.files) || 0, bytes: Number(b.store.bytes) || 0 } : null;
  const details = { node: typeof b.node === 'string' ? b.node.slice(0, 20) : null, platform: typeof b.platform === 'string' ? b.platform.slice(0, 20) : null, teams: Number(b.teams) || 0, store };
  if (errors.length) throw new CollectorValidationError(errors.slice(0, 50));
  return { collector: b.collector as string, version: b.version as string, engineVersion: b.engineVersion as string, mode: b.mode as HeartbeatBody['mode'], localEvidenceUrl, sources, details };
}

/** The latest Collector release and engine version this server knows (an older Collector is shown as outdated). */
export const LATEST_COLLECTOR_VERSION = '0.2.0';
export const CURRENT_ENGINE_VERSION = ENGINE_VERSION;

const cmp = (a: string, b: string) => { const x = a.split('.').map(Number); const y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return 0; };
export const isOutdated = (version: string, engine: string) => cmp(version, LATEST_COLLECTOR_VERSION) < 0 || cmp(engine, CURRENT_ENGINE_VERSION) < 0;
