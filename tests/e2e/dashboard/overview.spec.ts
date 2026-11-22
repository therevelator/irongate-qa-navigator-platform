import { test, expect, TAG } from '../support/fixtures';
import { ALL_ROLES, DEMO, type Role } from '../support/roles';
import { API_URL } from '../support/env';
import type { Page } from '@playwright/test';

/**
 * Overview (src/components/NewDashboard.tsx, KpiStatusModal.tsx): company status, KPI tiles,
 * "Teams vs KPI targets", team grid with filters, search, department, sort, layout and cards per
 * row, opening a team, the executive briefing (AI: stubbed, real Groq is not called in CI), and
 * what happens when the summary or the team list cannot be loaded.
 */

const cards = (page: Page) => page.getByTestId('team-card');
const names = (page: Page) => page.getByTestId('team-name').allInnerTexts();
const BRIEFING_ROLES: Role[] = ['admin', 'manager', 'lead'];

test.describe('Overview', { tag: [TAG.area('dashboard')] }, () => {
  for (const role of ALL_ROLES) {
    test(`DASH-01 ${role} sees the company status and every team of the company`, { tag: [TAG.smoke, TAG.role(role)] }, async ({ signInAs, page }) => {
      await signInAs(role);
      await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible();
      await expect(cards(page).first()).toBeVisible();
      await expect(page.getByText('Teams vs KPI targets').first()).toBeVisible();
      const briefing = page.getByRole('button', { name: 'Executive briefing' });
      if (BRIEFING_ROLES.includes(role)) await expect(briefing).toBeVisible();
      else await expect(briefing).toHaveCount(0);
    });
  }

  test('DASH-02 the status filters show the counted teams', async ({ signInAs, page }) => {
    await signInAs('manager');
    await expect(cards(page).first()).toBeVisible();
    for (const label of ['High performing', 'Needs attention', 'All']) {
      const button = page.getByRole('button', { name: new RegExp(`^${label} \\d+$`) });
      const count = Number((await button.innerText()).match(/(\d+)$/)![1]);
      await button.click();
      if (count === 0) await expect(page.getByText('No teams match')).toBeVisible();
      else await expect(cards(page)).toHaveCount(count);
    }
  });

  test('DASH-02b Needs attention holds exactly the teams below their QA target; a KPI off target alone does not count', async ({ signInAs, page }) => {
    await signInAs('admin');
    await expect(cards(page).first()).toBeVisible();
    const filter = async (label: string) => {
      const button = page.getByRole('button', { name: new RegExp(`^${label} \\d+$`) });
      await button.click();
      return Number((await button.innerText()).match(/(\d+)$/)![1]);
    };
    const read = async () => {
      const out: { qa: number; target: number }[] = [];
      for (const card of await cards(page).all()) {
        const qa = Number(await card.getByTestId('team-card-qa').innerText().then((t) => t.match(/^\d+/)?.[0]));
        const target = Number((await card.getByTestId('team-card-qa-target').innerText()).match(/(\d+)/)![1]);
        out.push({ qa, target });
      }
      return out;
    };
    const all = await filter('All');
    const attention = await filter('Needs attention');
    for (const c of attention ? await read() : []) expect(c.qa).toBeLessThan(c.target);
    const high = await filter('High performing');
    const highCards = high ? await read() : [];
    for (const c of highCards) expect(c.qa).toBeGreaterThanOrEqual(c.target);
    // Every team with a QA score is in exactly one of the two filters.
    await filter('All');
    const scored = (await cards(page).getByTestId('team-card-qa').allInnerTexts()).filter((t) => /^\d/.test(t)).length;
    expect(high + attention).toBe(scored);
    expect(scored).toBeLessThanOrEqual(all);
  });

  test('DASH-03 search narrows the list; no match says so; markup typed in is only text', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs('viewer');
    let dialogs = 0;
    page.on('dialog', (d) => { dialogs++; return d.dismiss(); });
    await page.getByLabel('Search teams').fill(DEMO.leadTeam.name);
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByTestId('team-name')).toHaveText(DEMO.leadTeam.name);
    await page.getByLabel('Search teams').fill('<img src=x onerror=alert(1)>');
    await expect(page.getByText('No teams match')).toBeVisible();
    await page.getByLabel('Search teams').fill('');
    await expect(cards(page).first()).toBeVisible();
    expect(dialogs).toBe(0);
  });

  test('DASH-04 department filter and sorting by name both ways', async ({ signInAs, page }) => {
    await signInAs('admin');
    await page.getByLabel('Department').selectOption(DEMO.otherTeam.department);
    await expect(cards(page).first()).toBeVisible();
    for (const card of await cards(page).all()) await expect(card).toContainText(DEMO.otherTeam.department);
    await page.getByLabel('Department').selectOption('all');
    await page.getByLabel('Sort teams by').selectOption('name');
    const asc = await names(page);
    expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b)));
    await page.getByRole('button', { name: /Sorted ascending/ }).click();
    await expect.poll(() => names(page)).toEqual([...asc].reverse());
  });

  test('DASH-05 grid or list and cards per row are remembered after a reload', async ({ signInAs, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInAs('lead');
    await page.getByTestId('grid-columns-3').click();
    await expect(page.locator('[data-columns="3"]')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('grid-columns-3')).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(page.getByTestId('grid-columns')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Grid', exact: true }).click();
    await page.getByTestId('grid-columns-1').click();
  });

  test('DASH-06 "Teams vs KPI targets" opens the breakdown; tabs switch; a team opens from it; Escape closes', { tag: [TAG.smoke] }, async ({ signInAs, page }) => {
    await signInAs('admin');
    await page.getByTestId('kpi-status-open').click();
    const modal = page.getByTestId('kpi-status-modal');
    await expect(modal).toBeVisible();
    for (const tab of ['onTrack', 'atRisk', 'offTrack']) {
      await page.getByTestId(`kpi-tab-${tab}`).click();
      await expect(page.getByTestId(`kpi-tab-${tab}`)).toHaveAttribute('aria-pressed', 'true');
    }
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await page.getByTestId('kpi-status-offTrack').click();
    const first = page.getByTestId('kpi-status-team').first();
    if (await first.count()) {
      const name = (await first.getByRole('button').first().innerText()).trim();
      await first.getByRole('button').first().click();
      await expect(page.getByTestId('team-detail')).toBeVisible();
      await expect(page.getByRole('heading', { name })).toBeVisible();
    }
  });

  test('DASH-07 a team card opens the team; "Back" returns to the overview', { tag: [TAG.smoke] }, async ({ signInAs, page }) => {
    await signInAs('engineer');
    await cards(page).filter({ hasText: DEMO.engineerTeam.name }).click();
    await expect(page.getByTestId('team-detail')).toBeVisible();
    await page.getByTestId('back-to-dashboard').click();
    await expect(page.getByTestId('dashboard')).toBeVisible();
  });

  test('DASH-11 a company with sample data shows the "Includes sample data" banner; a new one without data does not', async ({ freshCompany, signInAs, page, app }) => {
    await signInAs({ email: 'alex.morgan@northwind.example', password: 'demo123' });
    await expect(page.getByTestId('sample-data-banner')).toBeVisible();
    await app.signOut();
    await signInAs(freshCompany);
    await expect(page.getByTestId('team-card').first()).toBeVisible();
    await expect(page.getByTestId('sample-data-banner')).toHaveCount(0);
  });

  test('DASH-08 a missing company summary does not hide the teams', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await page.route(`${API_URL}/analytics/company-summary`, (r) => r.fulfill({ status: 500, json: { error: 'Internal server error', requestId: 'rid-dash' } }));
    await signInAs('admin');
    await expect(page.getByText('Company summary unavailable')).toBeVisible();
    await expect(cards(page).first()).toBeVisible();
  });

  test('DASH-09 a failed team list says so instead of "No teams match"', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await page.route(`${API_URL}/teams`, (r) => r.fulfill({ status: 500, json: { error: 'Internal server error', requestId: 'rid-teams-500' } }));
    await signInAs('viewer');
    await expect(page.getByTestId('load-error')).toHaveText('Could not load the teams: the server had a problem. Try again in a moment. Reference: rid-teams-500.');
    await expect(page.getByText('No teams match')).toHaveCount(0);
  });

  test('DASH-10 the overview survives an offline network with a message', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await page.route(`${API_URL}/teams`, (r) => r.abort('internetdisconnected'));
    await signInAs('viewer');
    await expect(page.getByTestId('load-error')).toContainText('the server could not be reached');
  });
});

test.describe('Executive briefing', { tag: [TAG.area('dashboard'), TAG.area('ai')] }, () => {
  test('BRIEF-01 the briefing shows the generated summary, labelled as AI (stubbed AI service)', { tag: [TAG.role('manager')] }, async ({ signInAs, page }) => {
    await page.route(`${API_URL}/analytics/company-insights`, (r) => r.fulfill({
      json: { analysis: '## Executive summary\n**Biggest risk:** flaky tests in Payments.\n1. Fix the flaky suite\n- Keep coverage above 80 %\n<script>window.__xss = 1</script>' },
    }));
    await signInAs('manager');
    await page.getByRole('button', { name: 'Executive briefing' }).click();
    const drawer = page.getByRole('dialog', { name: 'Executive briefing' });
    await expect(drawer.getByRole('heading', { name: 'Executive summary' })).toBeVisible();
    await expect(drawer.getByText('Fix the flaky suite')).toBeVisible();
    await expect(drawer.getByText('AI-generated summary.', { exact: false })).toBeVisible();
    await expect(drawer.getByText('<script>window.__xss = 1</script>')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });

  test('BRIEF-02 without the AI service (or on an error) the briefing says it cannot be generated', { tag: [TAG.negative, TAG.role('lead')] }, async ({ signInAs, page }) => {
    await page.route(`${API_URL}/analytics/company-insights`, (r) => r.fulfill({ status: 503, json: { error: 'AI is not configured' } }));
    await signInAs('lead');
    await page.getByRole('button', { name: 'Executive briefing' }).click();
    await expect(page.getByText('The briefing could not be generated right now. Please try again later.')).toBeVisible();
    await page.getByRole('dialog', { name: 'Executive briefing' }).getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog', { name: 'Executive briefing' })).toBeHidden();
  });

  test('BRIEF-03 an engineer cannot request the briefing even through the API', { tag: [TAG.negative, TAG.role('engineer')] }, async ({ signInAs, page }) => {
    await signInAs('engineer');
    const res = await page.request.post(`${API_URL}/analytics/company-insights`);
    expect([401, 403]).toContain(res.status());
  });
});
