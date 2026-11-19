import net from 'net';
import {
  createSmtpMailer, createResendMailer, logMailer, smtpConfigFromEnv, resendConfigFromEnv, mailerFromEnv, setMailerForTests, getMailer,
  RESEND_ENDPOINT, RESEND_TEST_SENDER, type MailMessage,
} from '../../server/lib/mailer';
import { flushBackgroundWrites } from '../../server/lib/opsLog';
import { pool } from '../../src/lib/db';
import { sendInvitationEmail } from '../../server/lib/invitations';

/**
 * The pluggable mailer (server/lib/mailer.ts): Resend when RESEND_API_KEY is set (exercised with a
 * mocked fetch: the real Resend API is never called), else SMTP when SMTP_HOST is set (exercised
 * against a local fake SMTP server), otherwise the log channel, which reports delivered: false so the UI
 * shows the link. A failing SMTP server never throws (the caller gets the link instead).
 */

/** Minimal SMTP server: accepts one message per connection and records it. */
function fakeSmtp(received: string[]): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      let buffer = '';
      let inData = false;
      let message = '';
      sock.write('220 fake.local ESMTP\r\n');
      sock.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let idx: number;
        while ((idx = buffer.indexOf('\r\n')) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (inData) {
            if (line === '.') {
              inData = false;
              received.push(message);
              message = '';
              sock.write('250 2.0.0 queued\r\n');
            } else {
              message += `${line}\n`;
            }
            continue;
          }
          const cmd = line.slice(0, 4).toUpperCase();
          if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-fake.local\r\n250 8BITMIME\r\n');
          else if (cmd === 'MAIL' || cmd === 'RCPT') sock.write('250 2.1.0 ok\r\n');
          else if (cmd === 'DATA') { inData = true; sock.write('354 go ahead\r\n'); }
          else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
          else sock.write('250 ok\r\n');
        }
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as net.AddressInfo).port }));
  });
}

describe('Mailer', () => {
  const received: string[] = [];
  let smtp: { server: net.Server; port: number };

  beforeAll(async () => { smtp = await fakeSmtp(received); });
  afterAll(async () => {
    setMailerForTests(null);
    await new Promise((r) => smtp.server.close(r));
    await flushBackgroundWrites(2000); // server_errors rows of the failed Resend sends
    await pool.end();
  });

  it('MAIL-001: SMTP settings come from SMTP_* (none = log channel)', () => {
    expect(smtpConfigFromEnv({})).toBeNull();
    expect(smtpConfigFromEnv({ SMTP_HOST: 'smtp.example.com' })).toMatchObject({ host: 'smtp.example.com', port: 587, secure: false });
    expect(smtpConfigFromEnv({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465' })).toMatchObject({ port: 465, secure: true });
    expect(smtpConfigFromEnv({ SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'QE <qe@x.io>', SMTP_SECURE: 'false', SMTP_PORT: '2525' }))
      .toMatchObject({ host: 'h', user: 'u', pass: 'p', from: 'QE <qe@x.io>', secure: false, port: 2525 });
    const saved = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    expect(getMailer().channel).toBe('log');
    if (saved !== undefined) process.env.SMTP_HOST = saved;
  });

  it('MAIL-002: SMTP delivers the message', async () => {
    const mailer = createSmtpMailer({ host: '127.0.0.1', port: smtp.port, secure: false, from: 'IronGate <no-reply@test.local>' });
    const msg: MailMessage = { to: 'person@test.local', subject: 'Hello there', text: 'Body line https://app.test/accept-invite?token=igi_abc' };
    const res = await mailer.send(msg);
    expect(res).toMatchObject({ delivered: true, channel: 'smtp' });
    const last = received[received.length - 1];
    expect(last).toContain('Subject: Hello there');
    expect(last).toContain('person@test.local');
    expect(last).toContain('igi_abc');
  });

  it('MAIL-003: an unreachable SMTP server is reported, never thrown', async () => {
    const closed = await new Promise<number>((resolve) => {
      const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
    });
    const res = await createSmtpMailer({ host: '127.0.0.1', port: closed, secure: false, from: 'x@test.local' }).send({ to: 'a@test.local', subject: 's', text: 't' });
    expect(res.delivered).toBe(false);
    expect(res.error).toMatch(/could not be sent/i);
  });

  it('MAIL-004: without SMTP nothing is sent and the caller is told so', async () => {
    const res = await logMailer.send({ to: 'a@test.local', subject: 's', text: 't' });
    expect(res).toMatchObject({ delivered: false, channel: 'log' });
    expect(res.error).toMatch(/SMTP_HOST/);
  });

  it('MAIL-005: the invitation email names the organisation, role and scope and carries the link', async () => {
    const sent: MailMessage[] = [];
    setMailerForTests({ channel: 'smtp', send: async (m) => { sent.push(m); return { delivered: true, channel: 'smtp' }; } });
    const res = await sendInvitationEmail({
      to: 'new@test.local', token: 'igi_tok', companyName: 'Acme <QA>', inviterName: 'Ada', role: 'team_lead', scopeName: 'Payments', expiresAt: new Date('2030-01-01T00:00:00Z'),
    });
    expect(res.delivered).toBe(true);
    expect(res.link).toMatch(/\/accept-invite\?token=igi_tok$/);
    expect(sent[0].subject).toContain('Acme <QA>');
    expect(sent[0].text).toContain('Team lead of Payments');
    expect(sent[0].text).toContain(res.link);
    expect(sent[0].html).toContain('Acme &lt;QA&gt;'); // escaped in HTML
    setMailerForTests(null);
  });

  /* ---------------------------------------------------------------------------------------- *
   * Resend
   * ---------------------------------------------------------------------------------------- */

  const KEY = 're_test_SECRET_key_0123456789abcdef';
  const msg: MailMessage = { to: 'person@test.local', subject: 'Reset', text: 'Plain https://app.test/reset-password?token=igr_x', html: '<p>Hi</p>' };
  type Call = { url: string; init: RequestInit };
  const fakeFetch = (status: number, body: unknown, calls: Call[] = []) =>
    (async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
  /** Everything written to the console (spied) during the test. */
  const spies: jest.SpyInstance[] = [];
  const watchConsole = () => { for (const k of ['log', 'error', 'warn', 'info'] as const) spies.push(jest.spyOn(console, k)); };
  const consoleText = () => JSON.stringify(spies.flatMap((s) => s.mock.calls));
  afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

  it('MAIL-006: Resend settings come from RESEND_API_KEY and MAIL_FROM (SMTP_FROM, then the Resend test sender as fallbacks)', () => {
    expect(resendConfigFromEnv({})).toBeNull();
    expect(resendConfigFromEnv({ RESEND_API_KEY: '  ' })).toBeNull();
    expect(resendConfigFromEnv({ RESEND_API_KEY: KEY, MAIL_FROM: 'QE <no-reply@qe.example>', SMTP_FROM: 'x@y.z' })).toEqual({ apiKey: KEY, from: 'QE <no-reply@qe.example>' });
    expect(resendConfigFromEnv({ RESEND_API_KEY: KEY, SMTP_FROM: 'Old <old@qe.example>' })!.from).toBe('Old <old@qe.example>');
    expect(resendConfigFromEnv({ RESEND_API_KEY: KEY })!.from).toBe(RESEND_TEST_SENDER);
    expect(smtpConfigFromEnv({ SMTP_HOST: 'h', MAIL_FROM: 'QE <m@qe.example>' })!.from).toBe('QE <m@qe.example>');
  });

  it('MAIL-007: channel precedence: Resend > SMTP > log; the cache key never holds the API key', () => {
    const both = mailerFromEnv({ RESEND_API_KEY: KEY, SMTP_HOST: 'smtp.example.com' });
    expect(both.create().channel).toBe('resend');
    expect(both.key).not.toContain(KEY);
    expect(mailerFromEnv({ SMTP_HOST: 'smtp.example.com' }).create().channel).toBe('smtp');
    expect(mailerFromEnv({}).create().channel).toBe('log');
    const saved = { k: process.env.RESEND_API_KEY, h: process.env.SMTP_HOST };
    try {
      process.env.RESEND_API_KEY = KEY;
      process.env.SMTP_HOST = 'smtp.example.com';
      expect(getMailer().channel).toBe('resend');
      delete process.env.RESEND_API_KEY;
      expect(getMailer().channel).toBe('smtp');
      delete process.env.SMTP_HOST;
      expect(getMailer().channel).toBe('log');
    } finally {
      if (saved.k === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = saved.k;
      if (saved.h === undefined) delete process.env.SMTP_HOST; else process.env.SMTP_HOST = saved.h;
    }
  });

  it('MAIL-008: Resend gets one POST with the bearer key and the JSON message', async () => {
    const calls: Call[] = [];
    const mailer = createResendMailer({ apiKey: KEY, from: 'IronGate QE Navigator <no-reply@qe.example>' }, fakeFetch(200, { id: 'msg_123' }, calls));
    const res = await mailer.send(msg);
    expect(res).toEqual({ delivered: true, channel: 'resend', messageId: 'msg_123' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    expect(RESEND_ENDPOINT).toBe('https://api.resend.com/emails');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toMatchObject({ Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      from: 'IronGate QE Navigator <no-reply@qe.example>', to: ['person@test.local'], subject: 'Reset', text: msg.text, html: '<p>Hi</p>',
    });
    // Without an HTML part only the text is sent.
    await mailer.send({ to: 'a@test.local', subject: 's', text: 't' });
    expect(JSON.parse(String(calls[1].init.body))).not.toHaveProperty('html');
  });

  it('MAIL-009: a Resend error answer is delivered: false with a safe message; the key is never logged or returned', async () => {
    watchConsole();
    for (const [status, body] of [[403, { name: 'validation_error', message: `The qe.example domain is not verified. key ${KEY}` }], [401, { name: 'missing_api_key' }], [500, 'not json']] as const) {
      const res = await createResendMailer({ apiKey: KEY, from: 'x@qe.example' }, fakeFetch(status, body)).send(msg);
      expect(res.delivered).toBe(false);
      expect(res.channel).toBe('resend');
      expect(res.error).toMatch(new RegExp(`Resend error ${status}`));
      expect(JSON.stringify(res)).not.toContain(KEY);
      expect(JSON.stringify(res)).not.toMatch(/not verified/); // Resend's free-text message is not passed on
    }
    // Network failure and timeout.
    const down = createResendMailer({ apiKey: KEY, from: 'x@qe.example' }, (async () => { throw new TypeError(`fetch failed ${KEY}`); }) as typeof fetch);
    const r1 = await down.send(msg);
    expect(r1).toMatchObject({ delivered: false, channel: 'resend' });
    expect(r1.error).toMatch(/could not be reached/);
    const slow = createResendMailer({ apiKey: KEY, from: 'x@qe.example' }, (async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); }) as typeof fetch);
    expect((await slow.send(msg)).error).toMatch(/did not answer in time/);
    expect(JSON.stringify(r1)).not.toContain(KEY);
    expect(consoleText()).not.toContain(KEY);
    expect(consoleText()).toMatch(/Resend send failed: Resend error 403, validation_error/);
    // Each failure is in server_errors (operator panel), without the key.
    await flushBackgroundWrites(2000);
    const rows = (await pool.query(`SELECT error_name, error_message, stack FROM server_errors WHERE function_name = 'mailer' AND created_at > now() - interval '1 minute'`)).rows;
    expect(rows.map((r: any) => r.error_message)).toEqual(expect.arrayContaining(['Resend: Resend error 403, validation_error', 'Resend: Resend could not be reached']));
    expect(JSON.stringify(rows)).not.toContain(KEY);
  });
});
