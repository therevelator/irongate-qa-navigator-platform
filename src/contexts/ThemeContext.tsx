import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  applyScoreDepth,
  applyScoreDisplay,
  applyTheme,
  DEFAULT_SCORE_DEPTH,
  isDarkTheme,
  readScoreDepth,
  readScoreDisplay,
  readThemePreference,
  resolveTheme,
  writeScoreDepth,
  writeScoreDisplay,
  writeThemePreference,
  type ScoreDepth,
  type ScoreDisplay,
  type ThemeId,
  type ThemePreference,
  SIGNED_IN_KEY,
} from '../lib/appearance';

/**
 * Appearance of the app (src/lib/appearance.ts): the colour theme (Light, Dark, Graphite,
 * Porcelain or "Match system"), the score display (Battery or Gauge) and its depth (3D or flat 2D).
 * All are kept in the browser; index.html applies them before the first paint, this provider keeps
 * <html> in step.
 */
interface ThemeContextType {
  /** The chosen preference (may be 'system'). */
  preference: ThemePreference;
  /** The theme on screen. */
  theme: ThemeId;
  /** Dark-based theme on screen (Dark or Graphite). */
  isDark: boolean;
  setTheme: (pref: ThemePreference) => void;
  scoreDisplay: ScoreDisplay;
  setScoreDisplay: (d: ScoreDisplay) => void;
  /** 3D (gloss, gradients, shadows) or flat 2D (same shapes and colours) for the battery and gauge. */
  scoreDepth: ScoreDepth;
  setScoreDepth: (d: ScoreDepth) => void;
  /** Light <-> Dark (legacy one-click switch). */
  toggleMode: () => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const SYSTEM_DARK = '(prefers-color-scheme: dark)';
const storage = (): Storage | null => {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
};
const systemPrefersDark = () => typeof window !== 'undefined' && !!window.matchMedia?.(SYSTEM_DARK).matches;

/** Company app, nobody signed in: keep the classic Light look (see AuthWrapper and index.html). */
function signedOutClassic(): boolean {
  if (typeof window === 'undefined') return false;
  const p = window.location.pathname;
  if (p === '/operator' || p.startsWith('/operator/')) return false;
  try { return window.localStorage.getItem(SIGNED_IN_KEY) !== '1'; } catch { return true; }
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preference, setPreference] = useState<ThemePreference>(() => readThemePreference(storage()));
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);
  const [scoreDisplay, setScoreDisplayState] = useState<ScoreDisplay>(() => readScoreDisplay(storage()));
  const [scoreDepth, setScoreDepthState] = useState<ScoreDepth>(() => readScoreDepth(storage()));

  // Follow the device setting only while "Match system" is chosen.
  useEffect(() => {
    if (preference !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia(SYSTEM_DARK);
    const onChange = () => setSystemDark(mq.matches);
    onChange();
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [preference]);

  const theme = resolveTheme(preference, systemDark);

  // Until someone is signed in, the company app shows the classic Light look (AuthWrapper applies
  // the chosen theme after sign-in); the operator panel always follows the choice.
  useLayoutEffect(() => { applyTheme(document.documentElement, signedOutClassic() ? 'light' : theme); }, [theme]);
  useLayoutEffect(() => { applyScoreDisplay(document.documentElement, scoreDisplay); }, [scoreDisplay]);
  useLayoutEffect(() => { applyScoreDepth(document.documentElement, scoreDepth); }, [scoreDepth]);

  const setTheme = useCallback((pref: ThemePreference) => {
    writeThemePreference(storage(), pref);
    setPreference(pref);
  }, []);
  const setScoreDisplay = useCallback((d: ScoreDisplay) => {
    writeScoreDisplay(storage(), d);
    setScoreDisplayState(d);
  }, []);
  const setScoreDepth = useCallback((d: ScoreDepth) => {
    writeScoreDepth(storage(), d);
    setScoreDepthState(d);
  }, []);
  const toggleMode = useCallback(() => setTheme(isDarkTheme(theme) ? 'light' : 'dark'), [setTheme, theme]);

  const value = useMemo<ThemeContextType>(() => ({
    preference, theme, isDark: isDarkTheme(theme), setTheme, scoreDisplay, setScoreDisplay, scoreDepth, setScoreDepth, toggleMode, toggleTheme: toggleMode,
  }), [preference, theme, setTheme, scoreDisplay, setScoreDisplay, scoreDepth, setScoreDepth, toggleMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

/** The chosen score depth; 3D outside the provider (a battery or gauge rendered on its own). */
export const useScoreDepth = (): ScoreDepth => useContext(ThemeContext)?.scoreDepth ?? DEFAULT_SCORE_DEPTH;
