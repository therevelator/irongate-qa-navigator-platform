/**
 * Load-test result files, read as they are written by the tools (no value is taken from the sender):
 *
 *   k6       the summary JSON (`k6 run --summary-export=summary.json`, or handleSummary's data):
 *            metrics.http_req_duration (med, p(95), p(99)), metrics.http_reqs (count, rate),
 *            metrics.http_req_failed (rate / value / fails). One row: "(all requests)".
 *   JMeter   statistics.json of the HTML dashboard report (`jmeter -g results.jtl -o report/`):
 *            per label sampleCount, errorCount, errorPct, medianResTime, pct2ResTime (95), pct3ResTime (99),
 *            throughput (per second). "Total" becomes "(all requests)".
 *   Gatling  js/stats.json (or js/global_stats.json) of the report: per request numberOfRequests (total, ko),
 *            percentiles1 (50), percentiles3 (95), percentiles4 (99), meanNumberOfRequestsPerSecond.
 *
 * Each file gives one row per endpoint (request name): requests, errors, p50 / p95 / p99 in milliseconds,
 * throughput per minute and error rate (%). A percentile the file does not hold stays empty.
 */
export type PerfTool = 'k6' | 'jmeter' | 'gatling';
export interface PerfRow { endpoint: string; requests: number | null; errors: number | null; p50: number | null; p95: number | null; p99: number | null; throughputPerMinute: number | null; errorRate: number | null }
export interface ParsedPerf { tool: PerfTool; rows: PerfRow[] }

export class PerfReportError extends Error {}

export const ALL_REQUESTS = '(all requests)';
const MAX_ROWS = 500;

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const nonNeg = (v: unknown): number | null => { const n = num(v); return n !== null && n >= 0 ? n : null; };
const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
const name = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 500);

function k6(doc: Record<string, any>): PerfRow[] {
  const m = doc.metrics;
  const d = isObj(m.http_req_duration?.values) ? m.http_req_duration.values : m.http_req_duration;
  const reqs = isObj(m.http_reqs?.values) ? m.http_reqs.values : m.http_reqs ?? {};
  const failed = isObj(m.http_req_failed?.values) ? m.http_req_failed.values : m.http_req_failed ?? {};
  const requests = nonNeg(reqs.count);
  // http_req_failed is a rate: "value" / "rate" is the share of failed requests; "passes" counts the failures.
  const share = nonNeg(failed.rate ?? failed.value);
  const errors = nonNeg(failed.passes) ?? (share !== null && requests !== null ? Math.round(share * requests) : null);
  const rate = nonNeg(reqs.rate);
  return [{
    endpoint: ALL_REQUESTS, requests, errors, p50: r2(nonNeg(d.med ?? d['p(50)'])), p95: r2(nonNeg(d['p(95)'])), p99: r2(nonNeg(d['p(99)'])),
    throughputPerMinute: rate !== null ? r2(rate * 60) : null,
    errorRate: share !== null ? r2(Math.min(100, share * 100)) : errors !== null && requests ? r2((errors / requests) * 100) : null,
  }];
}

function jmeter(doc: Record<string, any>): PerfRow[] {
  return Object.values(doc).filter((s) => isObj(s) && 'sampleCount' in s).slice(0, MAX_ROWS).map((s: any) => {
    const requests = nonNeg(s.sampleCount);
    const errors = nonNeg(s.errorCount);
    const tps = nonNeg(s.throughput);
    return {
      endpoint: s.transaction === 'Total' ? ALL_REQUESTS : name(s.transaction) || ALL_REQUESTS, requests, errors,
      p50: r2(nonNeg(s.medianResTime)), p95: r2(nonNeg(s.pct2ResTime)), p99: r2(nonNeg(s.pct3ResTime)),
      throughputPerMinute: tps !== null ? r2(tps * 60) : null,
      errorRate: nonNeg(s.errorPct) !== null ? r2(Math.min(100, nonNeg(s.errorPct) as number)) : errors !== null && requests ? r2((errors / requests) * 100) : null,
    };
  });
}

function gatling(doc: Record<string, any>): PerfRow[] {
  const out: PerfRow[] = [];
  const row = (label: string, s: Record<string, any>) => {
    const requests = nonNeg(s.numberOfRequests?.total);
    const errors = nonNeg(s.numberOfRequests?.ko);
    const tps = nonNeg(s.meanNumberOfRequestsPerSecond?.total);
    out.push({
      endpoint: label, requests, errors, p50: r2(nonNeg(s.percentiles1?.total)), p95: r2(nonNeg(s.percentiles3?.total)), p99: r2(nonNeg(s.percentiles4?.total)),
      throughputPerMinute: tps !== null ? r2(tps * 60) : null, errorRate: errors !== null && requests ? r2((errors / requests) * 100) : requests === 0 ? null : errors === 0 ? 0 : null,
    });
  };
  const walk = (node: Record<string, any>, top: boolean) => {
    if (isObj(node.stats) && out.length < MAX_ROWS) row(top ? ALL_REQUESTS : name(node.name ?? node.stats.name) || ALL_REQUESTS, node.stats);
    for (const c of Object.values(isObj(node.contents) ? node.contents : {})) if (isObj(c)) walk(c, false);
  };
  if (isObj(doc.stats) || isObj(doc.contents)) walk(doc, true);
  else row(ALL_REQUESTS, doc); // global_stats.json: the stats object itself
  return out;
}

/** The tool a result file comes from, by its content (not its name); null when it is none of them. */
export function detectPerfTool(doc: unknown): PerfTool | null {
  if (!isObj(doc)) return null;
  if (isObj(doc.metrics) && isObj(doc.metrics.http_req_duration)) return 'k6';
  if (Object.values(doc).some((s) => isObj(s) && 'sampleCount' in s && 'medianResTime' in s)) return 'jmeter';
  if ((isObj(doc.stats) && isObj(doc.stats.numberOfRequests)) || (isObj(doc.numberOfRequests) && isObj(doc.percentiles1))) return 'gatling';
  return null;
}

export function parsePerfReport(content: string, where = 'the file'): ParsedPerf {
  let doc: unknown;
  try { doc = JSON.parse(content); } catch { throw new PerfReportError(`${where} is not JSON: send the k6 summary export, JMeter's statistics.json or Gatling's stats.json`); }
  const tool = detectPerfTool(doc);
  if (!tool) throw new PerfReportError(`${where} is not a k6 summary export, a JMeter statistics.json or a Gatling stats.json`);
  const rows = (tool === 'k6' ? k6 : tool === 'jmeter' ? jmeter : gatling)(doc as Record<string, any>)
    .filter((r) => r.requests !== null || r.p50 !== null || r.p95 !== null);
  if (!rows.length) throw new PerfReportError(`${where} holds no request statistics`);
  return { tool, rows };
}

/** Several files of one run: the first file's tool; a later row of the same endpoint replaces an earlier one. */
export function mergePerf(parts: ParsedPerf[]): ParsedPerf {
  const by = new Map<string, PerfRow>();
  for (const p of parts) for (const r of p.rows) by.set(r.endpoint, r);
  return { tool: parts[0].tool, rows: Array.from(by.values()).slice(0, MAX_ROWS) };
}
