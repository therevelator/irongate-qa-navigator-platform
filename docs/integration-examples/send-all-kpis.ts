/**
 * End-to-end check (Node.js 18+, TypeScript): send one valid value for EVERY team KPI for one
 * team, with retry + exponential backoff and an Idempotency-Key that is reused on every retry.
 *
 *   export IRONGATE_URL=https://qe.example.com/api    # your instance, ending in /api
 *   export IRONGATE_API_KEY=igk_...                   # Admin console -> API keys (super admin)
 *   npx tsx send-all-kpis.ts <team id>
 *
 * No dependencies besides Node's built-in fetch. Values are placeholders for a smoke test.
 */
import { createHash } from 'node:crypto';

type KpiKey =
  | 'test_coverage' | 'test_flakiness_rate' | 'defect_density' | 'defect_escape_rate' | 'code_quality_score'
  | 'automation_coverage' | 'automation_roi' | 'avg_build_time_minutes' | 'test_execution_time_minutes'
  | 'deployment_frequency_per_week' | 'lead_time_days' | 'mttr_hours' | 'parallel_test_efficiency'
  | 'sprint_velocity' | 'sprint_commitment_rate' | 'sprint_carryover' | 'first_time_pass_rate'
  | 'blocked_time_hours' | 'sizing_accuracy' | 'change_failure_rate' | 'mtbf_hours'
  | 'system_availability' | 'infrastructure_failures';

export interface KpiItem {
  teamId: string;
  source: string;                 // 1-50 chars: a-z 0-9 _ - . ("manual" is reserved)
  recordedAt?: string;            // ISO 8601, the time the values are FOR (default now, max 365 days back)
  metrics: Partial<Record<KpiKey, number | null>>;
  idempotencyKey?: string;        // per item: an item already written with this key for the team is skipped
  sourceRef?: string;             // free text <= 500 chars (build URL, job id)
}

const ALL_KPIS: Record<KpiKey, number> = {
  test_coverage: 81.5, test_flakiness_rate: 1.8, defect_density: 0.42, defect_escape_rate: 4.5,
  code_quality_score: 84, automation_coverage: 72, automation_roi: 135,
  avg_build_time_minutes: 9, test_execution_time_minutes: 14, deployment_frequency_per_week: 6.5,
  lead_time_days: 1.8, mttr_hours: 1.5, parallel_test_efficiency: 82,
  sprint_velocity: 42, sprint_commitment_rate: 92, sprint_carryover: 8, first_time_pass_rate: 88,
  blocked_time_hours: 3, sizing_accuracy: 1.05,
  change_failure_rate: 4, mtbf_hours: 800, system_availability: 99.95, infrastructure_failures: 1,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST one request (an item or up to 100 items). Retries network errors, 429 and 5xx; never 4xx. */
export async function ingest(body: KpiItem | KpiItem[], opts: { partial?: boolean; maxAttempts?: number } = {}) {
  const base = (process.env.IRONGATE_URL ?? '').replace(/\/$/, '');
  const apiKey = process.env.IRONGATE_API_KEY ?? '';
  if (!base || !apiKey.startsWith('igk_')) throw new Error('Set IRONGATE_URL and IRONGATE_API_KEY (igk_...)');
  const payload = JSON.stringify(body);
  // Same body -> same key, so a retry (or a re-run of the same job) is answered from the stored result.
  const idempotencyKey = createHash('sha256').update(payload).digest('hex');
  const url = `${base}/ingest/kpis${opts.partial ? '?partial=true' : ''}`;
  const maxAttempts = opts.maxAttempts ?? 6;
  let delay = 1000;
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: payload,
      });
    } catch (err) {
      if (attempt >= maxAttempts) throw err;
      await sleep(delay + Math.random() * delay * 0.25);
      delay = Math.min(delay * 2, 60_000);
      continue;
    }
    const data = await res.json().catch(() => ({ error: `non-JSON response (HTTP ${res.status})` }));
    if (res.status === 200 || res.status === 207) {
      return { httpStatus: res.status, replayed: res.headers.get('Idempotent-Replayed') === 'true', data };
    }
    if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
      const reset = Number(res.headers.get('Retry-After') ?? res.headers.get('RateLimit-Reset'));
      await sleep(Number.isFinite(reset) && reset > 0 ? reset * 1000 : delay + Math.random() * delay * 0.25);
      delay = Math.min(delay * 2, 60_000);
      continue;
    }
    // 400 validation, 401 key, 403 team, 413 too large, 422 key reused: fix the request, do not retry.
    throw new Error(`IronGate ingestion failed: HTTP ${res.status} ${JSON.stringify(data)}`);
  }
}

async function main() {
  const teamId = process.argv[2];
  if (!teamId) {
    console.error('usage: npx tsx send-all-kpis.ts <team id>');
    process.exit(2);
  }
  const recordedAt = new Date().toISOString();
  const { httpStatus, replayed, data } = await ingest({
    teamId,
    source: 'smoke-test',
    recordedAt,
    sourceRef: 'docs/integration-examples/send-all-kpis.ts',
    metrics: ALL_KPIS,
  });
  console.log(`HTTP ${httpStatus}${replayed ? ' (replayed: nothing written again)' : ''}`);
  console.log(JSON.stringify(data, null, 2));
  const updated: string[] = data.result?.updated ?? [];
  console.log(`\n${updated.length} of ${Object.keys(ALL_KPIS).length} KPIs written; QA score ${data.result?.qaScore} (${data.result?.status})`);
  if (!replayed && updated.length !== Object.keys(ALL_KPIS).length) process.exit(1);
}

// Run main() only when executed directly (the module can also be imported for ingest()).
if (process.argv[1] && /send-all-kpis\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
