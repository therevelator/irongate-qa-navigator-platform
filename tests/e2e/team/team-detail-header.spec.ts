import { test, expect, TAG } from '../support/fixtures';
import { DEMO } from '../support/roles';
import { API_URL } from '../support/env';
import type { Page } from '@playwright/test';

/**
 * Team detail header (src/components/TeamDetailView.tsx QaScoreCard): the 3D battery (horizontal,
 * animated liquid, still with reduced motion, colour band by value: src/lib/batteryScale.ts), the
 * QA score with status and target, the 30-day change, the 30 / 90 day trend, rank, the input that
 * costs the score most, people; targets next to every KPI status (src/lib/targetText.ts) on Team
 * detail, the overview cards and Compare.
 */

const BAND = (v: number) => (v < 30 ? 'red' : v < 45 ? 'deepAmber' : v < 60 ? 'amber' : v < 75 ? 'yellow' : v < 90 ? 'lightGreen' : 'green');

async function openTeam(page: Page, name: string) {
  await page.getByLabel('Search teams').fill(name);
  await page.getByTestId('team-card').filter({ hasText: name }).first().click();
  await expect(page.getByTestId('team-qa-card')).toBeVisible();
}

test.describe('Team detail header', { tag: [TAG.area('team')] }, () => {
  test('TDH-01 viewer: QA card with battery band, target, change, trend toggle and people', { tag: [TAG.role('viewer'), TAG.smoke] }, async ({ signInAs, page }) => {
    await signInAs('viewer');
    await openTeam(page, DEMO.leadTeam.name);
    const card = page.getByTestId('team-qa-card');
    const scoreText = (await page.getByTestId('team-qa-score').innerText()).replace('/100', '').trim();
    const battery = card.getByRole('img', { name: /^QA score:/ });
    if (scoreText === '—') {
      await expect(battery).toHaveAttribute('data-battery-band', 'none');
    } else {
      await expect(battery).toHaveAttribute('data-battery-band', BAND(Number(scoreText)));
      await expect(card.getByTestId('battery-liquid')).toHaveCount(1);
      await expect(page.getByTestId('team-qa-target')).toContainText('Target ≥');
    }
    await expect(page.getByTestId('team-qa-change')).toBeVisible();
    await expect(page.getByTestId('team-qa-trend-30')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('team-qa-trend-90').click();
    await expect(page.getByTestId('team-qa-trend-90')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('team-qa-people')).toContainText(/\d+ (person|people)/);
    // One team in the viewer's scope: no rank.
    await expect(page.getByTestId('team-qa-rank')).toHaveCount(0);
  });

  test('TDH-02 super admin: rank among the company\'s teams', { tag: [TAG.role('admin')] }, async ({ signInAs, page }) => {
    await signInAs('admin');
    await openTeam(page, DEMO.leadTeam.name);
    await expect(page.getByTestId('team-qa-rank')).toContainText(/\d+ of \d+ teams in the company/);
  });

  test('TDH-03 every headline KPI says its target next to its status', { tag: [TAG.role('lead')] }, async ({ signInAs, page }) => {
    await signInAs('lead');
    await openTeam(page, DEMO.leadTeam.name);
    const captions = page.getByTestId('team-headline-kpis').locator('[data-testid^="kpi-headline-target-"]');
    const n = await captions.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      await expect(captions.nth(i)).toHaveText(/^(On target · Target [≥≤] |Off target · Target [≥≤] |Watch: [\d.]+–[\d.]+%? · Target [≥≤] )/);
    }
  });

  test('TDH-04 reduced motion: the battery liquid does not move', { tag: [TAG.role('viewer')] }, async ({ signInAs, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAs('viewer');
    await openTeam(page, DEMO.leadTeam.name);
    const wave = page.getByTestId('battery-liquid').locator('svg');
    if (await wave.count()) expect(await wave.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    if (await wave.count()) expect(await wave.evaluate((el) => getComputedStyle(el).animationName)).not.toBe('none');
  });

  test('TDH-05 overview cards and the hero show the targets', { tag: [TAG.role('admin')] }, async ({ signInAs, page }) => {
    await signInAs('admin');
    await expect(page.getByTestId('team-card').first()).toBeVisible();
    await expect(page.getByTestId('team-card-target').first()).toHaveText(/^Target [≥≤] /);
    await expect(page.getByTestId('team-card-qa-target').first()).toHaveText(/^Target ≥ \d+/);
    await expect(page.getByTestId('global-qa-target')).toContainText('Target ≥');
    await expect(page.getByTestId('gauge-target').first()).toContainText('Target ≥');
    // Every battery uses the one colour scale.
    const bands = await page.locator('[data-battery-band]').evaluateAll((els) => els.map((e) => e.getAttribute('data-battery-band')));
    expect(bands.length).toBeGreaterThan(1);
    for (const b of bands) expect(['red', 'deepAmber', 'amber', 'yellow', 'lightGreen', 'green', 'none']).toContain(b);
  });

  test('TDH-06 Compare says status and target under each value', { tag: [TAG.role('admin'), TAG.area('compare')] }, async ({ signInAs, page }) => {
    await signInAs('admin', `/compare?teams=${DEMO.leadTeam.id},${DEMO.engineerTeam.id}`);
    await expect(page.getByTestId('compare-target').first()).toHaveText(/(On target|Off target|Watch: [\d.]+–[\d.]+%?) · Target [≥≤] /);
  });

  test('TDH-07 phone: the QA card fits without sideways scrolling', { tag: [TAG.role('viewer')] }, async ({ signInAs, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs('viewer');
    await openTeam(page, DEMO.leadTeam.name);
    const box = await page.getByTestId('team-qa-card').boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.getElementById('main-scroll')!.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await page.request.get(`${API_URL}/teams/${DEMO.leadTeam.id}`)).status()).toBe(200);
  });
});
