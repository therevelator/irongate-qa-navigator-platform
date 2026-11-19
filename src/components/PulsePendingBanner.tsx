import React, { useEffect, useState } from 'react';
import { HeartPulse, X } from 'lucide-react';
import API_URL from '../config/api';
import { buttonClass, cx } from './ui';

/**
 * App-wide: the signed-in member's own pending wellbeing pulse surveys (GET /api/pulse/pending:
 * the survey went out at least the team's warning delay ago and they have not answered). One line
 * per team; "Not today" hides it until tomorrow (this browser only).
 */
interface Pending { teamId: string; teamName: string; period: { start: string; end: string; lastDay: string } }

const KEY = 'irongate_pulse_banner_hidden';
const today = () => new Date().toISOString().slice(0, 10);
const readHidden = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') ?? {}; } catch { return {}; }
};

const PulsePendingBanner: React.FC<{ userId: string | null | undefined; onOpen: (teamId: string) => void }> = ({ userId, onOpen }) => {
  const [pending, setPending] = useState<Pending[]>([]);
  const [hidden, setHidden] = useState<Record<string, string>>(readHidden);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    fetch(`${API_URL}/pulse/pending`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { pending: [] }))
      .then((b) => { if (live) setPending(Array.isArray(b.pending) ? b.pending : []); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [userId]);

  const hide = (teamId: string) => {
    const next = { ...hidden, [teamId]: today() };
    setHidden(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };

  const shown = userId ? pending.filter((p) => hidden[p.teamId] !== today()) : [];
  if (!shown.length) return null;
  return (
    <div className="border-b border-brand-200 bg-brand-50 px-4 py-2 sm:px-6 dark:border-brand-900 dark:bg-brand-950/40" data-testid="pulse-pending-banner">
      {shown.map((p) => (
        <div key={p.teamId} className="flex flex-col gap-2 py-1 text-sm text-brand-900 sm:flex-row sm:items-center sm:justify-between dark:text-brand-100">
          <p className="flex items-start gap-2">
            <HeartPulse size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {shown.length > 1 ? <strong>{p.teamName}: </strong> : null}
              Your team&apos;s wellbeing pulse is waiting — it takes 1 minute. Your answers are anonymous.
            </span>
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className={cx(buttonClass.primary, 'h-8 px-3 text-xs')} onClick={() => onOpen(p.teamId)} data-testid="pulse-pending-open">Answer now</button>
            <button type="button" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-brand-800 hover:bg-brand-100 dark:text-brand-200 dark:hover:bg-brand-900/50"
              onClick={() => hide(p.teamId)} aria-label={`Hide the pulse reminder for ${p.teamName} until tomorrow`} data-testid="pulse-pending-hide">
              <X size={14} aria-hidden /> Not today
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default PulsePendingBanner;
