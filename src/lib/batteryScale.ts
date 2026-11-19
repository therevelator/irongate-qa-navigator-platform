/**
 * The one colour scale for the liquid of every battery gauge in the app (overview hero, executive
 * gauges, team cards, team detail, TV mode). The colour follows the value (0–100), not the status
 * text: the status ("On target", "Watch", "Off target") is judged separately against the target
 * valid at the value's date.
 *
 *   below 30        red
 *   30 to below 45  deep amber
 *   45 to below 60  amber
 *   60 to below 75  yellow
 *   75 to below 90  light green
 *   90 to 100       solid green
 *
 * Each band has a five-stop palette for the glossy 3D battery (bottom edge, base, body, surface
 * highlight, surface edge) and a flat colour. Every body colour keeps at least 3:1 contrast against
 * the empty part of the battery (the shell) in every theme: BATTERY_SHELL in Light and Dark, a
 * smoky glass in Graphite and Porcelain (BATTERY_SHELLS; tests/api/battery-scale.test.ts and
 * tests/api/appearance.test.ts check it). The liquid colours themselves are the same in every theme.
 */

export type BatteryBandKey = 'red' | 'deepAmber' | 'amber' | 'yellow' | 'lightGreen' | 'green';

export interface BatteryBand {
  key: BatteryBandKey;
  /** Lowest value of the band (inclusive). */
  min: number;
  label: string;
  /** Glossy battery stops: bottom edge, base, body, surface highlight, surface edge. */
  stops: [string, string, string, string, string];
  /** Flat fill (compact battery, legends). */
  flat: string;
}

/** The empty part of every battery (dark glass) in the Light and Dark themes. */
export const BATTERY_SHELL = '#0f172a';

/**
 * The empty part of the battery per theme. The glass themes use a neutral smoky glass (with silver
 * rims and nib, src/styles/themes.css: --battery-*). Components read it through BATTERY_SHELL_CSS
 * so the shell follows the theme without a re-render.
 */
export const BATTERY_SHELLS: Record<'light' | 'dark' | 'graphite' | 'porcelain', string> = {
  light: BATTERY_SHELL,
  dark: BATTERY_SHELL,
  graphite: '#17191d',
  porcelain: '#22262c',
};

/** CSS value of the current theme's shell (custom property set per theme, Light/Dark fallback). */
export const BATTERY_SHELL_CSS = `var(--battery-shell, ${BATTERY_SHELL})`;

export const BATTERY_BANDS: BatteryBand[] = [
  { key: 'red', min: 0, label: 'Below 30', stops: ['#7a0a0a', '#e0392f', '#d33a2c', '#f25a4b', '#5c0707'], flat: '#e0392f' },
  { key: 'deepAmber', min: 30, label: '30–45', stops: ['#7a3300', '#ea6c12', '#dd6610', '#f78b33', '#5a2600'], flat: '#ea6c12' },
  { key: 'amber', min: 45, label: '45–60', stops: ['#7a4d00', '#f5a00e', '#e69508', '#fbb946', '#5a3800'], flat: '#f5a00e' },
  { key: 'yellow', min: 60, label: '60–75', stops: ['#6e6200', '#ecd022', '#dcc018', '#f8e04a', '#4f4600'], flat: '#ecd022' },
  { key: 'lightGreen', min: 75, label: '75–90', stops: ['#3f6b0c', '#93d155', '#82c144', '#ade46f', '#2e5108'], flat: '#93d155' },
  { key: 'green', min: 90, label: '90–100', stops: ['#0f4d27', '#27ac4f', '#1f9c45', '#3fc865', '#0b3a1d'], flat: '#27ac4f' },
];

/** The band of a 0–100 value (values are clamped); null for a missing value. */
export function batteryBand(value: number | null | undefined): BatteryBand | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const v = Math.max(0, Math.min(100, value));
  let band = BATTERY_BANDS[0];
  for (const b of BATTERY_BANDS) if (v >= b.min) band = b;
  return band;
}

/** WCAG relative luminance of a #rrggbb colour. */
export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio of two #rrggbb colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
