/**
 * Outgoing email: ONE pluggable mailer.
 *
 *   SMTP   when SMTP_HOST is set: SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS,
 *          SMTP_SECURE ('true' = implicit TLS, default true only for port 465), SMTP_FROM
 *          (default "IronGate QE Navigator <no-reply@SMTP_HOST>").
 *   log    otherwise: nothing is sent; the message is logged (without links outside development)
 *          and the caller gets delivered: false, so the UI shows the link to copy instead.
 *          A message is never dropped silently.
 *
 * setMailerForTests() swaps the transport (unit tests).
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailResult {
  delivered: boolean;
  channel: 'smtp' | 'log';
  /** Why nothing was delivered (SMTP not configured, or the SMTP error). */
  error?: string;
  messageId?: string;
}

export interface Mailer {
  channel: 'smtp' | 'log';
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
    from: env.SMTP_FROM || `IronGate QE Navigator <no-reply@${host}>`,
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
    const dev = process.env.NODE_ENV !== 'production';
    // Links carry one-time tokens: only printed in development.
    console.log(`[mailer] SMTP not configured; email to ${message.to} not sent: "${message.subject}"${dev ? `\n${message.text}` : ''}`);
    return { delivered: false, channel: 'log', error: 'Email is not configured on this server (SMTP_HOST is not set). Copy the link and send it yourself.' };
  },
};

let override: Mailer | null = null;
let cached: { key: string; mailer: Mailer } | null = null;

export function getMailer(): Mailer {
  if (override) return override;
  const cfg = smtpConfigFromEnv();
  const key = cfg ? `${cfg.host}:${cfg.port}:${cfg.user ?? ''}:${cfg.secure}` : 'log';
  if (!cached || cached.key !== key) cached = { key, mailer: cfg ? createSmtpMailer(cfg) : logMailer };
  return cached.mailer;
}

export function setMailerForTests(m: Mailer | null): void {
  override = m;
}

export function sendMail(message: MailMessage): Promise<MailResult> {
  return getMailer().send(message);
}

/** Escape text for the HTML part of an email. */
export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
