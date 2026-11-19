import fs from 'fs';
import { expect } from '@playwright/test';

/**
 * E-mails written by the log mailer to MAIL_CAPTURE_FILE (development aid of server/lib/mailer.ts):
 * one JSON object per line with to / subject / text. Used to follow invitation, reset and pulse links.
 */
export interface CapturedMail { to: string; subject?: string; text: string; html?: string }

export function mailCaptureEnabled(): boolean {
  return !!process.env.MAIL_CAPTURE_FILE;
}

export function mailsTo(address: string): CapturedMail[] {
  const file = process.env.MAIL_CAPTURE_FILE;
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) as CapturedMail; } catch { return null; } })
    .filter((m): m is CapturedMail => !!m && String(m.to).toLowerCase() === address.toLowerCase());
}

/** The first match of `pattern` in the latest e-mail to `address` (polls until it arrives). */
export async function linkFromMail(address: string, pattern: RegExp, timeout = 15000): Promise<string> {
  let found = '';
  await expect.poll(() => {
    const all = mailsTo(address);
    const m = all[all.length - 1]?.text.match(pattern);
    found = m ? m[1] ?? m[0] : '';
    return found;
  }, { timeout, message: `an e-mail to ${address} matching ${pattern}` }).not.toBe('');
  return found;
}
