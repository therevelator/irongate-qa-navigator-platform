import React from 'react';
import { clampScore, gaugeStatus, GAUGE_FILL, useMountedFill } from './BatteryIndicator';

/**
 * Vertical battery gauge for headline 0–100 scores (company status hero).
 * Flat fill in the status colour — no glow or gloss. Null renders an empty, dashed
 * grey battery; the caller shows "—" as the value.
 */
interface HeroBatteryProps {
  value: number | string | null | undefined;
  /** value at/above which the fill is green */
  good?: number;
  /** value at/above which the fill is amber */
  warn?: number;
  size?: 'sm' | 'lg';
  label: string;
  className?: string;
}

const SIZES = {
  sm: { w: 26, h: 46, nibW: 10, nibH: 4, border: 'border-2', pad: 'p-[2px]', radius: 'rounded-[5px]', inner: 'rounded-[2px]' },
  lg: { w: 64, h: 112, nibW: 24, nibH: 7, border: 'border-[3px]', pad: 'p-[4px]', radius: 'rounded-[12px]', inner: 'rounded-[6px]' },
};

const HeroBattery: React.FC<HeroBatteryProps> = ({ value: raw, good, warn, size = 'lg', label, className = '' }) => {
  const value = clampScore(raw);
  const status = gaugeStatus(value, good, warn);
  const s = SIZES[size];
  const fill = useMountedFill(value ?? 0);
  const empty = value == null;

  return (
    <div
      className={`flex flex-col items-center flex-shrink-0 ${className}`}
      role="img"
      aria-label={`${label}: ${empty ? 'no data' : `${Math.round(value)} of 100`}`}
    >
      <div
        aria-hidden="true"
        className={`rounded-t-[3px] ${empty ? 'bg-slate-300 dark:bg-slate-600' : 'bg-slate-400 dark:bg-slate-500'}`}
        style={{ width: s.nibW, height: s.nibH }}
      />
      <div
        aria-hidden="true"
        className={`relative ${s.border} ${s.pad} ${s.radius} ${empty ? 'border-dashed border-slate-300 dark:border-slate-600' : 'border-slate-400 dark:border-slate-500'}`}
        style={{ width: s.w, height: s.h }}
      >
        <div className={`relative h-full w-full overflow-hidden ${s.inner} bg-slate-100 dark:bg-slate-800`}>
          <div
            className={`absolute inset-x-0 bottom-0 ${s.inner} ${GAUGE_FILL[status]} transition-[height] duration-700 ease-out motion-reduce:transition-none`}
            style={{ height: `${fill}%` }}
          />
          {size === 'lg' && (
            // quarter marks so the level reads like a gauge
            [25, 50, 75].map((m) => (
              <div key={m} className="absolute inset-x-0 h-px bg-white/70 dark:bg-slate-950/50" style={{ bottom: `${m}%` }} />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default HeroBattery;
