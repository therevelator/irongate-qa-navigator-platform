/**
 * Recommendations rules engine (pure, deterministic): each rule looks at a team's facts (KPI
 * history, forecasts and, when the team sends raw CI data, the tests / files / stages behind the
 * numbers; server/lib/recommendations/load.ts builds them) and returns at most one recommendation
 * with its evidence (the numbers it is based on), a concrete next step, the expected effect on one
 * metric (a range, from the team's own history or from the evidence) and a confidence. A rule
 * that lacks the data it needs returns nothing: nothing is invented.
 *
 * Ranking (rankRecommendations): expected effect in "watch bands" of its metric (the distance
 * between the target and the warning threshold), times the confidence weight, plus an urgency bonus
 * when the metric's forecast worsens or misses its target. Ties: rule order.
 */
import type { WeeklyPoint } from '../forecast/math';
import { forecastValue, shortDay } from '../../../src/lib/forecastText';

export type Confidence = 'high' | 'medium' | 'low';

export interface MetricFacts {
  key: string;
  label: string;
  unit: string;
  lowerIsBetter: boolean | null;
  current: number | null;
  currentDay: string | null;
  /** The target valid now (good / warning), null when the metric has none. */
  target: { good: number; warning: number } | null;
  /** Weekly medians of the last 26 weeks (x = weeks before today, negative), oldest first. */
  weekly: WeeklyPoint[];
  forecast: {
    status: 'ok' | 'insufficient';
    trend: 'improving' | 'worsening' | 'flat' | null;
    outlook: string | null;
    crossingDay: string | null;
    slopePerWeek: number | null;
    endValue: number | null;
    endDay: string | null;
    confidence: Confidence | null;
  } | null;
}

export interface FlakyFacts {
  source: 'ci' | 'tracked';
  windowDays: number;
  tests: Array<{ name: string; suite: string | null; failedRuns: number; passedRuns: number; lastSeen: string | null }>;
  /** Distinct flaky tests (may exceed tests listed). */
  flakyCount: number;
  failedRunsTotal: number;
  /** Re-runs (attempt > 1) in the window and their time (CI data only). */
  reruns: number | null;
  rerunMinutes: number | null;
  /** Distinct tests run in the window (CI data only). */
  testsRun: number | null;
}

export interface CoverageFacts {
  day: string;
  commit: string;
  linesFound: number;
  linesHit: number;
  files: Array<{ path: string; linesFound: number; linesHit: number }>;
}

export interface StageFacts {
  /** Median duration per stage in the recent and the earlier window (seconds). */
  windowDays: number;
  stages: Array<{ name: string; recentMedianS: number | null; earlierMedianS: number | null; recentRuns: number; earlierRuns: number }>;
  failing: Array<{ name: string; runs: number; failed: number }>;
}

export interface TeamFacts {
  teamId: string;
  teamName: string;
  asOf: string;
  metrics: Record<string, MetricFacts | undefined>;
  flaky: FlakyFacts | null;
  coverage: CoverageFacts | null;
  stages: StageFacts | null;
  wellbeing: { value: number; responses: number; periodEnd: string } | null;
  /** Slowest tests of the last 7 days (CI data) and the median total test time per run. */
  slowTests?: Array<{ name: string; suite: string | null; medianMs: number; runs: number }> | null;
  slowTestsTotalMs?: number | null;
  /** Incidents resolved in the last 30 days (raw incident events, v2 phase 2). */
  incidents?: { windowDays: number; count: number; medianHours: number; medianAckHours: number | null; longest: Array<{ title: string; service: string | null; severity: string; hours: number; opened: string }> } | null;
  /** Production deploys of the last 30 days and the failed changes among them (raw deployment events). */
  deploys?: { windowDays: number; production: number; failed: number; failedList: Array<{ id: string; service: string | null; day: string }>; services: Array<{ service: string; total: number; failed: number }> } | null;
  debt: Array<{ title: string; severity: string; category: string; costOfDelay: number | null; effortHours: number | null; filePath: string | null }>;
}

export interface Evidence { label: string; value: string; detail?: string }
export interface Item { kind: 'test' | 'file' | 'stage' | 'debt' | 'incident' | 'service' | 'deploy'; name: string; detail: string }

export interface Effect {
  metric: string;
  label: string;
  unit: string;
  /** Value now (or the projected value it prevents, for kind "hold"). */
  from: number;
  /** Expected value range after the step (low = the smaller effect). */
  low: number;
  high: number;
  horizonWeeks: [number, number];
  basis: string;
  kind: 'improve' | 'hold';
}

export interface Recommendation {
  ruleKey: string;
  subjectKey: string;
  title: string;
  evidence: Evidence[];
  items: Item[];
  nextStep: string;
  /** A metric with a target (tracked actions measure it). */
  metricKey: string | null;
  effect: Effect | null;
  confidence: Confidence;
  score: number;
}

/* ------------------------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------------------- */

const r1 = (v: number) => Math.round(v * 10) / 10;
export const fmt = (v: number, unit: string) => forecastValue(v, unit);
const pts = (unit: string) => (unit === '%' || unit === '/100' || unit === '' ? ' points' : unit === 'ratio' ? '' : ` ${unit}`);
const better = (m: MetricFacts, a: number, b: number) => (m.lowerIsBetter ? a < b : a > b);
const offTarget = (m: MetricFacts) => !!m.target && m.current !== null && (m.lowerIsBetter ? m.current > m.target.good : m.current < m.target.good);
const targetText = (m: MetricFacts) => (m.target ? `${m.lowerIsBetter ? '≤' : '≥'} ${fmt(m.target.good, m.unit)}` : '');
const worsening = (m: MetricFacts) => m.forecast?.status === 'ok' && m.forecast.trend === 'worsening';

/** The weekly median about `weeks` weeks ago (the point nearest to −weeks, within 2 weeks). */
export function valueWeeksAgo(m: MetricFacts, weeks: number): { value: number; day: string } | null {
  let best: WeeklyPoint | null = null;
  for (const p of m.weekly) if (Math.abs(p.x + weeks) <= 2 && (!best || Math.abs(p.x + weeks) < Math.abs(best.x + weeks))) best = p;
  return best ? { value: best.value, day: best.to } : null;
}

/** The team's best weekly median in the last 26 weeks (in the metric's direction). */
export function ownBest(m: MetricFacts): { value: number; day: string } | null {
  if (m.lowerIsBetter === null || !m.weekly.length) return null;
  const p = m.weekly.reduce((b, x) => (better(m, x.value, b.value) ? x : b));
  return { value: p.value, day: p.to };
}

const monthName = (day: string) => shortDay(day).split(' ')[1];

/**
 * Expected effect from the team's own history: back to its best weekly level of the last 26
 * weeks (high) or half-way there (low). When now is its best and the forecast worsens: holding the
 * current level instead of the projected one ("hold"). Null when neither applies.
 */
export function historyEffect(m: MetricFacts, horizon: [number, number] = [6, 8]): Effect | null {
  if (m.current === null || m.lowerIsBetter === null) return null;
  const best = ownBest(m);
  const ref = m.target && best && better(m, best.value, m.target.good) && offTarget(m) ? m.target.good : best?.value;
  if (best && ref !== undefined && better(m, ref, m.current) && Math.abs(ref - m.current) > 1e-9) {
    const capped = ref; // the target when the team's best was better than it, else its best
    return {
      metric: m.key, label: m.label, unit: m.unit, from: m.current, kind: 'improve', horizonWeeks: horizon,
      low: m.current + (capped - m.current) / 2, high: capped,
      basis: capped === best.value
        ? `the team’s own best weekly level in the last 26 weeks (${fmt(best.value, m.unit)} in ${monthName(best.day)})`
        : `the target (${targetText(m)}), which the team bettered in ${monthName(best.day)} (${fmt(best.value, m.unit)})`,
    };
  }
  const f = m.forecast;
  if (f?.status === 'ok' && f.trend === 'worsening' && f.endValue !== null && f.endDay) {
    return {
      metric: m.key, label: m.label, unit: m.unit, from: f.endValue, kind: 'hold', horizonWeeks: horizon,
      low: m.current + (f.endValue - m.current) / 2, high: m.current,
      basis: `the forecast: about ${fmt(f.endValue, m.unit)} by ${shortDay(f.endDay)} at this rate`,
    };
  }
  return null;
}

/** "Test coverage +5.1 to +10.2 points (to 63.2–68.3%) in 6–8 weeks". */
export function effectText(e: Effect): string {
  const [a, b] = [e.low - e.from, e.high - e.from];
  const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '±');
  const abs = (v: number) => {
    const x = Math.abs(v);
    return (x >= 100 ? Math.round(x) : x >= 10 ? r1(x) : Math.round(x * 100) / 100).toLocaleString('en-GB');
  };
  const range = `${fmt(Math.min(e.low, e.high), e.unit)}–${fmt(Math.max(e.low, e.high), e.unit)}`;
  if (e.kind === 'hold') return `${e.label} holds at ${range} instead of about ${fmt(e.from, e.unit)} in ${e.horizonWeeks[0]}–${e.horizonWeeks[1]} weeks`;
  return `${e.label} ${sign(a)}${abs(a)} to ${sign(b)}${abs(b)}${pts(e.unit)} (to ${range}) in ${e.horizonWeeks[0]}–${e.horizonWeeks[1]} weeks`;
}

function trendEvidence(m: MetricFacts, weeks = 12): Evidence | null {
  const ago = valueWeeksAgo(m, weeks);
  if (!ago || m.current === null) return null;
  return { label: `${m.label}, ${weeks} weeks ago → now`, value: `${fmt(ago.value, m.unit)} → ${fmt(m.current, m.unit)}`, detail: `weekly median of ${shortDay(ago.day)} and the latest value (${m.currentDay ? shortDay(m.currentDay) : 'today'})` };
}

function currentEvidence(m: MetricFacts): Evidence {
  return { label: m.label, value: fmt(m.current as number, m.unit), detail: m.target ? `target ${targetText(m)}` : undefined };
}

function forecastEvidence(m: MetricFacts): Evidence | null {
  const f = m.forecast;
  if (f?.status !== 'ok' || f.endValue === null || !f.endDay) return null;
  if (f.outlook === 'will_miss' && f.crossingDay) return { label: 'Forecast', value: `misses ${targetText(m)} around ${shortDay(f.crossingDay)}` };
  if (f.trend !== 'worsening') return null;
  return { label: 'Forecast', value: `about ${fmt(f.endValue, m.unit)} by ${shortDay(f.endDay)} at this rate` };
}

/** For a metric on target now but forecast to miss it: "Test coverage (84% now) misses ≥ 80% around 6 Jan at this rate". */
function missTitle(m: MetricFacts): string | null {
  if (offTarget(m) || m.forecast?.outlook !== 'will_miss' || !m.forecast.crossingDay || m.current === null) return null;
  return `${m.label} (${fmt(m.current, m.unit)} now) misses ${targetText(m)} around ${shortDay(m.forecast.crossingDay)} at this rate`;
}

const compact = <T>(xs: Array<T | null | undefined | false>): T[] => xs.filter((x): x is T => !!x);

/** Confidence: evidence from CI data and a confident forecast → high; KPI history only → medium / low. */
function confidenceOf(hasCi: boolean, m: MetricFacts | undefined): Confidence {
  const fc = m?.forecast?.confidence ?? null;
  if (hasCi && fc !== 'low') return 'high';
  if (hasCi || fc === 'high') return 'medium';
  return 'low';
}

/** Needs attention: off target now, or on target but forecast to miss it. */
const needsAttention = (m: MetricFacts | undefined): m is MetricFacts =>
  !!m && m.current !== null && !reachesAnyway(m) && (offTarget(m) || (m.forecast?.status === 'ok' && m.forecast.outlook === 'will_miss'));
/** Off target but forecast to reach the target within the horizon (improving, or a latest value
 *  that is a blip above a usual level on target): nothing to add. */
const reachesAnyway = (m: MetricFacts) => m.forecast?.status === 'ok' && m.forecast.outlook === 'will_reach' && m.forecast.trend !== 'worsening';

/* ------------------------------------------------------------------------------------------
 * Rules
 * ---------------------------------------------------------------------------------------- */

export type Rule = (f: TeamFacts) => Omit<Recommendation, 'score'> | null;

/** Flaky tests costing failed runs and reruns. */
export const flakyTestsRule: Rule = (f) => {
  const m = f.metrics.test_flakiness_rate;
  if (!m || m.current === null) return null;
  if (!needsAttention(m) && !(worsening(m) && f.flaky)) return null;
  const fl = f.flaky;
  const top = fl?.tests.slice(0, 5) ?? [];
  let effect: Effect | null = historyEffect(m);
  if (fl && fl.source === 'ci' && fl.flakyCount > 0 && top.length) {
    // Flakiness = flaky tests ÷ tests run: removing the listed tests removes their share.
    // Flakiness = flaky tests ÷ tests run: fixing the listed tests removes their share of the rate,
    // less the new flaky tests that appear meanwhile (80 % of the share at best, 40 % at the low end).
    const share = Math.min(1, top.length / fl.flakyCount);
    effect = {
      metric: m.key, label: m.label, unit: m.unit, from: m.current, kind: 'improve', horizonWeeks: [2, 4],
      low: m.current * (1 - share * 0.4), high: m.current * (1 - share * 0.8),
      basis: `fixing ${top.length === fl.flakyCount ? `the ${top.length}` : `${top.length} of the ${fl.flakyCount}`} flaky tests (flakiness = flaky tests ÷ tests run), allowing for new flaky tests: 40–80% of their share`,
    };
  }
  const hours = fl?.rerunMinutes ? r1(fl.rerunMinutes / 60) : null;
  const one = fl?.flakyCount === 1;
  const window = fl?.source === 'ci' ? ` in the last ${fl.windowDays} days` : '';
  const title = fl && top.length
    ? one
      ? `Fix the flaky test “${top[0].name}”: it failed ${fl.failedRunsTotal} run${fl.failedRunsTotal === 1 ? '' : 's'}${window}${hours ? ` and cost about ${hours} hours of reruns` : ''}`
      : `Fix the ${fl.flakyCount} flaky tests: they failed ${fl.failedRunsTotal} runs${window}${hours ? ` and cost about ${hours} hours of reruns` : ''}`
    : missTitle(m) ?? `Bring test flakiness down from ${fmt(m.current, m.unit)} to ${targetText(m)}`;
  return {
    ruleKey: 'flaky_tests', subjectKey: '',
    title,
    evidence: compact<Evidence>([
      currentEvidence(m),
      trendEvidence(m),
      fl && { label: fl.source === 'ci' ? `Flaky tests (failed and passed on the same commit), last ${fl.windowDays} days` : 'Tracked flaky tests (not quarantined, flaky in the last 60 days)', value: String(fl.flakyCount), detail: `${fl.failedRunsTotal} failed runs` },
      fl?.reruns ? { label: `Re-runs in the last ${fl.windowDays} days`, value: String(fl.reruns), detail: hours ? `about ${hours} hours of pipeline time` : undefined } : null,
      fl?.testsRun ? { label: 'Distinct tests run', value: String(fl.testsRun) } : null,
      forecastEvidence(m),
    ]),
    items: top.map((t) => ({ kind: 'test' as const, name: t.suite ? `${t.suite} › ${t.name}` : t.name, detail: `failed ${t.failedRuns}, passed ${t.passedRuns}${t.lastSeen ? ` · last seen ${shortDay(t.lastSeen)}` : ''}` })),
    nextStep: top.length
      ? top.length === 1
        ? `Quarantine “${top[0].name}” in CI today so it stops blocking merges, then fix it this sprint. Typical causes: shared test data, waits on timing, order dependence.`
        : `Quarantine these ${top.length} tests in CI today so they stop blocking merges, then fix them this sprint, starting with “${top[0].name}” (${top[0].failedRuns} failed runs). Typical causes: shared test data, waits on timing, order dependence.`
      : 'Turn on retry reporting in CI (send the test reports with the attempt number) so the flaky tests are named, then quarantine and fix the worst ones this sprint.',
    metricKey: 'test_flakiness_rate',
    effect,
    confidence: confidenceOf(!!fl && fl.source === 'ci' && top.length > 0, m),
  };
};

/** Coverage below target: the files that hold most of the uncovered lines. */
export const coverageGapRule: Rule = (f) => {
  const m = f.metrics.test_coverage;
  if (!needsAttention(m)) return null;
  const goal = m.target?.good ?? 80;
  const cov = f.coverage;
  let files: Array<{ path: string; linesFound: number; linesHit: number; gain: number }> = [];
  let effect = historyEffect(m);
  if (cov && cov.linesFound > 0) {
    files = cov.files
      .filter((x) => x.linesFound > 0 && x.linesHit / x.linesFound < goal / 100)
      .map((x) => ({ ...x, gain: Math.max(0, (goal / 100) * x.linesFound - x.linesHit) }))
      .sort((a, b) => b.gain - a.gain)
      .slice(0, 5);
    const gainPts = (files.reduce((s, x) => s + x.gain, 0) / cov.linesFound) * 100;
    if (files.length && gainPts > 0.05) {
      effect = {
        metric: m.key, label: m.label, unit: m.unit, from: m.current as number, kind: 'improve', horizonWeeks: [4, 8],
        low: Math.min(100, (m.current as number) + gainPts / 2), high: Math.min(100, (m.current as number) + gainPts),
        basis: `raising these ${files.length} files to ${goal}% line coverage adds about ${r1(gainPts)} points in the latest coverage report (${cov.linesFound.toLocaleString('en-GB')} lines); low end: half of that`,
      };
    }
  }
  const escape = f.metrics.defect_escape_rate;
  const uncovered = cov ? cov.linesFound - cov.linesHit : 0;
  const share = cov && uncovered > 0 && files.length ? Math.round((files.reduce((s, x) => s + (x.linesFound - x.linesHit), 0) / uncovered) * 100) : null;
  return {
    ruleKey: 'coverage_gap', subjectKey: '',
    title: files.length
      ? `Close the coverage gap in ${files.length} file${files.length === 1 ? '' : 's'}${share !== null ? ` that hold ${share}% of the uncovered lines` : ''}`
      : missTitle(m) ?? `Raise test coverage from ${fmt(m.current as number, m.unit)} to ${targetText(m)}`,
    evidence: compact<Evidence>([
      currentEvidence(m),
      trendEvidence(m),
      cov && { label: `Latest coverage report (${shortDay(cov.day)}, commit ${cov.commit.slice(0, 7)})`, value: `${r1((cov.linesHit / cov.linesFound) * 100)}%`, detail: `${(cov.linesFound - cov.linesHit).toLocaleString('en-GB')} of ${cov.linesFound.toLocaleString('en-GB')} lines not covered` },
      escape && offTarget(escape) && escape.current !== null ? { label: 'Defect escape rate', value: fmt(escape.current, escape.unit), detail: `target ${targetText(escape)}: escaped defects point at untested code` } : null,
      forecastEvidence(m),
    ]),
    items: files.map((x) => ({ kind: 'file' as const, name: x.path, detail: `${r1((x.linesHit / x.linesFound) * 100)}% of ${x.linesFound.toLocaleString('en-GB')} lines · +${Math.round(x.gain)} lines to reach ${goal}%` })),
    nextStep: files.length
      ? `Add tests for ${files[0].path.split('/').pop()}${files.length > 1 ? ` and the ${files.length - 1} other file${files.length > 2 ? 's' : ''} listed` : ''} before new feature work in them, and make coverage of changed lines ≥ ${goal}% a merge check so the gap does not grow back.`
      : `Make coverage of changed lines ≥ ${goal}% a merge check and spend a fixed part of each sprint on tests for the least covered modules (send coverage reports to see which files).`,
    metricKey: 'test_coverage',
    effect,
    confidence: confidenceOf(files.length > 0, m),
  };
};

/** Build time regression, with the stage that grew. */
export const buildTimeRule: Rule = (f) => {
  const m = f.metrics.avg_build_time_minutes;
  if (!m || m.current === null) return null;
  const ago = valueWeeksAgo(m, 8);
  const grew = ago && ago.value > 0 && (m.current - ago.value) / ago.value >= 0.25;
  if (!grew || !(offTarget(m) || worsening(m))) return null;
  let stage: StageFacts['stages'][number] | null = null;
  for (const s of f.stages?.stages ?? []) {
    if (s.recentMedianS === null || s.earlierMedianS === null || s.recentRuns < 3 || s.earlierRuns < 3) continue;
    const d = s.recentMedianS - s.earlierMedianS;
    if (d >= 60 && d / Math.max(1, s.earlierMedianS) >= 0.2 && (!stage || d > (stage.recentMedianS! - stage.earlierMedianS!))) stage = s;
  }
  const mins = (s: number) => r1(s / 60);
  return {
    ruleKey: 'build_time_regression', subjectKey: '',
    title: stage
      ? `Build time rose from ${fmt(ago!.value, m.unit)} to ${fmt(m.current, m.unit)}; the “${stage.name}” stage went from ${mins(stage.earlierMedianS!)} to ${mins(stage.recentMedianS!)} minutes`
      : `Build time rose from ${fmt(ago!.value, m.unit)} to ${fmt(m.current, m.unit)} since ${shortDay(ago!.day)}`,
    evidence: compact<Evidence>([
      currentEvidence(m),
      { label: 'Build time 8 weeks ago → now', value: `${fmt(ago!.value, m.unit)} → ${fmt(m.current, m.unit)}`, detail: `+${Math.round(((m.current - ago!.value) / ago!.value) * 100)}%` },
      stage && { label: `Stage “${stage.name}”, median, days 8–${2 * f.stages!.windowDays} ago → last ${f.stages!.windowDays} days`, value: `${mins(stage.earlierMedianS!)} → ${mins(stage.recentMedianS!)} min`, detail: `${stage.earlierRuns} and ${stage.recentRuns} runs` },
      forecastEvidence(m),
    ]),
    items: stage ? [{ kind: 'stage', name: stage.name, detail: `median ${mins(stage.earlierMedianS!)} → ${mins(stage.recentMedianS!)} min` }] : [],
    nextStep: stage
      ? `Profile the “${stage.name}” stage: split it across parallel jobs, cache its dependencies and move the slowest tests out of the merge path (run them nightly).`
      : 'Send pipeline events with stage durations to see which stage grew; meanwhile cache dependencies and run test shards in parallel.',
    metricKey: 'avg_build_time_minutes',
    effect: historyEffect(m),
    confidence: confidenceOf(!!stage, m),
  };
};

/** Defect escape rising while coverage falls. */
export const escapeWithFallingCoverageRule: Rule = (f) => {
  const e = f.metrics.defect_escape_rate;
  const c = f.metrics.test_coverage;
  if (!e || !c || e.current === null || c.current === null) return null;
  const e0 = valueWeeksAgo(e, 12);
  const c0 = valueWeeksAgo(c, 12);
  if (!e0 || !c0) return null;
  if (!(e.current - e0.value >= 2 && c0.value - c.current >= 2 && offTarget(e))) return null;
  const effect: Effect = {
    metric: e.key, label: e.label, unit: e.unit, from: e.current, kind: 'improve', horizonWeeks: [6, 10],
    low: e.current - (e.current - e0.value) / 2, high: e0.value,
    basis: `the team’s own level 12 weeks ago (${fmt(e0.value, e.unit)}, when coverage was ${fmt(c0.value, c.unit)}); low end: half-way`,
  };
  return {
    ruleKey: 'escape_falling_coverage', subjectKey: '',
    title: `Defect escapes rose from ${fmt(e0.value, e.unit)} to ${fmt(e.current, e.unit)} while coverage fell from ${fmt(c0.value, c.unit)} to ${fmt(c.current, c.unit)}`,
    evidence: compact<Evidence>([
      { label: 'Defect escape rate, 12 weeks ago → now', value: `${fmt(e0.value, e.unit)} → ${fmt(e.current, e.unit)}`, detail: `target ${targetText(e)}` },
      { label: 'Test coverage, 12 weeks ago → now', value: `${fmt(c0.value, c.unit)} → ${fmt(c.current, c.unit)}`, detail: c.target ? `target ${targetText(c)}` : undefined },
      forecastEvidence(e),
    ]),
    items: [],
    nextStep: 'For every defect found in production this sprint, merge a regression test with the fix (no fix without a test), and review the last 10 escaped defects in the retro: which test level would have caught each one.',
    metricKey: 'defect_escape_rate',
    effect,
    confidence: confidenceOf(false, e),
  };
};

/** Sizing accuracy drifting away from 1.0, with carryover. */
export const sizingDriftRule: Rule = (f) => {
  const s = f.metrics.sizing_accuracy;
  const carry = f.metrics.sprint_carryover;
  if (!s || s.current === null) return null;
  const off = Math.abs(s.current - 1);
  if (off <= 0.15) return null;
  const s0 = valueWeeksAgo(s, 12);
  const drifting = s0 ? off - Math.abs(s0.value - 1) >= 0.03 : false;
  const carryHigh = !!carry && carry.current !== null && offTarget(carry);
  if (!drifting && !carryHigh) return null;
  const under = s.current > 1;
  return {
    ruleKey: 'sizing_drift', subjectKey: '',
    title: `Estimates are ${Math.round(off * 100)}% too ${under ? 'low' : 'high'} (actual ${s.current.toFixed(2)}× the estimate)${carryHigh ? `, and ${fmt(carry!.current as number, carry!.unit)} of the sprint carries over` : ''}`,
    evidence: compact<Evidence>([
      { label: 'Sizing accuracy (actual ÷ estimate)', value: `${s.current.toFixed(2)}×`, detail: 'target 1.00 ± 0.15' },
      s0 && { label: 'Sizing accuracy 12 weeks ago → now', value: `${s0.value.toFixed(2)}× → ${s.current.toFixed(2)}×` },
      carry && carry.current !== null && { label: 'Sprint carryover', value: fmt(carry.current, carry.unit), detail: carry.target ? `target ${targetText(carry)}` : undefined },
      carry && trendEvidence(carry),
    ]),
    items: [],
    nextStep: `Re-estimate the next sprint against 3 reference stories, split anything above 8 points, and compare estimate with actual for every finished item in the retro; plan ${under ? `about ${Math.round((1 - 1 / s.current) * 100)}% less` : 'more'} until the ratio is back within 0.85–1.15.`,
    metricKey: carry && carry.target ? 'sprint_carryover' : null,
    effect: carry ? historyEffect(carry) : null,
    confidence: confidenceOf(false, carry ?? s),
  };
};

/** Low wellbeing with high blocked time. */
export const wellbeingBlockedRule: Rule = (f) => {
  const b = f.metrics.blocked_time_hours;
  const w = f.wellbeing;
  if (!w || !b || b.current === null || w.value >= 60 || !offTarget(b)) return null;
  return {
    ruleKey: 'wellbeing_blocked', subjectKey: '',
    title: `Wellbeing is ${Math.round(w.value)}/100 and work waits ${fmt(b.current, b.unit)} blocked: remove blockers first`,
    evidence: compact<Evidence>([
      { label: 'Wellbeing (anonymous pulse survey)', value: `${Math.round(w.value)}/100`, detail: `${w.responses} responses, period ending ${shortDay(w.periodEnd)}; watch below 70` },
      currentEvidence(b),
      trendEvidence(b),
      forecastEvidence(b),
    ]),
    items: [],
    nextStep: 'Hold a 15-minute blocker review twice a week with the Product Owner; give every blocked item an owner outside the team and a date, and stop starting new work while more than two items are blocked.',
    metricKey: 'blocked_time_hours',
    effect: historyEffect(b),
    confidence: confidenceOf(false, b),
  };
};

/** Mean time to recovery rising (with the incidents behind it when sent). */
export const mttrRule: Rule = (f) => {
  const m = f.metrics.mttr_hours;
  if (!m || m.current === null) return null;
  const ago = valueWeeksAgo(m, 12);
  const rose = ago && ago.value > 0 && (m.current - ago.value) / ago.value >= 0.25;
  if (!rose || !(offTarget(m) || worsening(m))) return null;
  const inc = f.incidents;
  const h = (x: number) => (x >= 10 ? `${Math.round(x)} h` : `${r1(x)} h`);
  const ackShare = inc && inc.medianAckHours !== null && inc.medianHours > 0 ? inc.medianAckHours / inc.medianHours : null;
  return {
    ruleKey: 'mttr_rising', subjectKey: '',
    title: `Recovery takes longer: MTTR rose from ${fmt(ago!.value, m.unit)} to ${fmt(m.current, m.unit)} in 12 weeks${ackShare !== null && ackShare >= 0.3 ? `; ${Math.round(ackShare * 100)}% of it passes before anyone acknowledges` : ''}`,
    evidence: compact<Evidence>([
      currentEvidence(m), trendEvidence(m),
      inc && { label: `Incidents resolved in the last ${inc.windowDays} days`, value: String(inc.count), detail: `median ${h(inc.medianHours)} to recover${inc.medianAckHours !== null ? `, ${h(inc.medianAckHours)} to acknowledge` : ''}` },
      forecastEvidence(m),
    ]),
    items: (inc?.longest ?? []).map((i) => ({ kind: 'incident' as const, name: i.title, detail: `${i.severity}${i.service ? ` · ${i.service}` : ''} · ${h(i.hours)} · opened ${shortDay(i.opened)}` })),
    nextStep: ackShare !== null && ackShare >= 0.3
      ? 'Page the on-call engineer directly from the alert (no e-mail hop) and set a 15-minute acknowledgement target; then write a one-page runbook for the incident types listed and make rollback one command.'
      : 'Write a one-page runbook for the three most frequent incident types, make rollback one command, and run a 30-minute recovery drill this sprint.',
    metricKey: 'mttr_hours',
    effect: historyEffect(m),
    confidence: confidenceOf(!!inc, m),
  };
};

/** A stage that fails often while first-time pass rate is low (CI data). */
export const failingStageRule: Rule = (f) => {
  const m = f.metrics.first_time_pass_rate;
  const st = (f.stages?.failing ?? []).filter((s) => s.runs >= 10 && s.failed / s.runs >= 0.15).sort((a, b) => b.failed / b.runs - a.failed / a.runs)[0];
  if (!st || !needsAttention(m)) return null;
  return {
    ruleKey: 'failing_stage', subjectKey: st.name,
    title: `The “${st.name}” stage fails ${Math.round((st.failed / st.runs) * 100)}% of runs (${st.failed} of ${st.runs} in 30 days)`,
    evidence: compact<Evidence>([currentEvidence(m), { label: `Stage “${st.name}”, last 30 days`, value: `${st.failed} of ${st.runs} runs failed` }, trendEvidence(m)]),
    items: [{ kind: 'stage', name: st.name, detail: `${st.failed} failed of ${st.runs} runs` }],
    nextStep: `Look at the last failed runs of “${st.name}” (Evidence from CI → Failing stages): fix environment or data causes first, and make the stage fail fast with a clear message.`,
    metricKey: 'first_time_pass_rate',
    effect: historyEffect(m),
    confidence: confidenceOf(true, m),
  };
};

/** High-severity technical debt while code quality is low or falling. */
export const technicalDebtRule: Rule = (f) => {
  const m = f.metrics.code_quality_score;
  const items = f.debt.filter((d) => d.severity === 'critical' || d.severity === 'high').slice(0, 3);
  if (!items.length || !needsAttention(m)) return null;
  return {
    ruleKey: 'technical_debt', subjectKey: '',
    title: `Pay down ${items.length === 1 ? `“${items[0].title}”` : `the ${items.length} high-severity debt items`} while code quality is ${fmt(m.current as number, m.unit)}`,
    evidence: compact<Evidence>([currentEvidence(m), trendEvidence(m), { label: 'Open high or critical debt items', value: String(items.length) }]),
    items: items.map((d) => ({ kind: 'debt' as const, name: d.title, detail: `${d.severity}${d.effortHours ? ` · about ${Math.round(d.effortHours)} h of work` : ''}${d.costOfDelay ? ` · cost of delay ${Math.round(d.costOfDelay).toLocaleString('en-GB')} a month (as recorded)` : ''}` })),
    nextStep: `Plan “${items[0].title}” into the next sprint${items[0].effortHours ? ` (about ${Math.round(items[0].effortHours)} hours)` : ''} and reserve about 15% of each sprint for the rest of the list.`,
    metricKey: 'code_quality_score',
    effect: historyEffect(m),
    confidence: confidenceOf(false, m),
  };
};

/** Slow test suite: the slowest tests from CI data. */
export const slowTestsRule: Rule = (f) => {
  const m = f.metrics.test_execution_time_minutes;
  if (!needsAttention(m)) return null;
  const slow = (f.slowTests ?? []).slice(0, 5);
  const share = f.slowTests && f.slowTestsTotalMs && f.slowTestsTotalMs > 0 ? slow.reduce((s, t) => s + t.medianMs, 0) / f.slowTestsTotalMs : null;
  let effect = historyEffect(m);
  if (share !== null && share > 0.01) {
    // Halving the listed tests' time cuts that share of the suite by half (low end: a quarter).
    effect = {
      metric: m.key, label: m.label, unit: m.unit, from: m.current as number, kind: 'improve', horizonWeeks: [2, 6],
      low: (m.current as number) * (1 - share / 4), high: (m.current as number) * (1 - share / 2),
      basis: `the ${slow.length} slowest tests take ${Math.round(share * 100)}% of the test time per run; halving them (low end: a quarter off)`,
    };
  }
  const secs = (ms: number) => (ms >= 60_000 ? `${r1(ms / 60_000)} min` : `${r1(ms / 1000)} s`);
  return {
    ruleKey: 'slow_tests', subjectKey: '',
    title: slow.length
      ? `Speed up the ${slow.length === 1 ? 'slowest test: it takes' : `${slow.length} slowest tests: they take`} ${share !== null ? `${Math.round(share * 100)}% of` : 'most of'} the ${fmt(m.current as number, m.unit)} test run`
      : missTitle(m) ?? `Cut the test run from ${fmt(m.current as number, m.unit)} to ${targetText(m)}`,
    evidence: compact<Evidence>([currentEvidence(m), trendEvidence(m), forecastEvidence(m)]),
    items: slow.map((t) => ({ kind: 'test' as const, name: t.suite ? `${t.suite} › ${t.name}` : t.name, detail: `median ${secs(t.medianMs)} over ${t.runs} runs` })),
    nextStep: slow.length
      ? `Profile “${slow[0].name}” first (median ${secs(slow[0].medianMs)}): replace waits with events, share expensive setup, and split the suite into parallel shards.`
      : 'Send test reports from CI to see the slowest tests; meanwhile split the suite into parallel shards and move end-to-end tests that rarely fail to a nightly run.',
    metricKey: 'test_execution_time_minutes',
    effect,
    confidence: confidenceOf(slow.length > 0, m),
  };
};

/** Changes that fail in production (with the failed deploys and services when sent). */
export const changeFailureRule: Rule = (f) => {
  const m = f.metrics.change_failure_rate;
  if (!needsAttention(m)) return null;
  const deploys = f.metrics.deployment_frequency_per_week;
  const dep = f.deploys && f.deploys.failed > 0 ? f.deploys : null;
  const svc = dep?.services[0] ?? null;
  return {
    ruleKey: 'change_failure', subjectKey: '',
    title: missTitle(m) ?? (dep
      ? `${dep.failed} of ${dep.production} production deploys failed in ${dep.windowDays} days${svc && svc.failed > 1 ? ` (${svc.failed} in ${svc.service})` : ''}: release smaller and behind flags`
      : `${fmt(m.current as number, m.unit)} of changes fail in production (target ${targetText(m)}): release smaller and behind flags`),
    evidence: compact<Evidence>([
      currentEvidence(m),
      trendEvidence(m),
      dep && { label: `Production deploys, last ${dep.windowDays} days`, value: `${dep.failed} failed of ${dep.production}`, detail: 'rolled back, or with a linked incident' },
      deploys && deploys.current !== null ? { label: 'Deployment frequency', value: fmt(deploys.current, deploys.unit) } : null,
      forecastEvidence(m),
    ]),
    items: [
      ...(dep?.services ?? []).map((x) => ({ kind: 'service' as const, name: x.service, detail: `${x.failed} failed of ${x.total} deploys` })),
      ...(dep?.failedList ?? []).map((x) => ({ kind: 'deploy' as const, name: x.id, detail: `${x.service ? `${x.service} · ` : ''}${shortDay(x.day)}` })),
    ],
    nextStep: `Ship behind feature flags with a canary step (5% of traffic for 30 minutes), add a smoke test of the top three user journeys to the deploy${svc ? `, starting with ${svc.service}` : ''}, and write a short note for every failed change in the retro.`,
    metricKey: 'change_failure_rate',
    effect: historyEffect(m),
    confidence: confidenceOf(!!dep, m),
  };
};

export const RULES: Array<{ key: string; rule: Rule }> = [
  { key: 'flaky_tests', rule: flakyTestsRule },
  { key: 'coverage_gap', rule: coverageGapRule },
  { key: 'build_time_regression', rule: buildTimeRule },
  { key: 'escape_falling_coverage', rule: escapeWithFallingCoverageRule },
  { key: 'sizing_drift', rule: sizingDriftRule },
  { key: 'wellbeing_blocked', rule: wellbeingBlockedRule },
  { key: 'mttr_rising', rule: mttrRule },
  { key: 'failing_stage', rule: failingStageRule },
  { key: 'technical_debt', rule: technicalDebtRule },
  { key: 'slow_tests', rule: slowTestsRule },
  { key: 'change_failure', rule: changeFailureRule },
];

/** At most this many recommendations at a time (the highest ranked), so the list stays a plan. */
export const MAX_RECOMMENDATIONS = 6;

export const CONFIDENCE_WEIGHT: Record<Confidence, number> = { high: 1, medium: 0.7, low: 0.4 };

/** Score: expected effect (mid-point) in watch bands of its metric × confidence weight + urgency. */
export function scoreOf(r: Omit<Recommendation, 'score'>, f: TeamFacts): number {
  const m = r.effect ? f.metrics[r.effect.metric] : r.metricKey ? f.metrics[r.metricKey] : undefined;
  let size = 0.25;
  if (r.effect && m) {
    const band = m.target ? Math.abs(m.target.good - m.target.warning) : 0;
    const scale = band > 0 ? band : Math.max(Math.abs(m.current ?? 0) * 0.1, 1e-6);
    const mid = (r.effect.low + r.effect.high) / 2;
    size = Math.abs(mid - r.effect.from) / scale;
  }
  const urgency = m?.forecast?.status === 'ok' && (m.forecast.outlook === 'will_miss' || m.forecast.trend === 'worsening') ? 0.5 : 0;
  return Math.round((Math.min(size, 5) + urgency) * CONFIDENCE_WEIGHT[r.confidence] * 1000) / 1000;
}

/** Run every rule and rank by expected effect (highest first; ties in rule order). */
export function recommend(f: TeamFacts): Recommendation[] {
  const out: Array<Recommendation & { order: number }> = [];
  RULES.forEach(({ rule }, order) => {
    const r = rule(f);
    if (r) out.push({ ...r, score: scoreOf(r, f), order });
  });
  return out.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, MAX_RECOMMENDATIONS).map(({ order: _o, ...r }) => r);
}

