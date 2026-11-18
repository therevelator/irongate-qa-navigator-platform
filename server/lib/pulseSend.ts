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
 * without a user id; participation is recorded separately. Reminders use the participation list
 * server-side only to skip people who answered; the API returns counts only, and a reminder
 * count is withheld when it would reveal that 1 or 2 people answered.
 *
 * Automatic sending (runPulseAutoSend, hourly: server/jobs/pulseCron.ts locally,
 * netlify/functions/pulse-auto-send.ts on Netlify): for every active team with auto_send on,
 * once per period (unique index pulse_sends_auto_once), during the first days of the period.
 */
import { createHash, randomBytes } from 'crypto';
import { query, queryOne } from '../../src/lib/db';
import { execOn, loadGrants, teamMembers, type Exec } from './assignments';
import { recordAudit } from './audit';
import { escapeHtml, getMailer, sendMail } from './mailer';
import { appBaseUrl } from './sso';
import { canTakePulseSurvey } from './userPolicy';
import { K_ANONYMITY_MIN, meetsKAnonymity } from './privacy';
import { PulseError, loadCadences, submitPulseResponse } from './pulse';
import {
  PULSE_COMMENT_MAX, PULSE_QUESTIONS, PULSE_SCALE, addDays, periodDays, periodFor, todayUtc,
  type PulsePeriod, type PulseQuestionKey,
} from './pulseRules';

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
    `SELECT auto_send, to_char(auto_send_from, 'YYYY-MM-DD') AS auto_send_from FROM pulse_settings WHERE team_id = ?`, [teamId]
  );
  return r ? { autoSend: !!r.auto_send, autoSendFrom: r.auto_send_from ?? null, configured: true } : { autoSend: false, autoSendFrom: null, configured: false };
}

/** A manager set the cadence: switch automatic sending on from `from` unless the team already has a setting. */
export async function ensureAutoSendDefault(args: { companyId: string; teamId: string; from: string; actorId: string }): Promise<boolean> {
  const rows = await query<any[]>(
    `INSERT INTO pulse_settings (team_id, company_id, auto_send, auto_send_from, updated_by) VALUES (?, ?, TRUE, ?::date, ?)
     ON CONFLICT (team_id) DO NOTHING RETURNING team_id`,
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
     ON CONFLICT (team_id) DO UPDATE SET auto_send = EXCLUDED.auto_send, auto_send_from = EXCLUDED.auto_send_from,
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
  const body = 'Five statements on a 1–5 scale and an optional comment; it takes about a minute. Your answers are stored without your name, and results are only shown as team averages when at least 3 people answered.';
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
 * Scheduled run
 * ---------------------------------------------------------------------------------------- */

/**
 * Send the survey of every team with automatic sending on whose period just started (once per
 * team and period), and delete links that expired more than 30 days ago. opts.teamIds limits the
 * run to those teams (tests).
 */
export async function runPulseAutoSend(today = todayUtc(), opts: { teamIds?: string[] } = {}): Promise<{ teams: number; sent: number; skipped: number }> {
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
  await query(`DELETE FROM pulse_links WHERE expires_at < now() - interval '30 days'`);
  return { teams: teams.length, sent, skipped };
}

