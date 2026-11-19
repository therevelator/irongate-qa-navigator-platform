import { test, expect, TAG } from '../support/fixtures';
import { ALL_ROLES, DEMO, type Role } from '../support/roles';
import { signInWithForm } from '../support/auth';
import { API_URL } from '../support/env';
import { ROLES } from '../support/roles';
import type { Page } from '@playwright/test';

/**
 * Team detail (src/components/TeamDetailView.tsx) and Team TV mode (TeamTvView.tsx, tvNavigation.ts):
 * what each role sees on its own and another team, formula mode (super admins), TV mode from the
 * team page, the TV link by e-mail / clipboard, keyboard controls, kiosk options, a team outside the
 * scope, a signed-out TV link, server errors and a failed refresh that keeps the last data.
 */

const OWN: Record<Role, typeof DEMO.leadTeam> = {
  admin: DEMO.leadTeam, manager: DEMO.leadTeam, lead: DEMO.leadTeam, engineer: DEMO.engineerTeam, viewer: DEMO.leadTeam,
};

async function openTeam(page: Page, name: string) {
  await page.getByLabel('Search teams').fill(name);
  await page.getByTestId('team-card').filter({ hasText: name }).first().click();
  await expect(page.getByTestId('team-detail')).toBeVisible();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test.describe('Team detail', { tag: [TAG.area('team')] }, () => {
  for (const role of ALL_ROLES) {
    test(`TEAM-01 ${role}: own team shows KPIs and members; another team only for roles that have it in scope`, { tag: [TAG.role(role)] }, async ({ signInAs, page }) => {
      await signInAs(role);
      await openTeam(page, OWN[role].name);
      await expect(page.getByTestId('team-kpis')).toBeVisible();
      await expect(page.getByTestId('team-members-section')).toBeVisible();
      await page.getByTestId('back-to-dashboard').click();
      if (role === 'admin') {
        await openTeam(page, DEMO.otherTeam.name);
        await expect(page.getByTestId('team-kpis')).toBeVisible();
        await expect(page.getByTestId('team-members-section')).toBeVisible();
      } else {
        // One scope for every page (docs/ROLE_ACCESS.md): no card, and the API refuses the team.
        await page.getByLabel('Search teams').fill(DEMO.otherTeam.name);
        await expect(page.getByTestId('team-card')).toHaveCount(0);
        expect((await page.request.get(`${API_URL}/teams/${DEMO.otherTeam.id}`)).status()).toBe(403);
      }
    });
  }

  test('TEAM-02 formula mode is offered to super admins only and explains a metric', { tag: [TAG.role('admin'), TAG.role('manager')] }, async ({ signInAs, page, app }) => {
    await signInAs('admin');
    await openTeam(page, DEMO.leadTeam.name);
    const toggle = page.getByRole('switch', { name: 'Show formulas & data sources' });
    await toggle.click();
    await expect(page.getByTestId('formula-mode-hint')).toBeVisible();
    await page.locator('[data-metric-info]').first().click();
    await expect(page.getByTestId('metric-info-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await toggle.click();
    await expect(page.getByTestId('formula-mode-hint')).toHaveCount(0);
    await app.signOut();
    await signInAs('manager');
    await openTeam(page, DEMO.leadTeam.name);
    await expect(page.getByRole('switch', { name: 'Show formulas & data sources' })).toHaveCount(0);
  });

  test('TEAM-03 the TV link can be e-mailed and copied', { tag: [TAG.role('lead')] }, async ({ signInAs, page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signInAs('lead');
    await openTeam(page, DEMO.leadTeam.name);
    const href = decodeURIComponent((await page.getByTestId('email-tv-link').getAttribute('href')) ?? '');
    expect(href).toMatch(/^mailto:\?subject=/);
    expect(href).toContain(`/tv?team=${DEMO.leadTeam.id}`);
    await page.getByTestId('copy-tv-link').click();
    await expect(page.getByText('TV mode link copied')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`/tv?team=${DEMO.leadTeam.id}`);
  });

  test('TEAM-04 a failed team detail request does not leave a blank page', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs('lead');
    await page.route(new RegExp(`${API_URL}/teams/${DEMO.leadTeam.id}(\\?.*)?$`), (r) => r.fulfill({ status: 500, json: { error: 'Internal server error', requestId: 'rid-team' } }));
    await page.route(`${API_URL}/teams/${DEMO.leadTeam.id}/kpi-history*`, (r) => r.fulfill({ status: 500, json: { error: 'Internal server error' } }));
    await openTeam(page, DEMO.leadTeam.name);
    await expect(page.getByTestId('team-kpis')).toBeVisible();
    await page.getByTestId('back-to-dashboard').click();
    await expect(page.getByTestId('dashboard')).toBeVisible();
  });
});

test.describe('Team TV mode', { tag: [TAG.area('tv')] }, () => {
  test('TV-01 "Open TV mode" shows the team full screen; Exit returns to the team page', { tag: [TAG.smoke, TAG.role('lead')] }, async ({ signInAs, page }) => {
    await signInAs('lead');
    await openTeam(page, DEMO.leadTeam.name);
    await page.getByTestId('open-tv-mode').click();
    await expect(page.getByTestId('tv-mode')).toBeVisible();
    await expect(page.getByTestId('tv-team-name')).toHaveText(DEMO.leadTeam.name);
    await expect(page).toHaveURL(new RegExp(`/tv\\?team=${DEMO.leadTeam.id}`));
    await page.mouse.move(400, 400);
    await page.getByTestId('tv-exit').click();
    await expect(page.getByTestId('team-detail')).toBeVisible();
  });

  test('TV-02 keyboard: panels with 1-3 and arrows, T theme, R rotation, Esc exit', { tag: [TAG.role('manager')] }, async ({ signInAs, page }) => {
    await signInAs('manager', `/tv?team=${DEMO.leadTeam.id}`);
    await expect(page.getByTestId('tv-team-name')).toHaveText(DEMO.leadTeam.name);
    await expect(page.getByTestId('tv-panel-kpis')).toBeVisible();
    await page.keyboard.press('2');
    await expect(page.getByTestId('tv-panel-trends')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('tv-panel-focus')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('tv-panel-kpis')).toBeVisible();
    const theme = await page.getByTestId('tv-mode').getAttribute('data-theme');
    await page.keyboard.press('t');
    await expect(page.getByTestId('tv-mode')).not.toHaveAttribute('data-theme', theme ?? '');
    await page.keyboard.press('t');
    await page.keyboard.press('r');
    await expect(page.getByTestId('tv-rotate')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('r');
    await expect(page.getByTestId('tv-rotate')).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('dashboard')).toBeVisible();
  });

  test('TV-03 kiosk options in the address (?theme=light&rotate=1)', { tag: [TAG.role('admin')] }, async ({ signInAs, page }) => {
    await signInAs('admin', `/tv?team=${DEMO.leadTeam.id}&theme=light&rotate=1`);
    await expect(page.getByTestId('tv-mode')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByTestId('tv-refresh')).toContainText('panels rotate every 20 s');
    await page.keyboard.press('r');
  });

  test('TV-04 a team outside the scope is refused, with a way to show the own team; the picker lists the scope only', { tag: [TAG.negative, TAG.role('engineer')] }, async ({ signInAs, page }) => {
    await signInAs('engineer', `/tv?team=${DEMO.otherTeam.id}`);
    await expect(page.getByTestId('tv-state-forbidden')).toContainText('This team is not available to you');
    await page.getByRole('button', { name: `Show ${DEMO.engineerTeam.name}` }).click();
    await expect(page.getByTestId('tv-team-name')).toHaveText(DEMO.engineerTeam.name);
    const picker = (await (await page.request.get(`${API_URL}/tv/teams`)).json()).teams.map((t: { id: string }) => t.id);
    expect(picker).toEqual([DEMO.engineerTeam.id]);
  });

  test('TV-05 an e-mailed TV link opened while signed out shows the team after signing in', { tag: [TAG.role('viewer')] }, async ({ page }) => {
    await page.goto(`/tv?team=${DEMO.leadTeam.id}`);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await signInWithForm(page, ROLES.viewer, { expectSuccess: false });
    await expect(page.getByTestId('tv-team-name')).toHaveText(DEMO.leadTeam.name);
  });

  test('TV-06 a server error says the team could not be loaded', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await page.route(`${API_URL}/tv/teams/**`, (r) => r.fulfill({ status: 500, json: { error: 'Internal server error', requestId: 'rid-tv' } }));
    await signInAs('lead', `/tv?team=${DEMO.leadTeam.id}`);
    await expect(page.getByTestId('tv-state-error')).toContainText('Could not load the team');
    await page.getByRole('button', { name: 'Exit TV mode' }).click();
    await expect(page.getByTestId('dashboard')).toBeVisible();
  });

  test('TV-07 a failed refresh keeps the last data and says the connection was lost', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs('lead', `/tv?team=${DEMO.leadTeam.id}`);
    await expect(page.getByTestId('tv-team-name')).toHaveText(DEMO.leadTeam.name);
    await page.route(`${API_URL}/tv/teams/**`, (r) => r.abort('internetdisconnected'));
    await page.evaluate(() => window.dispatchEvent(new Event('irongate:metrics-updated')));
    await expect(page.getByTestId('tv-refresh')).toContainText('Connection lost');
    await expect(page.getByTestId('tv-team-name')).toHaveText(DEMO.leadTeam.name);
  });

  test('TV-08 /tv without a team shows the own team (or says there is none)', async ({ signInAs, page }) => {
    await signInAs('engineer', '/tv');
    await expect(page.getByTestId('tv-team-name').or(page.getByTestId('tv-state-none'))).toBeVisible();
  });
});
