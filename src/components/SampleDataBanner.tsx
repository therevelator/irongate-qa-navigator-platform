import React, { useState } from 'react';
import { FlaskConical, X } from 'lucide-react';
import { useHideSampleNotice } from '../contexts/AuthContext';

const KEY = 'irongate_sample_banner_dismissed';

const readDismissed = (): boolean => {
  try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; }
};

/**
 * "Includes sample data": shown when any value on the screen comes from generated sample data
 * (field_sources / metric_values source 'synthetic', reported by the API as sampleData), never
 * from the company name. Dismissed for the rest of the browser session. Not shown at all when the
 * company hides sample-data notices (companies.settings.hideSampleDataNotice, e.g. a demo company).
 */
const SampleDataBanner: React.FC<{ show: boolean; className?: string }> = ({ show, className }) => {
  const [dismissed, setDismissed] = useState(readDismissed);
  const hidden = useHideSampleNotice();
  if (!show || dismissed || hidden) return null;
  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem(KEY, '1'); } catch { /* storage unavailable */ }
  };
  return (
    <div
      role="status"
      data-testid="sample-data-banner"
      className={`mb-4 flex items-center gap-2.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 ${className ?? ''}`}
    >
      <FlaskConical size={14} className="flex-shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold text-slate-900 dark:text-white">Includes sample data.</span>{' '}
        Some values on this screen were generated for demonstration, not measured.
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-500 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
        aria-label="Dismiss the sample data notice for this session"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
};

export default SampleDataBanner;
