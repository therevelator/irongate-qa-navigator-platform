import React, { useEffect, useMemo, useState } from 'react';
import BrandMark from './BrandMark';
import { AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';
import API_URL from '../config/api';
import { PulseAnswerForm, type PulseQuestionSet } from './PulseSurveyForm';
import { periodLabel } from './PulseSurveyResults';

/**
 * /pulse/answer?token=… — the personal link from the survey e-mail (server/lib/pulseSend.ts).
 * Works with or without signing in: the token authenticates only this one submission for its
 * user, team and period (no session, no other access). The answer is stored anonymously, like an
 * answer given in the app; afterwards a thank-you is shown and the link stops working.
 */

interface LinkInfo extends Partial<PulseQuestionSet> {
  status: 'open' | 'used' | 'expired' | 'invalid';
  message: string | null;
  team?: { name: string };
  company?: { name: string };
  period?: { start: string; end: string; lastDay: string };
  threshold?: number;
}

const Shell: React.FC<{ children: React.ReactNode; wide?: boolean }> = ({ children, wide }) => (
  <div className="ig-app-bg min-h-screen bg-slate-50 px-4 py-10 dark:bg-slate-950">
    <main className={wide ? 'mx-auto w-full max-w-2xl' : 'mx-auto w-full max-w-md'}>
      <div className="mb-8 flex items-center gap-3">
        <BrandMark height={36} />
              <div className="leading-tight">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">QE Navigator</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">by IronGate Software</p>
              </div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-5 sm:p-8 dark:border-slate-800 dark:bg-slate-900">{children}</div>
    </main>
  </div>
);

const goHome = () => {
  window.history.replaceState(null, '', '/');
  window.dispatchEvent(new PopStateEvent('popstate'));
};

const PulseAnswerLink: React.FC = () => {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') ?? '', []);
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ team: string; lastDay?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_URL}/pulse/link`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
        });
        const body = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) setError(body.error || 'The survey could not be opened.');
        else setInfo(body);
      } catch {
        if (!cancelled) setError('The server could not be reached. Try again in a moment.');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const submit = async (answers: Record<string, number>, comment: string | undefined) => {
    const r = await fetch(`${API_URL}/pulse/link/respond`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, answers, comment }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || 'Your answer could not be saved.');
    setDone({ team: body.team?.name ?? info?.team?.name ?? 'your team', lastDay: info?.period?.lastDay });
  };

  if (done) {
    return (
      <Shell>
        <div className="flex items-start gap-3" data-testid="pulse-link-thanks">
          <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-green-700 dark:text-green-400" aria-hidden />
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">Thank you</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Your answer for {done.team} was saved anonymously: without your name, user id or the time you answered.
              Results are shown to the team only as averages, after the period ends and only if at least {info?.threshold ?? 3} people answered.
            </p>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">This link no longer works. You can close this page.</p>
          </div>
        </div>
      </Shell>
    );
  }

  if (error || (info && info.status !== 'open')) {
    const used = info?.status === 'used';
    return (
      <Shell>
        <div className="flex items-start gap-3" data-testid={`pulse-link-${info?.status ?? 'error'}`}>
          {used
            ? <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-green-700 dark:text-green-400" aria-hidden />
            : <AlertCircle size={22} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />}
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
              {used ? 'Already answered' : info?.status === 'expired' ? 'This survey has closed' : 'Link not valid'}
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{error ?? info?.message}</p>
            <button type="button" onClick={goHome} className="mt-5 h-10 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
              Open QE Navigator
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  if (!info || !info.questions || !info.scale || !info.period) {
    return <Shell><p className="text-sm text-slate-500 dark:text-slate-400" role="status">Opening your survey…</p></Shell>;
  }

  return (
    <Shell wide>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">Wellbeing pulse · {info.team?.name}</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        {info.company?.name} · period {periodLabel(info.period)}
      </p>
      <p className="mt-4 flex gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
        <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden />
        <span>Your answers are anonymous. Your manager can see whether you have responded, not what you answered. This personal link works once and only for this survey. Do not forward it.</span>
      </p>
      <div className="mt-6" data-testid="pulse-link-form">
        <PulseAnswerForm set={info as PulseQuestionSet} onSubmit={submit} />
      </div>
    </Shell>
  );
};

export default PulseAnswerLink;
