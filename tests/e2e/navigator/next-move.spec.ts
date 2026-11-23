import { test, expect } from '@playwright/test';
import { setupAuth } from '../fixtures/auth';

/**
 * The "next move" pages: Time lost (/time-lost), Findings (/findings), Outcomes (/outcomes), Data readiness
 * (/data-readiness). Read-only here: nothing is assigned, so the demo company is left as it was.
 *
 *   NM-01  Time lost: the hours of the last week, the five causes with their change, the teams with their one thing
 *   NM-02  Findings: ranked by hours; a finding opens to its evidence, the owner form and the ticket text; one team
 *          shows its one thing this week
 *   NM-03  Outcomes: five columns, the last two decided by the KPI; the period selector
 *   NM-04  Data readiness: every team of the scope with its sources; the rule is stated
 *   NM-05  a viewer opens the pages for their own teams and is not offered the owner form
 *   NM-06  no sideways scrolling on a phone
 */
const API = 'http://localhost:3000/api';

test.describe('Next move pages', { tag: ['@area:next-move'] }, () => {
  test.describe.configure({ mode: 'default' });
  test.setTimeout(90_000);

  test('NM-01 Time lost: hours, causes and teams @role:admin @smoke', async ({ page }) => {
    await setupAuth(page, 'super_admin');
    await page.goto('/time-lost');
    const hero = page.getByTestId('time-lost-hero');
    await expect(hero).toBeVisible({ timeout: 45_000 });
    const status = await (await page.request.get(`${API}/navigator/status`)).json();
    await expect(page.getByTestId('time-lost-now')).toHaveText(String(Math.round(status.hoursNow * 10) / 10));
    // Five causes and the total.
    await expect(page.getByTestId('time-lost-causes').locator('tbody tr')).toHaveCount(6);
    await expect(page.getByTestId('time-lost-team')).toHaveCount(status.teams.length);
    await expect(page.getByTestId('time-lost-team').first()).toContainText('This week');
    // The page explains itself.
    await page.getByTestId('about-page').locator('summary').click();
    await expect(page.getByTestId('about-page')).toContainText('Where the numbers come from');
    await page.getByTestId('time-lost-findings').click();
    await expect(page).toHaveURL(/\/findings$/);
  });

  test('NM-02 Findings: evidence, owner form and ticket text @role:admin', async ({ page }) => {
    await setupAuth(page, 'super_admin');
    await page.goto('/findings');
    const cards = page.getByTestId('finding');
    await expect(cards.first()).toBeVisible({ timeout: 45_000 });
    const data = await (await page.request.get(`${API}/navigator/findings`)).json();
    await expect(cards).toHaveCount(data.findings.length);
    await expect(cards.first().getByTestId('finding-title')).toHaveText(data.findings[0].title);
    // Ranked by hours: the first has the most.
    const hours = data.findings.map((f: any) => f.hours ?? -1);
    expect([...hours].sort((a, b) => b - a)).toEqual(hours);
    await cards.first().locator('button').first().click();
    const detail = cards.first().getByTestId('finding-detail');
    await expect(detail).toContainText('Evidence');
    await expect(detail).toContainText('Suggested next step');
    await expect(detail.getByTestId('finding-copy')).toBeVisible();
    if (!data.findings[0].action) await expect(detail.getByTestId('finding-assign-save')).toBeVisible();
    // One team: its one thing this week, as a thread from the finding to the verdict.
    await page.getByTestId('findings-team').selectOption(data.findings[0].teamId);
    const one = page.getByTestId('one-thing');
    await expect(one).toContainText('The one thing this week');
    for (const step of ['Finding', 'Evidence', 'Next step', 'Owner', 'Verdict']) await expect(one).toContainText(step);
    await expect(cards).toHaveCount(data.findings.filter((f: any) => f.teamId === data.findings[0].teamId).length);
  });

  test('NM-03 Outcomes: from suggested to verified @role:admin', async ({ page }) => {
    await setupAuth(page, 'super_admin');
    await page.goto('/outcomes');
    await expect(page.getByTestId('outcomes-board')).toBeVisible({ timeout: 45_000 });
    const data = await (await page.request.get(`${API}/navigator/outcomes`)).json();
    for (const [id, list] of [['owned', data.owned], ['waiting', data.waiting], ['verified', data.verified], ['not-held', data.notHeld]] as const) {
      await expect(page.getByTestId(`outcomes-${id}`).getByTestId('outcome-action')).toHaveCount(list.length);
    }
    await expect(page.getByTestId('outcomes-suggested')).toContainText(String(data.suggested.length));
    await expect(page.getByTestId('outcomes-print')).toBeVisible();
    await page.getByTestId('outcomes-month').selectOption({ index: 1 });
    await expect(page.getByTestId('outcomes-board')).toBeVisible();
  });

  test('NM-04 Data readiness: teams, sources and the rule @role:admin', async ({ page }) => {
    await setupAuth(page, 'super_admin');
    await page.goto('/data-readiness');
    await expect(page.getByTestId('readiness-matrix')).toBeVisible({ timeout: 45_000 });
    const data = await (await page.request.get(`${API}/navigator/readiness`)).json();
    await expect(page.getByTestId('readiness-team')).toHaveCount(data.teams.length);
    await expect(page.getByTestId('readiness-matrix').locator('thead th')).toHaveCount(data.sources.length + 2);
    await expect(page.getByTestId('readiness-exporter')).toBeVisible();
    await page.getByTestId('about-page').locator('summary').click();
    await expect(page.getByTestId('about-page')).toContainText('A source is connected when');
  });

  test('NM-05 a viewer sees their own teams and cannot assign @role:viewer', async ({ page }) => {
    await setupAuth(page, 'viewer');
    await page.goto('/time-lost');
    await expect(page.getByTestId('about-page')).toBeVisible({ timeout: 45_000 });
    const scope = await (await page.request.get(`${API}/analytics/scope`)).json();
    const status = await (await page.request.get(`${API}/navigator/status`)).json();
    expect(status.teams.map((t: any) => t.id).sort()).toEqual(scope.teams.map((t: any) => String(t.id)).sort());
    await page.goto('/findings');
    const cards = page.getByTestId('finding');
    if (await cards.count()) {
      await cards.first().locator('button').first().click();
      await expect(page.getByTestId('finding-assign-save')).toHaveCount(0);
    }
  });

  test('NM-06 no sideways scrolling on a phone @role:admin', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await setupAuth(page, 'super_admin');
    for (const path of ['/time-lost', '/findings', '/outcomes', '/data-readiness']) {
      await page.goto(path);
      await expect(page.getByTestId('about-page')).toBeVisible({ timeout: 45_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), path).toBeLessThanOrEqual(1);
    }
  });
});
