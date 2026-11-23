import React from 'react';

/**
 * Shared presentation primitives for the IronGate design system.
 * Keep pages visually consistent by composing these instead of
 * hand-rolling card / tile / badge styles per screen.
 */

export const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

export const Page: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cx('mx-auto w-full max-w-[1400px] px-4 sm:px-8 py-6 sm:py-8', className)}>{children}</div>
);

export const PageIntro: React.FC<{ title: string; description?: React.ReactNode; actions?: React.ReactNode }> = ({ title, description, actions }) => (
  <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div className="min-w-0">
      <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h2>
      {description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

export const Card: React.FC<{ children: React.ReactNode; className?: string; padded?: boolean }> = ({ children, className, padded = true }) => (
  <section
    className={cx(
      'rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
      padded && 'p-5',
      className,
    )}
  >
    {children}
  </section>
);

export const CardHeader: React.FC<{ title: string; subtitle?: React.ReactNode; action?: React.ReactNode }> = ({ title, subtitle, action }) => (
  <div className="mb-4 flex items-start justify-between gap-4">
    <div>
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
    </div>
    {action}
  </div>
);

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'brand';

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-slate-600 dark:text-slate-300',
  good: 'text-green-700 dark:text-green-400',
  warn: 'text-amber-700 dark:text-amber-400',
  bad: 'text-red-700 dark:text-red-400',
  brand: 'text-brand-700 dark:text-brand-300',
};
const TONE_BADGE: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
  good: 'bg-green-50 text-green-800 ring-green-200 dark:bg-green-950/40 dark:text-green-300 dark:ring-green-900',
  warn: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900',
  bad: 'bg-red-50 text-red-800 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900',
  brand: 'bg-brand-50 text-brand-800 ring-brand-200 dark:bg-brand-950/40 dark:text-brand-200 dark:ring-brand-900',
};
const TONE_BAR: Record<Tone, string> = {
  neutral: 'bg-slate-400',
  good: 'bg-green-600',
  warn: 'bg-amber-500',
  bad: 'bg-red-600',
  brand: 'bg-brand-600',
};

export const toneText = (t: Tone) => TONE_TEXT[t];
export const toneBar = (t: Tone) => TONE_BAR[t];

/** 0–100 score → tone, using the platform's standard thresholds. */
export const scoreTone = (score: number | null | undefined, good = 80, warn = 60): Tone =>
  score == null || Number.isNaN(score) ? 'neutral' : score >= good ? 'good' : score >= warn ? 'warn' : 'bad';

export const Badge: React.FC<{ tone?: Tone; children: React.ReactNode; className?: string }> = ({ tone = 'neutral', children, className }) => (
  <span className={cx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', TONE_BADGE[tone], className)}>
    {children}
  </span>
);

export const ProgressBar: React.FC<{ value: number; max?: number; tone?: Tone; className?: string }> = ({ value, max = 100, tone = 'brand', className }) => {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800', className)}>
      <div className={cx('h-full rounded-full', TONE_BAR[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
};

export const StatTile: React.FC<{
  label: string;
  value: React.ReactNode;
  unit?: string;
  caption?: React.ReactNode;
  tone?: Tone;
  progress?: number;
}> = ({ label, value, unit, caption, tone = 'neutral', progress }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
    <p className="mt-2 flex items-baseline gap-1">
      <span className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white tabular-nums">{value}</span>
      {unit && <span className="text-sm text-slate-500 dark:text-slate-400">{unit}</span>}
    </p>
    {progress != null && <ProgressBar value={progress} tone={tone} className="mt-3" />}
    {caption && <p className={cx('mt-2 text-xs', tone === 'neutral' ? 'text-slate-500 dark:text-slate-400' : TONE_TEXT[tone])}>{caption}</p>}
  </div>
);

export function SegmentedControl<T extends string>({ value, onChange, options }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex max-w-full overflow-x-auto sm:shrink-0 rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'px-3 py-1.5 text-sm rounded whitespace-nowrap transition-colors',
            value === o.value
              ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const buttonClass = {
  primary: 'inline-flex items-center justify-center gap-2 h-9 px-3.5 rounded-md bg-brand-700 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-60 transition-colors',
  secondary: 'inline-flex items-center justify-center gap-2 h-9 px-3.5 rounded-md border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 transition-colors',
};

export const inputClass =
  'h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

export const EmptyState: React.FC<{ title: string; description?: string; icon?: React.ReactNode }> = ({ title, description, icon }) => (
  <div className="flex flex-col items-center justify-center py-14 text-center">
    {icon && <div className="mb-3 text-slate-400">{icon}</div>}
    <p className="text-sm font-medium text-slate-900 dark:text-white">{title}</p>
    {description && <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>}
  </div>
);
