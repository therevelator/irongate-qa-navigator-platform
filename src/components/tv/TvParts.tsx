import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, ReferenceLine, ResponsiveContainer, CartesianGrid } from 'recharts';
import ScoreVisual from '../ScoreVisual';
import ScoreGauge from '../ScoreGauge';
import { fitGaugeWidth, GAUGE_SIZES } from '../../lib/gaugeGeometry';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemeId } from '../../lib/appearance';
import { expectationText } from '../../lib/targetText';
import { cx, type Tone } from '../ui';
import type { DetailedKPI, KPIStatus } from '../../data/detailedKPIs';
import type { HistoryPoint, KpiChange } from '../../data/kpiTrend';
import { chartTheme, formatAsOf } from '../../data/advancedFeatures';
import { targetOnDay, type TargetPeriod } from '../../config/metricsConfig';

/* Presentation pieces of Team TV mode (TeamTvView.tsx). Sizes are in rem: TV mode scales the
   root font size with the screen, so everything grows together from 1366×768 to 3840×2160. */

export const STATUS_META: Record<KPIStatus, { label: string; tone: Tone; bar: string; text: string; pill: string }> = {
  good: {
    label: 'On target', tone: 'good', bar: 'bg-green-600 dark:bg-green-500',
    text: 'text-green-700 dark:text-green-400',
    pill: 'bg-green-50 text-green-800 ring-green-300 dark:bg-green-950/60 dark:text-green-300 dark:ring-green-800',
  },
  warning: {
    label: 'Watch', tone: 'warn', bar: 'bg-amber-500 dark:bg-amber-400',
    text: 'text-amber-700 dark:text-amber-400',
    pill: 'bg-amber-50 text-amber-900 ring-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-800',
  },
  critical: {
    label: 'Off target', tone: 'bad', bar: 'bg-red-600 dark:bg-red-500',
    text: 'text-red-700 dark:text-red-400',
    pill: 'bg-red-50 text-red-800 ring-red-300 dark:bg-red-950/60 dark:text-red-300 dark:ring-red-800',
  },
  neutral: {
    label: 'Tracked', tone: 'neutral', bar: 'bg-slate-400 dark:bg-slate-500',
    text: 'text-slate-600 dark:text-slate-300',
    pill: 'bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700',
  },
  'no-data': {
    label: 'No data', tone: 'neutral', bar: 'bg-slate-300 dark:bg-slate-700',
    text: 'text-slate-500 dark:text-slate-400',
    pill: 'bg-slate-100 text-slate-600 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
  },
};

const TREND_TEXT: Record<Tone, string> = {
  good: 'text-green-700 dark:text-green-400',
  bad: 'text-red-700 dark:text-red-400',
  warn: 'text-amber-700 dark:text-amber-400',
  neutral: 'text-slate-600 dark:text-slate-300',
  brand: 'text-brand-700 dark:text-brand-300',
};

/** "%" → "%", "/week" → " / week", "min" → " min". */
export const unitSuffix = (unit: string) => (!unit ? '' : unit === '%' ? '%' : unit.startsWith('/') ? ` / ${unit.slice(1)}` : ` ${unit}`);

export const fmtValue = (v: number | null, digits = 1) =>
  v == null ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** "Target ≥ 80%", and for Watch the band too ("Watch: 70–80% · Target ≥ 80%"): src/lib/targetText.ts. */
export const targetText = (k: Pick<DetailedKPI, 'threshold' | 'unit'> & { status?: DetailedKPI['status'] }) =>
  expectationText(k.threshold, k.unit, k.status);

/** "17 Nov" (no year: TV mode shows the last 90 days). */
export const shortDate = (d: string) => {
  const t = new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

/**
 * Change vs the previous snapshot: arrow + amount + a word ("better" / "worse"), so it never
 * relies on colour alone. `compact` leaves out the date (KPI tiles say it once in the panel).
 */
export const TrendText: React.FC<{ change: KpiChange | null; unit: string; digits?: number; compact?: boolean; className?: string }> = ({ change, unit, digits = 1, compact, className }) => {
  if (!change) return <span className={cx('text-slate-500 dark:text-slate-400', className)}>No earlier snapshot</span>;
  const Icon = change.direction === 'up' ? TrendingUp : change.direction === 'down' ? TrendingDown : Minus;
  const amount = Math.abs(change.delta).toFixed(digits);
  const u = unit === '%' || unit === '/100' ? ' pts' : unitSuffix(unit);
  const word = change.direction === 'flat' ? 'no change' : change.tone === 'good' ? 'better' : change.tone === 'bad' ? 'worse' : change.direction === 'up' ? 'up' : 'down';
  return (
    <span className={cx('inline-flex items-center gap-[0.4em] whitespace-nowrap', TREND_TEXT[change.tone], className)}>
      <Icon className="h-[1.1em] w-[1.1em] flex-shrink-0" aria-hidden />
      <span className="font-semibold tabular-nums">
        {change.direction === 'flat' ? `±0${u}` : `${change.delta > 0 ? '+' : '−'}${amount}${u}`}
      </span>
      <span className="text-slate-600 dark:text-slate-300">
        · {word}{compact ? '' : ` since ${shortDate(change.prevDate) || 'the previous snapshot'}`}
      </span>
    </span>
  );
};

/**
 * The score visual (3D battery or gauge, as chosen in the Appearance menu), filling the space it
 * is given (crisp: CSS gradients / SVG).
 *  - Battery: scaled to the height it is given (its lg box is 166 px tall with the nib); the box
 *    is as wide as the scaled battery.
 *  - Gauge: wider than tall, so it fills the box its parent gives it (TeamTvView: the middle of
 *    the hero, between the title and the status), as large as fits both ways with its needle
 *    (fitGaugeWidth, from the gauge's own layout), centred. Drawn at that size (no CSS scale), so
 *    the arc, the needle and the number stay sharp on a 4K screen.
 */
export const ScaledBattery: React.FC<{ value: number | null; good: number; warn: number; label: string }> = ({ value, good, warn, label }) => {
  const { scoreDisplay } = useTheme();
  return scoreDisplay === 'gauge'
    ? <FittedGauge value={value} good={good} warn={warn} label={label} />
    : <ScaledHeroBattery value={value} good={good} warn={warn} label={label} />;
};

const ScaledHeroBattery: React.FC<{ value: number | null; good: number; warn: number; label: string }> = ({ value, good, warn, label }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(2);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setK(Math.max(0.5, el.clientHeight / 166));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="flex h-full flex-shrink-0 items-center justify-center" style={{ width: 84 * k }} data-testid="tv-battery">
      <div style={{ transform: `scale(${k})`, transformOrigin: 'center' }}>
        <ScoreVisual value={value} good={good} warn={warn} size="lg" label={label} variant="battery" />
      </div>
    </div>
  );
};

const FittedGauge: React.FC<{ value: number | null; good: number; warn: number; label: string }> = ({ value, good, warn, label }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState<number>(GAUGE_SIZES.lg);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(fitGaugeWidth(el.clientWidth, el.clientHeight, GAUGE_SIZES.sm));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="flex h-full w-full min-w-0 items-center justify-center" data-testid="tv-battery" data-gauge-width={w}>
      <ScoreGauge value={value} good={good} warn={warn} size="lg" width={w} label={label} />
    </div>
  );
};

/** Current root font size in px (TV mode scales it with the screen); charts use it for their text. */
export const useRootPx = () => {
  const read = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const [px, setPx] = useState(read);
  useEffect(() => {
    const onResize = () => setPx(read());
    window.addEventListener('resize', onResize);
    const t = window.setTimeout(onResize, 0);
    return () => { window.removeEventListener('resize', onResize); window.clearTimeout(t); };
  }, []);
  return px;
};

export const Sparkline: React.FC<{ history: HistoryPoint[]; isDark: boolean; theme?: ThemeId; tone: Tone }> = ({ history, isDark, theme, tone }) => {
  const ct = chartTheme(theme ?? isDark);
  const stroke = tone === 'good' ? (isDark ? '#22c55e' : '#16a34a') : tone === 'warn' ? (isDark ? '#fbbf24' : '#d97706') : tone === 'bad' ? (isDark ? '#ef4444' : '#dc2626') : ct.series;
  if (history.length < 2) {
    return <p className="flex h-full items-end text-[1.05rem] text-slate-500 dark:text-slate-400">{history.length === 1 ? 'One snapshot so far' : 'No history yet'}</p>;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={history} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Area type="monotone" dataKey="value" stroke={stroke} strokeWidth={3} fill={stroke} fillOpacity={0.12} isAnimationActive={false} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
};

export interface TvKpi {
  kpi: DetailedKPI;
  label: string;
  digits: number;
  history: HistoryPoint[];
  change: KpiChange | null;
  /** The latest value is older than its expected update interval: shown, not judged. */
  stale?: { staleSince: string | null; recordedAt: string | null } | null;
}

export const KpiTile: React.FC<{ item: TvKpi; isDark: boolean; theme?: ThemeId }> = ({ item, isDark, theme }) => {
  const { kpi, label, digits, history, change, stale } = item;
  const meta = stale ? { ...STATUS_META.neutral, label: 'Stale' } : STATUS_META[kpi.status];
  const target = targetText(kpi);
  return (
    <article
      className="relative flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white py-5 pl-8 pr-6 dark:border-slate-800 dark:bg-slate-900"
      aria-label={`${label}: ${kpi.value == null ? 'no data' : `${fmtValue(kpi.value, digits)}${unitSuffix(kpi.unit)}`}, ${meta.label}`}
      data-testid="tv-kpi"
      data-status={stale ? 'stale' : kpi.status}
    >
      <span aria-hidden className={cx('absolute inset-y-0 left-0 w-[0.6rem]', meta.bar)} />
      <h3 className="truncate pb-[0.1em] text-[1.6rem] font-medium leading-snug text-slate-700 dark:text-slate-200" title={label}>{label}</h3>
      <p className="mt-1 flex items-baseline gap-2">
        <span className={cx('text-[4.25rem] font-semibold leading-none tracking-tight tabular-nums', kpi.value == null || stale ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-white')}>
          {fmtValue(kpi.value, digits)}
        </span>
        {kpi.value != null && kpi.unit && <span className="whitespace-nowrap text-[1.9rem] font-medium text-slate-500 dark:text-slate-400">{unitSuffix(kpi.unit).trim()}</span>}
      </p>
      <p className="mt-3 flex flex-wrap items-center gap-x-[1em] text-[1.3rem] text-slate-600 dark:text-slate-300">
        <span className={cx('inline-flex items-center gap-[0.4em] font-semibold', meta.text)} data-testid="tv-kpi-status">
          <span aria-hidden className={cx('h-[0.65em] w-[0.65em] rounded-full', meta.bar)} />
          {meta.label}
        </span>
        {target && <span className="whitespace-nowrap">{target}</span>}
      </p>
      <p className="mt-1 text-[1.3rem]">
        {kpi.value == null ? <span className="text-slate-500 dark:text-slate-400">Not recorded</span>
          : stale ? <span className="font-medium text-amber-700 dark:text-amber-400" data-testid="tv-kpi-stale">Stale since {stale.staleSince ? shortDate(stale.staleSince) : '—'} · not judged</span>
            : <TrendText change={change} unit={kpi.unit} digits={digits} compact />}
      </p>
      <div className="mt-3 min-h-[2.5rem] flex-1">
        <Sparkline history={history} isDark={isDark} theme={theme} tone={meta.tone} />
      </div>
    </article>
  );
};

export const TrendChart: React.FC<{
  title: string;
  history: HistoryPoint[];
  unit: string;
  target: number | null;
  digits: number;
  isDark: boolean;
  rootPx: number;
  current: React.ReactNode;
  /** Target history in the window: each day is drawn with the target valid on that day. */
  targetPeriods?: TargetPeriod[];
  /** The theme on screen (TV mode's own); defaults from isDark. */
  theme?: ThemeId;
}> = ({ title, history, unit, target, digits, isDark, theme, rootPx, current, targetPeriods }) => {
  const ct = chartTheme(theme ?? isDark);
  // A target that changed inside the window is drawn as a step line (the target of each day).
  const dayTargets = targetPeriods?.length ? history.map((p) => targetOnDay(targetPeriods, p.date)?.good ?? null) : [];
  const changing = new Set(dayTargets.filter((v): v is number => v != null)).size > 1;
  const data = changing ? history.map((p, i) => ({ ...p, target: dayTargets[i] })) : history;
  const targetValues = changing ? dayTargets.filter((v): v is number => v != null) : [];
  const tick = { fill: isDark ? '#cbd5e1' : '#475569', fontSize: Math.round(rootPx * 1.05) };
  const fmtDay = (d: string) => {
    const t = new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  };
  const values = history.map((p) => p.value).concat(target != null ? [target] : []).concat(targetValues);
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 1;
  const pad = Math.max((hi - lo) * 0.15, hi === lo ? Math.abs(hi) * 0.1 || 1 : 0);
  return (
    <article className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900" data-testid="tv-trend">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-[1.6rem] font-medium text-slate-700 dark:text-slate-200">{title}</h3>
        <div className="text-[1.6rem] font-semibold tabular-nums text-slate-900 dark:text-white">{current}</div>
      </div>
      {changing && target != null && (
        <p className="text-[1.15rem] text-green-800 dark:text-green-300" data-testid="tv-trend-target-changed">
          Dashed line: the target of each day (changed in this period, now {target}{unitSuffix(unit)})
        </p>
      )}
      <div className="mt-3 min-h-0 flex-1" role="img" aria-label={`${title} over the last 90 days${changing ? `, target changed in this period, now ${target}${unitSuffix(unit)}` : target != null ? `, target ${target}${unitSuffix(unit)}` : ''}`}>
        {history.length < 2 ? (
          <p className="flex h-full items-center justify-center text-[1.4rem] text-slate-500 dark:text-slate-400">
            {history.length === 1 ? 'Only one snapshot in the last 90 days' : 'No snapshots in the last 90 days'}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: rootPx * 0.6, right: rootPx * 0.8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={ct.grid} vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDay} tick={tick} stroke={ct.grid} minTickGap={rootPx * 4} tickMargin={rootPx * 0.4} />
              <YAxis
                tick={tick}
                stroke={ct.grid}
                width={rootPx * 4.2}
                domain={[Math.floor((lo - pad) * 10) / 10, Math.ceil((hi + pad) * 10) / 10]}
                tickFormatter={(v: number) => Number(v).toFixed(v >= 100 ? 0 : digits === 0 ? 0 : 1)}
                tickCount={4}
              />
              {changing && (
                <Area type="stepAfter" dataKey="target" name="Target" stroke={isDark ? '#4ade80' : '#15803d'} strokeDasharray="8 6" strokeWidth={2} fill="none" fillOpacity={0} dot={false} isAnimationActive={false} connectNulls />
              )}
              {!changing && target != null && (
                <ReferenceLine
                  y={target}
                  stroke={isDark ? '#4ade80' : '#15803d'}
                  strokeDasharray="8 6"
                  strokeWidth={2}
                  label={{ value: `Target ${target}${unitSuffix(unit)}`, position: 'insideTopRight', fill: isDark ? '#86efac' : '#166534', fontSize: Math.round(rootPx * 1.05) }}
                />
              )}
              <Area type="monotone" dataKey="value" stroke={ct.series} strokeWidth={3.5} fill={ct.series} fillOpacity={0.14} isAnimationActive={false} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </article>
  );
};

/** Wall clock; re-renders on its own so the rest of the screen does not tick every second. */
export const Clock: React.FC = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="text-right" data-testid="tv-clock">
      <p className="text-[4.5rem] font-semibold leading-none tracking-tight tabular-nums text-slate-900 dark:text-white">
        {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </p>
      <p className="mt-3 text-[1.6rem] text-slate-600 dark:text-slate-300">
        {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
      </p>
    </div>
  );
};
