import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ShieldCheck } from 'lucide-react';
import API_URL from '../config/api';
import { Card } from './ui';

/**
 * The signed-in person's own developer-insights switch (Developer productivity page). Off by default: while it is
 * off, their pull requests are stored without an author, their calendar is not read and nobody sees an individual
 * row for them. Their choice is recorded in the change history. API: /api/auth/me/developer-insights.
 */
const MyDeveloperInsights: React.FC<{ onChanged?: () => void }> = ({ onChanged }) => {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/auth/me/developer-insights`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEnabled(d ? !!d.enabled : null))
      .catch(() => setEnabled(null));
  }, []);
  if (enabled === null) return null;

  const toggle = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/auth/me/developer-insights`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not change the setting');
      setEnabled(!!data.enabled);
      toast.success(data.enabled ? 'Your developer insights are on' : 'Your developer insights are off');
      onChanged?.();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="my-developer-insights">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <ShieldCheck size={20} className="mt-0.5 flex-shrink-0 text-brand-700 dark:text-brand-300" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Your developer insights: {enabled ? 'on' : 'off'}</h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {enabled
                ? 'Your review times and, where connected, your calendar’s busy and free times are used for your own row. The roles your organisation allows to see individual metrics can see it. Turn it off at any time.'
                : 'Your individual metrics are not kept: pull requests are stored without your name and your calendar is not read. Team figures do not show you. Turn it on to see your own week.'}
            </p>
          </div>
        </div>
        <button type="button" role="switch" aria-checked={enabled} aria-label="Your developer insights" disabled={busy} onClick={toggle} data-testid="my-developer-insights-switch"
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-60 ${enabled ? 'bg-brand-700' : 'bg-slate-400 dark:bg-slate-600'}`}>
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>
    </Card>
  );
};

export default MyDeveloperInsights;
