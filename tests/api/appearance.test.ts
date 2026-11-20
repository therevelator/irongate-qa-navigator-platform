import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  applyScoreDepth, applyScoreDisplay, applyTheme, parseScoreDepth, readScoreDepth, writeScoreDepth, SCORE_DEPTH_KEY, SCORE_DEPTH_OPTIONS,
  DEFAULT_SCORE_DEPTH, isDarkTheme, isGlassTheme, parseScoreDisplay, parseThemePreference, readScoreDisplay,
  readThemePreference, resolveTheme, tvTheme, writeScoreDisplay, writeThemePreference, SCORE_DISPLAY_KEY, SIGNED_IN_KEY, THEME_KEY,
  THEME_OPTIONS, type ThemeId,
} from '../../src/lib/appearance';
import { BATTERY_BANDS, BATTERY_SHELLS, contrastRatio } from '../../src/lib/batteryScale';
import { chartTheme } from '../../src/data/advancedFeatures';

/**
 * Appearance preferences (src/lib/appearance.ts): theme, score display and depth, how they are stored
 * and put on <html>, and the pre-paint script in index.html that must do the same thing.
 * Pure functions: no backend needed.
 */

class FakeEl {
  attrs: Record<string, string> = {};
  classes = new Set<string>();
  style = { colorScheme: '' };
  classList = { toggle: (n: string, force?: boolean) => { const on = force ?? !this.classes.has(n); if (on) this.classes.add(n); else this.classes.delete(n); return on; } };
  setAttribute(n: string, v: string) { this.attrs[n] = v; }
}
class FakeStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
}
const THEMES: ThemeId[] = ['light', 'dark', 'graphite', 'porcelain'];

describe('appearance: theme preference', () => {
  it('APP-001: menu offers Light, Dark, Graphite, Porcelain and Match system, in that order', () => {
    expect(THEME_OPTIONS.map((o) => o.label)).toEqual(['Light', 'Dark', 'Graphite', 'Porcelain', 'Match system']);
  });

  it('APP-002: unknown or missing stored values fall back to Light / Battery', () => {
    expect(parseThemePreference(null)).toBe('light');
    expect(parseThemePreference('ocean')).toBe('light');
    expect(parseThemePreference('graphite')).toBe('graphite');
    expect(parseThemePreference('system')).toBe('system');
    expect(parseScoreDisplay(undefined)).toBe('battery');
    expect(parseScoreDisplay('dial')).toBe('battery');
    expect(parseScoreDisplay('gauge')).toBe('gauge');
  });

  it('APP-003: "Match system" is Light or Dark by the device; the other choices ignore it', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    for (const t of THEMES) { expect(resolveTheme(t, true)).toBe(t); expect(resolveTheme(t, false)).toBe(t); }
  });

  it('APP-004: Dark and Graphite carry the dark class; Graphite and Porcelain are the glass themes', () => {
    expect(THEMES.filter(isDarkTheme)).toEqual(['dark', 'graphite']);
    expect(THEMES.filter(isGlassTheme)).toEqual(['graphite', 'porcelain']);
  });

  it('APP-005: applyTheme sets data-theme, the dark class and the colour scheme (and switches back)', () => {
    const el = new FakeEl();
    applyTheme(el, 'graphite');
    expect([el.attrs['data-theme'], el.classes.has('dark'), el.style.colorScheme]).toEqual(['graphite', true, 'dark']);
    applyTheme(el, 'porcelain');
    expect([el.attrs['data-theme'], el.classes.has('dark'), el.style.colorScheme]).toEqual(['porcelain', false, 'light']);
    applyScoreDisplay(el, 'gauge');
    expect(el.attrs['data-score-display']).toBe('gauge');
  });

  it('APP-006: preferences round-trip through storage; a throwing storage never breaks the app', () => {
    const s = new FakeStorage();
    expect(readThemePreference(s)).toBe('light');
    writeThemePreference(s, 'porcelain');
    writeScoreDisplay(s, 'gauge');
    expect([s.getItem(THEME_KEY), s.getItem(SCORE_DISPLAY_KEY)]).toEqual(['porcelain', 'gauge']);
    expect([readThemePreference(s), readScoreDisplay(s)]).toEqual(['porcelain', 'gauge']);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readThemePreference(broken)).toBe('light');
    expect(readScoreDisplay(broken)).toBe('battery');
    expect(() => writeThemePreference(broken, 'dark')).not.toThrow();
  });

  it('APP-007: TV mode keeps its light/dark switch, mapped to the glass pair while a glass theme is on', () => {
    expect([tvTheme('light', true), tvTheme('light', false)]).toEqual(['dark', 'light']);
    expect([tvTheme('dark', true), tvTheme('dark', false)]).toEqual(['dark', 'light']);
    expect([tvTheme('graphite', true), tvTheme('graphite', false)]).toEqual(['graphite', 'porcelain']);
    expect([tvTheme('porcelain', true), tvTheme('porcelain', false)]).toEqual(['graphite', 'porcelain']);
  });

  it('APP-008: the pre-paint script in index.html gives the same result as applyTheme for every stored value', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
    const script = html.match(/<script>([\s\S]*?irongate_theme_mode[\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    for (const stored of [null, 'light', 'dark', 'graphite', 'porcelain', 'system', 'bogus']) {
      for (const systemDark of [false, true]) {
        for (const display of [null, 'gauge', 'battery']) for (const depth of [null, '2d', '3d', 'flat']) {
          // Signed-out screens keep the classic Light theme (AuthWrapper); the operator panel follows the choice.
          for (const [signedIn, pathname] of [[true, '/'], [false, '/'], [false, '/operator']] as const) {
            const s = new FakeStorage();
            if (stored) s.setItem(THEME_KEY, stored);
            if (display) s.setItem(SCORE_DISPLAY_KEY, display);
            if (depth) s.setItem(SCORE_DEPTH_KEY, depth);
            if (signedIn) s.setItem(SIGNED_IN_KEY, '1');
            const pre = new FakeEl();
            vm.runInNewContext(script!, { document: { documentElement: pre }, localStorage: s, location: { pathname }, window: { matchMedia: () => ({ matches: systemDark }) } });
            const ref = new FakeEl();
            const followsChoice = signedIn || pathname === '/operator';
            applyTheme(ref, followsChoice ? resolveTheme(readThemePreference(s), systemDark) : 'light');
            applyScoreDisplay(ref, readScoreDisplay(s));
            applyScoreDepth(ref, readScoreDepth(s));
            expect([stored, systemDark, display, depth, signedIn, pathname, pre.attrs, [...pre.classes], pre.style])
              .toEqual([stored, systemDark, display, depth, signedIn, pathname, ref.attrs, [...ref.classes], ref.style]);
          }
        }
      }
    }
  });
});

describe('appearance: score depth (3D / 2D)', () => {
  it('APP-012: the menu offers 3D then 2D; 3D is the default and anything unknown is 3D', () => {
    expect(SCORE_DEPTH_OPTIONS.map((o) => o.label)).toEqual(['3D', '2D']);
    expect(DEFAULT_SCORE_DEPTH).toBe('3d');
    expect(parseScoreDepth(null)).toBe('3d');
    expect(parseScoreDepth(undefined)).toBe('3d');
    expect(parseScoreDepth('flat')).toBe('3d');
    expect(parseScoreDepth('2D')).toBe('3d');
    expect(parseScoreDepth('2d')).toBe('2d');
    expect(parseScoreDepth('3d')).toBe('3d');
  });

  it('APP-013: depth round-trips through storage on its own key, is put on <html>, and a throwing storage falls back to 3D', () => {
    const s = new FakeStorage();
    expect(readScoreDepth(s)).toBe('3d');
    writeScoreDepth(s, '2d');
    expect(s.getItem(SCORE_DEPTH_KEY)).toBe('2d');
    expect([s.getItem(THEME_KEY), s.getItem(SCORE_DISPLAY_KEY)]).toEqual([null, null]);
    expect(readScoreDepth(s)).toBe('2d');
    writeScoreDepth(s, '3d');
    expect(readScoreDepth(s)).toBe('3d');
    const el = new FakeEl();
    applyScoreDepth(el, '2d');
    expect(el.attrs['data-score-depth']).toBe('2d');
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readScoreDepth(broken)).toBe('3d');
    expect(() => writeScoreDepth(broken, '2d')).not.toThrow();
  });
});

describe('appearance: theme-safe colours', () => {
  it('APP-010: the battery liquid stands out from the shell of every theme (at least 3:1)', () => {
    for (const [theme, shell] of Object.entries(BATTERY_SHELLS)) {
      for (const b of BATTERY_BANDS) {
        expect([theme, b.key, contrastRatio(b.stops[2], shell) >= 3]).toEqual([theme, b.key, true]);
        expect([theme, b.key, contrastRatio(b.flat, shell) >= 3]).toEqual([theme, b.key, true]);
      }
    }
  });

  it('APP-011: chart colours per theme; axis text keeps 4.5:1 on the chart background', () => {
    const bg: Record<ThemeId, string> = { light: '#ffffff', dark: '#0f172a', graphite: '#2a2c31', porcelain: '#f7f4ef' };
    for (const t of THEMES) {
      const c = chartTheme(t);
      expect([t, contrastRatio(c.axis, bg[t]) >= 4.5]).toEqual([t, true]);
    }
    expect(chartTheme(true)).toEqual(chartTheme('dark'));
    expect(chartTheme(false)).toEqual(chartTheme('light'));
    expect(chartTheme('graphite').tooltip.contentStyle.backgroundColor).not.toBe(chartTheme('dark').tooltip.contentStyle.backgroundColor);
  });
});
