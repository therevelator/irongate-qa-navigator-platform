import React, { useId } from 'react';
import { clampScore } from './BatteryIndicator';
import { batteryBand } from '../lib/batteryScale';
import { useScoreDepth } from '../contexts/ThemeContext';
import type { ScoreDepth } from '../lib/appearance';
import { arcLength, arcPath, gaugeLayout, GAUGE_END, GAUGE_SIZES, GAUGE_START, gaugeNeedle, polar, valueToAngle } from '../lib/gaugeGeometry';

/**
 * Radial score gauge: the "Gauge" score display (Appearance menu), an alternative to the 3D
 * battery with the same props and the same accessible text. A 240° arc: a track, the value arc in
 * the colour of the value's band (the one battery scale, src/lib/batteryScale.ts), a marker at the
 * end of the coloured arc (the value) and the number in the centre; the target is in the text beside it. Subtle depth (bevelled track, soft shadow and a gentle
 * gradient on the value arc); the arc sweeps in on load, not at all with prefers-reduced-motion
 * (src/styles/themes.css). Colours of the track, tick and text are theme tokens (--gauge-*).
 * 2D (Appearance menu, Depth): the same arc, marker and colours, flat: the value arc in the band's
 * flat colour, no gradient, highlight, bevel or shadow.
 */
export interface ScoreGaugeProps {
  value: number | string | null | undefined;
  /** Target (the "good" threshold): shown in the text next to the gauge, not on the arc. */
  good?: number;
  warn?: number;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Box width in px instead of the size's own (TV mode fills its space: fitGaugeWidth). Drawn at that size, so it stays crisp. */
  width?: number;
  /** 3D or flat 2D; defaults to the Appearance choice (ThemeContext). */
  depth?: ScoreDepth;
  label: string;
  className?: string;
}

const ScoreGauge: React.FC<ScoreGaugeProps> = ({ value: raw, good, size = 'lg', width: boxWidth, depth, label, className = '' }) => {
  const chosenDepth = useScoreDepth();
  const flat = (depth ?? chosenDepth) === '2d';
  const id = useId().replace(/:/g, '');
  const value = clampScore(raw);
  const band = batteryBand(value);
  const w = boxWidth && boxWidth > 0 ? boxWidth : GAUGE_SIZES[size];
  const { cx, cy, r, stroke, width, height } = gaugeLayout(w);
  const track = arcPath(cx, cy, r, GAUGE_START, GAUGE_END);
  const valueArc = value != null && value > 0 ? arcPath(cx, cy, r, GAUGE_START, valueToAngle(value)) : '';
  const len = value != null ? arcLength(r, value) : 0;
  void good; // the target is shown in the text beside the gauge
  // The needle starts where the arc starts and travels with the sweep to the end of the coloured
  // arc (the value): drawn at the start angle and rotated about the centre by the value's angle.
  const needleTurn = value != null ? valueToAngle(value) - GAUGE_START : 0;
  const needle = gaugeNeedle(w);
  const t0 = polar(cx, cy, r - stroke / 2 - needle.reach, GAUGE_START);
  const t1 = polar(cx, cy, r + stroke / 2 + needle.reach, GAUGE_START);
  const fontSize = Math.round(w * (size === 'xs' ? 0.3 : 0.28));
  const showUnit = size === 'lg' || size === 'md';

  return (
    <div
      className={`flex flex-shrink-0 items-center justify-center ${className}`}
      role="img"
      aria-label={`${label}: ${value == null ? 'no data' : `${Math.round(value)} of 100`}`}
      data-battery-band={band?.key ?? 'none'}
      data-score-visual="gauge"
      data-score-depth={flat ? '2d' : '3d'}
      data-testid="score-gauge"
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false" style={{ overflow: 'visible' }}>
        {!flat && <defs>
          {band && (
            <linearGradient id={`${id}-v`} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor={band.stops[1]} />
              <stop offset="100%" stopColor={band.stops[3]} />
            </linearGradient>
          )}
          <filter id={`${id}-s`} x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy={Math.max(0.6, w * 0.012)} stdDeviation={Math.max(0.8, w * 0.018)} style={{ floodColor: 'var(--gauge-shadow)' }} floodOpacity="1" />
          </filter>
        </defs>}
        {/* Track with a soft bevel along its inner edge */}
        <path d={track} fill="none" strokeLinecap="round" strokeWidth={stroke} style={{ stroke: 'var(--gauge-track)' }} />
        {!flat && <path d={arcPath(cx, cy, r - stroke / 2 + 0.5, GAUGE_START, GAUGE_END)} fill="none" strokeWidth={1} style={{ stroke: 'var(--gauge-track-edge)' }} opacity={0.9} />}
        {valueArc && band && (
          <g filter={flat ? undefined : `url(#${id}-s)`}>
            <path
              key={`${value}`}
              className="ig-gauge-sweep"
              d={valueArc}
              fill="none"
              stroke={flat ? band.flat : `url(#${id}-v)`}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${len + 1} ${len + 1}`}
              style={{ ['--ig-gauge-len' as string]: `${len + 1}` }}
              data-testid="score-gauge-value"
              data-color={band.flat}
            />
            {/* Gentle highlight along the outer edge of the value arc */}
            {!flat && <path
              className="ig-gauge-sweep"
              d={arcPath(cx, cy, r + stroke * 0.22, GAUGE_START, valueToAngle(value!))}
              fill="none"
              stroke="#ffffff"
              strokeOpacity={0.28}
              strokeWidth={Math.max(1, stroke * 0.2)}
              strokeLinecap="round"
              strokeDasharray={`${len * 1.3 + 1} ${len * 1.3 + 1}`}
              style={{ ['--ig-gauge-len' as string]: `${len * 1.3 + 1}` }}
            />}
          </g>
        )}
        {value != null && (
          <g
            key={`n${value}`}
            className="ig-gauge-needle"
            data-testid="score-gauge-marker"
            data-angle={Math.round(valueToAngle(value) * 10) / 10}
            style={{
              transform: `rotate(${needleTurn}deg)`,
              transformOrigin: `${cx}px ${cy}px`,
              transformBox: 'view-box',
              ['--ig-needle-turn' as string]: `${needleTurn}deg`,
            }}
          >
            <line
              x1={t0.x} y1={t0.y} x2={t1.x} y2={t1.y}
              strokeWidth={needle.width}
              strokeLinecap="round"
              style={{ stroke: 'var(--gauge-tick)' }}
            />
          </g>
        )}
        <text
          x={cx}
          y={cy + fontSize * (showUnit ? 0.2 : 0.36)}
          textAnchor="middle"
          fontSize={fontSize}
          fontWeight={600}
          style={{ fill: 'var(--gauge-text)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}
        >
          {value == null ? '—' : Math.round(value)}
        </text>
        {showUnit && value != null && (
          <text x={cx} y={cy + fontSize * 0.2 + fontSize * 0.62} textAnchor="middle" fontSize={Math.round(fontSize * 0.36)} style={{ fill: 'var(--gauge-subtext)' }}>
            / 100
          </text>
        )}
      </svg>
    </div>
  );
};

export default ScoreGauge;
