/**
 * Outgoing email: ONE pluggable mailer, used by every e-mail of the app (invitations, password
 * resets, pulse surveys, digests, alerts). The first configured channel wins:
 *
 *   Resend when RESEND_API_KEY is set: the Resend HTTPS API (POST https://api.resend.com/emails).
 *          Sender: MAIL_FROM, else SMTP_FROM, else Resend's test sender onboarding@resend.dev
 *          (which only delivers to the Resend account's own address). MAIL_FROM must use a domain
 *          verified in Resend. The API key is never logged or returned.
 *   SMTP   when SMTP_HOST is set: SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS,
 *          SMTP_SECURE ('true' = implicit TLS, default true only for port 465), SMTP_FROM
 *          (default MAIL_FROM, else "QE Navigator <no-reply@SMTP_HOST>").
 *   log    otherwise: nothing is sent; the message is logged (without links outside development)
 *          and the caller gets delivered: false, so the UI shows the link to copy instead.
 *          A message is never dropped silently.
 *
 * setMailerForTests() swaps the transport (unit tests). MAIL_CAPTURE_FILE (ignored when
 * NODE_ENV=production): the log channel also appends each message as one JSON line to that file,
 * so end-to-end tests can follow links; delivery is still reported as not delivered.
 */
import { appendFileSync } from 'fs';
import { createHash } from 'crypto';
import { recordServerError } from './opsLog';
import { isSandboxEmail } from './sandboxConfig';
import { isProductionRuntime } from './runtimeEnv';

export type MailChannel = 'resend' | 'smtp' | 'log';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailResult {
  delivered: boolean;
  channel: MailChannel;
  /** Why nothing was delivered (e-mail not configured, or the provider's error, without secrets). */
  error?: string;
  messageId?: string;
}

export interface Mailer {
  channel: MailChannel;
  send(message: MailMessage): Promise<MailResult>;
}

export interface SmtpConfig { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string }

/** SMTP settings from the environment, or null when SMTP is not configured. */
export function smtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(env.SMTP_PORT) || 587;
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465;
  return {
    host,
    port,
    secure,
    user: env.SMTP_USER || undefined,
    pass: env.SMTP_PASS || undefined,
    from: env.SMTP_FROM || env.MAIL_FROM || `QE Navigator <no-reply@${host}>`,
  };
}

export interface ResendConfig { apiKey: string; from: string }

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';
export const RESEND_TEST_SENDER = 'QE Navigator <onboarding@resend.dev>';

/** Resend settings from the environment, or null when RESEND_API_KEY is not set. */
export function resendConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ResendConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, from: env.MAIL_FROM?.trim() || env.SMTP_FROM?.trim() || RESEND_TEST_SENDER };
}

/**
 * Resend over HTTPS with the global fetch (no SDK: one POST, and the SDK would add a dependency
 * for nothing). A failure (HTTP error, timeout, network) is reported as delivered: false with a
 * safe message and recorded in server_errors; the API key never appears in a log or an error.
 */
export function createResendMailer(cfg: ResendConfig, fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init)): Mailer {
  const fail = (detail: string, name = 'MailError'): MailResult => {
    console.error(`[mailer] Resend send failed: ${detail}`);
    recordServerError({ error: Object.assign(new Error(`Resend: ${detail}`), { name, stack: undefined }), functionName: 'mailer', status: null });
    return { delivered: false, channel: 'resend', error: `The email could not be sent (${detail}). Copy the link instead.` };
  };
  return {
    channel: 'resend',
    async send(message) {
      let res: Response;
      try {
        res = await fetchImpl(RESEND_ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: cfg.from, to: [message.to], subject: message.subject, text: message.text,
            ...(message.html ? { html: message.html } : {}),
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (e) {
        return fail((e as Error)?.name === 'TimeoutError' ? 'Resend did not answer in time' : 'Resend could not be reached');
      }
      const body = (await res.json().catch(() => null)) as { id?: unknown; name?: unknown } | null;
      if (!res.ok) {
        // Resend's error name (e.g. validation_error) is safe to show; its message can quote the request, so it is not used.
        const name = body?.name;
        const kind = typeof name === 'string' && /^[a-z_]{1,64}$/.test(name) ? `, ${name}` : '';
        return fail(`Resend error ${res.status}${kind}`);
      }
      return { delivered: true, channel: 'resend', messageId: typeof body?.id === 'string' ? body.id : undefined };
    },
  };
}

export function createSmtpMailer(cfg: SmtpConfig): Mailer {
  let transport: any = null;
  return {
    channel: 'smtp',
    async send(message) {
      try {
        if (!transport) {
          const nodemailer = (await import('nodemailer')).default;
          transport = nodemailer.createTransport({
            host: cfg.host,
            port: cfg.port,
            secure: cfg.secure,
            auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
            connectionTimeout: 10_000,
            greetingTimeout: 10_000,
            socketTimeout: 15_000,
          });
        }
        const info = await transport.sendMail({ from: cfg.from, ...message });
        return { delivered: true, channel: 'smtp', messageId: info?.messageId };
      } catch (e: any) {
        console.error('[mailer] SMTP send failed:', e?.code || '', e?.message || e);
        return { delivered: false, channel: 'smtp', error: 'The email could not be sent (SMTP error). Copy the link instead.' };
      }
    },
  };
}

export const logMailer: Mailer = {
  channel: 'log',
  async send(message) {
    const dev = !isProductionRuntime();
    // Links carry one-time tokens: only printed in development.
    console.log(`[mailer] e-mail not configured (RESEND_API_KEY / SMTP_HOST); email to ${message.to} not sent: "${message.subject}"${dev ? `\n${message.text}` : ''}`);
    const capture = process.env.MAIL_CAPTURE_FILE;
    if (capture && dev) {
      try { appendFileSync(capture, `${JSON.stringify({ to: message.to, subject: message.subject, text: message.text })}\n`); } catch { /* test aid only */ }
    }
    return { delivered: false, channel: 'log', error: 'Email is not configured on this server (set RESEND_API_KEY or SMTP_HOST). Copy the link and send it yourself.' };
  },
};

let override: Mailer | null = null;
let cached: { key: string; mailer: Mailer } | null = null;

/** The channel the environment selects: Resend (RESEND_API_KEY) > SMTP (SMTP_HOST) > log. */
export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): { key: string; create: () => Mailer } {
  const resend = resendConfigFromEnv(env);
  if (resend) {
    // The cache key holds a hash of the API key, never the key itself.
    const key = `resend:${createHash('sha256').update(resend.apiKey).digest('hex').slice(0, 16)}:${resend.from}`;
    return { key, create: () => createResendMailer(resend) };
  }
  const smtp = smtpConfigFromEnv(env);
  if (smtp) return { key: `smtp:${smtp.host}:${smtp.port}:${smtp.user ?? ''}:${smtp.secure}:${smtp.from}`, create: () => createSmtpMailer(smtp) };
  return { key: 'log', create: () => logMailer };
}

export function getMailer(): Mailer {
  if (override) return override;
  const { key, create } = mailerFromEnv();
  if (!cached || cached.key !== key) cached = { key, mailer: create() };
  return cached.mailer;
}

/** The configured e-mail channel (for "e-mail configured" indicators): 'resend', 'smtp' or 'log'. */
export const mailChannel = (): MailChannel => getMailer().channel;

export function setMailerForTests(m: Mailer | null): void {
  override = m;
}

export function sendMail(message: MailMessage): Promise<MailResult> {
  // The demo sandbox's people (server/lib/sandboxConfig.ts) are never mailed, whatever sends it.
  if (isSandboxEmail(message.to)) return Promise.resolve({ delivered: false, channel: getMailer().channel, error: 'Not sent: demo sandbox address' });
  return getMailer().send(message);
}

/** Escape text for the HTML part of an email. */
export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
