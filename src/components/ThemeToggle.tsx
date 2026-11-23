import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export const ThemeToggle: React.FC<{
  variant?: 'light' | 'dark-header' | 'sidebar';
  className?: string;
}> = ({ variant = 'light', className = '' }) => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const nextLabel = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  if (variant === 'sidebar') {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={nextLabel}
        title={nextLabel}
        className={`w-full min-h-[44px] px-3.5 rounded-lg flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap ${className}`}
      >
        <span className="flex items-center gap-3">
          {isDark ? (
            <Sun className="w-4 h-4 shrink-0 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 shrink-0 text-[#0B2B7E]" />
          )}
          <span>{isDark ? 'Light Appearance' : 'Dark Appearance'}</span>
        </span>
        <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
          {isDark ? 'Dark' : 'Light'}
        </span>
      </button>
    );
  }

  if (variant === 'dark-header') {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={nextLabel}
        title={nextLabel}
        className={`min-h-[40px] px-2.5 sm:px-3 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${className}`}
      >
        {isDark ? (
          <Sun className="w-4 h-4 shrink-0 text-amber-300" />
        ) : (
          <Moon className="w-4 h-4 shrink-0" />
        )}
        <span className="hidden sm:inline">{isDark ? 'Light' : 'Dark'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={nextLabel}
      title={nextLabel}
      className={`min-h-[40px] min-w-[40px] sm:min-h-[42px] sm:px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-100 text-xs font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${className}`}
    >
      {isDark ? (
        <Sun className="w-4 h-4 shrink-0 text-amber-400" />
      ) : (
        <Moon className="w-4 h-4 shrink-0 text-[#0B2B7E]" />
      )}
      <span className="hidden md:inline">{isDark ? 'Light' : 'Dark'}</span>
    </button>
  );
};
