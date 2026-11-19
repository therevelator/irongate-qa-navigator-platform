import React, { useEffect, useState } from 'react';
import { clampScore } from './BatteryIndicator';
import { batteryBand, BATTERY_SHELL } from '../lib/batteryScale';

/**
 * The original glossy 3D battery: a glass body with metallic highlights, a nib and a charge level
 * in the colour of its band (src/lib/batteryScale.ts: one scale for every battery of the app).
 * Vertical (nib on top, fills from the bottom) or horizontal (nib on the right, fills from the
 * left). With `liquid` the surface of the charge moves in a gentle wave; there is no motion at all
 * with prefers-reduced-motion, and the wave never changes the battery's size (no layout shift).
 * Null renders an empty (dark) battery; the caller shows "—" as the value.
 */
interface HeroBatteryProps {
  value: number | string | null | undefined;
  /** Accepted for compatibility; the colour follows the value's band (batteryBand), not the status. */
  good?: number;
  /** Accepted for compatibility (see good). */
  warn?: number;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  orientation?: 'vertical' | 'horizontal';
  /** Animated liquid surface (gentle wave). Off for prefers-reduced-motion. */
  liquid?: boolean;
  label: string;
  className?: string;
}

const SIZES = {
  xs: { w: 24, h: 46, nibW: 12, nibH: 5, radius: 7, band: 2, inset: 5 },
  sm: { w: 32, h: 62, nibW: 16, nibH: 6, radius: 9, band: 3, inset: 6 },
  md: { w: 46, h: 92, nibW: 22, nibH: 7, radius: 11, band: 3, inset: 7 },
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

/** Gradients are written for the vertical battery; the horizontal one turns them by 90°. */
const turn = (g: string, horizontal: boolean) =>
  horizontal ? g.replace(/to right/g, 'to bottom').replace(/to top/g, 'to right').replace(/linear-gradient\(#/g, 'linear-gradient(to right, #') : g;

const HeroBattery: React.FC<HeroBatteryProps> = ({ value: raw, size = 'lg', orientation = 'vertical', liquid = false, label, className = '' }) => {
  const value = clampScore(raw);
  const band = batteryBand(value);
  const s = SIZES[size];
  const empty = value == null;
  const horizontal = orientation === 'horizontal';

  // 0–100 maps to the battery's visible window (12%–89% of the body length).
  const target = empty ? 12 : 12 + (value / 100) * 77;
  const c = useAnimatedCharge(target);

  const body = turn(empty
    ? `linear-gradient(to top, transparent 5%, #1e293b 5%, ${BATTERY_SHELL} 95%, transparent 95%), ${GLASS}`
    : (() => {
        const col = band!.stops;
        return (
          `linear-gradient(to top, transparent 5%, ${col[0]} 5%, ${col[0]} 7%, ${col[1]} 8%, ${col[1]} 10%, ${col[2]} 11%, ` +
          `${col[2]} ${c - 3}%, ${col[3]} ${c - 2}%, ${col[3]} ${c}%, ${col[4]} ${c}%, ${BATTERY_SHELL} ${c + 5}%, ${BATTERY_SHELL} 95%, transparent 95%), ${GLASS}`
        );
      })(), horizontal);

  // Body box: the vertical sizes, turned for the horizontal battery.
  const bodyW = horizontal ? s.h : s.w;
  const bodyH = horizontal ? s.w : s.h;
  const r = s.radius;
  const nib = (
    <div
      aria-hidden="true"
      style={horizontal ? {
        width: s.nibH,
        height: s.nibW,
        borderTopRightRadius: s.nibH * 0.6,
        borderBottomRightRadius: s.nibH * 0.6,
        backgroundImage: turn(NIB, true),
        marginLeft: -1,
      } : {
        width: s.nibW,
        height: s.nibH,
        borderTopLeftRadius: s.nibH * 0.6,
        borderTopRightRadius: s.nibH * 0.6,
        backgroundImage: NIB,
        marginBottom: -1,
      }}
    />
  );
  // Wave strip at the liquid surface: crests in the surface highlight colour moving along the
  // surface (CSS animation ig-liquid-*, off with prefers-reduced-motion; src/index.css).
  const waveSize = Math.max(6, Math.round(s.w * 0.22));
  const wave = liquid && !empty && band ? (
    <div
      aria-hidden="true"
      data-testid="battery-liquid"
      className="pointer-events-none absolute overflow-hidden"
      style={horizontal
        ? { top: 0, bottom: 0, left: `calc(${c}% - ${waveSize / 2}px)`, width: waveSize }
        : { left: 0, right: 0, bottom: `calc(${c}% - ${waveSize / 2}px)`, height: waveSize }}
    >
      <svg
        className={horizontal ? 'ig-liquid-wave-y' : 'ig-liquid-wave-x'}
        viewBox={horizontal ? '0 0 10 40' : '0 0 40 10'}
        preserveAspectRatio="none"
        style={horizontal ? { display: 'block', width: '100%', height: '200%' } : { display: 'block', height: '100%', width: '200%' }}
      >
        <path
          d={horizontal
            ? 'M0 0 H5 C8 2.5 8 7.5 5 10 C2 12.5 2 17.5 5 20 C8 22.5 8 27.5 5 30 C2 32.5 2 37.5 5 40 H0 Z'
            : 'M0 10 V5 C2.5 2 7.5 2 10 5 C12.5 8 17.5 8 20 5 C22.5 2 27.5 2 30 5 C32.5 8 37.5 8 40 5 V10 Z'}
          fill={band.stops[3]}
          opacity={0.9}
        />
      </svg>
    </div>
  ) : null;

  return (
    <div
      className={`flex flex-shrink-0 items-center ${horizontal ? 'flex-row' : 'flex-col'} ${className}`}
      role="img"
      aria-label={`${label}: ${empty ? 'no data' : `${Math.round(value)} of 100`}`}
      data-battery-band={band?.key ?? 'none'}
    >
      {!horizontal && nib}
      <div
        aria-hidden="true"
        style={{
          position: 'relative',
          overflow: 'hidden',
          width: bodyW,
          height: bodyH,
          borderRadius: horizontal ? `${r / 2}px ${r}px ${r}px ${r / 2}px` : `${r}px ${r}px ${r / 2}px ${r / 2}px`,
          ...(horizontal
            ? { borderLeft: '2px solid rgba(255,255,255,0.2)', borderRight: '2px solid rgba(255,255,255,0.2)' }
            : { borderTop: '2px solid rgba(255,255,255,0.2)', borderBottom: '2px solid rgba(255,255,255,0.2)' }),
          backgroundImage: body,
          boxShadow: '0 4px 10px rgba(15,23,42,0.18)',
          opacity: empty ? 0.55 : 1,
        }}
      >
        {wave}
        <div
          style={horizontal ? {
            position: 'absolute',
            height: bodyH,
            width: bodyW - s.inset * 2,
            left: s.inset,
            top: 0,
            borderRadius: r / 2,
            borderLeft: `${s.band}px solid black`,
            borderRight: `${s.band}px solid black`,
            backgroundImage: turn(OVERLAY, true),
            pointerEvents: 'none',
          } : {
            position: 'absolute',
            width: bodyW,
            height: bodyH - s.inset * 2,
            top: s.inset,
            left: 0,
            borderRadius: r / 2,
            borderTop: `${s.band}px solid black`,
            borderBottom: `${s.band}px solid black`,
            backgroundImage: OVERLAY,
            pointerEvents: 'none',
          }}
        />
      </div>
      {horizontal && nib}
    </div>
  );
};

export default HeroBattery;
