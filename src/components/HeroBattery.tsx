import React, { useEffect, useState } from 'react';
import { clampScore, gaugeStatus, type GaugeStatus } from './BatteryIndicator';

/**
 * The original glossy 3D battery: a glass body with metallic highlights, a nib on top
 * and a charge level that fills from the bottom in the status colour.
 * Null renders an empty (dark) battery; the caller shows "—" as the value.
 */
interface HeroBatteryProps {
  value: number | string | null | undefined;
  /** value at/above which the charge is green */
  good?: number;
  /** value at/above which the charge is amber */
  warn?: number;
  size?: 'xs' | 'sm' | 'lg';
  label: string;
  className?: string;
}

// Five-stop palettes from the original battery: bottom edge, base, body, top highlight, top edge.
const PALETTES: Record<Exclude<GaugeStatus, 'none'>, string[]> = {
  good: ['#316d08', '#60b939', '#51aa31', '#64ce11', '#255405'],
  warning: ['#754f00', '#f2bb00', '#dbb300', '#df8f00', '#593c00'],
  critical: ['#750900', '#c6462b', '#b74424', '#df0a00', '#590700'],
};

const SIZES = {
  xs: { w: 24, h: 46, nibW: 12, nibH: 5, radius: 7, band: 2, inset: 5 },
  sm: { w: 32, h: 62, nibW: 16, nibH: 6, radius: 9, band: 3, inset: 6 },
  lg: { w: 76, h: 148, nibW: 36, nibH: 11, radius: 18, band: 4, inset: 10 },
};

const GLASS =
  'linear-gradient(to right, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.4) 4%, rgba(255,255,255,0.2) 7%, rgba(255,255,255,0.2) 14%, ' +
  'rgba(255,255,255,0.8) 14%, rgba(255,255,255,0.2) 40%, rgba(255,255,255,0) 41%, rgba(255,255,255,0) 80%, rgba(255,255,255,0.2) 80%, ' +
  'rgba(255,255,255,0.4) 86%, rgba(255,255,255,0.6) 90%, rgba(255,255,255,0.1) 92%, rgba(255,255,255,0.1) 95%, rgba(255,255,255,0.5) 98%)';

const NIB =
  'linear-gradient(to right, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 14%, rgba(255,255,255,0.8) 14%, rgba(255,255,255,0.3) 40%, ' +
  'rgba(255,255,255,0) 41%, rgba(255,255,255,0) 80%, rgba(255,255,255,0.2) 80%, rgba(255,255,255,0.4) 86%, rgba(255,255,255,0.6) 90%, ' +
  'rgba(255,255,255,0.1) 92%, rgba(255,255,255,0.1) 95%, rgba(255,255,255,0.5) 98%), linear-gradient(#64748b, #334155)';

const OVERLAY =
  'linear-gradient(to right, rgba(255,255,255,0.3) 4%, rgba(255,255,255,0.2) 5%, transparent 5%, transparent 14%, rgba(255,255,255,0.3) 14%, ' +
  'rgba(255,255,255,0.12) 40%, rgba(0,0,0,0.05) 42%, rgba(0,0,0,0.05) 48%, transparent 60%, transparent 80%, rgba(255,255,255,0.3) 87%, ' +
  'rgba(255,255,255,0.3) 92%, transparent 92%, transparent 97%, rgba(255,255,255,0.4) 97%)';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Charge animates up from empty to the target level (instant with reduced motion). */
const useAnimatedCharge = (target: number) => {
  const [charge, setCharge] = useState(() => (prefersReducedMotion() ? target : 12));
  useEffect(() => {
    if (prefersReducedMotion()) { setCharge(target); return; }
    let raf = 0;
    const start = performance.now();
    const from = 12;
    const duration = 900;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setCharge(from + (target - from) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return charge;
};

const HeroBattery: React.FC<HeroBatteryProps> = ({ value: raw, good, warn, size = 'lg', label, className = '' }) => {
  const value = clampScore(raw);
  const status = gaugeStatus(value, good, warn);
  const s = SIZES[size];
  const empty = value == null;

  // 0–100 maps to the battery's visible window (12%–89% of the body height).
  const target = empty ? 12 : 12 + (value / 100) * 77;
  const c = useAnimatedCharge(target);

  const body = empty
    ? `linear-gradient(to top, transparent 5%, #1e293b 5%, #0f172a 95%, transparent 95%), ${GLASS}`
    : (() => {
        const col = PALETTES[status as Exclude<GaugeStatus, 'none'>];
        return (
          `linear-gradient(to top, transparent 5%, ${col[0]} 5%, ${col[0]} 7%, ${col[1]} 8%, ${col[1]} 10%, ${col[2]} 11%, ` +
          `${col[2]} ${c - 3}%, ${col[3]} ${c - 2}%, ${col[3]} ${c}%, ${col[4]} ${c}%, black ${c + 5}%, black 95%, transparent 95%), ${GLASS}`
        );
      })();

  return (
    <div
      className={`flex flex-col items-center flex-shrink-0 ${className}`}
      role="img"
      aria-label={`${label}: ${empty ? 'no data' : `${Math.round(value)} of 100`}`}
    >
      <div
        aria-hidden="true"
        style={{
          width: s.nibW,
          height: s.nibH,
          borderTopLeftRadius: s.nibH * 0.6,
          borderTopRightRadius: s.nibH * 0.6,
          backgroundImage: NIB,
          marginBottom: -1,
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'relative',
          width: s.w,
          height: s.h,
          borderRadius: `${s.radius}px ${s.radius}px ${s.radius / 2}px ${s.radius / 2}px`,
          borderTop: '2px solid rgba(255,255,255,0.2)',
          borderBottom: '2px solid rgba(255,255,255,0.2)',
          backgroundImage: body,
          boxShadow: '0 4px 10px rgba(15,23,42,0.18)',
          opacity: empty ? 0.55 : 1,
        }}
      >
        <div
          style={{
            position: 'absolute',
            width: s.w,
            height: s.h - s.inset * 2,
            top: s.inset,
            left: 0,
            borderRadius: s.radius / 2,
            borderTop: `${s.band}px solid black`,
            borderBottom: `${s.band}px solid black`,
            backgroundImage: OVERLAY,
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
};

export default HeroBattery;
