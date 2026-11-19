/**
 * Appearance preferences: the colour theme and how scores are drawn (battery or gauge).
 *
 * Themes are applied on <html>: `data-theme="light|dark|graphite|porcelain"` plus the `dark` class
 * for the dark-based themes (Dark, Graphite), so every `dark:` utility keeps working and the glass
 * themes only re-map tokens on top (src/styles/themes.css). The preference is kept in the browser
 * (localStorage) and applied before the first paint by the inline script in index.html, which
 * mirrors applyTheme() below (tests/api/appearance.test.ts runs both and compares them).
 *
 * With no stored preference the app is Light: the system setting is only followed when the person
 * picks "Match system".
 */

export type ThemeId = 'light' | 'dark' | 'graphite' | 'porcelain';
export type ThemePreference = ThemeId | 'system';
export type ScoreDisplay = 'battery' | 'gauge';

export const THEME_KEY = 'irongate_theme_mode';
export const SCORE_DISPLAY_KEY = 'irongate_score_display';
export const DEFAULT_THEME: ThemePreference = 'light';
export const DEFAULT_SCORE_DISPLAY: ScoreDisplay = 'battery';

export const THEME_OPTIONS: Array<{ id: ThemePreference; label: string; hint: string }> = [
  { id: 'light', label: 'Light', hint: 'Bright and plain' },
  { id: 'dark', label: 'Dark', hint: 'Dim and plain' },
  { id: 'graphite', label: 'Graphite', hint: 'Dark glass' },
  { id: 'porcelain', label: 'Porcelain', hint: 'Light frosted glass' },
  { id: 'system', label: 'Match system', hint: 'Light or Dark, as your device' },
];

export const SCORE_DISPLAY_OPTIONS: Array<{ id: ScoreDisplay; label: string; hint: string }> = [
  { id: 'battery', label: 'Battery', hint: '3D battery' },
  { id: 'gauge', label: 'Gauge', hint: 'Radial gauge' },
];

const THEME_IDS: ThemeId[] = ['light', 'dark', 'graphite', 'porcelain'];

export const isThemeId = (v: unknown): v is ThemeId => typeof v === 'string' && (THEME_IDS as string[]).includes(v);

/** A stored value as a preference; anything unknown (or nothing) is the default. */
export function parseThemePreference(v: unknown): ThemePreference {
  return v === 'system' || isThemeId(v) ? v : DEFAULT_THEME;
}

export function parseScoreDisplay(v: unknown): ScoreDisplay {
  return v === 'gauge' || v === 'battery' ? v : DEFAULT_SCORE_DISPLAY;
}

/** The theme a preference shows: "Match system" is Light or Dark by the device setting. */
export function resolveTheme(pref: ThemePreference, systemDark: boolean): ThemeId {
  if (pref === 'system') return systemDark ? 'dark' : 'light';
  return pref;
}

/** Dark-based themes carry the `dark` class (all `dark:` utilities apply). */
export const isDarkTheme = (t: ThemeId): boolean => t === 'dark' || t === 'graphite';

/** The glass themes (translucent surfaces, background sheen). */
export const isGlassTheme = (t: ThemeId): boolean => t === 'graphite' || t === 'porcelain';

/**
 * The theme of the glass "family" that matches a light/dark choice: TV mode keeps its own
 * light/dark switch and, while the app shows a glass theme, Dark is Graphite and Light Porcelain.
 */
export function tvTheme(appTheme: ThemeId, tvDark: boolean): ThemeId {
  if (isGlassTheme(appTheme)) return tvDark ? 'graphite' : 'porcelain';
  return tvDark ? 'dark' : 'light';
}

/** Minimal element surface (document.documentElement in the browser, a fake in unit tests). */
export interface ThemeTarget {
  classList: { toggle(name: string, force?: boolean): unknown };
  setAttribute(name: string, value: string): void;
  style: { colorScheme: string };
}

/** Put a theme on <html>: data-theme, the `dark` class and the native colour scheme. */
export function applyTheme(el: ThemeTarget, theme: ThemeId): void {
  el.setAttribute('data-theme', theme);
  el.classList.toggle('dark', isDarkTheme(theme));
  el.style.colorScheme = isDarkTheme(theme) ? 'dark' : 'light';
}

export function applyScoreDisplay(el: Pick<ThemeTarget, 'setAttribute'>, display: ScoreDisplay): void {
  el.setAttribute('data-score-display', display);
}

/** localStorage access that never throws (private mode, blocked storage). */
export interface PrefStorage { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function readThemePreference(storage: PrefStorage | null | undefined): ThemePreference {
  try { return parseThemePreference(storage?.getItem(THEME_KEY)); } catch { return DEFAULT_THEME; }
}

export function readScoreDisplay(storage: PrefStorage | null | undefined): ScoreDisplay {
  try { return parseScoreDisplay(storage?.getItem(SCORE_DISPLAY_KEY)); } catch { return DEFAULT_SCORE_DISPLAY; }
}

export function writeThemePreference(storage: PrefStorage | null | undefined, pref: ThemePreference): void {
  try { storage?.setItem(THEME_KEY, pref); } catch { /* storage unavailable: the choice lasts for this page only */ }
}

export function writeScoreDisplay(storage: PrefStorage | null | undefined, display: ScoreDisplay): void {
  try { storage?.setItem(SCORE_DISPLAY_KEY, display); } catch { /* storage unavailable */ }
}
