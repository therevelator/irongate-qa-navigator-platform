/**
 * Notifications: who hears about an alert, and through which channel.
 *
 *   in-app   notifications rows (the bell): every user who may see the alert (analytics scope;
 *            company-level alerts: super_admins) and whose preferences allow it (in_app on,
 *            severity at least their minimum). Users who see a team only through a company-wide
 *            role are told about its critical alerts only (alertPolicy isOwnTeam). One row per
 *            user and alert; an escalation updates it and marks it unread again.
 *   email    immediate email per alert for users with email_immediate on (same filters), via the
 *            ONE mailer (server/lib/mailer.ts: SMTP when configured, else logged); the weekly
 *            digest (server/lib/digest.ts) for users with weekly_digest on.
 *   Slack    one company incoming webhook (Parameters → Alerts and notifications), for alerts at or
 *            above the company's Slack minimum severity, and optionally the digest summary.
 *            The webhook URL is a secret: stored AES-256-GCM encrypted (key from
 *            SETTINGS_ENCRYPTION_KEY, else JWT_SECRET), never returned (a masked hint only),
 *            never logged, never put into the delivery log.
 * Preferences (notification_preferences) default to: in-app on, immediate email off, weekly
 * digest on for digest recipients (canReceiveDigest), minimum severity warning.
 *
 * Email and Slack messages go through an outbox (notification_deliveries): queued with a
 * dedupe key (the same message is never sent twice), then sent by processDeliveries() right
 * away within a time budget, and retried by the scheduled run (at most 3 attempts).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { query, queryOne } from '../../src/lib/db';
import { sendMail, escapeHtml } from './mailer';
import { canReceiveDigest, canSeeAlert, isOwnTeam, loadCompanyActors, type CompanyActor } from './alertPolicy';
import { atLeast, isSeverity, RULE_DEFS, type AlertRow, type Severity } from './alerts';
import type { PolicyActor } from './userPolicy';
import { isProductionRuntime, settingsKeyMaterial } from './runtimeEnv';

/* ------------------------------------------------------------------------------------------
 * Preferences
 * ---------------------------------------------------------------------------------------- */

export interface NotificationPrefs {
  inApp: boolean;
  emailImmediate: boolean;
  weeklyDigest: boolean;
  minSeverity: Severity;
}

export function defaultPrefs(actor: PolicyActor): NotificationPrefs {
  return { inApp: true, emailImmediate: false, weeklyDigest: canReceiveDigest(actor), minSeverity: 'warning' };
}

const prefsFromRow = (r: any): NotificationPrefs => ({
  inApp: !!r.in_app, emailImmediate: !!r.email_immediate, weeklyDigest: !!r.weekly_digest, minSeverity: isSeverity(r.min_severity) ? r.min_severity : 'warning',
});

export async function getPrefs(actor: PolicyActor): Promise<{ prefs: NotificationPrefs; isDefault: boolean }> {
  const row = await queryOne<any>('SELECT * FROM notification_preferences WHERE user_id = ?', [actor.id]);
  return row ? { prefs: prefsFromRow(row), isDefault: false } : { prefs: defaultPrefs(actor), isDefault: true };
}

/** Preferences of many users (defaults where no row). */
export async function prefsFor(actors: PolicyActor[]): Promise<Map<string, NotificationPrefs>> {
  const out = new Map<string, NotificationPrefs>();
  if (!actors.length) return out;
  const rows = await query<any[]>('SELECT * FROM notification_preferences WHERE user_id = ANY(?::text[])', [actors.map((a) => a.id)]);
  const by = new Map(rows.map((r: any) => [r.user_id, r]));
  for (const a of actors) out.set(a.id, by.has(a.id) ? prefsFromRow(by.get(a.id)) : defaultPrefs(a));
  return out;
}

export function validatePrefs(input: any, current: NotificationPrefs): NotificationPrefs {
  const out = { ...current };
  for (const k of ['inApp', 'emailImmediate', 'weeklyDigest'] as const) {
    if (input?.[k] === undefined) continue;
    if (typeof input[k] !== 'boolean') throw new Error(`${k} must be true or false`);
    out[k] = input[k];
  }
  if (input?.minSeverity !== undefined) {
    if (!isSeverity(input.minSeverity)) throw new Error('minSeverity must be info, warning or critical');
    out.minSeverity = input.minSeverity;
  }
  return out;
}

export async function savePrefs(companyId: string, userId: string, p: NotificationPrefs): Promise<void> {
  await query(
    `INSERT INTO notification_preferences (user_id, company_id, in_app, email_immediate, weekly_digest, min_severity, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())
     ON CONFLICT (user_id) DO UPDATE SET in_app = EXCLUDED.in_app, email_immediate = EXCLUDED.email_immediate,
       weekly_digest = EXCLUDED.weekly_digest, min_severity = EXCLUDED.min_severity, updated_at = NOW()`,
    [userId, companyId, p.inApp, p.emailImmediate, p.weeklyDigest, p.minSeverity]
  );
}

/* ------------------------------------------------------------------------------------------
 * Secret storage (Slack webhook)
 * ---------------------------------------------------------------------------------------- */

/** AES key from key material (the same derivation for every material, so old values stay readable). */
export function settingsKeyFrom(material: string): Buffer {
  return createHash('sha256').update(`irongate-settings:${material}`).digest();
}

/**
 * The key of stored secrets: SETTINGS_ENCRYPTION_KEY, else the signing secret (JWT_SECRET /
 * secrettoken). In production one of them must be a real secret (server/lib/runtimeEnv.ts): a
 * constant is never used there. Webhooks stored with the former development constant are made
 * readable once with `npm run secrets:reencrypt` (server/scripts/reencryptSecrets.ts).
 */
function secretKey(): Buffer {
  return settingsKeyFrom(settingsKeyMaterial());
}

export function encryptSecret(plain: string, key: Buffer = secretKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

/** Plaintext, or null when it cannot be decrypted (e.g. the key changed: the admin enters it again). */
export function decryptSecret(stored: string | null | undefined, key?: Buffer): string | null {
  if (!stored) return null;
  try {
    const [v, iv, tag, data] = stored.split(':');
    if (v !== 'v1') return null;
    const d = createDecipheriv('aes-256-gcm', key ?? secretKey(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

const SLACK_RE = /^https:\/\/hooks\.slack\.com\/(services|workflows|triggers)\/[A-Za-z0-9_\-/]{8,400}$/;
/** Local test receivers (http://127.0.0.1:<port>/…) only when NOTIFY_SLACK_ALLOW_LOCAL=true outside production. */
const LOCAL_RE = /^http:\/\/127\.0\.0\.1:\d{2,5}\/[A-Za-z0-9_\-/]{1,200}$/;

export function validateSlackWebhook(url: unknown): string {
  const s = typeof url === 'string' ? url.trim() : '';
  if (SLACK_RE.test(s)) return s;
  if (process.env.NOTIFY_SLACK_ALLOW_LOCAL === 'true' && !isProductionRuntime() && LOCAL_RE.test(s)) return s;
  throw new Error('Enter a Slack incoming webhook URL (https://hooks.slack.com/services/…)');
}

/** Masked form of a webhook: host and path kind, the last 4 characters. */
export function maskWebhook(url: string): string {
  const u = new URL(url);
  const kind = u.pathname.split('/').filter(Boolean)[0] ?? '';
  return `${u.host}/${kind}/…${url.slice(-4)}`;
}

export interface NotificationSettings {
  slackConfigured: boolean;
  slackHint: string | null;
  /** The stored webhook could not be decrypted (encryption key changed): enter it again. */
  slackUnreadable: boolean;
  slackEnabled: boolean;
  slackMinSeverity: Severity;
  slackDigest: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export async function getSettings(companyId: string): Promise<NotificationSettings & { webhook: string | null }> {
  const r = await queryOne<any>(
    `SELECT s.*, NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS updated_by_name
       FROM company_notification_settings s LEFT JOIN users u ON u.id = s.updated_by WHERE s.company_id = ?`,
    [companyId]
  );
  const webhook = decryptSecret(r?.slack_webhook_enc);
  return {
    webhook,
    slackConfigured: !!r?.slack_webhook_enc,
    slackHint: r?.slack_webhook_hint ?? null,
    slackUnreadable: !!r?.slack_webhook_enc && !webhook,
    slackEnabled: !!r?.slack_enabled,
    slackMinSeverity: isSeverity(r?.slack_min_severity) ? r.slack_min_severity : 'critical',
    slackDigest: !!r?.slack_digest,
    updatedAt: r?.updated_at ? new Date(r.updated_at).toISOString() : null,
    updatedBy: r?.updated_by_name ?? null,
  };
}

/** The settings as the API returns them (never the webhook). */
export const publicSettings = ({ webhook: _w, ...s }: NotificationSettings & { webhook: string | null }): NotificationSettings => s;

/* ------------------------------------------------------------------------------------------
 * Alert notifications
 * ---------------------------------------------------------------------------------------- */

export const appUrl = () => (process.env.APP_URL || process.env.URL || process.env.FRONTEND_URL || '').replace(/\/+$/, '');

const SEVERITY_LABEL: Record<Severity, string> = { info: 'Info', warning: 'Warning', critical: 'Critical' };

/** In-app title of an alert notification. */
export const alertTitle = (a: Pick<AlertRow, 'rule' | 'severity'>, teamName: string | null, reason: 'new' | 'escalated') =>
  `${reason === 'escalated' ? 'Escalated: ' : ''}${RULE_DEFS[a.rule]?.label ?? a.rule}${teamName ? ` · ${teamName}` : ''}`;

async function enqueue(row: { companyId: string; channel: 'email' | 'slack'; kind: 'alert' | 'digest' | 'test' | 'pulse'; userId?: string | null; recipient: string; alertId?: string | null; subject?: string | null; payload: object; dedupeKey: string | null }): Promise<string | null> {
  const r = await queryOne<any>(
    `INSERT INTO notification_deliveries (company_id, channel, kind, user_id, recipient, alert_id, subject, payload, dedupe_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?)
     ON CONFLICT (company_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING id`,
    [row.companyId, row.channel, row.kind, row.userId ?? null, row.recipient, row.alertId ?? null, row.subject ?? null, JSON.stringify(row.payload), row.dedupeKey]
  );
  return r?.id ?? null;
}

/** Notify everyone concerned about new or escalated alerts (in-app now; email / Slack through the outbox). */
export async function notifyAlerts(companyId: string, items: Array<{ alert: AlertRow; reason: 'new' | 'escalated' }>): Promise<{ inApp: number; queued: number }> {
  if (!items.length) return { inApp: 0, queued: 0 };
  const teamIds = [...new Set(items.map((i) => i.alert.team_id).filter((x): x is string => !!x))];
  const teams = new Map((teamIds.length ? await query<any[]>('SELECT id, name, department_id FROM teams WHERE id = ANY(?::text[])', [teamIds]) : []).map((t: any) => [t.id, t]));
  const actors = await loadCompanyActors(companyId);
  const prefs = await prefsFor(actors);
  const settings = await getSettings(companyId);
  const base = appUrl();
  let inApp = 0;
  let queued = 0;
  for (const { alert, reason } of items) {
    const team = alert.team_id ? teams.get(alert.team_id) : null;
    const scoped = { team_id: alert.team_id, department_id: team?.department_id ?? null };
    const title = alertTitle(alert, team?.name ?? null, reason);
    const link = base ? `${base}/notifications` : '';
    for (const a of actors) {
      if (!canSeeAlert(a, scoped)) continue;
      // Company-wide roles hear about critical team alerts only (see isOwnTeam).
      if (alert.team_id && alert.severity !== 'critical' && !isOwnTeam(a, { id: alert.team_id, department_id: scoped.department_id })) continue;
      const p = prefs.get(a.id)!;
      if (!atLeast(alert.severity, p.minSeverity)) continue;
      if (p.inApp) {
        await query(
          `INSERT INTO notifications (company_id, user_id, kind, severity, title, body, team_id, alert_id)
           VALUES (?, ?, 'alert', ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, alert_id) WHERE alert_id IS NOT NULL
           DO UPDATE SET severity = EXCLUDED.severity, title = EXCLUDED.title, body = EXCLUDED.body, created_at = NOW(), read_at = NULL`,
          [companyId, a.id, alert.severity, title, alert.message, alert.team_id, alert.id]
        );
        inApp++;
      }
      if (p.emailImmediate && a.email) {
        const subject = `[QE Navigator] ${SEVERITY_LABEL[alert.severity]}: ${title}`;
        const text = `${title}\n\n${alert.message}\n\n${link ? `Open the alerts: ${link}\n\n` : ''}You receive this because immediate alert emails are on in your notification preferences.`;
        const html = `<p><strong>${escapeHtml(title)}</strong></p><p>${escapeHtml(alert.message)}</p>${link ? `<p><a href="${escapeHtml(link)}">Open the alerts</a></p>` : ''}<p style="color:#64748b;font-size:12px">You receive this because immediate alert emails are on in your notification preferences.</p>`;
        if (await enqueue({ companyId, channel: 'email', kind: 'alert', userId: a.id, recipient: a.email, alertId: alert.id, subject, payload: { text, html }, dedupeKey: `alert:${alert.id}:${a.id}:${alert.severity}` })) queued++;
      }
    }
    if (settings.slackEnabled && settings.webhook && atLeast(alert.severity, settings.slackMinSeverity)) {
      // Team names and alert text are escaped for Slack mrkdwn: an unescaped <!channel> or <url|label> in a
      // team name would ping the channel or show a disguised link.
      const text = `*${SEVERITY_LABEL[alert.severity]}* · ${escapeSlack(title)}\n${escapeSlack(alert.message)}${link ? `\n<${link}|Open in QE Navigator>` : ''}`;
      if (await enqueue({ companyId, channel: 'slack', kind: 'alert', recipient: 'slack', alertId: alert.id, subject: title, payload: { text }, dedupeKey: `alert:${alert.id}:slack:${alert.severity}` })) queued++;
    }
  }
  if (queued) await processDeliveries({ companyId, budgetMs: 5_000 });
  return { inApp, queued };
}

/** In-app notification for the owner of an action (assigned to them by someone else). */
export async function notifyActionOwner(companyId: string, action: { id: string; title: string; team_id: string; owner_id: string | null; due_date?: string | null }, teamName: string, actorId: string): Promise<void> {
  if (!action.owner_id || action.owner_id === actorId) return;
  const due = action.due_date ? ` · due ${String(action.due_date).slice(0, 10)}` : '';
  await query(
    `INSERT INTO notifications (company_id, user_id, kind, severity, title, body, team_id, action_id) VALUES (?, ?, 'action', 'info', ?, ?, ?, ?)`,
    [companyId, action.owner_id, `Action assigned to you · ${teamName}`, `${action.title}${due}`, action.team_id, action.id]
  );
}

/**
 * The wellbeing pulse escalation (server/lib/pulseSend.ts): names of members who have not answered
 * and the response rate, to the chosen recipients. In-app when their preferences allow it, e-mail
 * when immediate e-mails are on. Never anything about what anyone answered. Returns how many
 * people were told (in-app or e-mail).
 */
export async function notifyPulseEscalation(args: {
  companyId: string; teamId: string; recipients: Array<{ id: string; email: string; name: string }>; title: string; body: string; dedupe: string;
}): Promise<number> {
  const actors = (await loadCompanyActors(args.companyId)).filter((a) => args.recipients.some((r) => r.id === a.id));
  const prefs = await prefsFor(actors);
  const link = appUrl() ? `${appUrl()}/analytics/pulse?team=${encodeURIComponent(args.teamId)}` : '';
  let told = 0, queued = 0;
  for (const a of actors) {
    const p = prefs.get(a.id)!;
    let reached = false;
    if (p.inApp) {
      await query(
        `INSERT INTO notifications (company_id, user_id, kind, severity, title, body, team_id) VALUES (?, ?, 'pulse', 'warning', ?, ?, ?)`,
        [args.companyId, a.id, args.title, args.body, args.teamId]
      );
      reached = true;
    }
    if (p.emailImmediate && a.email) {
      const text = `${args.title}\n\n${args.body}\n\n${link ? `Open the team's pulse: ${link}\n\n` : ''}You receive this because immediate e-mails are on in your notification preferences.`;
      const html = `<p><strong>${escapeHtml(args.title)}</strong></p><p>${escapeHtml(args.body)}</p>${link ? `<p><a href="${escapeHtml(link)}">Open the team's pulse</a></p>` : ''}<p style="color:#64748b;font-size:12px">You receive this because immediate e-mails are on in your notification preferences.</p>`;
      if (await enqueue({ companyId: args.companyId, channel: 'email', kind: 'pulse', userId: a.id, recipient: a.email, subject: `[QE Navigator] ${args.title}`, payload: { text, html }, dedupeKey: `${args.dedupe}:${a.id}` })) { queued++; reached = true; }
    }
    if (reached) told++;
  }
  if (queued) await processDeliveries({ companyId: args.companyId, budgetMs: 5_000 });
  return told;
}

/* ------------------------------------------------------------------------------------------
 * Outbox
 * ---------------------------------------------------------------------------------------- */

const MAX_ATTEMPTS = 3;

/**
 * Escape text for Slack mrkdwn (https://api.slack.com/reference/surfaces/formatting#escaping):
 * &, < and > are the control characters; everything that is not a literal in the code (team
 * names, alert messages, people's names) goes through this before it is put in a Slack message.
 */
export const escapeSlack = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** POST a message to a Slack webhook. Never logs or returns the URL. */
export async function postToSlack(webhook: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(webhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(4_000), redirect: 'error',
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `Slack answered HTTP ${res.status}` };
  } catch (e: any) {
    return { ok: false, error: e?.name === 'TimeoutError' ? 'Slack did not answer in time' : 'Slack could not be reached' };
  }
}

async function sendOne(d: any, webhooks: Map<string, string | null>): Promise<{ status: 'sent' | 'logged' | 'failed' | 'skipped'; error?: string }> {
  if (d.channel === 'email') {
    const r = await sendMail({ to: d.recipient, subject: d.subject ?? 'QE Navigator notification', text: d.payload?.text ?? '', html: d.payload?.html });
    if (r.delivered) return { status: 'sent' };
    return r.channel === 'log' ? { status: 'logged', error: 'E-mail is not configured (RESEND_API_KEY / SMTP_HOST): the email was logged, not sent' } : { status: 'failed', error: r.error };
  }
  if (!webhooks.has(d.company_id)) {
    const s = await getSettings(d.company_id);
    webhooks.set(d.company_id, s.slackEnabled || d.kind === 'test' ? s.webhook : null);
  }
  const hook = webhooks.get(d.company_id);
  if (!hook) return { status: 'skipped', error: 'Slack is not configured or turned off' };
  const r = await postToSlack(hook, d.payload?.text ?? '');
  return r.ok ? { status: 'sent' } : { status: 'failed', error: r.error };
}

/**
 * Send pending deliveries (oldest first) until the time budget is used up; the rest wait for the
 * next run. A failed delivery is retried by later runs (5 minutes apart) up to MAX_ATTEMPTS.
 */
export async function processDeliveries(opts: { companyId?: string; budgetMs?: number; ids?: string[] } = {}): Promise<{ processed: number }> {
  const deadline = Date.now() + (opts.budgetMs ?? 5_000);
  const webhooks = new Map<string, string | null>();
  let processed = 0;
  while (Date.now() < deadline) {
    const batch = await query<any[]>(
      `UPDATE notification_deliveries SET attempts = attempts + 1, last_attempt_at = NOW()
        WHERE id IN (
          SELECT id FROM notification_deliveries
           WHERE status = 'pending' AND (?::text IS NULL OR company_id = ?) AND (?::text[] IS NULL OR id = ANY(?::text[]))
             AND (last_attempt_at IS NULL OR last_attempt_at < NOW() - INTERVAL '5 minutes')
           ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED)
        RETURNING *`,
      [opts.companyId ?? null, opts.companyId ?? null, opts.ids ?? null, opts.ids ?? null]
    );
    if (!batch.length) break;
    for (const d of batch) {
      const r = await sendOne(d, webhooks);
      // Test messages are not retried: the person who clicked "Send test" sees the result.
      const final = r.status !== 'failed' || d.attempts >= MAX_ATTEMPTS || d.kind === 'test';
      await query(
        `UPDATE notification_deliveries SET status = ?, error = ?, sent_at = CASE WHEN ? = 'sent' THEN NOW() ELSE sent_at END WHERE id = ?`,
        [final ? r.status : 'pending', r.error ?? null, r.status, d.id]
      );
      if (r.status === 'failed') console.warn(`[notifications] ${d.channel} delivery ${d.id} failed (attempt ${d.attempts}): ${r.error}`);
      processed++;
    }
  }
  return { processed };
}

/** Queue and send one message now (test messages); returns its final status. */
export async function sendNow(row: Parameters<typeof enqueue>[0]): Promise<{ status: string; error: string | null }> {
  const id = await enqueue(row);
  if (!id) return { status: 'skipped', error: 'Already sent' };
  await processDeliveries({ ids: [id], budgetMs: 8_000 });
  const d = await queryOne<any>('SELECT status, error FROM notification_deliveries WHERE id = ?', [id]);
  return { status: d?.status ?? 'pending', error: d?.error ?? null };
}

export { enqueue as enqueueDelivery, canReceiveDigest, type CompanyActor };
