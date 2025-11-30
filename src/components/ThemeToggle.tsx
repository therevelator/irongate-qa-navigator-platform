import React from 'react';
import { Sun, Moon, Palette } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

interface ThemeToggleProps {
  compact?: boolean;
}

const ThemeToggle: React.FC<ThemeToggleProps> = ({ compact = false }) => {
  const { isDark, toggleMode } = useTheme();

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

        {isDark && (
          <>
            <div className="absolute top-2 left-2 w-1 h-1 bg-white rounded-full opacity-70 animate-pulse" />
            <div className="absolute top-4 left-4 w-0.5 h-0.5 bg-white rounded-full opacity-50" />
            <div className="absolute top-2.5 left-5 w-0.5 h-0.5 bg-white rounded-full opacity-60" />
          </>
        )}
      </button>
    </div>
  );
};

export const ThemePanel: React.FC = () => {
  const { isDark, toggleMode } = useTheme();

  return (
    <div className="p-4 rounded-xl bg-white dark:bg-slate-800 shadow-lg border border-gray-200 dark:border-slate-700">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <Palette size={16} />
        Appearance
      </h3>

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

      <div>
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 block">Theme</label>
        <div className="p-3 rounded-lg border border-dashed border-gray-300 dark:border-slate-600 bg-gray-50 dark:bg-slate-800/40">
          <p className="text-sm font-medium text-gray-900 dark:text-white">Minimal</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Fixed minimal layout. You can still switch between light and dark mode above.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ThemeToggle;
