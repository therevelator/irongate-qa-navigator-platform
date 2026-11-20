import React, { useEffect, useState } from 'react';
import { clampScore } from './BatteryIndicator';
import { batteryBand, BATTERY_SHELL_CSS } from '../lib/batteryScale';
import { useScoreDepth } from '../contexts/ThemeContext';
import { cellCharge, CELL_CHARGE_EMPTY } from '../lib/cellBattery';
import type { HeroBatteryProps } from './HeroBattery';

/**
 * The "Cell" battery style (Appearance menu › Battery style; the original glass tube is HeroBattery,
 * "Liquid"). Design adapted from Lynn Fisher's single-div battery (a.singlediv.com, #battery): an
 * elliptically rounded body with side edges, a nib, a glass overlay with highlight bands and a dark
 * band before the nib, and a charge built from five shades of its colour (edge, highlight, body,
 * bright leading edge, dark leading edge fading into the empty part).
 *
 * Drawn horizontally (the reference's 250 × 120 px) with CSS gradients at the component's own size,
 * so it is sharp at any size; the vertical battery (nib on top, fills from the bottom) is the same
 * drawing turned by 90°. Colours: the one battery scale (src/lib/batteryScale.ts), whose five stops
 * per band follow the reference's shade relationship; the empty part is the dark battery shell of
 * the theme. Same props and accessible text as HeroBattery; the charge grows to the value on load
 * (instant with prefers-reduced-motion). 2D (Depth): same shape and colours, flat: no gloss, glass,
 * highlight bands, rims, edges or leading-edge shading.
 */

/** Body length (along the charge) and thickness per size: the same footprint as HeroBattery. */
const SIZES = {
  xs: { len: 46, thick: 24 },
  sm: { len: 62, thick: 32 },
  md: { len: 92, thick: 46 },
  lg: { len: 148, thick: 76 },
} as const;

/** Reference geometry (px of the 250 × 120 original). */
const REF = { len: 250, thick: 120, nibLen: 12, nibThick: 55, glassLeft: 10, glassLen: 228, glassRim: 4, edge: 2 };

const GLOSS =
  'linear-gradient(to bottom, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.4) 4%, rgba(255,255,255,0.2) 7%, rgba(255,255,255,0.2) 14%, ' +
  'rgba(255,255,255,0.8) 14%, rgba(255,255,255,0.2) 40%, rgba(255,255,255,0) 41%, rgba(255,255,255,0) 80%, rgba(255,255,255,0.2) 80%, ' +
  'rgba(255,255,255,0.4) 86%, rgba(255,255,255,0.6) 90%, rgba(255,255,255,0.1) 92%, rgba(255,255,255,0.1) 95%, rgba(255,255,255,0.5) 98%)';

const NIB =
  'linear-gradient(rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 14%, rgba(255,255,255,0.8) 14%, rgba(255,255,255,0.3) 40%, ' +
  'rgba(255,255,255,0) 41%, rgba(255,255,255,0) 80%, rgba(255,255,255,0.2) 80%, rgba(255,255,255,0.4) 86%, rgba(255,255,255,0.6) 90%, ' +
  'rgba(255,255,255,0.1) 92%, rgba(255,255,255,0.1) 95%, rgba(255,255,255,0.5) 98%), linear-gradient(var(--battery-shell-top, #1e293b), var(--battery-shell, #0f172a))';

const GLASS = [
  'linear-gradient(rgba(255,255,255,0.3) 4%, rgba(255,255,255,0.2) 5%, transparent 5%, transparent 14%, rgba(255,255,255,0.3) 14%, ' +
    'rgba(255,255,255,0.12) 40%, rgba(0,0,0,0.05) 42%, rgba(0,0,0,0.05) 48%, transparent 60%, transparent 80%, rgba(255,255,255,0.3) 87%, ' +
    'rgba(255,255,255,0.3) 92%, transparent 92%, transparent 97%, rgba(255,255,255,0.4) 97%)',
  'linear-gradient(to left, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.2) 2%, black 2%, black 6%, transparent 6%)',
  'linear-gradient(rgba(255,255,255,0) 0%, rgba(255,255,255,0) 35%, rgba(255,255,255,0.3) 90%, rgba(255,255,255,0) 90%)',
].join(', ');

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Charge grows from empty to the target (instant with reduced motion). */
const useAnimatedCharge = (target: number) => {
  const [charge, setCharge] = useState(() => (prefersReducedMotion() ? target : CELL_CHARGE_EMPTY));
  useEffect(() => {
    if (prefersReducedMotion()) { setCharge(target); return; }
    let raf = 0;
    const start = performance.now();
    const from = CELL_CHARGE_EMPTY;
    const duration = 900;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      setCharge(from + (target - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return charge;
};

const CellBattery: React.FC<HeroBatteryProps> = ({ value: raw, size = 'lg', orientation = 'vertical', depth, label, className = '' }) => {
  const chosenDepth = useScoreDepth();
  const flat = (depth ?? chosenDepth) === '2d';
  const value = clampScore(raw);
  const band = batteryBand(value);
  const empty = value == null;
  const vertical = orientation !== 'horizontal';
  const { len, thick } = SIZES[size];

  const target = empty ? CELL_CHARGE_EMPTY : cellCharge(value);
  const c = useAnimatedCharge(target);

  // Scale of the reference along the body and across it.
  const kl = len / REF.len;
  const kt = thick / REF.thick;
  const edge = Math.max(1, REF.edge * kl);
  const inner = len - 2 * edge; // padding box: backgrounds and the overlays are laid out in it
  const nibLen = Math.max(3, REF.nibLen * kl);
  const nibThick = REF.nibThick * kt;
  const total = len + nibLen;
  const px = (n: number) => `${Math.round(n * 100) / 100}px`;

  // Body: the empty part (shell) from the leading edge on, over the reference's gloss. The two ends
  // (0–5 % and 95–100 %) are the dark shell too: in the reference they were see-through over a black
  // page, so on a light page they showed as white caps. The charge itself is its own element (below),
  // so its length is exactly the value.
  const shellLayer = empty
    ? `linear-gradient(to right, ${BATTERY_SHELL_CSS} 0%, ${BATTERY_SHELL_CSS} 100%)`
    : `linear-gradient(to right, ${BATTERY_SHELL_CSS} 0%, ${BATTERY_SHELL_CSS} 5%, transparent 5%, transparent ${c}%, ${band!.stops[4]} ${c}%, ${BATTERY_SHELL_CSS} ${c + 5}%, ${BATTERY_SHELL_CSS} 100%)`;

  // The charge, 5% → c% of the body (3D) or 0 → c% (2D): edge, highlight, body, leading edge.
  const fillStart = flat ? 0 : 5;
  const fillLen = Math.max(0, ((c - fillStart) / 100) * inner);
  const s = band?.stops;
  const fillImage = s
    ? `linear-gradient(to right, ${s[0]} 0px, ${s[0]} ${px(0.02 * inner)}, ${s[1]} ${px(0.03 * inner)}, ${s[1]} ${px(0.05 * inner)}, ` +
      `${s[2]} ${px(0.06 * inner)}, ${s[2]} ${px(fillLen - 0.03 * inner)}, ${s[3]} ${px(fillLen - 0.02 * inner)}, ${s[3]} 100%)`
    : undefined;

  const drawing = (
    <div aria-hidden="true" style={{ position: 'relative', flex: 'none', width: total, height: thick, transform: vertical ? 'rotate(-90deg)' : undefined }}>
      <div
        data-testid="cell-body"
        style={{
          position: 'absolute', left: 0, top: 0, width: len, height: thick,
          boxSizing: 'border-box',
          overflow: 'hidden',
          borderRadius: `${px(10 * kl)} / ${px(30 * kt)}`,
          ...(flat
            // Same box as 3D (the edges stay, transparent, so the charge lines up the same way).
            ? { backgroundColor: BATTERY_SHELL_CSS, borderLeft: `${px(edge)} solid transparent`, borderRight: `${px(edge)} solid transparent` }
            : {
                // The reference's faint edge over the dark shell, in every theme (a theme's light
                // --battery-edge read as a white rim on light pages).
                borderLeft: `${px(edge)} solid rgba(255,255,255,0.2)`,
                borderRight: `${px(edge)} solid rgba(255,255,255,0.2)`,
                backgroundImage: `${shellLayer}, ${GLOSS}`,
              }),
          // A thin outline keeps the shape readable on light backgrounds (theme token, none on dark).
          outline: '1px solid var(--cell-outline, transparent)',
          outlineOffset: 0,
          opacity: empty ? 0.55 : 1,
        }}
      >
        {!empty && band && (
          <div
            data-testid="cell-fill"
            style={{
              position: 'absolute', top: 0, bottom: 0, left: `${fillStart}%`, width: `${Math.max(0, c - fillStart)}%`,
              ...(flat ? { backgroundColor: band.flat } : { backgroundImage: fillImage }),
            }}
          />
        )}
        {!flat && (
          <div
            style={{
              position: 'absolute', top: 0, height: '100%', boxSizing: 'border-box',
              left: px((REF.glassLeft / REF.len) * inner), width: px((REF.glassLen / REF.len) * inner),
              borderRadius: `${px(5 * kl)} / ${px(30 * kt)}`,
              borderLeft: `${px(REF.glassRim * kl)} solid black`,
              borderRight: `${px(REF.glassRim * kl)} solid black`,
              backgroundImage: GLASS,
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
      <div
        style={{
          position: 'absolute', left: len, top: (thick - nibThick) / 2, width: nibLen, height: nibThick,
          borderRadius: `0 ${px(6 * kl)} ${px(6 * kl)} 0 / 0 ${px(10 * kt)} ${px(10 * kt)} 0`,
          ...(flat ? { backgroundColor: BATTERY_SHELL_CSS } : { backgroundImage: NIB }),
          opacity: empty ? 0.55 : 1,
        }}
      />
    </div>
  );

  return (
    <div
      className={`flex flex-shrink-0 items-center justify-center ${className}`}
      style={vertical ? { width: thick, height: total } : { width: total, height: thick }}
      role="img"
      aria-label={`${label}: ${empty ? 'no data' : `${Math.round(value)} of 100`}`}
      data-battery-band={band?.key ?? 'none'}
      data-battery-style="cell"
      data-score-depth={flat ? '2d' : '3d'}
      data-charge={Math.round(target * 100) / 100}
    >
      {drawing}
    </div>
  );
};

export default CellBattery;
