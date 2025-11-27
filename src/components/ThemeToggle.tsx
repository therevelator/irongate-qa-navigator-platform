import React from 'react';
import { Sun, Moon, Palette } from 'lucide-react';
import { useTheme, themes } from '../contexts/ThemeContext';
import type { ThemeName } from '../contexts/ThemeContext';

interface ThemeToggleProps {
  showThemeSelector?: boolean;
  compact?: boolean;
}

const ThemeToggle: React.FC<ThemeToggleProps> = ({ showThemeSelector = false, compact = false }) => {
  const { isDark, themeName, toggleMode, setThemeName } = useTheme();

  if (compact) {
    return (
      <button
        onClick={toggleMode}
        className={`relative w-14 h-7 rounded-full transition-all duration-300 ${
          isDark 
            ? 'bg-gradient-to-r from-slate-700 to-slate-800' 
            : 'bg-gradient-to-r from-amber-200 to-yellow-300'
        }`}
        title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      >
        <div
          className={`absolute top-0.5 w-6 h-6 rounded-full transition-all duration-300 flex items-center justify-center ${
            isDark 
              ? 'left-7 bg-slate-600 shadow-lg' 
              : 'left-0.5 bg-white shadow-md'
          }`}
        >
          {isDark ? (
            <Moon size={14} className="text-cyan-400" />
          ) : (
            <Sun size={14} className="text-amber-500" />
          )}
        </div>
        
        {/* Stars for dark mode */}
        {isDark && (
          <>
            <div className="absolute top-1.5 left-2 w-1 h-1 bg-white rounded-full opacity-70" />
            <div className="absolute top-3 left-4 w-0.5 h-0.5 bg-white rounded-full opacity-50" />
          </>
        )}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {/* Mode Toggle */}
      <button
        onClick={toggleMode}
        className={`relative w-16 h-8 rounded-full transition-all duration-300 ${
          isDark 
            ? 'bg-gradient-to-r from-slate-700 to-slate-800 shadow-inner' 
            : 'bg-gradient-to-r from-amber-200 to-yellow-300 shadow-inner'
        }`}
        title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      >
        <div
          className={`absolute top-1 w-6 h-6 rounded-full transition-all duration-300 flex items-center justify-center shadow-lg ${
            isDark 
              ? 'left-9 bg-slate-600' 
              : 'left-1 bg-white'
          }`}
        >
          {isDark ? (
            <Moon size={14} className="text-cyan-400" />
          ) : (
            <Sun size={14} className="text-amber-500" />
          )}
        </div>
        
        {/* Decorative elements */}
        {isDark && (
          <>
            <div className="absolute top-2 left-2 w-1 h-1 bg-white rounded-full opacity-70 animate-pulse" />
            <div className="absolute top-4 left-4 w-0.5 h-0.5 bg-white rounded-full opacity-50" />
            <div className="absolute top-2.5 left-5 w-0.5 h-0.5 bg-white rounded-full opacity-60" />
          </>
        )}
      </button>

      {/* Theme Selector */}
      {showThemeSelector && (
        <div className="flex items-center gap-1 p-1 rounded-lg bg-gray-100 dark:bg-slate-800">
          {(Object.keys(themes) as ThemeName[]).map((theme) => (
            <button
              key={theme}
              onClick={() => setThemeName(theme)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
                themeName === theme
                  ? theme === 'ocean'
                    ? 'bg-cyan-500 text-white shadow-md'
                    : 'bg-violet-500 text-white shadow-md'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-slate-700'
              }`}
              title={themes[theme].description}
            >
              {themes[theme].name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// Full Theme Panel for settings
export const ThemePanel: React.FC = () => {
  const { isDark, themeName, toggleMode, setThemeName } = useTheme();

  return (
    <div className="p-4 rounded-xl bg-white dark:bg-slate-800 shadow-lg border border-gray-200 dark:border-slate-700">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <Palette size={16} />
        Appearance
      </h3>

      {/* Mode Selection */}
      <div className="mb-4">
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 block">Mode</label>
        <div className="flex gap-2">
          <button
            onClick={() => !isDark || toggleMode()}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg transition-all ${
              !isDark
                ? 'bg-amber-100 text-amber-700 border-2 border-amber-300'
                : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400 border-2 border-transparent hover:border-gray-300 dark:hover:border-slate-600'
            }`}
          >
            <Sun size={16} />
            <span className="text-sm font-medium">Light</span>
          </button>
          <button
            onClick={() => isDark || toggleMode()}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg transition-all ${
              isDark
                ? 'bg-slate-700 text-cyan-400 border-2 border-cyan-500/50'
                : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400 border-2 border-transparent hover:border-gray-300 dark:hover:border-slate-600'
            }`}
          >
            <Moon size={16} />
            <span className="text-sm font-medium">Dark</span>
          </button>
        </div>
      </div>

      {/* Theme Selection */}
      <div>
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 block">Theme</label>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(themes) as ThemeName[]).map((theme) => (
            <button
              key={theme}
              onClick={() => setThemeName(theme)}
              className={`relative p-3 rounded-lg transition-all ${
                themeName === theme
                  ? 'ring-2 ring-offset-2 dark:ring-offset-slate-800 ' + 
                    (theme === 'ocean' ? 'ring-cyan-500' : 'ring-violet-500')
                  : 'hover:bg-gray-50 dark:hover:bg-slate-700'
              }`}
            >
              {/* Theme Preview */}
              <div className={`h-12 rounded-md mb-2 ${
                theme === 'ocean'
                  ? 'bg-gradient-to-br from-cyan-400 to-blue-500'
                  : 'bg-gradient-to-br from-violet-400 to-fuchsia-500'
              }`} />
              <div className="text-left">
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {themes[theme].name}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {themes[theme].description}
                </p>
              </div>
              {themeName === theme && (
                <div className={`absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center ${
                  theme === 'ocean' ? 'bg-cyan-500' : 'bg-violet-500'
                }`}>
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ThemeToggle;
