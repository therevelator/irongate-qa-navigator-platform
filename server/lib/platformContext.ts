import { AsyncLocalStorage } from 'async_hooks';

/**
 * "This code runs for IronGate platform support" (an operator request, server/routes/operator.ts).
 * Set for the whole operator request, including the company app handlers the operator panel
 * reuses for its changes. While it is set, nothing is written to the company's change history
 * (recordAudit is a no-op). Operator activity is not logged anywhere.
 */
export interface PlatformSupportContext { operatorId: string; email: string }

const als = new AsyncLocalStorage<PlatformSupportContext>();

export const platformSupportContext = (): PlatformSupportContext | undefined => als.getStore();

/**
 * Set (by the operator panel only, never from a request's data: a Symbol) on an internal request
 * that runs a company app handler for platform support: authenticateToken then acts as a super
 * admin of that company with no user id, and only while platformSupportContext() is set.
 */
export const PLATFORM_SUPPORT_REQUEST = Symbol('irongate.platformSupportRequest');
export interface PlatformSupportRequest { companyId: string }

export function runAsPlatformSupport<T>(ctx: PlatformSupportContext, fn: () => T): T {
  return als.run(ctx, fn);
}
