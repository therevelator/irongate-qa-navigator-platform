/**
 * Privacy, enforced here before anything is sent:
 *   - people: never sent by name or e-mail; with privacy.people = hash, a person becomes
 *     HMAC-SHA256(customer salt, lower-cased stable id), first 32 hex, computed locally. QE Navigator
 *     never sees the salt, so it cannot reverse or recompute the hash.
 *   - titles: only with privacy.sendTitles; e-mail addresses and URLs inside a title are masked.
 *   - every record goes through the shared field allow-list (vendor/fieldAllowList.ts, the same list
 *     QE Navigator applies on its side) and then the Collector's stricter send policy (policy.ts): any
 *     field that is not on both, at any depth, is dropped.
 *   - a last check refuses a record that still contains an e-mail address anywhere.
 */
import { createHmac } from 'node:crypto';
import { minimise } from './vendor/fieldAllowList';
import { applyPolicy, type PolicyKind } from './policy';
import type { Privacy } from './config';

export interface PrivacyContext { privacy: Privacy; salt: string | null }

export function personHash(salt: string, identity: string): string {
  return createHmac('sha256', salt).update(identity.trim().toLowerCase()).digest('hex').slice(0, 32);
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_RE = /\bhttps?:\/\/\S+/gi;

export function maskTitle(t: string | null | undefined): string | null {
  if (!t) return null;
  return t.replace(EMAIL, '[email]').replace(URL_RE, '[link]').trim() || null;
}

/** The hash of a person (or undefined when people are not sent or the person is unknown). */
export function person(ctx: PrivacyContext, identity: string | null | undefined): string | undefined {
  if (ctx.privacy.people !== 'hash' || !ctx.salt || !identity) return undefined;
  return personHash(ctx.salt, identity);
}

export class PrivacyViolation extends Error {}

function scan(v: unknown, path: string): void {
  if (typeof v === 'string') {
    EMAIL.lastIndex = 0;
    if (EMAIL.test(v)) throw new PrivacyViolation(`${path} contains an e-mail address; the record is not sent`);
  } else if (Array.isArray(v)) v.forEach((x, i) => scan(x, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) scan(x, `${path}.${k}`);
}

/** The record exactly as it will be sent: shared allow-list, then the Collector's send policy, then checked. */
export function finalRecord(kind: PolicyKind, record: Record<string, unknown>, ctx: PrivacyContext): Record<string, unknown> {
  const r = { ...record };
  if (typeof r.title === 'string') r.title = maskTitle(r.title);
  // salt: null — a raw person field that reached this point is dropped, never hashed with a weak salt.
  const shared = minimise(kind, r, { storeTitles: ctx.privacy.sendTitles, salt: null }).record;
  const out = applyPolicy(kind, shared, { titles: ctx.privacy.sendTitles, links: ctx.privacy.sendLinks, people: ctx.privacy.people === 'hash' && !!ctx.salt });
  scan(out, kind);
  return out;
}
