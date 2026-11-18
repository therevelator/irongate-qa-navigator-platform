import React from 'react';
import { Badge, cx, type Tone } from './ui';
import { basedOnText, CONFIDENCE_RULE_TEXT, type Confidence } from '../../server/lib/metricFormulas';

/**
 * How much a composite score (or a value) can be trusted, shown next to it everywhere:
 *   ConfidenceNote  "Based on 3 of 4 inputs" + High / Medium / Low confidence
 *                   (the API's qaScoreConfidence / globalQaScoreConfidence / …Confidence)
 *   StaleNote       "Stale since 12 Nov" for a value older than its expected update interval
 *   SampleMarker    a small "Sample" tag for a value from generated sample data
 */

export interface ConfidenceInfo {
  value?: number | null;
  inputsUsed: number;
  inputsTotal: number;
  confidence: Confidence;
  staleInputs?: string[];
  missingInputs?: string[];
}

const CONFIDENCE_META: Record<Confidence, { label: string; tone: Tone }> = {
  high: { label: 'High confidence', tone: 'good' },
  medium: { label: 'Medium confidence', tone: 'warn' },
  low: { label: 'Low confidence', tone: 'bad' },
};

/** Labels of the QA score inputs (and other composite parts) for the explanation. */
const INPUT_LABEL: Record<string, string> = {
  test_coverage: 'test coverage',
  defect_escape_rate: 'defect escape rate',
  change_failure_rate: 'change failure rate',
  code_quality_score: 'code quality',
  deliveryPerformance: 'delivery',
  pipelineHealth: 'pipeline',
  techDebtStatus: 'tech debt',
  workloadBalance: 'workload balance',
};
const label = (k: string) => INPUT_LABEL[k] ?? k.replace(/_/g, ' ');

export function confidenceExplanation(c: ConfidenceInfo, noun = 'inputs'): string {
  const parts = [`${basedOnText(c, noun).replace(/^b/, 'B')}.`];
  if (c.staleInputs?.length) parts.push(`Stale (left out): ${c.staleInputs.map(label).join(', ')}.`);
  if (c.missingInputs?.length) parts.push(`Not recorded: ${c.missingInputs.map(label).join(', ')}.`);
  parts.push(CONFIDENCE_RULE_TEXT);
  return parts.join(' ');
}

export const ConfidenceNote: React.FC<{
  c: ConfidenceInfo | null | undefined;
  /** What the inputs are: inputs (QA score), teams (company score), components (engineering health). */
  noun?: string;
  className?: string;
  /** Hide the badge (tight spaces such as team cards); the text and tooltip stay. */
  compact?: boolean;
  testId?: string;
}> = ({ c, noun = 'inputs', className, compact, testId }) => {
  if (!c || c.inputsTotal <= 0) return null;
  const meta = CONFIDENCE_META[c.confidence];
  const explanation = confidenceExplanation(c, noun);
  return (
    <span className={cx('inline-flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400', className)} title={explanation} data-testid={testId}>
      <span>{basedOnText(c, noun).replace(/^b/, 'B')}</span>
      {!compact && <Badge tone={meta.tone}>{meta.label}</Badge>}
      <span className="sr-only">{explanation}</span>
    </span>
  );
};

/** 'YYYY-MM-DD…' → '12 Nov' (or '12 Nov 2025' in another year). */
export function shortDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' });
}

export const StaleNote: React.FC<{ staleSince: string | null | undefined; recordedAt?: string | null; className?: string; testId?: string }> = ({ staleSince, recordedAt, className, testId }) => {
  if (!staleSince) return null;
  const since = shortDay(staleSince);
  const recorded = shortDay(recordedAt ?? null);
  return (
    <span
      className={cx('inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400', className)}
      title={`Older than its expected update interval${recorded ? ` (last value recorded ${recorded})` : ''}; shown but left out of composite scores and targets.`}
      data-testid={testId}
    >
      Stale since {since}
    </span>
  );
};

export const SampleMarker: React.FC<{ className?: string }> = ({ className }) => (
  <span
    className={cx('inline-flex items-center rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-slate-600 ring-1 ring-inset ring-slate-300 dark:text-slate-300 dark:ring-slate-600', className)}
    title="Generated sample data (source: synthetic)"
    data-testid="sample-marker"
  >
    Sample
  </span>
);
