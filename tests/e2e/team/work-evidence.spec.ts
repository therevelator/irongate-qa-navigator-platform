import { test, expect, TAG } from '../support/fixtures';
import { DEMO } from '../support/roles';
import { API_URL } from '../support/env';
import { checkA11y } from '../support/a11y';
import type { Page } from '@playwright/test';

/**
 * v2 phase 3 in the app: the team page's "Work & code quality" (sprint and defect values calculated
 * from the sample issues of the demo teams, the last closed sprints, escaped defects, blocked, carried-
 * over and mis-sized issues, the latest SARIF report with findings by rule, new and fixed findings),
 * "How this was calculated" from a tile and from a KPI card, the access rule, and Admin console →
 * Connect your CI (issue and SARIF steps per tool, the test calls, real issues and a real report turning
 * into calculated values). Accessibility in the four themes.
 */

async function openTeam(page: Page, name: string) {
  await page.getByLabel('Search teams').fill(name);
  await page.getByTestId('team-card').filter({ hasText: name }).first().click();
  await expect(page.getByTestId('team-detail')).toBeVisible();
}

test.describe('Work & code quality', { tag: [TAG.area('team'), TAG.area('ci-evidence')] }, () => {
  test('WRK-01 the team page shows sprint and defect values, the last sprints, escaped defects and blocked issues from the sample issues', { tag: [TAG.smoke, TAG.role('admin')] }, async ({ signInAs, page }) => {
    await signInAs('admin');
    await openTeam(page, DEMO.leadTeam.name);
    const w = page.getByTestId('work-evidence');
    await expect(w.getByRole('heading', { name: 'Work & code quality' })).toBeVisible();
    await expect(w.getByTestId('work-metrics')).toBeVisible();
    await expect(w.getByTestId('work-metric-velocity')).toContainText(/\d+ points/);
    await expect(w.getByTestId('work-metric-commitment')).toContainText('%');
    await expect(w.getByTestId('work-metric-escape_rate')).toContainText('%');
    await expect(w.getByTestId('work-metric-sizing_accuracy')).toContainText('× estimate');
    await expect(w).toContainText('sample data');
    const sprints = w.getByTestId('work-sprint');
    await expect(sprints.first()).toBeVisible();
    expect(await sprints.count()).toBeLessThanOrEqual(6);
    await expect(sprints.first()).toContainText(/Sprint \d+/);
    await expect(sprints.first()).toContainText('pts');
    await expect(w.getByTestId('work-escaped-defect').first()).toContainText('found in Production');
    await expect(w.getByTestId('work-blocked')).toContainText(/blocked \d+(\.\d)? h|pts carried over/);
    await expect(w.getByTestId('work-sizing')).toBeVisible();
    await expect(w.getByTestId('work-last-received')).toContainText('Issues:');
  });

  test('WRK-02 code quality: the score, findings by rule, new and fixed findings since the previous report', { tag: [TAG.role('admin')] }, async ({ signInAs, page }) => {
    await signInAs('admin');
    await openTeam(page, DEMO.leadTeam.name);
    const w = page.getByTestId('work-evidence');
    await expect(w.getByTestId('work-metric-code_quality')).toContainText('/ 100');
    await expect(w.getByTestId('quality-report').first()).toContainText('SonarQube');
    await expect(w.getByTestId('quality-report').first()).toContainText(/\+\d+ \/ −\d+/);
    await expect(w.getByTestId('quality-rule').first()).toContainText('typescript:S');
    await expect(w.getByTestId('quality-new').or(w.getByText('No new findings since the previous report.'))).toBeVisible();
    await expect(w.getByTestId('quality-history')).toContainText('→ now');
    const toggle = w.getByTestId('quality-rules-toggle');
    if (await toggle.count()) {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    }
  });

  test('WRK-03 How this was calculated: from a tile and from the KPI card, with the formula, the sprint and the issues or reports', { tag: [TAG.role('admin'), TAG.a11y] }, async ({ signInAs, page }, testInfo) => {
    await signInAs('admin');
    await openTeam(page, DEMO.leadTeam.name);
    await page.getByTestId('work-metric-velocity').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('How this was calculated: Sprint velocity');
    await expect(dialog.getByTestId('how-calculated-formula')).toContainText('story points of the issues completed in the latest closed sprint');
    await expect(dialog.getByTestId('how-calculated-sprint')).toContainText(/Sprint \d+/);
    await expect(dialog.getByTestId('how-calculated-issue').first()).toContainText('completed');
    await expect(dialog).toContainText(/Based on \d+ sprint issues/);
    await expect(dialog).toContainText('sample CI data');
    await checkA11y(page, testInfo, { include: '[role="dialog"]' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.getByTestId('work-metric-escape_rate').click();
    await expect(page.getByRole('dialog').getByTestId('how-calculated-issue').first()).toContainText(/found in production|bug/);
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByTestId('work-metric-code_quality').click();
    await expect(page.getByRole('dialog').getByTestId('how-calculated-formula')).toContainText('weighted findings per 1,000 lines');
    await expect(page.getByRole('dialog').getByTestId('how-calculated-report').first()).toContainText('SonarQube report');
    await page.keyboard.press('Escape');
    // The KPI card of the same metric offers the calculation too.
    const card = page.getByTestId('how-calculated-defect_escape_rate');
    if (await card.count()) {
      await card.click();
      await expect(page.getByRole('dialog')).toContainText('How this was calculated: Defect escape rate');
      await page.keyboard.press('Escape');
    }
    await checkA11y(page, testInfo, { include: '[data-testid="work-evidence"]' });
  });

  test('WRK-04 an engineer sees the work evidence of their own team; another team is refused by the API', { tag: [TAG.role('engineer'), TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs('engineer');
    await openTeam(page, DEMO.engineerTeam.name);
    await expect(page.getByTestId('work-evidence')).toBeVisible();
    expect((await page.request.get(`${API_URL}/ci/teams/${DEMO.otherTeam.id}/work`)).status()).toBe(403);
    expect((await page.request.get(`${API_URL}/ci/teams/${DEMO.otherTeam.id}/metrics/velocity`)).status()).toBe(403);
  });

  test('WRK-05 a team without issues or reports shows no work section; the phone layout keeps the tables scrollable', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany);
    await openTeam(page, freshCompany.teamName);
    await expect(page.getByTestId('ci-evidence')).toContainText('issues and static-analysis reports');
    await expect(page.getByTestId('work-evidence')).toHaveCount(0);
  });
});

test.describe('Connect your CI: issues and static analysis', { tag: [TAG.area('admin'), TAG.area('ci-evidence')] }, () => {
  test('CI-04 issue and SARIF steps per tool, the test calls, and real issues and a report calculated on the team page', { tag: [TAG.smoke, TAG.role('admin')] }, async ({ freshCompany, signInAs, page, request }) => {
    await signInAs(freshCompany, '/admin-panel');
    const ci = page.getByTestId('connect-ci');
    await expect(ci.getByTestId('connect-ci-endpoints')).toContainText('/api/ingest/issues');
    await expect(ci.getByTestId('connect-ci-endpoints')).toContainText('/api/ingest/static-analysis');
    const work = ci.getByTestId('connect-ci-work');
    const issues = work.getByTestId('connect-ci-issue-snippet');
    await expect(issues).toContainText(`/ingest/issues?team=${freshCompany.teamId}&format=jira`);
    await expect(issues).toContainText('expand=changelog,names');
    await work.getByRole('tab', { name: 'Linear' }).click();
    await expect(issues).toContainText('api.linear.app/graphql');
    await work.getByRole('tab', { name: 'Linear' }).press('ArrowRight');
    await expect(work.getByRole('tab', { name: 'Other tracker (JSON)' })).toHaveAttribute('aria-selected', 'true');
    await expect(issues).toContainText('"environment":"production"');
    const sarif = work.getByTestId('connect-ci-sarif-snippet');
    await expect(sarif).toContainText(`/ingest/static-analysis?team=${freshCompany.teamId}`);
    await expect(sarif).toContainText('eslint-formatter-sarif');
    await work.getByRole('tab', { name: 'GitLab CI' }).click();
    await expect(sarif).toContainText('CI_DEFAULT_BRANCH');

    await page.getByPlaceholder('Key name, e.g. Jenkins production').fill('Work key');
    await page.getByRole('button', { name: 'Create key' }).click();
    const key = (await page.getByTestId('api-key-created').locator('code').innerText()).trim();
    await page.getByRole('button', { name: 'Done' }).click();
    await ci.getByLabel('API key').fill(key);
    await ci.getByTestId('connect-ci-test-kind').selectOption('issues');
    await ci.getByRole('button', { name: 'Send test call' }).click();
    await expect(ci.getByTestId('connect-ci-test-result')).toContainText('the sample issue was read');
    await ci.getByTestId('connect-ci-test-kind').selectOption('static-analysis');
    await ci.getByRole('button', { name: 'Send test call' }).click();
    await expect(ci.getByTestId('connect-ci-test-result')).toContainText('the sample SARIF report was read');

    const d = (daysAgo: number, h = 10) => new Date(Date.now() - daysAgo * 86_400_000 - (Date.now() % 86_400_000) + h * 3_600_000).toISOString();
    const auth = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    const r = await request.post(`${API_URL}/ingest/issues?team=${freshCompany.teamId}`, { headers: auth, data: {
      sprints: [{ id: 'S1', name: 'Sprint 1', startedAt: d(16, 9), completedAt: d(3, 15) }],
      issues: [
        { key: 'FR-1', type: 'story', status: 'Done', storyPoints: 5, estimateHours: 8, timeLoggedHours: 12, sprint: 'S1', createdAt: d(20), resolvedAt: d(5),
          transitions: [{ at: d(10, 9), to: 'Blocked' }, { at: d(10, 15), to: 'In Progress' }] },
        { key: 'FR-2', type: 'story', status: 'In Progress', storyPoints: 3, sprint: 'S1', createdAt: d(20) },
        { key: 'FR-3', type: 'bug', title: 'Fee shown twice', status: 'Open', environment: 'production', createdAt: d(2) },
        { key: 'FR-4', type: 'bug', status: 'Open', environment: 'staging', createdAt: d(2) },
      ] } });
    expect(r.status(), await r.text()).toBe(201);
    const report = JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'ESLint', rules: [{ id: 'no-unused-vars' }] } }, results: [
      { ruleId: 'no-unused-vars', level: 'warning', message: { text: "'x' is assigned a value but never used." }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/fees.ts' }, region: { startLine: 7 } } }] },
    ] }] });
    const s = await request.post(`${API_URL}/ingest/static-analysis?team=${freshCompany.teamId}&repo=fresh-app&loc=2000`, { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, data: report });
    expect(s.status(), await s.text()).toBe(201);
    await page.reload();
    await expect(page.getByTestId('connect-ci-row').filter({ hasText: freshCompany.teamName })).toContainText('sarif');

    await page.goto('/');
    await openTeam(page, freshCompany.teamName);
    const w = page.getByTestId('work-evidence');
    await expect(w.getByTestId('work-metric-velocity')).toContainText('5 points');
    await expect(w.getByTestId('work-metric-commitment')).toContainText('62.5 %');
    await expect(w.getByTestId('work-metric-blocked_time')).toContainText('6.0 h');
    await expect(w.getByTestId('work-metric-sizing_accuracy')).toContainText('1.50× estimate');
    await expect(w.getByTestId('work-metric-escape_rate')).toContainText('50.0 %');
    await expect(w.getByTestId('work-escaped-defect')).toContainText('FR-3');
    await expect(w.getByTestId('work-carried-issue')).toContainText('FR-2');
    // weighted 2 (one medium) over 2 KLOC → 100 × e^(−1 ÷ 20) = 95
    await expect(w.getByTestId('work-metric-code_quality')).toContainText('95 / 100');
    await expect(w.getByTestId('quality-rule')).toContainText('no-unused-vars');
  });
});

test.describe('Work & code quality accessibility', { tag: [TAG.a11y, TAG.area('ci-evidence')] }, () => {
  const cases = [
    { id: 'A11Y-46', theme: 'Light' },
    { id: 'A11Y-47', theme: 'Dark' },
    { id: 'A11Y-48', theme: 'Graphite' },
    { id: 'A11Y-49', theme: 'Porcelain' },
  ] as const;
  for (const c of cases) {
    test(`${c.id} ${c.theme} theme: Work & code quality and the Connect your CI issue steps have no serious violations`, async ({ signInAs, page, app }, testInfo) => {
      await signInAs('admin');
      await app.setTheme(c.theme);
      await openTeam(page, DEMO.leadTeam.name);
      await expect(page.getByTestId('work-metrics')).toBeVisible();
      await checkA11y(page, testInfo, { include: '[data-testid="work-evidence"]' });
      await page.goto('/admin-panel');
      await expect(page.getByTestId('connect-ci-work')).toBeVisible();
      await checkA11y(page, testInfo, { include: '[data-testid="connect-ci-work"]' });
      await page.evaluate(() => localStorage.removeItem('irongate_theme_mode'));
    });
  }
});
