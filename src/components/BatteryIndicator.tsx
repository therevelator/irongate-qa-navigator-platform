import React from 'react';

/**
 * Compact 0–100 score ring. Static (no glow / count-up animation) so the number
 * shown is always the real value. Colour uses the caller's thresholds.
 * `mode` and `animationDelay` are accepted for backwards compatibility and ignored.
 */
interface BatteryIndicatorProps {
  percentage: number | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  mode?: 'flat' | '3d';
  className?: string;
  animationDelay?: number;
  /** value at/above which the ring is green (default 80) */
  good?: number;
  /** value at/above which the ring is amber (default 60) */
  warn?: number;
  label?: string;
}

const SIZES = {
  sm: { px: 48, stroke: 5, text: 'text-xs' },
  md: { px: 64, stroke: 6, text: 'text-sm' },
  lg: { px: 80, stroke: 7, text: 'text-base' },
};

const BatteryIndicator: React.FC<BatteryIndicatorProps> = ({
  percentage,
  size = 'md',
  className = '',
  good = 80,
  warn = 60,
  label,
}) => {
  const { px, stroke, text } = SIZES[size];
  const value = percentage == null || Number.isNaN(Number(percentage)) ? null : Math.max(0, Math.min(100, Number(percentage)));
  const r = (px - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = value == null ? 0 : (value / 100) * c;
  const tone =
    value == null
      ? 'text-slate-300 dark:text-slate-700'
      : value >= good
        ? 'text-green-600 dark:text-green-500'
        : value >= warn
          ? 'text-amber-500 dark:text-amber-400'
          : 'text-red-600 dark:text-red-500';

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: px, height: px }}
      role="img"
      aria-label={`${label ?? 'Score'}: ${value == null ? 'no data' : `${Math.round(value)} of 100`}`}
    >
      <svg width={px} height={px} className="-rotate-90">
        <circle cx={px / 2} cy={px / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-slate-200 dark:stroke-slate-800" />
        {value != null && (
          <circle
            cx={px / 2}
            cy={px / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            stroke="currentColor"
            strokeDasharray={`${dash} ${c}`}
            className={tone}
          />
        )}
      </svg>
      <span className={`absolute ${text} font-semibold tabular-nums text-slate-900 dark:text-white`}>
        {value == null ? '—' : Math.round(value)}
      </span>
    </div>
  );
};

export default BatteryIndicator;
