import { randomBytes } from 'crypto';

/**
 * Unique, recognisable names for entities a test creates, so tests can run in parallel, in any
 * order and again on the same database. Every id starts with "uit-" (UI test).
 */
export function uid(prefix = 'uit'): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

/** A unique client address for the API's per-address limits (sign-in attempts, forgot password). */
export function fakeClientIp(): string {
  const b = randomBytes(3);
  return `10.${b[0]}.${b[1]}.${(b[2] % 250) + 2}`;
}
