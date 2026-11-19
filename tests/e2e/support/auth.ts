import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { API_URL, APP_URL, API_GLOB, REMOTE } from './env';
import { ROLES, type Role } from './roles';
import { fakeClientIp } from './ids';

export interface Credentials { email: string; password: string }

export function credentialsOf(who: Role | Credentials): Credentials {
  if (typeof who !== 'string') return who;
  if (REMOTE) {
    const email = process.env.UI_REMOTE_EMAIL, password = process.env.UI_REMOTE_PASSWORD;
    if (!email || !password) throw new Error('Remote mode needs UI_REMOTE_EMAIL and UI_REMOTE_PASSWORD in the environment.');
    return { email, password };
  }
  return { email: ROLES[who].email, password: ROLES[who].password };
}

/**
 * Sign in through the API (fast; the cookie lands in the page's context) and open `path`.
 * Remote mode signs in through the form instead (same origin, nothing special).
 */
export async function signIn(page: Page, who: Role | Credentials, path = '/'): Promise<void> {
  const creds = credentialsOf(who);
  if (REMOTE) {
    await signInWithForm(page, creds);
    if (path !== '/') await page.goto(path);
    return;
  }
  const res = await page.request.post(`${API_URL}/auth/login`, { data: creds });
  expect(res.status(), `sign-in of ${creds.email}: ${await res.text().catch(() => '')}`).toBe(200);
  await page.goto(path);
  // The app frame, or TV mode (full screen, no frame).
  await expect(page.getByTestId('nav-toggle').or(page.getByTestId('tv-mode')).first()).toBeVisible({ timeout: 30000 });
}

/** Sign in through the sign-in form, as a person would. */
export async function signInWithForm(page: Page, creds: Credentials, opts: { expectSuccess?: boolean } = {}): Promise<void> {
  if (!page.url().startsWith(APP_URL)) await page.goto('/');
  await page.getByLabel('Email address').fill(creds.email);
  await page.locator('#password').fill(creds.password);
  await page.getByRole('button', { name: /^Sign in/ }).click();
  if (opts.expectSuccess !== false) await expect(page.getByTestId('dashboard').or(page.getByTestId('nav-toggle')).first()).toBeVisible({ timeout: 30000 });
}

/** A new browser context signed in as `who` (for "two devices" flows). */
export async function signedInContext(browser: Browser, who: Role | Credentials, path = '/'): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: APP_URL });
  const page = await ctx.newPage();
  await signIn(page, who, path);
  return { ctx, page };
}

/**
 * Give this page's API requests their own client address (X-Forwarded-For; the API trusts one proxy
 * hop), so per-address limits (failed sign-ins, forgot password) of other tests and earlier runs do
 * not apply. Added after the browser's CORS check, so no preflight changes.
 */
export async function useOwnClientAddress(page: Page, ip = fakeClientIp()): Promise<string> {
  await page.route(API_GLOB, (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }));
  return ip;
}

/** An API call as `who`, outside the browser (to check what the API refuses). */
export async function apiAs(request: APIRequestContext, who: Role | Credentials) {
  const creds = credentialsOf(who);
  const res = await request.post(`${API_URL}/auth/login`, { data: creds });
  expect(res.status()).toBe(200);
  return request;
}
