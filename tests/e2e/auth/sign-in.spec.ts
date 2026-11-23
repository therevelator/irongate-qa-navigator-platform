import { test, expect, TAG } from '../support/fixtures';
import { signInWithForm, useOwnClientAddress, signedInContext } from '../support/auth';
import { ALL_ROLES, ROLES } from '../support/roles';
import { API_URL } from '../support/env';
import { AppShell } from '../support/app';
import { createFixtureUser, deleteFixtureUser } from '../support/data';
import { sql } from '../support/db';
import { fakeClientIp } from '../support/ids';

/**
 * Sign-in screen (src/components/Login.tsx, AuthWrapper.tsx, contexts/AuthContext.tsx):
 * password sign-in for every role, validation, wrong / unknown / deactivated accounts, the
 * per-address attempt limit, SSO buttons (stubbed: real Google / Microsoft cannot run in CI),
 * demo chips, sign out, deep links kept across sign-in, sessions that end mid-use.
 * Inventory: docs/testing/E2E_FLOWS.md, section "Sign-in and sessions".
 */

test.describe('Sign-in', { tag: [TAG.area('auth')] }, () => {
  for (const role of ALL_ROLES) {
    test(`AUTH-01 ${role} signs in with the form and sees the overview with their role`, { tag: [TAG.smoke, TAG.role(role)] }, async ({ page, app }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      await signInWithForm(page, ROLES[role]);
      await expect(page.getByTestId('dashboard')).toBeVisible();
      await expect(app.title).toHaveText('Overview');
      await app.openNav();
      await expect(app.drawer.getByText(ROLES[role].label, { exact: true })).toBeVisible();
    });
  }

  test('AUTH-02 empty fields are refused before anything is sent', { tag: [TAG.negative] }, async ({ page }) => {
    let sent = false;
    await page.route(`${API_URL}/auth/login`, (r) => { sent = true; return r.continue(); });
    await page.goto('/');
    await page.getByRole('button', { name: /^Sign in/ }).click();
    await expect(page.getByRole('alert')).toHaveText('Enter your email address and password.');
    await page.getByLabel('Email address').fill('admin@irongate.com');
    await page.getByRole('button', { name: /^Sign in/ }).click();
    await expect(page.getByRole('alert')).toHaveText('Enter your email address and password.');
    expect(sent).toBe(false);
  });

  test('AUTH-03 a wrong password says "Invalid credentials" and keeps what was typed', { tag: [TAG.negative] }, async ({ page }) => {
    await useOwnClientAddress(page);
    await page.goto('/');
    await signInWithForm(page, { email: 'viewer@irongate.com', password: 'not-the-password' }, { expectSuccess: false });
    await expect(page.getByRole('alert')).toHaveText('Invalid credentials');
    await expect(page.getByLabel('Email address')).toHaveValue('viewer@irongate.com');
    await expect(page.getByTestId('dashboard')).toHaveCount(0);
  });

  test('AUTH-04 an unknown e-mail gets exactly the same answer (no account enumeration)', { tag: [TAG.negative] }, async ({ page }) => {
    await useOwnClientAddress(page);
    await page.goto('/');
    await signInWithForm(page, { email: 'nobody-here@uitest.example', password: 'whatever-123' }, { expectSuccess: false });
    await expect(page.getByRole('alert')).toHaveText('Invalid credentials');
  });

  test('AUTH-05 a deactivated account cannot sign in', { tag: [TAG.negative] }, async ({ page }) => {
    const user = await createFixtureUser({ active: false });
    try {
      await useOwnClientAddress(page);
      await page.goto('/');
      await signInWithForm(page, user, { expectSuccess: false });
      await expect(page.getByRole('alert')).toHaveText('Invalid credentials');
    } finally {
      await deleteFixtureUser(user.id);
    }
  });

  test('AUTH-06 after 20 failed attempts from one address the form says to wait', { tag: [TAG.negative] }, async ({ page, request }) => {
    const ip = fakeClientIp();
    for (let i = 0; i < 20; i++) {
      await request.post(`${API_URL}/auth/login`, { data: { email: 'nobody-here@uitest.example', password: 'x' }, headers: { 'x-forwarded-for': ip } });
    }
    await useOwnClientAddress(page, ip);
    await page.goto('/');
    await signInWithForm(page, ROLES.viewer, { expectSuccess: false });
    await expect(page.getByRole('alert')).toHaveText('Too many attempts, please try again later.');
  });

  test('AUTH-07 the password can be shown and hidden', async ({ page }) => {
    await page.goto('/');
    const pw = page.locator('#password');
    await pw.fill('secret-value');
    await expect(pw).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(pw).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(pw).toHaveAttribute('type', 'password');
  });

  test('AUTH-08 demo account chips fill in the credentials (demo mode)', { tag: [TAG.smoke] }, async ({ page }) => {
    await page.goto('/');
    const chips = page.getByTestId('demo-accounts');
    await expect(chips).toBeVisible();
    await chips.getByRole('button', { name: 'Team lead' }).click();
    await expect(page.getByLabel('Email address')).toHaveValue('lead@irongate.com');
    await expect(page.locator('#password')).toHaveValue('demo123');
    await page.getByRole('button', { name: /^Sign in/ }).click();
    await expect(page.getByTestId('dashboard')).toBeVisible();
  });

  test('AUTH-09 no SSO buttons when single sign-on is not configured', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('demo-accounts')).toBeVisible();
    await expect(page.getByTestId('sso-buttons')).toHaveCount(0);
  });

  test('AUTH-10 configured SSO providers show their buttons pointing at the API (stubbed providers)', async ({ page }) => {
    await page.route(`${API_URL}/auth/providers`, (r) => r.fulfill({
      json: {
        sso: [
          { id: 'google', label: 'Google', startUrl: '/auth/sso/google/start' },
          { id: 'microsoft', label: 'Microsoft', startUrl: '/auth/sso/microsoft/start' },
        ],
        demoMode: false,
      },
    }));
    await page.goto('/');
    await expect(page.getByTestId('sso-google')).toHaveText(/Continue with Google/);
    await expect(page.getByTestId('sso-google')).toHaveAttribute('href', `${API_URL}/auth/sso/google/start`);
    await expect(page.getByTestId('sso-microsoft')).toHaveAttribute('href', `${API_URL}/auth/sso/microsoft/start`);
    await expect(page.getByTestId('demo-accounts')).toHaveCount(0);
  });

  test('AUTH-11 an unconfigured SSO provider is refused by the API and the error comes back to the form', { tag: [TAG.negative] }, async ({ page }) => {
    const res = await page.request.get(`${API_URL}/auth/sso/google/start`, { maxRedirects: 0 });
    expect([302, 303, 404]).toContain(res.status());
    if (res.status() !== 404) expect(res.headers()['location'] ?? '').toContain('sso_error');
    await page.goto('/?sso_error=not_allowed&sso_message=No%20account%20for%20this%20e-mail.%20Ask%20your%20administrator%20for%20an%20invitation.');
    await expect(page.getByRole('alert')).toHaveText('No account for this e-mail. Ask your administrator for an invitation.');
    await expect(page).toHaveURL(/\/$/); // the error leaves the address bar
  });

  test('AUTH-12 a server error or an unreachable server gives a clear message, not a blank screen', { tag: [TAG.negative] }, async ({ page }) => {
    await page.goto('/');
    await page.route(`${API_URL}/auth/login`, (r) => r.fulfill({ status: 500, json: { error: 'Internal server error', requestId: 'req-ui-test-500' } }), { times: 1 });
    await signInWithForm(page, ROLES.viewer, { expectSuccess: false });
    await expect(page.getByRole('alert')).toHaveText('Sign-in failed: the server had a problem. Try again in a moment. Reference: req-ui-test-500.');
    await page.route(`${API_URL}/auth/login`, (r) => r.abort('internetdisconnected'), { times: 1 });
    await page.getByRole('button', { name: /^Sign in/ }).click();
    await expect(page.getByRole('alert')).toHaveText('The server could not be reached. Check your connection and try again.');
    await expect(page.getByLabel('Email address')).toHaveValue(ROLES.viewer.email);
  });

  test('AUTH-13 double-clicking Sign in signs in once', { tag: [TAG.negative] }, async ({ page }) => {
    let calls = 0;
    await page.route(`${API_URL}/auth/login`, async (r) => { calls++; await r.continue(); });
    await page.goto('/');
    await page.getByLabel('Email address').fill(ROLES.viewer.email);
    await page.locator('#password').fill(ROLES.viewer.password);
    await page.getByRole('button', { name: /^Sign in/ }).dblclick();
    await expect(page.getByTestId('dashboard')).toBeVisible();
    expect(calls).toBe(1);
  });

  test('AUTH-14 "Keep me signed in": unticked a browser-session cookie, ticked a cookie for the company sign-in lifetime', async ({ browser }) => {
    const cookieAfterSignIn = async (keep: boolean) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto('/');
      await expect(page.getByText('Unticked, you are signed out when you close the browser.')).toBeVisible();
      if (keep) await page.getByLabel('Keep me signed in').check();
      await signInWithForm(page, ROLES.viewer);
      await expect(page.getByTestId('dashboard')).toBeVisible();
      const cookie = (await ctx.cookies()).find((c) => c.name === 'irongate_token');
      await ctx.close();
      return cookie;
    };
    const session = await cookieAfterSignIn(false);
    expect(session, 'session cookie').toBeTruthy();
    expect(session!.expires).toBe(-1); // a browser-session cookie: gone when the browser closes
    const kept = await cookieAfterSignIn(true);
    const days = (kept!.expires - Date.now() / 1000) / 86400;
    expect(days).toBeGreaterThan(6.9); // the demo company's sign-in lifetime: 7 days (Parameters → Sign-in)
    expect(days).toBeLessThan(7.1);
  });

  test('AUTH-15 "Keep me signed in" also applies to the single sign-on buttons (stubbed providers)', async ({ page }) => {
    await page.route(`${API_URL}/auth/providers`, (r) => r.fulfill({
      json: { sso: [{ id: 'google', label: 'Google', startUrl: '/auth/sso/google/start' }], demoMode: false },
    }));
    await page.goto('/');
    await expect(page.getByTestId('sso-google')).toHaveAttribute('href', `${API_URL}/auth/sso/google/start`);
    await page.getByLabel('Keep me signed in').check();
    await expect(page.getByTestId('sso-google')).toHaveAttribute('href', `${API_URL}/auth/sso/google/start?remember=1`);
    await page.getByLabel('Keep me signed in').uncheck();
    await expect(page.getByTestId('sso-google')).toHaveAttribute('href', `${API_URL}/auth/sso/google/start`);
  });
});

test.describe('Sign out and sessions', { tag: [TAG.area('auth')] }, () => {
  test('AUTH-20 signing out returns to the sign-in screen; Back and reload do not show the app', { tag: [TAG.smoke] }, async ({ signInAs, page, app }) => {
    await signInAs('engineer');
    await app.go('nav-team-pulse', 'Wellbeing pulse');
    await app.signOut();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    const me = await page.request.get(`${API_URL}/auth/me`);
    expect(me.status()).toBe(401);
  });

  test('AUTH-21 a deep link opened while signed out opens after signing in', { tag: [TAG.smoke] }, async ({ page, app }) => {
    await page.goto('/analytics/pulse');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await signInWithForm(page, ROLES.lead);
    await expect(app.title).toHaveText('Wellbeing pulse');
    await expect(page).toHaveURL(/\/analytics\/pulse/);
  });

  test('AUTH-22 a session ended elsewhere (signed out everywhere) sends the open app to sign-in with a message that survives a reload, and the page opens again after signing in', { tag: [TAG.negative] }, async ({ page, app }) => {
    const user = await createFixtureUser();
    try {
      await page.goto('/');
      await signInWithForm(page, user);
      await app.go('nav-team-pulse', 'Wellbeing pulse');
      // Every session issued before this moment is refused from now on (what "Sign out everywhere" does).
      await sql(`UPDATE users SET sessions_valid_after = now() + interval '2 seconds' WHERE id = $1`, [user.id]);
      await app.go('nav-technical-debt');
      await expect(page.getByTestId('session-notice')).toHaveText('Your session has ended. Please sign in again.');
      await expect(page).toHaveURL(/\/analytics\/technical-debt/);
      // The refused request cleared the cookie; after a reload the reason is still shown (FI-16).
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      await expect(page.getByTestId('session-notice')).toHaveText('Your session has ended. Please sign in again.');
      await sql(`UPDATE users SET sessions_valid_after = now() - interval '5 seconds' WHERE id = $1`, [user.id]);
      await signInWithForm(page, user);
      await expect(app.title).toHaveText('Technical debt');
      // A successful sign-in clears the reason: signing out and reloading shows the plain sign-in screen.
      await app.signOut();
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      await expect(page.getByTestId('session-notice')).toHaveCount(0);
    } finally {
      await deleteFixtureUser(user.id);
    }
  });

  test('AUTH-23 an expired sign-in says so', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs('viewer');
    await page.route(`${API_URL}/auth/me`, (r) => r.fulfill({
      status: 401, json: { error: 'Session expired' },
      headers: { 'X-Session-Ended': 'session_expired', 'Access-Control-Expose-Headers': 'X-Session-Ended' },
    }));
    await page.reload();
    await expect(page.getByTestId('session-notice')).toHaveText('Your sign-in has expired. Please sign in again.');
  });

  test('AUTH-24 "Sign out my other devices" can be cancelled and then nothing changes', { tag: [TAG.negative] }, async ({ browser }) => {
    const user = await createFixtureUser();
    const a = await signedInContext(browser, user);
    const b = await signedInContext(browser, user);
    try {
      await new AppShell(a.page).openNav();
      a.page.once('dialog', (d) => d.dismiss());
      await a.page.getByTestId('sign-out-others').click();
      await b.page.reload();
      await expect(b.page.getByTestId('dashboard')).toBeVisible();
    } finally {
      await a.ctx.close();
      await b.ctx.close();
      await deleteFixtureUser(user.id);
    }
  });

  test('AUTH-25 "Sign out my other devices" reports a server failure', { tag: [TAG.negative] }, async ({ signInAs, page, app }) => {
    await signInAs('viewer');
    await page.route(`${API_URL}/auth/sessions/sign-out-others`, (r) => r.fulfill({ status: 500, json: { error: 'Internal server error', requestId: 'rid-x' } }));
    await app.openNav();
    page.once('dialog', (d) => d.accept());
    await page.getByTestId('sign-out-others').click();
    await expect(page.getByText('Internal server error')).toBeVisible();
    await expect(page.getByTestId('dashboard')).toBeVisible();
  });
});
