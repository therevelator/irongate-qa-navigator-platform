import { test, expect } from '@playwright/test';
import fs from 'fs';
import { setupAuth } from './fixtures/auth';

/**
 * Phase 3B UI: Compare teams, saved views (quick switcher round trip), CSV export downloads
 * and the onboarding checklist on the dashboard.
 */
const APP = 'http://localhost:5173';
const API = 'http://localhost:3000';

test.describe('Compare teams, saved views, CSV export, onboarding', { tag: ['@area:compare', '@area:saved-views', '@area:onboarding'] }, () => {
  // Written for one worker: these tests run in order, in one worker (a failure does not skip the rest).
  test.describe.configure({ mode: 'default' });
  test.setTimeout(90000);

  test('Compare teams: open from the navigation, add a team, differences are highlighted', async ({ page }) => {
    await setupAuth(page, 'super_admin');
    await page.click('[data-testid="nav-toggle"]');
    await page.click('[data-testid="nav-compare"]');
    await expect(page.locator('[data-testid="compare-teams"]')).toBeVisible();
    // Starts with two teams of the scope.
    await expect(page.locator('[data-testid="compare-chip"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="compare-team-card"]')).toHaveCount(2);
    const add = page.locator('[data-testid="compare-add"]');
    const option = await add.locator('option').nth(1).getAttribute('value');
    await add.selectOption(option!);
    await expect(page.locator('[data-testid="compare-team-card"]')).toHaveCount(3);
    await expect(page.locator('[data-testid="compare-table"]')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('teams')?.split(',').length).toBe(3);
    const rows = page.locator('[data-testid="compare-row"]');
    expect(await rows.count()).toBeGreaterThan(10);
    // "Only rows that differ" keeps the highlighted rows only.
    await page.check('[data-testid="compare-only-diff"]');
    const left = page.locator('[data-testid="compare-row"]');
    expect(await left.count()).toBe(await page.locator('[data-testid="compare-row"][data-differs="true"]').count());
  });

  test('Compare teams: an engineer only gets teams of their own scope', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');
    const scope = await (await page.request.get(`${API}/api/analytics/scope`)).json();
    await page.goto(`${APP}/compare`);
    await expect(page.locator('[data-testid="compare-teams"]')).toBeVisible();
    if ((scope.teams ?? []).length < 2) {
      await expect(page.getByText('Not enough teams to compare')).toBeVisible();
    } else {
      for (const chip of await page.locator('[data-testid="compare-chip"]').allTextContents()) {
        expect(scope.teams.some((t: any) => chip.includes(t.name.slice(0, 10)))).toBe(true);
      }
    }
    // The API refuses a comparison with a team outside the scope.
    const res = await page.request.get(`${API}/api/compare/teams?ids=${scope.teams?.[0]?.id},no-such-team`);
    expect(res.status()).toBe(403);
  });

  test('Saved view round trip on the dashboard', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');
    const name = `E2E view ${Date.now()}`;
    await page.getByRole('button', { name: /^Needs attention/ }).click();
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await page.click('[data-testid="saved-views-toggle"]');
    await page.click('[data-testid="saved-view-new"]');
    await page.fill('[data-testid="saved-view-name"]', name);
    await page.click('[data-testid="saved-view-save"]');
    await expect(page.locator('[data-testid="saved-views-toggle"]')).toContainText(name);

    // Change the choices: the switcher no longer shows the view as active.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^All \d+/ }).click();
    await page.getByRole('button', { name: 'Grid', exact: true }).click();
    await expect(page.locator('[data-testid="saved-views-toggle"]')).not.toContainText(name);

    // Apply the view again.
    await page.click('[data-testid="saved-views-toggle"]');
    await page.locator('[data-testid="saved-view-item"]', { hasText: name }).locator('[data-testid="saved-view-apply"]').click();
    await expect(page.locator('[data-testid="saved-views-toggle"]')).toContainText(name);
    await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');

    // Delete it.
    page.once('dialog', (d) => d.accept());
    await page.click('[data-testid="saved-views-toggle"]');
    await page.locator('[data-testid="saved-view-item"]', { hasText: name }).locator('[data-testid="saved-view-delete"]').click();
    await expect(page.locator('[data-testid="saved-view-item"]', { hasText: name })).toHaveCount(0);
  });

  test('CSV download from the dashboard and the comparison', async ({ page }) => {
    await setupAuth(page, 'super_admin');
    const [dash] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid="dashboard-export"]')]);
    expect(dash.suggestedFilename()).toMatch(/^irongate-team-performance-\d{4}-\d{2}-\d{2}\.csv$/);
    const dashText = fs.readFileSync((await dash.path())!, 'utf8').replace(/^﻿/, '');
    expect(dashText.split('\r\n')[0]).toContain('Team,Department,QA score,QA score (raw)');

    await page.goto(`${APP}/compare`);
    await expect(page.locator('[data-testid="compare-team-card"]')).toHaveCount(2);
    const [cmp] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid="compare-export"]')]);
    expect(cmp.suggestedFilename()).toMatch(/^irongate-team-comparison-.*\.csv$/);
    const lines = fs.readFileSync((await cmp.path())!, 'utf8').replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0].startsWith('Team,Department,Group,Metric,Value,Value (raw)')).toBe(true);
    expect(lines.length).toBeGreaterThan(20);
    expect(lines.join('\n')).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  test('Onboarding checklist: progress from the real state, hide and show again', async ({ page }) => {
    await setupAuth(page, 'super_admin');
    const status = await (await page.request.get(`${API}/api/onboarding`)).json();
    test.skip(!status.show, 'Onboarding already complete or hidden for this organisation');
    const card = page.locator('[data-testid="onboarding-checklist"]');
    await expect(card).toBeVisible();
    await expect(page.locator('[data-testid="onboarding-progress"]')).toHaveText(`${status.completed} of ${status.total} steps done`);
    for (const s of status.steps) await expect(page.locator(`[data-testid="onboarding-step-${s.key}"]`)).toHaveAttribute('data-done', String(s.done));
    try {
      await page.click('[data-testid="onboarding-dismiss"]');
      await expect(card).toHaveCount(0);
      await page.reload();
      await expect(page.locator('[data-testid="dashboard"]')).toBeVisible();
      await expect(page.locator('[data-testid="onboarding-checklist"]')).toHaveCount(0);
    } finally {
      await page.request.post(`${API}/api/onboarding/restore`);
    }
    await page.reload();
    await expect(page.locator('[data-testid="onboarding-checklist"]')).toBeVisible();
    // Other roles never see it.
  });

  test('Onboarding checklist is not shown to a QA manager', async ({ page }) => {
    await setupAuth(page, 'qa_manager');
    await expect(page.locator('[data-testid="team-card"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="onboarding-checklist"]')).toHaveCount(0);
  });
});
