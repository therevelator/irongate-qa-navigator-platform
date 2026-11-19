/**
 * Sending the wellbeing pulse survey by e-mail: the ONE module that reads and writes
 * pulse_settings, pulse_sends, pulse_recipients and pulse_links (migration 20261122200000).
 *
 * Personal links: every active member assigned to the team gets a link
 *   APP_URL/pulse/answer?token=igp_…
 * for the RUNNING period. The token is 32 random bytes; only its sha256 is stored. A link is
 * bound to one user, team and period, expires when the period ends and works once: answering
 * (through the link or in the app) marks every link of that person and period used. The token
 * authenticates only that one survey submission; it gives no session and no other access.
 * Links are never returned by the API, so nobody (a manager included) can answer as someone else.
 *
 * Anonymity: answers go through submitPulseResponse (server/lib/pulse.ts), which stores them
 * without a user id; participation (who answered, no time) is recorded separately. Participation
 * decides who gets reminders and, after the escalation delay, whose NAMES (members who have not
 * answered) go to the team lead / department managers. Nothing here ever reads or returns an
 * answer, its time, or anything derived from answer content.
 *
 * Non-response handling (per team, pulse_settings; defaults in pulseRules.ts): an in-app warning
 * for the member after warning_after_days, automatic reminder e-mails every reminder_every_days
 * (at most one per person per day, never after the period ends), and one escalation per team and
 * period after escalate_after_days (notifications + pulse_sends kind 'escalation'). Days count from
 * the first survey send of the period; without a send there is no warning, reminder or escalation.
 *
 * Automatic sending (runPulseAutoSend, hourly: server/jobs/pulseCron.ts locally,
 * netlify/functions/pulse-auto-send.ts on Netlify): for every active team with auto_send on,
 * once per period (unique index pulse_sends_auto_once), during the first days of the period.
 */
import { createHash, randomBytes } from 'crypto';
import { query, queryOne } from '../../src/lib/db';
import { execOn, loadGrants, teamMembers, departmentManagers, teamLeadOf, type Exec } from './assignments';
import { recordAudit } from './audit';
import { escapeHtml, getMailer, sendMail } from './mailer';
import { appBaseUrl } from './sso';
import { canTakePulseSurvey } from './userPolicy';
import { K_ANONYMITY_MIN, meetsKAnonymity } from './privacy';
import { PulseError, loadCadences, submitPulseResponse } from './pulse';
import {
  PULSE_COMMENT_MAX, PULSE_QUESTIONS, PULSE_SCALE, addDays, periodDays, periodFor, todayUtc, daysBetween,
  DEFAULT_REMINDER_SETTINGS, ESCALATE_TO_LABELS, effectiveReminderSettings,
  type PulsePeriod, type PulseQuestionKey, type ReminderSettings, type EffectiveReminderSettings, type EscalateTo,
} from './pulseRules';
import { assignedTeamIds, type PolicyActor } from './userPolicy';

/* ------------------------------------------------------------------------------------------
 * Tokens
 * ---------------------------------------------------------------------------------------- */

export const PULSE_TOKEN_PREFIX = 'igp_';
export const hashPulseToken = (token: string) => createHash('sha256').update(token).digest('hex');
export function newPulseToken(): { token: string; hash: string } {
  const token = `${PULSE_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashPulseToken(token) };
}
export const pulseLink = (token: string) => `${appBaseUrl()}/pulse/answer?token=${encodeURIComponent(token)}`;
const validTokenShape = (t: unknown): t is string => typeof t === 'string' && t.startsWith(PULSE_TOKEN_PREFIX) && t.length >= 20 && t.length <= 200;

/** Expiry of a period's links: the end of the period (its end day, 00:00 UTC). */
export const linkExpiry = (period: { end: string }) => new Date(`${period.end}T00:00:00Z`);

/**
 * Automatic sending happens only during the first days of a period (a quarter of it, at least 2
 * days), so a team switched on mid-period or a scheduler that was down for long does not mail
 * people late in a period; the manual button covers that.
 */
export const autoSendWindowDays = (p: { start: string; end: string }) => Math.max(2, Math.floor(periodDays(p) / 4));
export function inAutoSendWindow(p: { start: string; end: string }, today: string, from: string | null): boolean {
  if (from && p.start < from) return false;
  return today >= p.start && today < addDays(p.start, autoSendWindowDays(p));
}

/** May the number of people reminded be shown? Not when it would reveal that 1 or 2 people answered. */
export const reminderCountShown = (answered: number | null) => answered === null || answered === 0 || meetsKAnonymity(answered);

/* ------------------------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------------------------- */

export interface PulseSettings { autoSend: boolean; autoSendFrom: string | null; configured: boolean }

export async function loadPulseSettings(teamId: string, exec: Exec = execOn()): Promise<PulseSettings> {
  const [r] = await exec<any>(
    `SELECT auto_send, auto_send_decided, to_char(auto_send_from, 'YYYY-MM-DD') AS auto_send_from FROM pulse_settings WHERE team_id = ?`, [teamId]
  );
  return r && r.auto_send_decided !== false
    ? { autoSend: !!r.auto_send, autoSendFrom: r.auto_send_from ?? null, configured: true }
    : { autoSend: false, autoSendFrom: null, configured: false };
}

/** Warning / reminder / escalation settings of a team (defaults when none saved). */
export async function loadReminderSettings(teamId: string): Promise<ReminderSettings> {
  const r = await queryOne<any>(
    `SELECT warning_after_days, reminder_emails, reminder_every_days, escalate_after_days, escalate_to FROM pulse_settings WHERE team_id = ?`, [teamId]
  );
  if (!r) return { ...DEFAULT_REMINDER_SETTINGS };
  return {
    warningAfterDays: Number(r.warning_after_days), reminderEmails: !!r.reminder_emails, reminderEveryDays: Number(r.reminder_every_days),
    escalateAfterDays: Number(r.escalate_after_days), escalateTo: r.escalate_to as EscalateTo,
  };
}

/** Save the warning / reminder / escalation settings (a new row leaves automatic sending undecided). */
export async function saveReminderSettings(args: { companyId: string; teamId: string; settings: ReminderSettings; actorId: string }): Promise<void> {
  const s = args.settings;
  await query(
    `INSERT INTO pulse_settings (team_id, company_id, auto_send, auto_send_decided, warning_after_days, reminder_emails, reminder_every_days,
                                 escalate_after_days, escalate_to, updated_by, updated_at)
     VALUES (?, ?, FALSE, FALSE, ?, ?, ?, ?, ?, ?, now())
     ON CONFLICT (team_id) DO UPDATE SET warning_after_days = EXCLUDED.warning_after_days, reminder_emails = EXCLUDED.reminder_emails,
       reminder_every_days = EXCLUDED.reminder_every_days, escalate_after_days = EXCLUDED.escalate_after_days,
       escalate_to = EXCLUDED.escalate_to, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [args.teamId, args.companyId, s.warningAfterDays, s.reminderEmails, s.reminderEveryDays, s.escalateAfterDays, s.escalateTo, args.actorId]
  );
}

/** A manager set the cadence: switch automatic sending on from `from` unless the team already has a setting. */
export async function ensureAutoSendDefault(args: { companyId: string; teamId: string; from: string; actorId: string }): Promise<boolean> {
  // A row saved only for the reminder settings has not decided automatic sending yet.
  const rows = await query<any[]>(
    `INSERT INTO pulse_settings (team_id, company_id, auto_send, auto_send_from, updated_by) VALUES (?, ?, TRUE, ?::date, ?)
     ON CONFLICT (team_id) DO UPDATE SET auto_send = TRUE, auto_send_from = EXCLUDED.auto_send_from, auto_send_decided = TRUE,
       updated_by = EXCLUDED.updated_by, updated_at = now()
       WHERE pulse_settings.auto_send_decided = FALSE
     RETURNING team_id`,
    [args.teamId, args.companyId, args.from, args.actorId]
  );
  return rows.length > 0;
}

/** Turn automatic sending on (from the next period) or off. Returns the settings before and after. */
export async function setAutoSend(args: { companyId: string; teamId: string; enabled: boolean; actorId: string; today?: string }):
  Promise<{ before: PulseSettings; after: PulseSettings }> {
  const today = args.today ?? todayUtc();
  const before = await loadPulseSettings(args.teamId);
  const cadences = (await loadCadences([args.teamId])).get(args.teamId) ?? [];
  const from = before.autoSend && args.enabled ? before.autoSendFrom : periodFor(cadences, today).end;
  await query(
    `INSERT INTO pulse_settings (team_id, company_id, auto_send, auto_send_from, updated_by, updated_at) VALUES (?, ?, ?, ?::date, ?, now())
     ON CONFLICT (team_id) DO UPDATE SET auto_send = EXCLUDED.auto_send, auto_send_from = EXCLUDED.auto_send_from, auto_send_decided = TRUE,
       updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [args.teamId, args.companyId, args.enabled, args.enabled ? from : null, args.actorId]
  );
  return { before, after: await loadPulseSettings(args.teamId) };
}

/* ------------------------------------------------------------------------------------------
 * E-mail
 * ---------------------------------------------------------------------------------------- */

export function renderSurveyEmail(args: {
  kind: 'survey' | 'reminder'; firstName: string | null; teamName: string; period: PulsePeriod; link: string;
}): { subject: string; text: string; html: string } {
  const last = addDays(args.period.end, -1);
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const hello = args.firstName ? `Hello ${args.firstName},` : 'Hello,';
  const subject = args.kind === 'reminder'
    ? `Reminder: wellbeing pulse for ${args.teamName}`
    : `Wellbeing pulse for ${args.teamName}: five quick questions`;
  const lead = args.kind === 'reminder'
    ? `A reminder: the wellbeing pulse of ${args.teamName} is open until ${fmt(last)}.`
    : `The wellbeing pulse of ${args.teamName} for ${fmt(args.period.start)} – ${fmt(last)} is open.`;
  const body = 'Five statements on a 1–5 scale and an optional comment; it takes about a minute. Your answers are anonymous. Your manager can see whether you have responded, not what you answered. Results are only shown as team averages when at least 3 people answered.';
  const fine = `This link is personal and works once, until ${fmt(last)}. Do not forward it. You can also answer in the app under Analytics, Wellbeing pulse.`;
  const text = `${hello}\n\n${lead}\n\n${body}\n\nAnswer the survey:\n${args.link}\n\n${fine}`;
  const html = `<p>${escapeHtml(hello)}</p><p>${escapeHtml(lead)}</p><p>${escapeHtml(body)}</p>
<p><a href="${escapeHtml(args.link)}">Answer the survey</a></p>
<p style="color:#475569;font-size:13px">${escapeHtml(fine)}</p>`;
  return { subject, text, html };
}

/* ------------------------------------------------------------------------------------------
 * Sending
 * ---------------------------------------------------------------------------------------- */

export interface SendOutcome {
  kind: 'survey' | 'reminder';
  period: { start: string; end: string };
  /** Members e-mailed by this send (null: withheld, see reminderCountShown). */
  recipients: number | null;
  delivered: number | null;
  /** 'smtp' when e-mail is configured, else 'log' (nothing leaves the server). */
  channel: 'smtp' | 'log';
  emailConfigured: boolean;
  sendId: string | null;
}

interface Member { id: string; email: string; first_name: string | null; name: string }

async function activeMembers(teamId: string): Promise<Member[]> {
  const rows = await teamMembers(teamId);
  const seen = new Set<string>();
  return rows.filter((r: any) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .map((r: any) => ({
      id: r.id, email: r.email, first_name: r.first_name ?? null,
      name: [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || r.email,
    }));
}

/** Issue a link for one member and e-mail it. Returns whether the mail server accepted it. */
async function mailMember(args: {
  companyId: string; team: { id: string; name: string }; period: PulsePeriod; member: Member; kind: 'survey' | 'reminder';
}): Promise<boolean> {
  const { token, hash } = newPulseToken();
  await query(
    `INSERT INTO pulse_links (token_hash, company_id, team_id, user_id, period_start, period_end, expires_at)
     VALUES (?, ?, ?, ?, ?::date, ?::date, ?)`,
    [hash, args.companyId, args.team.id, args.member.id, args.period.start, args.period.end, linkExpiry(args.period)]
  );
  const mail = renderSurveyEmail({ kind: args.kind, firstName: args.member.first_name, teamName: args.team.name, period: args.period, link: pulseLink(token) });
  const result = await sendMail({ to: args.member.email, ...mail });
  await query(
    `INSERT INTO pulse_recipients (company_id, team_id, user_id, period_start, period_end, delivered) VALUES (?, ?, ?, ?::date, ?::date, ?)
     ON CONFLICT (team_id, user_id, period_start) DO UPDATE SET delivered = pulse_recipients.delivered OR EXCLUDED.delivered`,
    [args.companyId, args.team.id, args.member.id, args.period.start, args.period.end, result.delivered]
  );
  return result.delivered;
}

/**
 * E-mail the survey for the running period to every active member who has not been sent it yet
 * (a member whose e-mail was not delivered counts as not sent). trigger 'auto' is recorded at
 * most once per team and period; a second automatic run sends nothing (returns null).
 */
export async function sendPulseSurvey(args: {
  companyId: string; team: { id: string; name: string; department_id?: string | null }; actorId: string | null;
  trigger: 'manual' | 'auto'; today?: string;
}): Promise<SendOutcome | null> {
  const today = args.today ?? todayUtc();
  const cadences = (await loadCadences([args.team.id])).get(args.team.id) ?? [];
  const period = periodFor(cadences, today);
  const channel = getMailer().channel;
  const sent = new Set((await query<any[]>(
    `SELECT user_id FROM pulse_recipients WHERE team_id = ? AND period_start = ?::date AND delivered`, [args.team.id, period.start]
  )).map((r: any) => r.user_id));
  const targets = (await activeMembers(args.team.id)).filter((m) => !sent.has(m.id));
  if (!targets.length && args.trigger === 'manual') {
    throw new PulseError(409, 'Every active member has already been sent the survey for this period. Use a reminder for those who have not answered.');
  }
  // The automatic send is recorded first: the unique index lets only one run per team and period through.
  const [row] = await query<any[]>(
    `INSERT INTO pulse_sends (company_id, team_id, period_start, period_end, kind, trigger, actor_id, channel)
     VALUES (?, ?, ?::date, ?::date, 'survey', ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id`,
    [args.companyId, args.team.id, period.start, period.end, args.trigger, args.actorId, channel]
  );
  if (!row) return null; // automatic send of this period already done
  const sendId: string = row.id;
  let delivered = 0;
  for (const m of targets) if (await mailMember({ companyId: args.companyId, team: args.team, period, member: m, kind: 'survey' })) delivered++;
  await query(`UPDATE pulse_sends SET recipients = ?, delivered = ? WHERE id = ?`, [targets.length, delivered, sendId]);
  await recordAudit({
    companyId: args.companyId, actorId: args.actorId, action: 'team.pulse_send', entityType: 'team', entityId: args.team.id,
    summary: `Pulse survey of ${args.team.name} for ${period.start} – ${addDays(period.end, -1)} ${args.trigger === 'auto' ? 'sent automatically' : 'sent'} to ${targets.length} member${targets.length === 1 ? '' : 's'}${channel === 'log' ? ' (e-mail not configured: not delivered)' : ''}`,
    after: { period: { start: period.start, end: period.end }, trigger: args.trigger, recipients: targets.length, delivered, channel },
    departmentIds: [args.team.department_id], subjectIds: [args.team.id],
  });
  return { kind: 'survey', period: { start: period.start, end: period.end }, recipients: targets.length, delivered, channel, emailConfigured: channel !== 'log', sendId };
}

/** Minimum time between two reminders of a team (hours). */
export const REMINDER_MIN_HOURS = 24;

/**
 * Remind every active member who has not answered the running period (participation is read
 * here, server-side only). The count returned is withheld when it would reveal that 1 or 2
 * people answered. At most one reminder per REMINDER_MIN_HOURS.
 */
export async function remindPulseSurvey(args: {
  companyId: string; team: { id: string; name: string; department_id?: string | null }; actorId: string; today?: string;
}): Promise<SendOutcome> {
  const today = args.today ?? todayUtc();
  const cadences = (await loadCadences([args.team.id])).get(args.team.id) ?? [];
  const period = periodFor(cadences, today);
  const channel = getMailer().channel;
  const recent = await queryOne<any>(
    `SELECT id FROM pulse_sends WHERE team_id = ? AND kind = 'reminder' AND created_at > now() - make_interval(hours => ?)`,
    [args.team.id, REMINDER_MIN_HOURS]
  );
  if (recent) throw new PulseError(409, `A reminder was sent less than ${REMINDER_MIN_HOURS} hours ago. Try again later.`);
  const members = await activeMembers(args.team.id);
  const answeredIds = new Set((await query<any[]>(
    `SELECT user_id FROM pulse_participation WHERE team_id = ? AND period_start = ?::date`, [args.team.id, period.start]
  )).map((r: any) => r.user_id));
  const targets = members.filter((m) => !answeredIds.has(m.id));
  const answered = members.length - targets.length;
  if (!targets.length) throw new PulseError(409, 'Every member has answered this period. There is nobody to remind.');
  const [row] = await query<any[]>(
    `INSERT INTO pulse_sends (company_id, team_id, period_start, period_end, kind, trigger, actor_id, channel, answered)
     VALUES (?, ?, ?::date, ?::date, 'reminder', 'manual', ?, ?, ?) RETURNING id`,
    [args.companyId, args.team.id, period.start, period.end, args.actorId, channel, answered]
  );
  let delivered = 0;
  for (const m of targets) if (await mailMember({ companyId: args.companyId, team: args.team, period, member: m, kind: 'reminder' })) delivered++;
  await markReminded(args.team.id, period, targets.map((m) => m.id), today);
  await query(`UPDATE pulse_sends SET recipients = ?, delivered = ? WHERE id = ?`, [targets.length, delivered, row.id]);
  const shown = reminderCountShown(answered);
  await recordAudit({
    companyId: args.companyId, actorId: args.actorId, action: 'team.pulse_reminder', entityType: 'team', entityId: args.team.id,
    summary: `Pulse survey reminder for ${args.team.name} (${period.start} – ${addDays(period.end, -1)}) sent to the members who had not answered`
      + (shown ? ` (${targets.length})` : ''),
    after: { period: { start: period.start, end: period.end }, recipients: shown ? targets.length : null, channel },
    departmentIds: [args.team.department_id], subjectIds: [args.team.id],
  });
  return {
    kind: 'reminder', period: { start: period.start, end: period.end },
    recipients: shown ? targets.length : null, delivered: shown ? delivered : null,
    channel, emailConfigured: channel !== 'log', sendId: row.id,
  };
}

/* ------------------------------------------------------------------------------------------
 * Status (what the pulse page shows the people who may send)
 * ---------------------------------------------------------------------------------------- */

export interface SendStatus {
  emailConfigured: boolean;
  autoSend: { enabled: boolean; from: string | null; windowDays: number };
  period: { start: string; end: string };
  /** Active members assigned to the team. */
  members: number;
  /** Members the survey e-mail was delivered to for the running period. */
  sent: number;
  lastSentAt: string | null;
  /** Members not sent the survey yet (sending is not answering: names are fine). */
  notSent: Array<{ id: string; name: string }>;
  lastReminderAt: string | null;
  reminderAvailableAt: string | null;
  log: Array<{ id: string; kind: 'survey' | 'reminder'; trigger: 'manual' | 'auto'; at: string; period: { start: string; end: string }; recipients: number | null; delivered: number | null; channel: string; by: string | null }>;
}

export async function sendStatus(team: { id: string }, today = todayUtc()): Promise<SendStatus> {
  const cadences = (await loadCadences([team.id])).get(team.id) ?? [];
  const period = periodFor(cadences, today);
  const settings = await loadPulseSettings(team.id);
  const members = await activeMembers(team.id);
  const rec = await query<any[]>(
    `SELECT user_id, delivered, first_sent_at FROM pulse_recipients WHERE team_id = ? AND period_start = ?::date`, [team.id, period.start]
  );
  const delivered = new Set(rec.filter((r: any) => r.delivered).map((r: any) => r.user_id));
  const memberIds = new Set(members.map((m) => m.id));
  const sends = await query<any[]>(
    `SELECT s.id, s.kind, s.trigger, s.created_at, to_char(s.period_start, 'YYYY-MM-DD') AS period_start, to_char(s.period_end, 'YYYY-MM-DD') AS period_end,
            s.recipients, s.delivered, s.answered, s.channel,
            NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS by_name
       FROM pulse_sends s LEFT JOIN users u ON u.id = s.actor_id
      WHERE s.team_id = ? ORDER BY s.created_at DESC LIMIT 10`,
    [team.id]
  );
  const iso = (d: any) => (d ? new Date(d).toISOString() : null);
  const lastSurvey = sends.find((s: any) => s.kind === 'survey' && s.period_start === period.start && Number(s.delivered) > 0);
  const lastReminder = sends.find((s: any) => s.kind === 'reminder');
  const reminderAvailableAt = lastReminder
    ? new Date(new Date(lastReminder.created_at).getTime() + REMINDER_MIN_HOURS * 3_600_000)
    : null;
  return {
    emailConfigured: getMailer().channel !== 'log',
    autoSend: { enabled: settings.autoSend, from: settings.autoSendFrom, windowDays: autoSendWindowDays(period) },
    period: { start: period.start, end: period.end },
    members: members.length,
    sent: [...delivered].filter((id) => memberIds.has(id)).length,
    lastSentAt: iso(lastSurvey?.created_at),
    notSent: members.filter((m) => !delivered.has(m.id)).map((m) => ({ id: m.id, name: m.name })),
    lastReminderAt: iso(lastReminder?.created_at),
    reminderAvailableAt: reminderAvailableAt && reminderAvailableAt.getTime() > Date.now() ? reminderAvailableAt.toISOString() : null,
    log: sends.map((s: any) => {
      const shown = s.kind === 'survey' || reminderCountShown(s.answered === null ? null : Number(s.answered));
      return {
        id: s.id, kind: s.kind, trigger: s.trigger, at: iso(s.created_at)!,
        period: { start: s.period_start, end: s.period_end },
        recipients: shown ? Number(s.recipients) : null, delivered: shown ? Number(s.delivered) : null,
        channel: s.channel, by: s.trigger === 'auto' ? null : s.by_name ?? null,
      };
    }),
  };
}

/** Members the survey was delivered to, per period start (for the response rate of closed periods). */
export async function sentCounts(teamId: string, periodStarts: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!periodStarts.length) return out;
  const rows = await query<any[]>(
    `SELECT to_char(period_start, 'YYYY-MM-DD') AS start, COUNT(*)::int AS n FROM pulse_recipients
      WHERE team_id = ? AND delivered AND period_start = ANY(?::date[]) GROUP BY period_start`,
    [teamId, periodStarts]
  );
  for (const r of rows) out.set(r.start, Number(r.n));
  return out;
}

/** Response rate (0-100) = responses ÷ members the survey was sent to, at most 100; null without a send. */
export const responseRate = (responses: number | null, sent: number | null | undefined): number | null =>
  responses == null || !sent ? null : Math.min(100, Math.round((responses / sent) * 100));

/* ------------------------------------------------------------------------------------------
 * Answering through a personal link (no session)
 * ---------------------------------------------------------------------------------------- */

export type LinkStatus = 'open' | 'used' | 'expired' | 'invalid';

export const LINK_STATUS_MESSAGE: Record<Exclude<LinkStatus, 'open'>, string> = {
  used: 'This survey link has already been used: you have answered for this period. Thank you.',
  expired: 'This survey link has expired: its period has ended. The next survey arrives at the start of the next period.',
  invalid: 'This survey link is not valid. Open the latest survey e-mail, or sign in and answer under Analytics, Wellbeing pulse.',
};

interface LinkRow {
  token_hash: string; company_id: string; team_id: string; user_id: string; period_start: string; period_end: string;
  expires_at: Date; used: boolean; team_name: string; team_active: boolean; company_name: string; user_active: boolean;
}

async function findLink(token: unknown): Promise<LinkRow | null> {
  if (!validTokenShape(token)) return null;
  return queryOne<LinkRow>(
    `SELECT l.token_hash, l.company_id, l.team_id, l.user_id, to_char(l.period_start, 'YYYY-MM-DD') AS period_start,
            to_char(l.period_end, 'YYYY-MM-DD') AS period_end, l.expires_at, l.used,
            t.name AS team_name, t.is_active AS team_active, c.name AS company_name, u.is_active AS user_active
       FROM pulse_links l
       JOIN teams t ON t.id = l.team_id AND t.company_id = l.company_id
       JOIN companies c ON c.id = l.company_id
       JOIN users u ON u.id = l.user_id AND u.company_id = l.company_id
      WHERE l.token_hash = ?`,
    [hashPulseToken(token)]
  );
}

/** The link's status, checked against the live state (membership, period, participation). */
async function linkState(link: LinkRow | null, today: string): Promise<LinkStatus> {
  if (!link) return 'invalid';
  if (link.used) return 'used';
  const answered = await queryOne<any>(
    `SELECT 1 AS x FROM pulse_participation WHERE team_id = ? AND user_id = ? AND period_start = ?::date`,
    [link.team_id, link.user_id, link.period_start]
  );
  if (answered) return 'used';
  if (new Date(link.expires_at).getTime() <= Date.now()) return 'expired';
  const cadences = (await loadCadences([link.team_id])).get(link.team_id) ?? [];
  if (periodFor(cadences, today).start !== link.period_start) return 'expired';
  if (!link.team_active || !link.user_active) return 'invalid';
  const grants = await loadGrants(link.company_id, link.user_id);
  if (!canTakePulseSurvey({ id: link.user_id, role: '', grants }, { id: link.team_id })) return 'invalid';
  return 'open';
}

/** What the answer page shows for a token (no personal data: team, company, period, questions). */
export async function inspectLink(token: unknown, today = todayUtc()) {
  const link = await findLink(token);
  const status = await linkState(link, today);
  const base = { status, message: status === 'open' ? null : LINK_STATUS_MESSAGE[status] };
  if (!link || status === 'invalid') return base;
  return {
    ...base,
    team: { name: link.team_name },
    company: { name: link.company_name },
    period: { start: link.period_start, end: link.period_end, lastDay: addDays(link.period_end, -1) },
    ...(status === 'open' ? {
      questions: PULSE_QUESTIONS.map((q) => ({ key: q.key, text: q.text })),
      scale: PULSE_SCALE,
      commentMax: PULSE_COMMENT_MAX,
      threshold: K_ANONYMITY_MIN,
    } : {}),
  };
}

/**
 * Submit through a link: the answer is stored anonymously by submitPulseResponse (no user id with
 * the answer; participation recorded separately) and the person's links of the period are used up.
 */
export async function respondWithLink(args: {
  token: unknown; answers: Record<PulseQuestionKey, number>; comment: string | null; today?: string;
}): Promise<{ period: { start: string; end: string }; teamName: string }> {
  const today = args.today ?? todayUtc();
  const link = await findLink(args.token);
  const status = await linkState(link, today);
  if (status !== 'open') throw new PulseError(status === 'invalid' ? 404 : 410, LINK_STATUS_MESSAGE[status]);
  const period = await submitPulseResponse({
    companyId: link!.company_id, teamId: link!.team_id, userId: link!.user_id, answers: args.answers, comment: args.comment, today,
  });
  if (period.start !== link!.period_start) throw new PulseError(410, LINK_STATUS_MESSAGE.expired); // cannot happen: checked above
  return { period: { start: period.start, end: period.end }, teamName: link!.team_name };
}

/* ------------------------------------------------------------------------------------------
 * Non-response: warning, automatic reminders, escalation (names of non-responders only)
 * ---------------------------------------------------------------------------------------- */

/** Day (UTC) of the period's first survey send (any channel, at least one recipient), else null. */
export async function surveySentDay(teamId: string, periodStart: string): Promise<string | null> {
  const r = await queryOne<any>(
    `SELECT to_char(MIN(created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day FROM pulse_sends
      WHERE team_id = ? AND period_start = ?::date AND kind = 'survey' AND recipients > 0`,
    [teamId, periodStart]
  );
  return r?.day ?? null;
}

export interface ReminderState {
  settings: ReminderSettings;
  period: PulsePeriod;
  /** Day the survey went out this period (null: not sent yet). */
  sentDay: string | null;
  /** Values that apply this period (clamped to the period; from the period start when not sent yet). */
  effective: EffectiveReminderSettings;
  /** Whole days since the survey went out (null when not sent). */
  daysSinceSent: number | null;
}

export async function reminderState(teamId: string, today = todayUtc()): Promise<ReminderState> {
  const cadences = (await loadCadences([teamId])).get(teamId) ?? [];
  const period = periodFor(cadences, today);
  const settings = await loadReminderSettings(teamId);
  const sent = await surveySentDay(teamId, period.start);
  // A send is never earlier than its period (the send row's time is the server clock).
  const sentDay = sent && sent < period.start ? period.start : sent;
  const from = sentDay ?? period.start;
  return {
    settings, period, sentDay,
    effective: effectiveReminderSettings(settings, daysBetween(from, period.end)),
    daysSinceSent: sentDay ? daysBetween(sentDay, today) : null,
  };
}

/** Active members of the team who have not answered the period (participation only; never answers). */
export async function nonResponders(teamId: string, periodStart: string): Promise<Array<{ id: string; name: string; email: string; first_name: string | null }>> {
  const members = await activeMembers(teamId);
  const answered = new Set((await query<any[]>(
    `SELECT user_id FROM pulse_participation WHERE team_id = ? AND period_start = ?::date`, [teamId, periodStart]
  )).map((r: any) => r.user_id));
  return members.filter((m) => !answered.has(m.id)).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The once-a-day snapshot of the non-responder list (pulse_nonresponder_days). Taken at the
 * escalation and then by the hourly job on its first run of each UTC day; never by a viewer, so
 * how often someone looks changes nothing. The first snapshot of a day stays (ON CONFLICT DO NOTHING).
 */
export async function snapshotNonResponders(team: { id: string; company_id: string }, periodStart: string, day: string): Promise<void> {
  const ids = (await nonResponders(team.id, periodStart)).map((m) => m.id);
  await query(
    `INSERT INTO pulse_nonresponder_days (team_id, company_id, period_start, day, user_ids)
     VALUES (?, ?, ?::date, ?::date, ?::varchar[]) ON CONFLICT DO NOTHING`,
    [team.id, team.company_id, periodStart, day, ids]
  );
}

/**
 * The non-responder list as the people told see it: the latest daily snapshot up to today, limited
 * to members still active in the team. A member who answers drops off with the next day's snapshot.
 */
export async function dailyNonResponders(teamId: string, periodStart: string, today = todayUtc()):
  Promise<{ asOf: string; members: Array<{ id: string; name: string }> } | null> {
  const snap = await queryOne<any>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, user_ids FROM pulse_nonresponder_days
      WHERE team_id = ? AND period_start = ?::date AND day <= ?::date ORDER BY day DESC LIMIT 1`,
    [teamId, periodStart, today]
  );
  if (!snap) return null;
  const listed = new Set<string>(snap.user_ids ?? []);
  const members = (await activeMembers(teamId)).filter((m) => listed.has(m.id))
    .sort((a, b) => a.name.localeCompare(b.name)).map((m) => ({ id: m.id, name: m.name }));
  return { asOf: snap.day, members };
}

async function markReminded(teamId: string, period: PulsePeriod, userIds: string[], today: string): Promise<void> {
  if (!userIds.length) return;
  await query(
    `UPDATE pulse_recipients SET last_reminder_on = ?::date WHERE team_id = ? AND period_start = ?::date AND user_id = ANY(?::varchar[])`,
    [today, teamId, period.start, userIds]
  );
}

/**
 * Who hears about the members who have not answered: the team lead and / or the department's
 * managers (escalateTo); when nobody holds that role, the company's super admins (fallback).
 */
export async function escalationRecipients(companyId: string, team: { id: string; department_id?: string | null }, to: EscalateTo):
  Promise<{ users: Array<{ id: string; name: string; email: string }>; fallback: boolean }> {
  const ids = new Set<string>();
  if (to !== 'department_managers') { const lead = await teamLeadOf(team.id); if (lead) ids.add(lead); }
  if (to !== 'team_lead') for (const m of await departmentManagers(companyId, team.department_id ?? null)) ids.add(m.id);
  let fallback = false;
  if (!ids.size) {
    fallback = true;
    const admins = await query<any[]>(
      `SELECT DISTINCT ra.user_id FROM role_assignments ra JOIN users u ON u.id = ra.user_id AND u.is_active = TRUE AND u.company_id = ?
        WHERE ra.company_id = ? AND ra.role = 'super_admin' AND ra.scope_type = 'company' AND ra.revoked_at IS NULL`,
      [companyId, companyId]
    );
    for (const a of admins) ids.add(a.user_id);
  }
  const users = ids.size
    ? await query<any[]>(
      `SELECT id, email, COALESCE(NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''), email) AS name
         FROM users WHERE id = ANY(?::varchar[]) AND company_id = ? ORDER BY 3`, [[...ids], companyId])
    : [];
  return { users, fallback };
}

/** The current escalation of the period, if any (who was told). */
export async function currentEscalation(teamId: string, periodStart: string): Promise<{ at: string; escalatedTo: string[] } | null> {
  const r = await queryOne<any>(
    `SELECT created_at, escalated_to FROM pulse_sends WHERE team_id = ? AND period_start = ?::date AND kind = 'escalation'`, [teamId, periodStart]
  );
  return r ? { at: new Date(r.created_at).toISOString(), escalatedTo: r.escalated_to ?? [] } : null;
}

/**
 * The signed-in member's own pending surveys (the app-wide banner): teams they are assigned to
 * whose survey went out at least warning_after_days ago and that they have not answered.
 * Only ever about the caller.
 */
export async function pendingSurveysFor(actor: PolicyActor, companyId: string, today = todayUtc()):
  Promise<Array<{ teamId: string; teamName: string; period: { start: string; end: string; lastDay: string } }>> {
  const teamIds = assignedTeamIds(actor);
  if (!teamIds.length) return [];
  const teams = await query<any[]>(
    `SELECT id, name FROM teams WHERE company_id = ? AND is_active = TRUE AND id = ANY(?::varchar[]) ORDER BY name`, [companyId, teamIds]
  );
  const out = [];
  for (const t of teams) {
    const st = await reminderState(t.id, today);
    if (st.sentDay === null || (st.daysSinceSent ?? 0) < st.effective.warningAfterDays) continue;
    const answered = await queryOne<any>(
      `SELECT 1 AS x FROM pulse_participation WHERE team_id = ? AND user_id = ? AND period_start = ?::date`, [t.id, actor.id, st.period.start]
    );
    if (answered) continue;
    out.push({ teamId: t.id, teamName: t.name, period: { start: st.period.start, end: st.period.end, lastDay: addDays(st.period.end, -1) } });
  }
  return out;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

/** Automatic reminders of one team (members who have not answered, due today). Returns how many were reminded. */
async function autoRemindTeam(team: { id: string; name: string; company_id: string; department_id: string | null }, st: ReminderState, today: string): Promise<number> {
  if (!st.settings.reminderEmails || st.sentDay === null || (st.daysSinceSent ?? 0) < st.effective.reminderEveryDays) return 0;
  if (today >= st.period.end) return 0; // never after the period ends
  const every = st.effective.reminderEveryDays;
  const pending = await nonResponders(team.id, st.period.start);
  if (!pending.length) return 0;
  const last = new Map((await query<any[]>(
    `SELECT user_id, to_char(last_reminder_on, 'YYYY-MM-DD') AS d FROM pulse_recipients WHERE team_id = ? AND period_start = ?::date`,
    [team.id, st.period.start]
  )).map((r: any) => [r.user_id, r.d as string | null]));
  const targets = pending.filter((m) => { const d = last.get(m.id); return !d || (d < today && daysBetween(d, today) >= every); });
  if (!targets.length) return 0;
  const members = (await activeMembers(team.id)).length;
  const answered = members - pending.length;
  const channel = getMailer().channel;
  const [row] = await query<any[]>(
    `INSERT INTO pulse_sends (company_id, team_id, period_start, period_end, kind, trigger, actor_id, channel, answered)
     VALUES (?, ?, ?::date, ?::date, 'reminder', 'auto', NULL, ?, ?) RETURNING id`,
    [team.company_id, team.id, st.period.start, st.period.end, channel, answered]
  );
  let delivered = 0;
  for (const m of targets) if (await mailMember({ companyId: team.company_id, team, period: st.period, member: m, kind: 'reminder' })) delivered++;
  await markReminded(team.id, st.period, targets.map((m) => m.id), today);
  await query(`UPDATE pulse_sends SET recipients = ?, delivered = ? WHERE id = ?`, [targets.length, delivered, row.id]);
  const shown = reminderCountShown(answered);
  await recordAudit({
    companyId: team.company_id, actorId: null, action: 'team.pulse_reminder', entityType: 'team', entityId: team.id,
    summary: `Automatic pulse reminder for ${team.name} (${st.period.start} – ${addDays(st.period.end, -1)}) sent to the members who had not answered${shown ? ` (${targets.length})` : ''}`,
    after: { period: { start: st.period.start, end: st.period.end }, trigger: 'auto', recipients: shown ? targets.length : null, channel },
    departmentIds: [team.department_id], subjectIds: [team.id],
  });
  return targets.length;
}

/** The escalation of one team, once per period. Returns true when it was sent now. */
async function escalateTeam(team: { id: string; name: string; company_id: string; department_id: string | null }, st: ReminderState, today: string): Promise<boolean> {
  if (st.sentDay === null || (st.daysSinceSent ?? 0) < st.effective.escalateAfterDays || today >= st.period.end) return false;
  const pending = await nonResponders(team.id, st.period.start);
  if (!pending.length) return false;
  const members = (await activeMembers(team.id)).length;
  const answered = members - pending.length;
  const { users, fallback } = await escalationRecipients(team.company_id, team, st.settings.escalateTo);
  if (!users.length) return false;
  const [row] = await query<any[]>(
    `INSERT INTO pulse_sends (company_id, team_id, period_start, period_end, kind, trigger, actor_id, channel, recipients, delivered, answered, escalated_to)
     VALUES (?, ?, ?::date, ?::date, 'escalation', 'auto', NULL, 'app', ?, 0, ?, ?::varchar[]) ON CONFLICT DO NOTHING RETURNING id`,
    [team.company_id, team.id, st.period.start, st.period.end, users.length, answered, users.map((u) => u.id)]
  );
  if (!row) return false; // already escalated this period
  await snapshotNonResponders(team, st.period.start, today);
  const names = pending.map((m) => m.name);
  const rate = `${pct(answered, members)}% (${answered} of ${members} members)`;
  const title = `Wellbeing pulse: ${pending.length} not answered yet · ${team.name}`;
  const body = `Not answered yet: ${names.join(', ')}. Response rate so far: ${rate}. The survey closes after ${addDays(st.period.end, -1)}. `
    + 'This list says only who has not answered; answers stay anonymous.';
  const { notifyPulseEscalation } = await import('./notifications');
  const delivered = await notifyPulseEscalation({ companyId: team.company_id, teamId: team.id, recipients: users, title, body, dedupe: `pulse-escalation:${team.id}:${st.period.start}` });
  await query(`UPDATE pulse_sends SET delivered = ? WHERE id = ?`, [Math.min(delivered, users.length), row.id]);
  await recordAudit({
    companyId: team.company_id, actorId: null, action: 'team.pulse_escalation', entityType: 'team', entityId: team.id,
    summary: `Pulse survey of ${team.name}: ${pending.length} member${pending.length === 1 ? '' : 's'} had not answered after ${st.effective.escalateAfterDays} days; `
      + `${fallback ? 'super admins (no one holds the chosen role)' : ESCALATE_TO_LABELS[st.settings.escalateTo].toLowerCase()} told: ${users.map((u) => u.name).join(', ')}`,
    after: { period: { start: st.period.start, end: st.period.end }, notResponded: pending.length, members, escalatedTo: users.map((u) => u.id), fallback },
    departmentIds: [team.department_id], subjectIds: [team.id],
  });
  return true;
}

/** Reminders and escalations of every team whose survey went out this period (hourly with the auto send). */
export async function runPulseReminders(today = todayUtc(), opts: { teamIds?: string[] } = {}): Promise<{ teams: number; reminded: number; escalated: number }> {
  const teams = await query<any[]>(
    `SELECT DISTINCT t.id, t.name, t.company_id, t.department_id
       FROM pulse_sends s
       JOIN teams t ON t.id = s.team_id AND t.is_active
       JOIN companies c ON c.id = t.company_id AND c.is_active IS NOT FALSE
      WHERE s.kind = 'survey' AND s.recipients > 0 AND s.period_end > ?::date AND s.period_start <= ?::date
        AND (?::varchar[] IS NULL OR t.id = ANY(?::varchar[]))
      ORDER BY t.company_id, t.id`,
    [today, today, opts.teamIds ?? null, opts.teamIds ?? null]
  );
  let reminded = 0, escalated = 0;
  for (const t of teams) {
    try {
      const st = await reminderState(t.id, today);
      reminded += await autoRemindTeam(t, st, today);
      if (await escalateTeam(t, st, today)) escalated++;
      // The day's snapshot of the non-responder list (first run of the day; later runs change nothing).
      else if (today < st.period.end && await currentEscalation(t.id, st.period.start)) await snapshotNonResponders(t, st.period.start, today);
    } catch (e) {
      console.error(`[pulse] reminders for team ${t.id} failed:`, (e as Error)?.message ?? e);
    }
  }
  return { teams: teams.length, reminded, escalated };
}

/* ------------------------------------------------------------------------------------------
 * Scheduled run
 * ---------------------------------------------------------------------------------------- */

/**
 * Send the survey of every team with automatic sending on whose period just started (once per
 * team and period), send the due reminders and escalations (runPulseReminders), and delete links
 * that expired more than 30 days ago. opts.teamIds limits the
 * run to those teams (tests).
 */
export async function runPulseAutoSend(today = todayUtc(), opts: { teamIds?: string[] } = {}): Promise<{ teams: number; sent: number; skipped: number; reminded: number; escalated: number }> {
  const teams = await query<any[]>(
    `SELECT t.id, t.name, t.company_id, t.department_id, to_char(s.auto_send_from, 'YYYY-MM-DD') AS auto_send_from
       FROM pulse_settings s
       JOIN teams t ON t.id = s.team_id AND t.is_active
       JOIN companies c ON c.id = t.company_id AND c.is_active IS NOT FALSE
      WHERE s.auto_send AND (?::varchar[] IS NULL OR t.id = ANY(?::varchar[]))
      ORDER BY t.company_id, t.id`,
    [opts.teamIds ?? null, opts.teamIds ?? null]
  );
  const cadences = await loadCadences(teams.map((t: any) => t.id));
  let sent = 0, skipped = 0;
  for (const t of teams) {
    const period = periodFor(cadences.get(t.id) ?? [], today);
    if (!inAutoSendWindow(period, today, t.auto_send_from)) { skipped++; continue; }
    try {
      const r = await sendPulseSurvey({ companyId: t.company_id, team: t, actorId: null, trigger: 'auto', today });
      if (r) sent++; else skipped++;
    } catch (e) {
      console.error(`[pulse] automatic send for team ${t.id} failed:`, (e as Error)?.message ?? e);
    }
  }
  // Reminders and escalations (members who have not answered) of the running periods.
  const r = await runPulseReminders(today, opts);
  await query(`DELETE FROM pulse_links WHERE expires_at < now() - interval '30 days'`);
  return { teams: teams.length, sent, skipped, reminded: r.reminded, escalated: r.escalated };
}

