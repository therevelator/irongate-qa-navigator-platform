import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { BellRing, Info, Mail, Send } from 'lucide-react';
import API_URL from '../config/api';
import { formatAsOf } from '../data/advancedFeatures';
import { Badge, CardHeader, buttonClass, cx } from './ui';
import { Switch } from './NotificationParts';
import type { TeamPulseData } from './PulseSurveyResults';

/**
 * "Send survey to the team" (POST /api/pulse/teams/:id/send), reminders (…/remind) and automatic
 * sending (PUT …/auto-send) for the team's lead, its QA managers and admins.
 *
 * Privacy: the panel shows who has not been SENT the survey (sending is not answering), but about
 * answering only counts, and those only from 3 answers on. Personal links are never shown: a
 * manager holding one could answer as someone else.
 */

export interface PulseSendStatus {
  emailConfigured: boolean;
  autoSend: { enabled: boolean; from: string | null; windowDays: number };
  period: { start: string; end: string };
  members: number;
  sent: number;
  lastSentAt: string | null;
  notSent: Array<{ id: string; name: string }>;
  lastReminderAt: string | null;
  reminderAvailableAt: string | null;
  log: Array<{
    id: string; kind: 'survey' | 'reminder'; trigger: 'manual' | 'auto'; at: string; period: { start: string; end: string };
    recipients: number | null; delivered: number | null; channel: string; by: string | null;
  }>;
}

const when = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return `${formatAsOf(iso)}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`;
};

async function call(path: string, method: 'POST' | 'PUT', body?: object) {
  const r = await fetch(`${API_URL}${path}`, {
    method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error || 'The request failed.');
  return json;
}

const logLine = (e: PulseSendStatus['log'][number]) => {
  const what = e.kind === 'reminder' ? 'Reminder' : e.trigger === 'auto' ? 'Sent automatically' : 'Survey sent';
  const count = e.recipients == null
    ? (e.kind === 'reminder' ? ' to the members who had not answered' : '')
    : e.kind === 'reminder' ? ` to ${e.recipients} member${e.recipients === 1 ? '' : 's'} who had not answered` : ` to ${e.recipients} member${e.recipients === 1 ? '' : 's'}`;
  const delivery = e.channel === 'log' ? ' · not e-mailed (e-mail not configured)' : e.delivered != null && e.recipients != null && e.delivered < e.recipients ? ` · ${e.delivered} delivered` : '';
  return `${what}${count}${e.by ? ` by ${e.by}` : ''}${delivery}`;
};

export const PulseSendPanel: React.FC<{ data: TeamPulseData; sending: PulseSendStatus; onChanged: () => void; compact?: boolean }> = ({ data, sending, onChanged, compact }) => {
  const [busy, setBusy] = useState<null | 'send' | 'remind' | 'auto'>(null);
  const [showAll, setShowAll] = useState(false);
  const teamPath = `/pulse/teams/${encodeURIComponent(data.team.id)}`;
  const allSent = sending.members > 0 && sending.notSent.length === 0;
  const answeredAll = data.currentPeriod.responsesSoFar != null && data.currentPeriod.responsesSoFar >= sending.members && sending.members > 0;

  const run = async (kind: 'send' | 'remind') => {
    setBusy(kind);
    try {
      const r = await call(`${teamPath}/${kind}`, 'POST');
      if (!r.emailConfigured) {
        toast('E-mail is not configured on this server, so nothing was e-mailed. Members can answer in the app.', { icon: undefined });
      } else if (kind === 'send') {
        toast.success(`Survey sent to ${r.recipients} member${r.recipients === 1 ? '' : 's'}${r.delivered < r.recipients ? ` (${r.delivered} delivered)` : ''}.`);
      } else {
        toast.success(r.recipients == null ? 'Reminder sent to the members who have not answered.' : `Reminder sent to ${r.recipients} member${r.recipients === 1 ? '' : 's'} who have not answered.`);
      }
      onChanged();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const toggleAuto = async (enabled: boolean) => {
    setBusy('auto');
    try {
      const r = await call(`${teamPath}/auto-send`, 'PUT', { enabled });
      toast.success(r.autoSend.enabled ? `Sent automatically from the period starting ${formatAsOf(r.autoSend.from)}.` : 'Automatic sending is off.');
      onChanged();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const shownNotSent = showAll ? sending.notSent : sending.notSent.slice(0, compact ? 4 : 8);
  const statusText = sending.members === 0
    ? 'The team has no active members to send the survey to.'
    : sending.sent === 0
      ? `Not sent yet for this period (${sending.members} member${sending.members === 1 ? '' : 's'}).`
      : `Sent to ${sending.sent} of ${sending.members} members${sending.lastSentAt ? ` on ${formatAsOf(sending.lastSentAt)}` : ''}.`;

  return (
    <section aria-label="Send the survey" data-testid="pulse-send">
      {compact ? (
        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Send the survey</h4>
      ) : (
        <CardHeader title="Send the survey" subtitle="Each member gets a personal link for this period. It works once and expires when the period ends." />
      )}
      <div className={cx('space-y-3 text-sm', compact && 'mt-2')}>
        <p className="text-slate-700 dark:text-slate-300" data-testid="pulse-send-status">{statusText}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="pulse-send-answered">
          Answers so far: {data.currentPeriod.responsesSoFarText.toLowerCase()}
          {data.currentPeriod.responseRate != null ? ` (${data.currentPeriod.responseRate}% of those sent)` : ''}. Who answered is never shown.
        </p>

        {!sending.emailConfigured && (
          <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="pulse-email-off">
            <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
            <p>E-mail is not configured on this server (SMTP), so the survey cannot be e-mailed. Members can answer in the app under Analytics, Wellbeing pulse. Personal links are never shown here, so nobody can answer for someone else.</p>
          </div>
        )}

        {sending.notSent.length > 0 && sending.members > 0 && (
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Not sent yet ({sending.notSent.length})</p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5" data-testid="pulse-not-sent">
              {shownNotSent.map((m) => (
                <li key={m.id}><Badge tone="neutral" className="whitespace-nowrap">{m.name}</Badge></li>
              ))}
              {sending.notSent.length > shownNotSent.length && (
                <li><button type="button" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => setShowAll(true)}>+{sending.notSent.length - shownNotSent.length} more</button></li>
              )}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass.primary} disabled={busy !== null || allSent || sending.members === 0 || !data.team.isActive}
            onClick={() => run('send')} data-testid="pulse-send-button">
            <Send size={15} aria-hidden /> {busy === 'send' ? 'Sending…' : allSent ? 'Sent to every member' : sending.sent ? 'Send to the rest of the team' : 'Send survey to the team'}
          </button>
          <button type="button" className={buttonClass.secondary} disabled={busy !== null || sending.members === 0 || answeredAll || !!sending.reminderAvailableAt || !data.team.isActive}
            onClick={() => run('remind')} data-testid="pulse-remind-button"
            title={sending.reminderAvailableAt ? `One reminder per 24 hours; next from ${when(sending.reminderAvailableAt)}` : undefined}>
            <BellRing size={15} aria-hidden /> {busy === 'remind' ? 'Sending…' : <>Send reminder<span className={compact ? 'hidden sm:inline' : undefined}> to those who haven’t answered</span></>}
          </button>
        </div>
        {sending.reminderAvailableAt && (
          <p className="text-xs text-slate-500 dark:text-slate-400">Reminder sent {when(sending.lastReminderAt)}. The next one is possible from {when(sending.reminderAvailableAt)}.</p>
        )}

        <div className={cx('border-t border-slate-200 pt-3 dark:border-slate-800')}>
          {data.canSetCadence ? (
            <Switch checked={sending.autoSend.enabled} disabled={busy !== null} onChange={toggleAuto} testId="pulse-auto-send"
              label="Send automatically each period"
              description={sending.autoSend.enabled
                ? `E-mailed to every member at the start of each period${sending.autoSend.from ? `, from ${formatAsOf(sending.autoSend.from)}` : ''}.`
                : 'Off: the survey goes out only when someone presses Send.'} />
          ) : (
            <p className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400" data-testid="pulse-auto-readonly">
              <Mail size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                Asked {data.cadences.find((c) => c.value === data.cadence)?.label.toLowerCase() ?? data.cadence}
                {sending.autoSend.enabled ? ', e-mailed automatically at the start of each period' : ', sent by hand'}. QA managers decide how often and whether it goes out automatically.
              </span>
            </p>
          )}
        </div>

        {!compact && sending.log.length > 0 && (
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Recent sends</p>
            <ul className="mt-1.5 space-y-1" data-testid="pulse-send-log">
              {sending.log.slice(0, 5).map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-x-3 text-xs">
                  <span className="text-slate-700 dark:text-slate-300">{logLine(e)}</span>
                  <span className="tabular-nums text-slate-500 dark:text-slate-400">{when(e.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
};
