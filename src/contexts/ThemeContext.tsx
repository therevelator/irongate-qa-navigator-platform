import React, { createContext, useContext, useState, useEffect } from 'react';

interface ThemeContextType {
  isDark: boolean;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    // If no saved preference, default to dark mode
    if (saved === null) {
      return true;
    }
    return saved === 'dark';
  });

  useEffect(() => {
    // Update localStorage
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    
    // Update document class
    const htmlElement = document.documentElement;
    if (isDark) {
      htmlElement.classList.add('dark');
    } else {
      htmlElement.classList.remove('dark');
    }
    
    // Force a reflow to ensure styles are applied
    void htmlElement.offsetHeight;
    
    console.log('Theme changed to:', isDark ? 'dark' : 'light');
    console.log('HTML classes:', htmlElement.className);
    console.log('Computed background:', window.getComputedStyle(document.body).backgroundColor);
  }, [isDark]);

  const toggleTheme = () => {
    console.log('Toggle theme clicked. Current:', isDark ? 'dark' : 'light', '-> New:', !isDark ? 'dark' : 'light');
    setIsDark(prev => !prev);
  };

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
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
