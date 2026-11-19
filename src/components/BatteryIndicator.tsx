import React, { useEffect, useState } from 'react';
import { QA_SCORE_THRESHOLDS } from '../../server/lib/metricFormulas';
import { batteryBand, BATTERY_SHELL_CSS } from '../lib/batteryScale';

/**
 * Battery gauges for 0–100 scores.
 *
 * The fill colour is the value's band of the one battery scale (src/lib/batteryScale.ts), on the
 * same dark shell as the 3D battery in both themes. A missing value renders an empty grey battery
 * labelled "—", never 0. The only motion is a short fill transition
 * on first render, which is switched off for prefers-reduced-motion.
 */

export type GaugeStatus = 'good' | 'warning' | 'critical' | 'none';

export const clampScore = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
};

export const gaugeStatus = (
  value: number | null,
  good: number = QA_SCORE_THRESHOLDS.good,
  warn: number = QA_SCORE_THRESHOLDS.warning,
): GaugeStatus => (value == null ? 'none' : value >= good ? 'good' : value >= warn ? 'warning' : 'critical');

/** Fill colour per status (new palette: green / ochre / crimson, slate for no data). */
export const GAUGE_FILL: Record<GaugeStatus, string> = {
  good: 'bg-green-600 dark:bg-green-500',
  warning: 'bg-amber-500 dark:bg-amber-400',
  critical: 'bg-red-600 dark:bg-red-500',
  none: 'bg-transparent',
};

/** Animate from 0 to the value once mounted (the CSS transition is disabled for reduced motion). */
export const useMountedFill = (pct: number) => {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);
  return shown;
};

interface BatteryIndicatorProps {
  percentage: number | string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** value at/above which the fill is green (default: QA score "good" threshold) */
  good?: number;
  /** value at/above which the fill is amber (default: QA score "warning" threshold) */
  warn?: number;
  label?: string;
  /** show the number next to the battery (default true) */
  showValue?: boolean;
  /** Accepted for backwards compatibility and ignored. */
  mode?: 'flat' | '3d';
  animationDelay?: number;
}

const SIZES = {
  sm: { w: 30, h: 15, nibW: 2, nibH: 6, text: 'text-sm' },
  md: { w: 40, h: 20, nibW: 3, nibH: 8, text: 'text-base' },
  lg: { w: 52, h: 26, nibW: 3, nibH: 10, text: 'text-lg' },
};

/** Compact horizontal battery, e.g. for team cards. */
const BatteryIndicator: React.FC<BatteryIndicatorProps> = ({
  percentage,
  size = 'md',
  className = '',
  good,
  warn,
  label,
  showValue = true,
}) => {
  const value = clampScore(percentage);
  const band = batteryBand(value);
  void good; void warn; // accepted for compatibility: the colour follows the value's band
  const s = SIZES[size];
  const fill = useMountedFill(value ?? 0);

  return (
    <div
      className={`inline-flex items-center gap-2 ${className}`}
      role="img"
      aria-label={`${label ?? 'Score'}: ${value == null ? 'no data' : `${Math.round(value)} of 100`}`}
    >
      <div className="flex items-center" aria-hidden="true">
        <div
          className={`relative rounded-[5px] border-2 p-[2px] ${value == null ? 'border-slate-300 border-dashed dark:border-slate-600' : 'border-slate-400 dark:border-slate-500'}`}
          style={{ width: s.w, height: s.h }}
        >
          <div className="relative h-full w-full overflow-hidden rounded-[2px]" style={{ background: BATTERY_SHELL_CSS }}>
            <div
              className="absolute inset-y-0 left-0 rounded-[2px] transition-[width] duration-700 ease-out motion-reduce:transition-none"
              style={{ width: `${fill}%`, background: band?.flat ?? 'transparent' }}
              data-battery-band={band?.key ?? 'none'}
            />
          </div>
        </div>
        <div
          className={`rounded-r-sm ${value == null ? 'bg-slate-300 dark:bg-slate-600' : 'bg-slate-400 dark:bg-slate-500'}`}
          style={{ width: s.nibW, height: s.nibH }}
        />
      </div>
      {showValue && (
        <span className={`${s.text} font-semibold tabular-nums ${value == null ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-white'}`}>
          {value == null ? '—' : Math.round(value)}
        </span>
      )}
    </div>
  );
};

export default BatteryIndicator;
