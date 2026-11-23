import React from 'react';
import { cx } from './ui';
import { formatAsOf } from '../data/advancedFeatures';

/**
 * Small-print "how is this number made" notes, shown when the
 * "Show formulas & data sources" switch (useShowFormulas) is on.
 */

export type FormulaNoteRow = [label: string, value: React.ReactNode] | null | false | undefined;

/** Definition list in small print. `stacked` puts each label above its value (narrow tiles). */
export const FormulaNote: React.FC<{ rows: FormulaNoteRow[]; className?: string; stacked?: boolean }> = ({ rows, className, stacked }) => (
  <dl
    className={cx(
      'grid border-l-2 border-slate-200 pl-3 text-[11px] leading-snug text-slate-500 dark:border-slate-700 dark:text-slate-400',
      stacked ? 'grid-cols-1 gap-y-0.5' : 'grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1',
      className,
    )}
  >
    {rows.filter((r): r is [string, React.ReactNode] => Boolean(r)).map(([label, value]) => (
      <React.Fragment key={label}>
        <dt className={cx('font-medium text-slate-600 dark:text-slate-300', stacked && 'mt-1 first:mt-0')}>{label}</dt>
        <dd className="min-w-0 break-words">{value}</dd>
      </React.Fragment>
    ))}
  </dl>
);

/** Database column / code identifier in the notes. */
export const Code: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <code className="break-all font-mono text-[11px] text-slate-600 dark:text-slate-300">{children}</code>
);

export const FormulaSwitch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label?: string }> = ({
  checked,
  onChange,
  label = 'Show formulas & data sources',
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className="inline-flex h-9 items-center gap-2.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 transition-colors"
  >
    <span
      aria-hidden="true"
      className={cx(
        'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-brand-700 dark:bg-brand-500' : 'bg-slate-300 dark:bg-slate-600',
      )}
    >
      <span
        className={cx(
          'inline-block h-3 w-3 rounded-full bg-white transition-transform',
          checked ? 'translate-x-3.5' : 'translate-x-0.5',
        )}
      />
    </span>
    {label}
  </button>
);

export interface FieldSource {
  source?: string | null;
  recorded_at?: string | null;
  carried_forward?: boolean;
}

/** Human label for a field_sources source value. */
export function sourceLabel(source: string | null | undefined): string {
  const s = (source ?? '').trim().toLowerCase();
  if (!s) return 'not recorded';
  if (s === 'manual') return 'manual entry';
  if (s === 'synthetic') return 'sample data';
  if (s === 'computed') return 'calculated from CI data';
  if (s === 'unknown') return 'unknown source';
  return `ingestion API (${source})`;
}

/**
 * "manual entry · 18 Nov 2026", "sample data · snapshot 18 Nov 2026" (no recorded_at stored)
 * or "not recorded" when the latest snapshot has no provenance for the column.
 */
export function describeFieldSource(fs: FieldSource | null | undefined, snapshotDate?: string | null): string {
  if (!fs || !fs.source) return 'not recorded';
  const parts = [sourceLabel(fs.source)];
  const recorded = formatAsOf(fs.recorded_at ?? null);
  const snapshot = formatAsOf(snapshotDate ?? null);
  if (recorded) parts.push(recorded);
  else if (snapshot) parts.push(`snapshot ${snapshot}`);
  if (fs.carried_forward) parts.push('carried forward from an earlier snapshot');
  return parts.join(' · ');
}
