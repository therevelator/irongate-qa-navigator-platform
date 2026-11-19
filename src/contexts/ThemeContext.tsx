import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  applyScoreDisplay,
  applyTheme,
  isDarkTheme,
  readScoreDisplay,
  readThemePreference,
  resolveTheme,
  writeScoreDisplay,
  writeThemePreference,
  type ScoreDisplay,
  type ThemeId,
  type ThemePreference,
} from '../lib/appearance';

/**
 * Appearance of the app (src/lib/appearance.ts): the colour theme (Light, Dark, Graphite,
 * Porcelain or "Match system") and the score display (Battery or Gauge). Both are kept in the
 * browser; index.html applies them before the first paint, this provider keeps <html> in step.
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

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preference, setPreference] = useState<ThemePreference>(() => readThemePreference(storage()));
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);
  const [scoreDisplay, setScoreDisplayState] = useState<ScoreDisplay>(() => readScoreDisplay(storage()));

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

  useLayoutEffect(() => { applyTheme(document.documentElement, theme); }, [theme]);
  useLayoutEffect(() => { applyScoreDisplay(document.documentElement, scoreDisplay); }, [scoreDisplay]);

  const setTheme = useCallback((pref: ThemePreference) => {
    writeThemePreference(storage(), pref);
    setPreference(pref);
  }, []);
  const setScoreDisplay = useCallback((d: ScoreDisplay) => {
    writeScoreDisplay(storage(), d);
    setScoreDisplayState(d);
  }, []);
  const toggleMode = useCallback(() => setTheme(isDarkTheme(theme) ? 'light' : 'dark'), [setTheme, theme]);

  const value = useMemo<ThemeContextType>(() => ({
    preference, theme, isDark: isDarkTheme(theme), setTheme, scoreDisplay, setScoreDisplay, toggleMode, toggleTheme: toggleMode,
  }), [preference, theme, setTheme, scoreDisplay, setScoreDisplay, toggleMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
