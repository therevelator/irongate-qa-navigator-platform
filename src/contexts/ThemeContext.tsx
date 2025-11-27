import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

// Two beautiful theme options
export type ThemeName = 'ocean' | 'aurora';
export type ThemeMode = 'light' | 'dark';

interface ThemeContextType {
  isDark: boolean;
  themeName: ThemeName;
  toggleMode: () => void;
  setThemeName: (name: ThemeName) => void;
  // Legacy support
  toggleTheme: () => void;
}

// Theme color definitions
export const themes = {
  ocean: {
    name: 'Ocean',
    description: 'Cool blues and cyans - professional and calm',
    colors: {
      primary: 'cyan',
      accent: 'blue',
      gradient: {
        light: 'from-blue-50 via-cyan-50 to-teal-50',
        dark: 'from-slate-900 via-slate-800 to-cyan-900/20'
      },
      sidebar: {
        light: 'bg-white',
        dark: 'bg-slate-900'
      },
      card: {
        light: 'bg-white',
        dark: 'bg-slate-800/50'
      }
    }
  },
  aurora: {
    name: 'Aurora',
    description: 'Vibrant purples and pinks - modern and energetic',
    colors: {
      primary: 'violet',
      accent: 'fuchsia',
      gradient: {
        light: 'from-violet-50 via-fuchsia-50 to-pink-50',
        dark: 'from-slate-900 via-purple-900/20 to-slate-800'
      },
      sidebar: {
        light: 'bg-white',
        dark: 'bg-slate-900'
      },
      card: {
        light: 'bg-white',
        dark: 'bg-slate-800/50'
      }
    }
  }
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Initialize from localStorage, IGNORE system preferences
  const [isDark, setIsDark] = useState<boolean>(() => {
    const saved = localStorage.getItem('irongate_theme_mode');
    // Default to dark if no preference saved
    return saved === null ? true : saved === 'dark';
  });

  const [themeName, setThemeNameState] = useState<ThemeName>(() => {
    const saved = localStorage.getItem('irongate_theme_name') as ThemeName;
    return saved || 'ocean';
  });

  // Apply theme classes to document
  useEffect(() => {
    const htmlElement = document.documentElement;
    
    // Remove all theme classes first
    htmlElement.classList.remove('dark', 'light', 'theme-ocean', 'theme-aurora');
    
    // Apply mode class
    if (isDark) {
      htmlElement.classList.add('dark');
    }
    
    // Apply theme name class
    htmlElement.classList.add(`theme-${themeName}`);
    
    // Save to localStorage
    localStorage.setItem('irongate_theme_mode', isDark ? 'dark' : 'light');
    localStorage.setItem('irongate_theme_name', themeName);
    
    // Set CSS custom properties for theme colors
    const root = document.documentElement;
    const theme = themes[themeName];
    
    if (themeName === 'ocean') {
      root.style.setProperty('--theme-primary', isDark ? '34 211 238' : '6 182 212'); // cyan-400/500
      root.style.setProperty('--theme-accent', isDark ? '96 165 250' : '59 130 246'); // blue-400/500
      root.style.setProperty('--theme-primary-rgb', isDark ? '34, 211, 238' : '6, 182, 212');
    } else {
      root.style.setProperty('--theme-primary', isDark ? '167 139 250' : '139 92 246'); // violet-400/500
      root.style.setProperty('--theme-accent', isDark ? '232 121 249' : '217 70 239'); // fuchsia-400/500
      root.style.setProperty('--theme-primary-rgb', isDark ? '167, 139, 250' : '139, 92, 246');
    }
  }, [isDark, themeName]);

  const toggleMode = useCallback(() => {
    setIsDark(prev => !prev);
  }, []);

  const setThemeName = useCallback((name: ThemeName) => {
    setThemeNameState(name);
  }, []);

  // Legacy support
  const toggleTheme = toggleMode;

  return (
    <ThemeContext.Provider value={{ 
      isDark, 
      themeName, 
      toggleMode, 
      setThemeName,
      toggleTheme 
    }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Helper hook to get current theme config
export const useThemeConfig = () => {
  const { themeName, isDark } = useTheme();
  return {
    theme: themes[themeName],
    isDark,
    themeName
  };
};
