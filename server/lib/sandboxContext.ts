import { AsyncLocalStorage } from 'async_hooks';

/**
 * "This request is a demo sandbox session" (server/lib/sandboxConfig.ts). Set by authenticateToken
 * for the whole request of a sandbox user; read by code far from the request that must behave
 * differently there: the AI provider is never called (server/lib/groq.ts), so every AI feature uses
 * its rule-based fallback and nothing costs money.
 */
const als = new AsyncLocalStorage<{ companyId: string }>();

export const inSandboxRequest = (): boolean => !!als.getStore();

export function runAsSandbox<T>(companyId: string, fn: () => T): T {
  return als.run({ companyId }, fn);
}
