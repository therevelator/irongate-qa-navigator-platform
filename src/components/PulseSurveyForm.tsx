import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Lock } from 'lucide-react';
import API_URL from '../config/api';
import { formatAsOf } from '../data/advancedFeatures';
import { Card, CardHeader, buttonClass, cx, inputClass } from './ui';
import { CADENCE_LABEL, periodLabel, type PulseCadence, type TeamPulseData } from './PulseSurveyResults';

/**
 * Answer the team's anonymous pulse survey for the running period (POST /api/pulse/teams/:id/responses),
 * and, for QA managers and admins (managers decide), how often the team is asked (PUT …/cadence).
 */
export interface PulseQuestionSet {
  questions: Array<{ key: string; text: string }>;
  scale: { min: number; max: number; minLabel: string; maxLabel: string };
  commentMax: number;
}

/**
 * The five statements on the 1–5 scale and the optional comment. Used in the app and on the
 * personal-link page; `onSubmit` sends the answers (and throws with the message to show).
 */
export const PulseAnswerForm: React.FC<{ set: PulseQuestionSet; onSubmit: (answers: Record<string, number>, comment: string | undefined) => Promise<void> }> = ({ set, onSubmit }) => {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = set.questions.every((q) => answers[q.key] != null);
  const scale = Array.from({ length: set.scale.max - set.scale.min + 1 }, (_, i) => set.scale.min + i);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!complete) { setError(`Answer every question (${set.scale.min}–${set.scale.max}) before sending.`); return; }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(answers, comment.trim() || undefined);
      setAnswers({});
      setComment('');
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" data-testid="pulse-form" noValidate>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        1 = {set.scale.minLabel.toLowerCase()}, {set.scale.max} = {set.scale.maxLabel.toLowerCase()}.
      </p>
      {set.questions.map((q, qi) => (
        <fieldset key={q.key} className="space-y-2">
          <legend className="text-sm font-medium text-slate-900 dark:text-white">{qi + 1}. {q.text}</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={q.text}>
            {scale.map((v) => {
              const id = `pulse-${q.key}-${v}`;
              const checked = answers[q.key] === v;
              return (
                <label key={v} htmlFor={id} className={cx(
                  'flex h-10 min-w-10 cursor-pointer items-center justify-center rounded-md border px-3 text-sm font-medium transition-colors',
                  'focus-within:ring-2 focus-within:ring-brand-500 focus-within:ring-offset-1 dark:focus-within:ring-offset-slate-900',
                  checked
                    ? 'border-brand-700 bg-brand-700 text-white dark:border-brand-400 dark:bg-brand-500 dark:text-slate-950'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
                )}>
                  <input id={id} type="radio" name={`pulse-${q.key}`} value={v} checked={checked} className="sr-only"
                    onChange={() => setAnswers((a) => ({ ...a, [q.key]: v }))} data-testid={id} />
                  {v}
                  <span className="sr-only">{v === set.scale.min ? ` (${set.scale.minLabel})` : v === set.scale.max ? ` (${set.scale.maxLabel})` : ''}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
      <div>
        <label htmlFor="pulse-comment" className="block text-sm font-medium text-slate-900 dark:text-white">Comment (optional)</label>
        <textarea id="pulse-comment" rows={3} maxLength={set.commentMax} value={comment} onChange={(e) => setComment(e.target.value)}
          className={cx(inputClass, 'mt-1.5 block h-auto w-full py-2')} aria-describedby="pulse-comment-help" data-testid="pulse-comment" />
        <p id="pulse-comment-help" className="mt-1 flex justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span>Shown word for word to your lead and managers, with the period’s results only. Leave out anything that identifies you.</span>
          <span className="shrink-0 tabular-nums">{comment.length}/{set.commentMax}</span>
        </p>
      </div>
      {error && <p className="text-sm text-red-700 dark:text-red-400" role="alert">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonClass.primary} disabled={saving} data-testid="pulse-submit">{saving ? 'Sending…' : 'Send anonymously'}</button>
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"><Lock size={12} aria-hidden /> Your answers are anonymous. Your manager can see whether you have responded, not what you answered.</span>
      </div>
    </form>
  );
};

export const PulseSurveyForm: React.FC<{ data: TeamPulseData; onSubmitted: () => void }> = ({ data, onSubmitted }) => {
  const period = data.currentPeriod;
  const submit = async (answers: Record<string, number>, comment: string | undefined) => {
    const r = await fetch(`${API_URL}/pulse/teams/${encodeURIComponent(data.team.id)}/responses`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers, comment }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || 'Your answer could not be saved.');
    toast.success('Thank you. Your answer was saved anonymously.');
    onSubmitted();
  };

  return (
    <Card>
      <CardHeader title="This period's survey" subtitle={<>Period {periodLabel(period)} · asked {CADENCE_LABEL[data.cadence].toLowerCase()}</>} />
      {!data.canRespond ? (
        <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="pulse-not-member">
          {data.team.isActive ? 'Only members of this team can answer its survey. You can see the team’s results.' : 'This team is inactive.'}
        </p>
      ) : period.responded ? (
        <div className="flex items-start gap-3 rounded-md bg-green-50 px-4 py-3 text-sm text-green-800 dark:bg-green-950/40 dark:text-green-300" data-testid="pulse-already-answered">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden />
          <p>You have answered for this period. The next survey opens on {formatAsOf(period.end)}. Results for this period appear after it ends, if at least {data.threshold} people answered.</p>
        </div>
      ) : (
        <PulseAnswerForm set={data} onSubmit={submit} />
      )}
    </Card>
  );
};

/** Every week / two weeks / month / three months: managers decide (the department's QA managers and admins). */
export const PulseCadenceControl: React.FC<{ data: TeamPulseData; onChanged: () => void }> = ({ data, onChanged }) => {
  const [saving, setSaving] = useState(false);
  const effective = data.pendingCadence?.cadence ?? data.cadence;
  const change = async (cadence: PulseCadence) => {
    setSaving(true);
    try {
      const r = await fetch(`${API_URL}/pulse/teams/${encodeURIComponent(data.team.id)}/cadence`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cadence }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || 'The cadence could not be changed.');
      toast.success((body.pendingCadence
        ? `${CADENCE_LABEL[body.pendingCadence.cadence as PulseCadence]} from ${formatAsOf(body.pendingCadence.from)} (the running period keeps its length).`
        : `Stays ${CADENCE_LABEL[cadence].toLowerCase()}.`) + (body.autoSendEnabled ? ' The survey will be e-mailed automatically at the start of each period.' : ''));
      onChanged();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  if (!data.canSetCadence) return null;
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="pulse-cadence" className="whitespace-nowrap text-sm text-slate-600 dark:text-slate-300">Ask the team</label>
      <select id="pulse-cadence" className={cx(inputClass, 'w-44')} value={effective} disabled={saving}
        onChange={(e) => change(e.target.value as PulseCadence)} data-testid="pulse-cadence">
        {data.cadences.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      {data.pendingCadence && (
        <span className="text-xs text-slate-500 dark:text-slate-400">from {formatAsOf(data.pendingCadence.from)}</span>
      )}
    </div>
  );
};
