import React, { useEffect, useState } from 'react';
import { CheckCircle2, Circle, ArrowRight, X } from 'lucide-react';
import toast from 'react-hot-toast';
import API_URL from '../config/api';
import { useAuth } from '../contexts/AuthContext';
import { canViewOnboarding } from '../../server/lib/userPolicy';
import { policyActorOf } from '../lib/policyActor';
import { Card, ProgressBar, buttonClass, cx } from './ui';

/**
 * Onboarding checklist of a new organisation (GET /api/onboarding, server/lib/onboarding.ts),
 * on the dashboard of company administrators while any step is open and nobody hid it.
 * Progress comes from the real state (departments, teams, people, targets, first data), so a
 * step ticks itself when the work is done anywhere in the app.
 */

interface Step { key: string; label: string; description: string; done: boolean; count: number; view: string; actionLabel: string }
interface Status { steps: Step[]; completed: number; total: number; complete: boolean; dismissed: boolean; show: boolean }

/** App view → path (App.tsx VIEW_TO_PATH); navigation through popstate, which App listens to. */
const PATH: Record<string, string> = {
  departments: '/departments', teams: '/teams', users: '/users', 'parameters-config': '/parameters-config', 'admin-panel': '/admin-panel', 'manual-metrics': '/manual-metrics',
};
const go = (view: string) => {
  window.history.pushState(null, '', PATH[view] ?? '/');
  window.dispatchEvent(new PopStateEvent('popstate'));
};

const DONE_TEXT: Record<string, (n: number) => string> = {
  departments: (n) => `${n} department${n === 1 ? '' : 's'}`,
  teams: (n) => `${n} active team${n === 1 ? '' : 's'}`,
  people: (n) => `${n} ${n === 1 ? 'person or invitation' : 'people and invitations'}`,
  targets: (n) => `${n} target${n === 1 ? '' : 's'} set`,
  data: () => 'Data received',
};

const OnboardingChecklist: React.FC = () => {
  const { user } = useAuth();
  const allowed = canViewOnboarding(policyActorOf(user));
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    fetch(`${API_URL}/onboarding`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setStatus(d); })
      .catch(() => { /* the checklist is optional: no card on failure */ });
    return () => { cancelled = true; };
  }, [allowed]);

  if (!allowed || !status?.show) return null;

  const dismiss = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/onboarding/dismiss`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error();
      setStatus(await res.json());
      toast.success('Checklist hidden. The remaining steps stay available from each page.');
    } catch {
      toast.error('Could not hide the checklist');
    } finally {
      setBusy(false);
    }
  };

  const next = status.steps.find((s) => !s.done);

  return (
    <Card className="mb-6" padded={false}>
      <div data-testid="onboarding-checklist">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Set up your organisation</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              <span data-testid="onboarding-progress">{status.completed} of {status.total} steps done</span> · each step ticks itself when the work is done
            </p>
            <ProgressBar value={status.completed} max={status.total} tone="brand" className="mt-2 max-w-xs" />
          </div>
          <button
            type="button"
            onClick={dismiss}
            disabled={busy}
            className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            data-testid="onboarding-dismiss"
          >
            <X size={14} aria-hidden /> Hide
          </button>
        </div>
        <ol className="divide-y divide-slate-100 dark:divide-slate-800">
          {status.steps.map((s, i) => (
            <li key={s.key} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:px-6" data-testid={`onboarding-step-${s.key}`} data-done={s.done ? 'true' : 'false'}>
              <div className="flex min-w-0 flex-1 items-start gap-3">
                {s.done
                  ? <CheckCircle2 size={18} className="mt-0.5 flex-shrink-0 text-green-600 dark:text-green-400" aria-hidden />
                  : <Circle size={18} className="mt-0.5 flex-shrink-0 text-slate-300 dark:text-slate-600" aria-hidden />}
                <div className="min-w-0">
                  <p className={cx('text-sm font-medium', s.done ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-white')}>
                    <span className="sr-only">Step {i + 1}, {s.done ? 'done' : 'to do'}: </span>{s.label}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{s.done ? (DONE_TEXT[s.key]?.(s.count) ?? 'Done') : s.description}</p>
                </div>
              </div>
              {!s.done && (
                <button
                  type="button"
                  onClick={() => go(s.view)}
                  className={cx(s === next ? buttonClass.primary : buttonClass.secondary, 'self-start whitespace-nowrap sm:self-auto')}
                >
                  {s.actionLabel} <ArrowRight size={14} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
};

export default OnboardingChecklist;
