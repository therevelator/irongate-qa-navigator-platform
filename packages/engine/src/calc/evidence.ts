/**
 * The evidence lists of a team as of a day, as the app shows them next to the CI metrics (the same rules as
 * GET /api/ci/teams/:id/evidence): flaky tests with the runs that prove them, the lowest-coverage files of the
 * latest report, the slowest tests and the failing pipeline stages. Pure.
 */
import { dayMinus, flakyGroups, isMainBranch, lowestCoverageFiles, type CiData } from './ci';
import { median } from './types';

export interface CiEvidence {
  flakyTests: Array<{ testKey: string; name: string; suite: string; commits: string[]; failedRuns: number; passedRuns: number; lastSeen: string }>;
  coverage: { reportId: string; commit: string; branch: string | null; format: string; createdAt: string; linesFound: number; linesHit: number; fileCount: number } | null;
  lowestFiles: Array<{ path: string; linesFound: number; linesHit: number; branchesFound: number; branchesHit: number; coverage: number }>;
  slowestTests: Array<{ testKey: string; name: string; suite: string; runs: number; medianMs: number; maxMs: number }>;
  failingStages: Array<{ name: string; runs: number; failed: number; failureRate: number; medianSeconds: number | null; lastFailedRuns: Array<{ runId: string; url: string | null }> }>;
  /** The slowest pipeline stages (jobs) over the 30 days ending the day: median duration, with their slowest steps when the CI reports steps. */
  slowestStages: Array<{ name: string; runs: number; medianSeconds: number; maxSeconds: number; slowestSteps: Array<{ name: string; medianSeconds: number }> }>;
}

export function ciEvidence(day: string, data: CiData): CiEvidence {
  // Flaky tests seen in the 30 days ending the day, per test (most failed runs first).
  const from30 = dayMinus(day, 29);
  const window = data.testRuns.filter((r) => r.day >= from30 && r.day <= day);
  const startedOf = new Map(window.map((r) => [r.id, r.startedAt]));
  const byTest = new Map<string, { testKey: string; name: string; suite: string; commits: string[]; failed: Set<string>; passed: Set<string>; lastSeen: number }>();
  for (const g of flakyGroups(window).groups) {
    const t = byTest.get(g.testKey) ?? { testKey: g.testKey, name: g.name, suite: g.suite, commits: [], failed: new Set<string>(), passed: new Set<string>(), lastSeen: 0 };
    t.commits.push(g.commit);
    for (const id of [...g.failedRuns, ...g.passedRuns]) t.lastSeen = Math.max(t.lastSeen, startedOf.get(id) ?? 0);
    g.failedRuns.forEach((x) => t.failed.add(x));
    g.passedRuns.forEach((x) => t.passed.add(x));
    byTest.set(g.testKey, t);
  }
  const flakyTests = Array.from(byTest.values())
    .sort((a, b) => b.failed.size - a.failed.size || b.lastSeen - a.lastSeen)
    .slice(0, 20)
    .map((t) => ({ testKey: t.testKey, name: t.name, suite: t.suite, commits: t.commits.slice(0, 5), failedRuns: t.failed.size, passedRuns: t.passed.size, lastSeen: new Date(t.lastSeen).toISOString() }));

  // Lowest-coverage files of the latest report (main branch first).
  const upTo = data.coverage.filter((c) => c.day <= day);
  const report = [...upTo].sort((a, b) => Number(isMainBranch(b.branch, data.mainBranch)) - Number(isMainBranch(a.branch, data.mainBranch)) || b.createdAt - a.createdAt)[0] ?? null;
  const lowestFiles = report ? lowestCoverageFiles(report.files ?? [], 15).map((f) => ({
    path: f.path, linesFound: f.linesFound, linesHit: f.linesHit, branchesFound: f.branchesFound ?? 0, branchesHit: f.branchesHit ?? 0,
    coverage: Math.round((f.linesHit / f.linesFound) * 10000) / 100,
  })) : [];

  // Slowest tests over the 7 days ending the day (median duration).
  const from7 = dayMinus(day, 6);
  const durations = new Map<string, { testKey: string; name: string; suite: string; ms: number[] }>();
  for (const r of data.testRuns) {
    if (r.day < from7 || r.day > day) continue;
    for (const c of r.cases ?? []) {
      if (c.status === 'skipped') continue;
      const t = durations.get(c.testKey) ?? { testKey: c.testKey, name: c.name, suite: c.suite, ms: [] };
      if (c.name > t.name) t.name = c.name;
      if (c.suite > t.suite) t.suite = c.suite;
      t.ms.push(c.durationMs);
      durations.set(c.testKey, t);
    }
  }
  const slowestTests = Array.from(durations.values())
    .map((t) => ({ testKey: t.testKey, name: t.name, suite: t.suite, runs: t.ms.length, medianMs: Math.round(median(t.ms) ?? 0), maxMs: Math.max(...t.ms) }))
    .sort((a, b) => b.medianMs - a.medianMs)
    .slice(0, 15);

  // Failing pipeline stages over the 30 days ending the day.
  const stages = new Map<string, { name: string; runs: number; failed: number; seconds: number[]; failedRuns: Array<{ at: number; runId: string; url: string | null }> }>();
  for (const p of data.pipelines) {
    if (p.day < from30 || p.day > day) continue;
    for (const s of p.stages ?? []) {
      if (s.result === 'skipped') continue;
      const t = stages.get(s.name) ?? { name: s.name, runs: 0, failed: 0, seconds: [], failedRuns: [] };
      t.runs++;
      if (s.durationS !== null) t.seconds.push(s.durationS);
      if (s.result === 'failed') { t.failed++; t.failedRuns.push({ at: p.startedAt, runId: p.externalId, url: p.url ?? null }); }
      stages.set(s.name, t);
    }
  }
  const failingStages = Array.from(stages.values())
    .filter((s) => s.failed > 0)
    .sort((a, b) => b.failed - a.failed || b.runs - a.runs)
    .slice(0, 10)
    .map((s) => {
      const m = median(s.seconds);
      return {
        name: s.name, runs: s.runs, failed: s.failed, failureRate: Math.round((s.failed / s.runs) * 1000) / 10, medianSeconds: m === null ? null : Math.round(m),
        lastFailedRuns: s.failedRuns.sort((a, b) => b.at - a.at).slice(0, 3).map((x) => ({ runId: x.runId, url: x.url })),
      };
    });

  // Slowest stages over the same 30 days (median duration), with their slowest steps.
  const durs = new Map<string, { name: string; s: number[]; steps: Map<string, number[]> }>();
  const newStage = (name: string) => ({ name, s: [] as number[], steps: new Map<string, number[]>() });
  for (const p of data.pipelines) {
    if (p.day < from30 || p.day > day) continue;
    for (const s of p.stages ?? []) {
      if (s.result === 'skipped' || s.durationS === null) continue;
      const t = durs.get(s.name) ?? newStage(s.name);
      t.s.push(s.durationS);
      durs.set(s.name, t);
    }
    for (const st of p.steps ?? []) {
      if (st.durationS === null) continue;
      const t = durs.get(st.job);
      if (!t) continue;
      const l = t.steps.get(st.name) ?? [];
      l.push(st.durationS);
      t.steps.set(st.name, l);
    }
  }
  const slowestStages = Array.from(durs.values())
    .map((t) => ({
      name: t.name, runs: t.s.length, medianSeconds: Math.round(median(t.s) ?? 0), maxSeconds: Math.max(...t.s),
      slowestSteps: Array.from(t.steps.entries()).map(([name, v]) => ({ name, medianSeconds: Math.round(median(v) ?? 0) })).sort((a, b) => b.medianSeconds - a.medianSeconds).slice(0, 3),
    }))
    .sort((a, b) => b.medianSeconds - a.medianSeconds)
    .slice(0, 10);

  return {
    flakyTests, slowestStages,
    coverage: report ? { reportId: report.id, commit: report.commit, branch: report.branch, format: report.format, createdAt: new Date(report.createdAt).toISOString(), linesFound: report.linesFound, linesHit: report.linesHit, fileCount: report.fileCount } : null,
    lowestFiles, slowestTests, failingStages,
  };
}
