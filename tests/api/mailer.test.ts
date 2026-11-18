import net from 'net';
import { createSmtpMailer, logMailer, smtpConfigFromEnv, setMailerForTests, getMailer, type MailMessage } from '../../server/lib/mailer';
import { sendInvitationEmail } from '../../server/lib/invitations';

/**
 * The pluggable mailer (server/lib/mailer.ts): SMTP when SMTP_HOST is set (exercised against a
 * local fake SMTP server), otherwise the log channel, which reports delivered: false so the UI
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
  afterAll(async () => { setMailerForTests(null); await new Promise((r) => smtp.server.close(r)); });

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
});
