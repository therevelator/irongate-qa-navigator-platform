import React, { useState } from 'react';
import toast from 'react-hot-toast';
import API_URL from '../config/api';
import { formatAsOf } from '../data/advancedFeatures';
import { CardHeader, buttonClass, cx, inputClass } from './ui';
import { Switch } from './NotificationParts';
import type { PulseReminderInfo, TeamPulseData } from './PulseSurveyResults';

/**
 * Non-response handling of a team's pulse survey (PUT /api/pulse/teams/:id/settings), for the
 * team lead, the department's QA managers and admins: the in-app warning for members who have not
 * answered, automatic reminder e-mails, and the escalation of their NAMES (never their answers).
 * Shows the values that apply this period (shortened to fit short periods).
 */
export const PulseReminderSettings: React.FC<{ data: TeamPulseData; reminders: PulseReminderInfo; onChanged: () => void }> = ({ data, reminders, onChanged }) => {
  const [form, setForm] = useState(reminders.settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eff = reminders.effective;
  const dirty = JSON.stringify(form) !== JSON.stringify(reminders.settings);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const num = (k: 'warningAfterDays' | 'reminderEveryDays' | 'escalateAfterDays', label: string, help: string, effective: number) => (
    <div>
      <label htmlFor={`pr-${k}`} className="block text-sm font-medium text-slate-900 dark:text-white">{label}</label>
      <div className="mt-1 flex items-center gap-2">
        <input id={`pr-${k}`} type="number" inputMode="numeric" min={reminders.limits[k].min} max={reminders.limits[k].max} value={form[k]}
          onChange={(e) => set(k, Number(e.target.value))} className={cx(inputClass, 'w-24')} data-testid={`pulse-${k}`} />
        <span className="text-sm text-slate-600 dark:text-slate-300">days after the survey went out</span>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {help}{effective !== form[k] && form[k] === reminders.settings[k] ? ` This period: ${effective} days (the period is short).` : ''}
      </p>
    </div>
  );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${API_URL}/pulse/teams/${encodeURIComponent(data.team.id)}/settings`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || 'The settings could not be saved.');
      toast.success('Reminder settings saved.');
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Reminders and escalation" data-testid="pulse-reminders">
      <CardHeader title="Reminders and escalation"
        subtitle={reminders.sentDay ? `This period's survey went out on ${formatAsOf(reminders.sentDay)}. It closes after ${formatAsOf(reminders.periodLastDay)}.` : 'Counted from the day the survey goes out each period.'} />
      <div className="space-y-4 text-sm">
        {num('warningAfterDays', 'Warn members who have not answered', 'They see a reminder in the app (only they see it).', eff.warningAfterDays)}
        <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
          <Switch checked={form.reminderEmails} onChange={(v) => set('reminderEmails', v)} testId="pulse-reminderEmails"
            label="E-mail reminders" description="Only to members who have not answered, never after the survey closes, at most one a day." />
          {form.reminderEmails && num('reminderEveryDays', 'Every', 'A new personal link each time.', eff.reminderEveryDays)}
        </div>
        <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
          {num('escalateAfterDays', 'Escalate', 'Once per period, the names of members who have not answered and the response rate. Never what anyone answered.', eff.escalateAfterDays)}
          <label htmlFor="pr-escalateTo" className="mt-3 block text-sm font-medium text-slate-900 dark:text-white">Tell</label>
          <select id="pr-escalateTo" value={form.escalateTo} onChange={(e) => set('escalateTo', e.target.value as typeof form.escalateTo)} className={cx(inputClass, 'mt-1 w-full sm:w-auto')} data-testid="pulse-escalateTo">
            {reminders.escalateToOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400" data-testid="pulse-escalation-recipients">
            {reminders.fallbackToAdmins
              ? `Nobody holds that role now, so the super admins are told instead${reminders.recipients.length ? ` (${reminders.recipients.join(', ')})` : ''}.`
              : `Now: ${reminders.recipients.join(', ')}.`}
          </p>
        </div>
        {eff.shortened && (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300" data-testid="pulse-effective">
            This period is short, so it uses: warning after {eff.warningAfterDays} days, reminders every {eff.reminderEveryDays} days, escalation after {eff.escalateAfterDays} days.
          </p>
        )}
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
        <button type="button" className={buttonClass.primary} disabled={!dirty || saving} onClick={save} data-testid="pulse-reminders-save">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  );
};
