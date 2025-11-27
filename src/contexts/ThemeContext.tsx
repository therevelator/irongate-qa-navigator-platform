import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

// Three theme options
export type ThemeName = 'ocean' | 'aurora' | 'minimal';
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
    description: 'Fresh emerald and teal - energetic and modern',
    colors: {
      primary: 'emerald',
      accent: 'teal',
      gradient: {
        light: 'from-emerald-50 via-teal-50 to-lime-50',
        dark: 'from-slate-950 via-emerald-950/30 to-slate-900'
      },
      sidebar: {
        light: 'bg-white',
        dark: 'bg-slate-950'
      },
      card: {
        light: 'bg-white',
        dark: 'bg-slate-900/60'
      }
    }
  },
  minimal: {
    name: 'Minimal',
    description: 'Clean and simple - no frills, just clarity',
    colors: {
      primary: 'gray',
      accent: 'gray',
      gradient: {
        light: 'from-gray-50 to-gray-50',
        dark: 'from-gray-900 to-gray-900'
      },
      sidebar: {
        light: 'bg-white',
        dark: 'bg-gray-900'
      },
      card: {
        light: 'bg-white',
        dark: 'bg-gray-800'
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
    htmlElement.classList.remove('dark', 'light', 'theme-ocean', 'theme-aurora', 'theme-minimal');
    
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
    } else if (themeName === 'aurora') {
      // Aurora/Emerald theme
      root.style.setProperty('--theme-primary', isDark ? '16 185 129' : '5 150 105'); // emerald-500/600
      root.style.setProperty('--theme-accent', isDark ? '45 212 191' : '20 184 166'); // teal-400/500
      root.style.setProperty('--theme-primary-rgb', isDark ? '16, 185, 129' : '5, 150, 105');
    } else {
      // Minimal theme - neutral grays
      root.style.setProperty('--theme-primary', isDark ? '156 163 175' : '107 114 128'); // gray-400/500
      root.style.setProperty('--theme-accent', isDark ? '156 163 175' : '107 114 128'); // gray-400/500
      root.style.setProperty('--theme-primary-rgb', isDark ? '156, 163, 175' : '107, 114, 128');
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
