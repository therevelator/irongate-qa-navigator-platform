/**
 * Pipeline run events (POST /api/ingest/pipelines): validation and normalisation of the JSON body.
 * Result names of GitHub Actions, GitLab CI, Jenkins and Azure DevOps are all understood.
 */
import { ReportError } from './testReports';

export type PipelineResult = 'success' | 'failed' | 'cancelled';
export type StageResult = PipelineResult | 'skipped';

export interface PipelineStageEvent {
  name: string;
  kind: 'build' | 'test' | 'deploy' | 'other';
  parallelGroup: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationS: number | null;
  result: StageResult;
}

export interface PipelineRunEvent {
  id: string;
  attempt: number;
  name: string | null;
  commit: string;
  branch: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  durationS: number | null;
  result: PipelineResult;
  url: string | null;
  stages: PipelineStageEvent[];
}

export const MAX_PIPELINE_RUNS = 100;
export const MAX_STAGES = 200;

const RESULT: Record<string, PipelineResult> = {
  success: 'success', succeeded: 'success', passed: 'success', ok: 'success',
  // Azure DevOps SucceededWithIssues (Agent.JobStatus): the run succeeded with warnings, counted as a success (as on
  // /ingest/deployments).
  succeededwithissues: 'success', succeeded_with_issues: 'success',
  failure: 'failed', failed: 'failed', unstable: 'failed', error: 'failed', errored: 'failed', timed_out: 'failed', timedout: 'failed',
  partiallysucceeded: 'failed', partially_succeeded: 'failed',
  cancelled: 'cancelled', canceled: 'cancelled', aborted: 'cancelled', skipped: 'cancelled',
  // Jenkins NOT_BUILT (currentBuild.currentResult): the run did not build, so it is not counted (like a cancelled run:
  // left out of the success-rate denominators).
  not_built: 'cancelled', notbuilt: 'cancelled',
};

export function normaliseResult(v: unknown, field: string, allowSkipped = false): StageResult {
  const s = typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
  if (allowSkipped && s === 'skipped') return 'skipped';
  const r = RESULT[s];
  if (!r) throw new ReportError(`${field} must be one of success, failed, cancelled (also: succeeded, SucceededWithIssues, failure, unstable, aborted, canceled, timed_out, NOT_BUILT)`);
  return r;
}

function time(v: unknown, field: string, required: boolean): Date | null {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ReportError(`${field} is required (ISO 8601)`);
    return null;
  }
  const d = new Date(typeof v === 'number' ? v : String(v));
  if (Number.isNaN(d.getTime())) throw new ReportError(`${field} must be an ISO 8601 timestamp`);
  return d;
}

function seconds(v: unknown, field: string): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 30 * 86400) throw new ReportError(`${field} must be a number of seconds (0 to 30 days)`);
  return Math.round(n);
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : null);

export function stageKind(name: string, given?: unknown): PipelineStageEvent['kind'] {
  const g = typeof given === 'string' ? given.toLowerCase() : '';
  if (g === 'build' || g === 'test' || g === 'deploy' || g === 'other') return g;
  if (/test|spec|e2e|qa|check|verify/i.test(name)) return 'test';
  if (/build|compile|package|assemble/i.test(name)) return 'build';
  if (/deploy|release|publish|rollout/i.test(name)) return 'deploy';
  return 'other';
}

export function normaliseRun(raw: any, index: number, defaults: { commit?: string; branch?: string | null }): PipelineRunEvent {
  const at = (f: string) => `runs[${index}].${f}`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ReportError(`runs[${index}] must be an object`);
  const id = str(raw.id ?? raw.runId ?? raw.run, 200);
  if (!id) throw new ReportError(`${at('id')} is required (the CI's run id)`);
  const attempt = raw.attempt === undefined || raw.attempt === null || raw.attempt === '' ? 1 : Number(raw.attempt);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 1000) throw new ReportError(`${at('attempt')} must be a whole number from 1`);
  const startedAt = time(raw.startedAt ?? raw.start, at('startedAt'), true)!;
  const finishedAt = time(raw.finishedAt ?? raw.end, at('finishedAt'), false);
  if (finishedAt && finishedAt.getTime() < startedAt.getTime()) throw new ReportError(`${at('finishedAt')} is before startedAt`);
  let durationS = seconds(raw.durationSeconds ?? raw.duration, at('durationSeconds'));
  if (durationS === null && finishedAt) durationS = Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000);
  const result = normaliseResult(raw.result ?? raw.status ?? raw.conclusion, at('result')) as PipelineResult;
  const stagesRaw = raw.stages ?? raw.jobs ?? [];
  if (!Array.isArray(stagesRaw)) throw new ReportError(`${at('stages')} must be an array`);
  if (stagesRaw.length > MAX_STAGES) throw new ReportError(`${at('stages')}: at most ${MAX_STAGES} stages`);
  const stages = stagesRaw.map((s: any, j: number): PipelineStageEvent => {
    const sf = (f: string) => `${at('stages')}[${j}].${f}`;
    if (!s || typeof s !== 'object') throw new ReportError(`${at('stages')}[${j}] must be an object`);
    const name = str(s.name, 255);
    if (!name) throw new ReportError(`${sf('name')} is required`);
    const st = time(s.startedAt ?? s.start, sf('startedAt'), false);
    const fi = time(s.finishedAt ?? s.end, sf('finishedAt'), false);
    let d = seconds(s.durationSeconds ?? s.duration, sf('durationSeconds'));
    if (d === null && st && fi) d = Math.max(0, Math.round((fi.getTime() - st.getTime()) / 1000));
    return {
      name, kind: stageKind(name, s.kind), parallelGroup: str(s.parallelGroup ?? s.group, 100),
      startedAt: st, finishedAt: fi, durationS: d, result: normaliseResult(s.result ?? s.status ?? s.conclusion, sf('result'), true),
    };
  });
  return {
    id, attempt, name: str(raw.name ?? raw.workflow ?? raw.pipeline, 255),
    commit: (str(raw.commit ?? raw.sha, 80) ?? defaults.commit ?? '').slice(0, 80),
    branch: str(raw.branch ?? raw.ref, 255)?.replace(/^refs\/heads\//, '') ?? defaults.branch ?? null,
    startedAt, finishedAt, durationS, result, url: str(raw.url, 1000), stages,
  };
}

/** Body: one run, an array of runs, or {runs: [...]} (at most 100). */
export function parsePipelineBody(body: unknown, defaults: { commit?: string; branch?: string | null } = {}): PipelineRunEvent[] {
  let list: unknown[];
  if (Array.isArray(body)) list = body;
  else if (body && typeof body === 'object' && Array.isArray((body as any).runs)) list = (body as any).runs;
  else if (body && typeof body === 'object') list = [body];
  else throw new ReportError('Send a JSON pipeline run, an array of runs, or {"runs": [...]}');
  if (list.length === 0 || list.length > MAX_PIPELINE_RUNS) throw new ReportError(`Send between 1 and ${MAX_PIPELINE_RUNS} pipeline runs`);
  return list.map((r, i) => normaliseRun(r, i, defaults));
}
