import { test, expect, TAG } from '../support/fixtures';
import { expectNoHorizontalScroll } from '../support/app';
import { checkA11y } from '../support/a11y';
import { API_URL } from '../support/env';
import { DEMO } from '../support/roles';
import type { Page } from '@playwright/test';

/**
 * Executive summary (/summary: src/components/ExecutiveSummary.tsx, GET /api/summary). On a phone
 * (390 × 844): the scope's QA score with its status, target and weekly change, the biggest risks,
 * the most improved teams, money at risk (managers and admins), open alerts and changes since last
 * week; no sideways scrolling and large tap targets. Scope per role, the offline copy, the share
 * link, the assumptions link, the score display, and accessibility in the four themes.
 */

const summaryApi = async (page: Page) => (await page.request.get(`${API_URL}/summary`)).json();

test.describe('Executive summary on a phone', { tag: [TAG.area('summary')] }, () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('SUMUI-01 super admin: the company summary fits the phone, numbers from the summary API, large tap targets', { tag: [TAG.smoke, TAG.role('admin')] }, async ({ signInAs, page, app }) => {
    await signInAs('admin', '/summary');
    await expect(app.title).toHaveText('Summary');
    const api = await summaryApi(page);
    await expect(page.getByTestId('summary-quality')).toBeVisible();
    await expect(page.getByTestId('summary-scope')).toHaveText(api.scope.label);
    await expect(page.getByTestId('summary-qa-score')).toHaveText(String(api.quality.score ?? '—'));
    await expect(page.getByTestId('summary-alerts-open')).toHaveText(String(api.alerts.open + api.alerts.acknowledged));
    await expect(page.getByTestId('summary-risk')).toHaveCount(Math.min(3, api.risks.top.length));
    await expect(page.getByTestId('summary-improved-item')).toHaveCount(api.improved.top.length);
    if (api.risks.top.length) await expect(page.getByTestId('summary-risk').first()).toContainText(api.risks.top[0].teamName);
    await expect(page.getByTestId('summary-money')).toBeVisible();
    await expect(page.getByTestId('summary-since')).toBeVisible();
    await expect(page.getByTestId('summary-loaded')).toContainText('Loaded today');
    await expectNoHorizontalScroll(page);
    for (const id of ['summary-share', 'summary-refresh', 'summary-alerts']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box!.height, `${id} is at least 44 px tall`).toBeGreaterThanOrEqual(44);
    }
  });

  test('SUMUI-02 manager: their department only, offered in the navigation', { tag: [TAG.role('manager')] }, async ({ signInAs, page, app }) => {
    await signInAs('manager');
    await app.go('nav-summary', 'Summary');
    const api = await summaryApi(page);
    expect(api.scope.level).toBe('department');
    await expect(page.getByTestId('summary-scope')).toHaveText(api.scope.label);
    expect(api.scope.label).toContain(DEMO.managerDepartment.name);
    expect(api.teams.every((t: { departmentName: string }) => t.departmentName === DEMO.managerDepartment.name)).toBe(true);
    await expectNoHorizontalScroll(page);
  });

  test('SUMUI-03 software engineer: not in the navigation, but the link opens their own team; no money roll-up', { tag: [TAG.role('engineer')] }, async ({ signInAs, page, app }) => {
    await signInAs('engineer');
    expect(await app.navItems()).not.toContain('nav-summary');
    await app.closeNav();
    await page.goto('/summary');
    await expect(page.getByTestId('summary-scope')).toHaveText(DEMO.engineerTeam.name);
    await expect(page.getByTestId('summary-money')).toContainText('shown to super admins and managers');
    await expect(page.getByTestId('summary-money-tile')).toContainText('Managers and admins');
    const api = await summaryApi(page);
    expect(api.teams.map((t: { teamId: string }) => t.teamId)).toEqual([DEMO.engineerTeam.id]);
  });

  test('SUMUI-04 offline: the last summary stays with the time it was loaded, also after a reload; it comes back online on its own', { tag: [TAG.negative, TAG.role('lead')] }, async ({ signInAs, page }) => {
    await signInAs('lead', '/summary');
    const score = await page.getByTestId('summary-qa-score').textContent();
    await expect(page.getByTestId('summary-loaded')).toContainText('Loaded today');
    await page.route(`${API_URL}/summary`, (r) => r.abort('internetdisconnected'));
    await page.getByTestId('summary-refresh').click();
    await expect(page.getByTestId('summary-loaded')).toContainText('Offline · showing the summary loaded today');
    await expect(page.getByTestId('summary-qa-score')).toHaveText(score!);
    await page.reload();
    await expect(page.getByTestId('summary-loaded')).toContainText('Offline');
    await expect(page.getByTestId('summary-qa-score')).toHaveText(score!);
    await page.unroute(`${API_URL}/summary`);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByTestId('summary-loaded')).toContainText('Loaded today');
  });

  test('SUMUI-05 a server error with no copy yet says so, and Reload recovers', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await page.route(`${API_URL}/summary`, (r) => r.fulfill({ status: 500, json: { error: 'Internal server error' } }));
    await signInAs('viewer');
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('irongate_summary_cache:')) localStorage.removeItem(k); });
    await page.goto('/summary');
    await expect(page.getByTestId('summary-unavailable')).toContainText('could not be loaded');
    await page.unroute(`${API_URL}/summary`);
    await page.getByTestId('summary-refresh').click();
    await expect(page.getByTestId('summary-quality')).toBeVisible();
  });

  test('SUMUI-06 the share button copies the summary link', { tag: [TAG.role('admin')] }, async ({ signInAs, page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signInAs('admin', '/summary');
    await page.getByTestId('summary-share').click();
    await expect(page.getByText('Summary link copied')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/summary$/);
  });
});

test.describe('Executive summary on a desktop', { tag: [TAG.area('summary')] }, () => {
  test('SUMUI-10 money at risk shows the roll-up range; its assumptions link opens Business impact on "All teams"', { tag: [TAG.role('admin')] }, async ({ signInAs, page, app }) => {
    await signInAs('admin', '/summary');
    const api = await summaryApi(page);
    expect(api.money.available).toBe(true);
    if (api.money.stake.monthlyLow !== null) await expect(page.getByTestId('summary-money-range')).toContainText(' to ');
    await page.getByTestId('summary-money-assumptions').click();
    await expect(app.title).toHaveText('Business impact');
    await expect(page).toHaveURL(/\/analytics\/business-impact\?tab=all-teams/);
  });

  test('SUMUI-11 the score follows the Battery / Gauge choice', async ({ signInAs, page, app }) => {
    await signInAs('manager', '/summary');
    await app.setScoreDisplay('Gauge');
    await expect(page.getByTestId('summary-quality').getByTestId('score-gauge')).toBeVisible();
    await app.setScoreDisplay('Battery');
    await expect(page.getByTestId('summary-quality').getByTestId('score-gauge')).toHaveCount(0);
  });

  test('SUMUI-12 a risk with more than two KPIs off target expands and collapses', async ({ signInAs, page }) => {
    await signInAs('admin', '/summary');
    const api = await summaryApi(page);
    const idx = api.risks.top.findIndex((r: { items: { key: string }[] }) => r.items.filter((i) => i.key !== 'qaScore').length > 2);
    test.skip(idx < 0, 'no risk with more than two KPIs off target in this data');
    const card = page.getByTestId('summary-risk').nth(idx);
    await expect(card.getByTestId('summary-risk-item')).toHaveCount(2);
    await card.getByRole('button', { name: /more off target/ }).click();
    await expect(card.getByTestId('summary-risk-item')).toHaveCount(api.risks.top[idx].items.filter((i: { key: string }) => i.key !== 'qaScore').length);
    await card.getByRole('button', { name: 'Show less' }).click();
    await expect(card.getByTestId('summary-risk-item')).toHaveCount(2);
  });
});

test.describe('Executive summary accessibility', { tag: [TAG.a11y, TAG.area('summary')] }, () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const cases = [
    { id: 'A11Y-30', theme: 'Light', display: 'Battery' },
    { id: 'A11Y-31', theme: 'Dark', display: 'Gauge' },
    { id: 'A11Y-32', theme: 'Graphite', display: 'Battery' },
    { id: 'A11Y-33', theme: 'Porcelain', display: 'Gauge' },
  ] as const;
  for (const c of cases) {
    test(`${c.id} ${c.theme} theme (${c.display}): the phone summary has no serious violations`, async ({ signInAs, page, app }, testInfo) => {
      await signInAs('admin', '/summary');
      await app.setTheme(c.theme);
      await app.setScoreDisplay(c.display);
      await expect(page.getByTestId('summary-quality')).toBeVisible();
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await checkA11y(page, testInfo, { known: [] });
      await page.evaluate(() => { localStorage.removeItem('irongate_theme_mode'); localStorage.removeItem('irongate_score_display'); });
    });
  }
});
