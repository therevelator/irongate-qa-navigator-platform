/**
 * Developer health assessment — one weighted list of concerns per developer,
 * from which the status, summary and suggestion are all derived.
 *
 * Rules (thresholds per day unless noted; wellbeing = happiness_score on 0–100):
 *   weight 2: focus time < 3 h, meetings > 4 h, context switches > 6, wellbeing < 50
 *   weight 1: PR merge time > 24 h, code review turnaround > 4 h
 *   status:   'at-risk'          if total weight ≥ 3 OR wellbeing < 50
 *             'needs-attention'  if total weight ≥ 1
 *             'healthy'          otherwise (no concerns in the measured metrics)
 *   A developer with no metric recorded at all is 'needs-attention' ("No metrics recorded").
 *   Severity is monotonic: adding a concern or raising its weight never lowers the status.
 *   Missing inputs are reported as "not measured" and never count as good.
 *   Praise is only given when there are zero concerns AND every input was measured.
 */

import { toNum } from './metricFormulas';

export type DeveloperStatus = 'healthy' | 'needs-attention' | 'at-risk';
export const DEVELOPER_STATUSES: readonly DeveloperStatus[] = ['healthy', 'needs-attention', 'at-risk'];
const STATUS_RANK: Record<DeveloperStatus, number> = { healthy: 0, 'needs-attention': 1, 'at-risk': 2 };

export const DEVELOPER_THRESHOLDS = {
  focusLowHours: 3,          // concern below
  focusGoodHours: 5,         // strength at/above
  meetingsHighHours: 4,      // concern above
  meetingsGoodHours: 2,      // strength at/below
  contextSwitchesHigh: 6,    // concern above
  contextSwitchesGood: 3,    // strength at/below
  wellbeingLow: 50,          // concern below (0–100 scale)
  wellbeingGood: 70,         // strength at/above (0–100 scale)
  prMergeSlowHours: 24,      // concern above
  prMergeFastHours: 4,       // strength at/below
  reviewSlowHours: 4,        // concern above
  reviewFastHours: 2,        // strength at/below
} as const;

export const DEVELOPER_RULES_TEXT =
  'Concerns — weight 2: focus < 3 h/day, meetings > 4 h/day, context switches > 6/day, wellbeing (happiness score, 0–100) < 50; ' +
  'weight 1: PR merge time > 24 h, code review turnaround > 4 h. ' +
  'Status: at-risk if total weight ≥ 3 or wellbeing < 50; needs-attention if total weight ≥ 1; otherwise healthy. ' +
  'Missing values are shown as not measured and never count as good.';

export interface DeveloperMetricsInput {
  developerId?: string;
  name: string;
  prMergeTimeHours: number | null;
  codeReviewTimeHours: number | null;
  focusTimeHours: number | null;
  meetingTimeHours: number | null;
  contextSwitchesPerDay: number | null;
  happinessScore: number | null;
}

type ConcernKey = 'wellbeing' | 'focus' | 'meetings' | 'contextSwitches' | 'prMerge' | 'review';

interface Concern {
  key: ConcernKey;
  label: string;
  weight: 1 | 2;
  suggestion: string;
}

export interface DeveloperAssessment {
  developerId?: string;
  name: string;
  status: DeveloperStatus;
  summary: string;
  strengths: string[];
  concerns: string[];
  suggestion: string;
  /** Sum of concern weights. */
  concernWeight: number;
  /** Inputs with no recorded value. */
  notMeasured: string[];
  /** Plausibility warnings about the input values (e.g. placeholder-looking data). */
  dataQualityWarnings: string[];
}

// Fixed priority used to break ties between concerns of equal weight.
const PRIORITY: ConcernKey[] = ['wellbeing', 'focus', 'meetings', 'contextSwitches', 'prMerge', 'review'];

const SUGGESTIONS: Record<ConcernKey, string> = {
  wellbeing:
    'Hold a 1:1 this week about workload and wellbeing, and agree one concrete change (for example dropping a recurring meeting or rebalancing on-call).',
  focus:
    'Protect 2–3 hours of no-meeting focus time each day (calendar focus blocks) and batch meetings into one part of the day.',
  meetings:
    'Review recurring meetings: decline or shorten those without a clear agenda or owner, and aim for no more than 4 hours a day (ideally 2).',
  contextSwitches:
    'Cut interruptions: limit work in progress to 1–2 items, batch chat and notifications, and route ad-hoc requests through a rotating on-call person.',
  prMerge:
    'Keep pull requests small and agree a team target of merging within 24 hours so changes do not wait.',
  review:
    'Set a code-review SLA (first response within 4 hours) and a reviewer rotation so reviews do not queue.',
};

const INPUT_LABELS: Record<Exclude<keyof DeveloperMetricsInput, 'developerId' | 'name'>, string> = {
  prMergeTimeHours: 'PR merge time',
  codeReviewTimeHours: 'code review time',
  focusTimeHours: 'focus time',
  meetingTimeHours: 'meeting time',
  contextSwitchesPerDay: 'context switches',
  happinessScore: 'wellbeing score',
};

const fmt = (n: number, digits = 1) => (Number.isInteger(n) ? String(n) : n.toFixed(digits));

export function normaliseDeveloperStatus(value: unknown): DeveloperStatus | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
  return (DEVELOPER_STATUSES as readonly string[]).includes(v) ? (v as DeveloperStatus) : null;
}

export function statusRank(status: DeveloperStatus): number {
  return STATUS_RANK[status];
}

/** Build the metrics payload from a developer_metrics row (null = not measured). */
export function developerMetricsFromRow(row: any): DeveloperMetricsInput {
  return {
    developerId: row.developer_id,
    name: row.name,
    prMergeTimeHours: toNum(row.pr_merge_time_avg),
    codeReviewTimeHours: toNum(row.code_review_time_avg),
    focusTimeHours: toNum(row.focus_time_hours),
    meetingTimeHours: toNum(row.meeting_time_hours),
    contextSwitchesPerDay: toNum(row.context_switches_per_day),
    happinessScore: toNum(row.happiness_score),
  };
}

export function assessDeveloper(dev: DeveloperMetricsInput): DeveloperAssessment {
  const T = DEVELOPER_THRESHOLDS;
  const concerns: Concern[] = [];
  const strengths: string[] = [];

  const { focusTimeHours: focus, meetingTimeHours: meetings, contextSwitchesPerDay: cs,
    happinessScore: wellbeing, prMergeTimeHours: pr, codeReviewTimeHours: review } = dev;

  // Wellbeing (0–100)
  if (wellbeing !== null) {
    if (wellbeing < T.wellbeingLow) {
      concerns.push({ key: 'wellbeing', weight: 2, label: `Low wellbeing score (${fmt(wellbeing, 0)}/100)`, suggestion: SUGGESTIONS.wellbeing });
    } else if (wellbeing >= T.wellbeingGood) {
      strengths.push(`Good wellbeing score (${fmt(wellbeing, 0)}/100)`);
    }
  }
  // Focus
  if (focus !== null) {
    if (focus < T.focusLowHours) {
      concerns.push({ key: 'focus', weight: 2, label: `Low focus time (${fmt(focus)} h/day)`, suggestion: SUGGESTIONS.focus });
    } else if (focus >= T.focusGoodHours) {
      strengths.push(`Good focus time (${fmt(focus)} h/day)`);
    }
  }
  // Meetings
  if (meetings !== null) {
    if (meetings > T.meetingsHighHours) {
      concerns.push({ key: 'meetings', weight: 2, label: `Too many meetings (${fmt(meetings)} h/day)`, suggestion: SUGGESTIONS.meetings });
    } else if (meetings <= T.meetingsGoodHours) {
      strengths.push(`Light meeting load (${fmt(meetings)} h/day)`);
    }
  }
  // Context switches
  if (cs !== null) {
    if (cs > T.contextSwitchesHigh) {
      concerns.push({ key: 'contextSwitches', weight: 2, label: `High context switching (${fmt(cs)}/day)`, suggestion: SUGGESTIONS.contextSwitches });
    } else if (cs <= T.contextSwitchesGood) {
      strengths.push(`Few context switches (${fmt(cs)}/day)`);
    }
  }
  // PR merge time
  if (pr !== null) {
    if (pr > T.prMergeSlowHours) {
      concerns.push({ key: 'prMerge', weight: 1, label: `Slow PR merges (${fmt(pr)} h)`, suggestion: SUGGESTIONS.prMerge });
    } else if (pr <= T.prMergeFastHours) {
      strengths.push(`Fast PR turnaround (${fmt(pr)} h)`);
    }
  }
  // Review turnaround
  if (review !== null) {
    if (review > T.reviewSlowHours) {
      concerns.push({ key: 'review', weight: 1, label: `Slow code reviews (${fmt(review)} h)`, suggestion: SUGGESTIONS.review });
    } else if (review <= T.reviewFastHours) {
      strengths.push(`Quick code reviews (${fmt(review)} h)`);
    }
  }

  const notMeasured = (Object.keys(INPUT_LABELS) as Array<keyof typeof INPUT_LABELS>)
    .filter((k) => dev[k] === null)
    .map((k) => INPUT_LABELS[k]);
  const nothingMeasured = notMeasured.length === Object.keys(INPUT_LABELS).length;

  // Order concerns by weight (desc), then fixed priority.
  concerns.sort((a, b) => b.weight - a.weight || PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key));
  const concernWeight = concerns.reduce((s, c) => s + c.weight, 0);
  const hasWellbeingConcern = concerns.some((c) => c.key === 'wellbeing');

  let status: DeveloperStatus;
  if (concernWeight >= 3 || hasWellbeingConcern) status = 'at-risk';
  else if (concernWeight >= 1) status = 'needs-attention';
  else if (nothingMeasured) status = 'needs-attention';
  else status = 'healthy';

  const notMeasuredText = notMeasured.length > 0 ? ` Not measured: ${notMeasured.join(', ')}.` : '';

  let summary: string;
  let suggestion: string;
  if (nothingMeasured) {
    summary = 'No metrics recorded, so this developer cannot be assessed.';
    suggestion = 'Record this developer’s metrics before drawing conclusions.';
  } else if (concerns.length === 0) {
    if (notMeasured.length === 0) {
      summary = 'All measured metrics are within healthy ranges.';
      suggestion = 'Keep up the good work.';
    } else {
      summary = `No concerns in the metrics that were recorded.${notMeasuredText}`;
      suggestion = `Record the missing metrics (${notMeasured.join(', ')}) to complete the assessment.`;
    }
  } else {
    summary = `${concerns.length} area${concerns.length === 1 ? '' : 's'} need${concerns.length === 1 ? 's' : ''} attention: ${concerns.map((c) => c.label).join('; ')}.${notMeasuredText}`;
    suggestion = concerns.slice(0, 2).map((c) => c.suggestion).join(' ');
  }

  // Plausibility checks (do not change the status; flag possible placeholder data).
  const dataQualityWarnings: string[] = [];
  const measuredValues = [pr, review, focus, meetings, cs].filter((v): v is number => v !== null);
  if (measuredValues.length === 5 && measuredValues.every((v) => v === measuredValues[0])) {
    dataQualityWarnings.push(`PR, review, focus, meeting and context-switch values are all ${fmt(measuredValues[0])}; this may be placeholder or test data.`);
  }
  if (focus !== null && meetings !== null && focus + meetings > 12) {
    dataQualityWarnings.push(`Focus plus meeting time is ${fmt(focus + meetings)} h/day, which is implausibly high.`);
  }

  return {
    developerId: dev.developerId,
    name: dev.name,
    status,
    summary,
    strengths,
    concerns: concerns.map((c) => c.label),
    suggestion,
    concernWeight,
    notMeasured,
    dataQualityWarnings,
  };
}

export function summariseTeamDevelopers(assessments: DeveloperAssessment[]): string {
  const n = assessments.length;
  const healthy = assessments.filter((a) => a.status === 'healthy').length;
  const needs = assessments.filter((a) => a.status === 'needs-attention').length;
  const atRisk = assessments.filter((a) => a.status === 'at-risk').length;
  return `${healthy} of ${n} developer${n === 1 ? '' : 's'} have no flagged concerns; ${needs} need attention; ${atRisk} at risk.`;
}
