import { test, expect, TAG } from '../support/fixtures';
import { createFixtureTeam, deleteFixtureTeam, type FixtureTeam } from '../support/data';
import { sql } from '../support/db';
import { DEMO } from '../support/roles';
import { API_URL } from '../support/env';
import { checkA11y } from '../support/a11y';
import type { Page } from '@playwright/test';

/**
 * Team detail → Improve (v2 phase 4: src/components/Improve.tsx, GET /api/improve/teams/:id): the
 * "Forecast" line on the KPI tiles and the QA score, the trend charts with the projected band, the
 * Recommendations section (top 3 visible, the rest in an accordion, evidence with the tests named,
 * expected effect, next step), "Add to Action plan" (a tracked action linked to the recommendation,
 * with its before / after), "Dismiss" with a reason and "Reopen", read-only for an engineer, the
 * phone layout, the four themes, and the executive summary's "at this rate".
 *
 * Fixture: a team of its own with 20 weeks of declining history (Lending-like: coverage 56 % and
 * falling, defect escape 21 % and rising, flakiness 6 %, change failure 25 %, code quality 60), two
 * flaky tests from CI and a high-severity debt item; a team lead and an engineer.
 */

let team: FixtureTeam;

test.beforeAll(async () => {
  team = await createFixtureTeam({ lead: true, members: 1 });
  const series: Record<string, (w: number) => number> = {
    test_coverage: (w) => 56 + w * 0.8,
    defect_escape_rate: (w) => 21 - w * 0.4,
    test_flakiness_rate: (w) => 6 - w * 0.12,
    change_failure_rate: (w) => 25 - w * 0.5,
    code_quality_score: (w) => 60 + w,
  };
  const cols = Object.keys(series);
  for (let w = 19; w >= 0; w--) {
    const vals = cols.map((k) => Math.round(series[k](w) * 100) / 100);
    for (let i = 0; i < cols.length; i++) {
      await sql(`INSERT INTO metric_values (company_id, team_id, metric_key, value, recorded_at, source) VALUES ($1, $2, $3, $4, (CURRENT_DATE - $5::int)::timestamp + interval '8 hours', 'api')`,
        [DEMO.companyId, team.id, cols[i], vals[i], w * 7]);
    }
    await sql(`INSERT INTO kpi_snapshots (team_id, snapshot_date, ${cols.join(', ')}) VALUES ($1, CURRENT_DATE - $2::int, ${cols.map((_, i) => `$${i + 3}`).join(', ')})`,
      [team.id, w * 7, ...vals.map((v, i) => (cols[i] === 'code_quality_score' ? Math.round(v) : v))]);
  }
  await sql(`INSERT INTO flaky_test_evidence (company_id, team_id, test_key, suite, name, commit_sha, failed_run_ids, passed_run_ids, first_seen, last_seen) VALUES
      ($1, $2, 'k1', 'src/offers/offers.test.ts', 'refunds a rate quote', 'c1', ARRAY['r1','r2','r3'], ARRAY['r4'], now() - interval '5 days', now() - interval '1 day'),
      ($1, $2, 'k2', 'src/credit/credit.test.ts', 'exports a loan offer', 'c2', ARRAY['r5'], ARRAY['r6'], now() - interval '4 days', now() - interval '2 days')`, [DEMO.companyId, team.id]);
  await sql(`INSERT INTO technical_debt (team_id, company_id, title, severity, status, effort_hours, cost_of_delay) VALUES ($1, $2, 'Report generation blocks the request thread', 'high', 'open', 23, 5400)`, [team.id, DEMO.companyId]);
});
test.afterAll(async () => {
  if (!team) return;
  await sql('DELETE FROM recommendations WHERE team_id = $1', [team.id]);
  await sql('DELETE FROM team_actions WHERE team_id = $1', [team.id]);
  await sql('DELETE FROM technical_debt WHERE team_id = $1', [team.id]);
  await sql('DELETE FROM flaky_test_evidence WHERE team_id = $1', [team.id]);
  await sql('DELETE FROM kpi_snapshots WHERE team_id = $1', [team.id]);
  await sql('DELETE FROM metric_values WHERE team_id = $1', [team.id]);
  await sql('DELETE FROM forecasts WHERE team_id = $1', [team.id]);
  await deleteFixtureTeam(team);
});

const lead = () => ({ email: team.leadEmail!, password: 'demo123' });
const engineer = () => ({ email: team.memberEmails[0], password: 'demo123' });

async function openTeam(page: Page) {
  await page.getByLabel('Search teams').fill(team.name);
  await page.getByTestId('team-card').filter({ hasText: team.name }).first().click();
  await expect(page.getByTestId('team-detail')).toBeVisible();
  await expect(page.getByTestId('recommendation').first()).toBeVisible({ timeout: 20_000 });
}
const recs = (page: Page) => page.getByTestId('recommendations');

test.describe('Improve: forecasts and recommendations', { tag: [TAG.area('team'), TAG.area('improve')] }, () => {
  test.describe.configure({ mode: 'serial' });

  test('IMP-01 forecasts: a Forecast line on the KPI tiles and the QA score, trend charts with the projection', { tag: [TAG.smoke, TAG.role('lead')] }, async ({ signInAs, page }) => {
    await signInAs(lead());
    await openTeam(page);
    const cov = page.getByTestId('forecast-test_coverage');
    await expect(cov).toHaveText(/^Forecast: Stays off target ≥ 80%: about 49\.6% by \d+ \w+$/);
    await expect(cov).toHaveAttribute('data-outlook', 'stays_off');
    await expect(page.getByTestId('forecast-defect_escape_rate')).toContainText('Stays off target ≤ 5%');
    await expect(page.getByTestId('forecast-qa_score')).toContainText('Forecast:');
    // A metric without history in this fixture has no Forecast line.
    await expect(page.getByTestId('forecast-mttr_hours')).toHaveCount(0);
    await expect(page.getByTestId('trend-test_coverage')).toHaveAttribute('aria-label', /forecast Stays off target ≥ 80%.*target ≥ 80%/);
    await expect(page.getByTestId('team-qa-trend')).toContainText('shaded: forecast');
  });

  test('IMP-02 recommendations: ranked, top 3 visible, the rest collapsed; evidence names the flaky tests', { tag: [TAG.smoke, TAG.role('lead')] }, async ({ signInAs, page }) => {
    await signInAs(lead());
    await openTeam(page);
    const api = await (await page.request.get(`${API_URL}/improve/teams/${team.id}`)).json();
    const open = api.recommendations.open;
    expect(open.length).toBeGreaterThan(3);
    const top = recs(page).getByTestId('recommendations-top').getByTestId('recommendation');
    await expect(top).toHaveCount(3);
    await expect(top.getByTestId('recommendation-title')).toHaveText(open.slice(0, 3).map((r: { title: string }) => r.title));
    await expect(recs(page).getByRole('heading', { name: `Recommendations (${open.length})` })).toBeVisible();
    const more = recs(page).getByTestId('recommendations-more');
    await expect(more).toHaveAttribute('data-count', String(open.length - 3));
    await expect(more.getByTestId('recommendation').first()).toBeHidden();
    await recs(page).getByTestId('recommendations-more-toggle').click();
    await expect(more.getByTestId('recommendation').first()).toBeVisible();

    const flaky = recs(page).locator('[data-rule="flaky_tests"]');
    await expect(flaky.getByTestId('recommendation-title')).toHaveText('Fix the 2 flaky tests: they failed 4 runs in the last 14 days');
    await expect(flaky.getByTestId('recommendation-effect')).toContainText(/Expected effect: Test flakiness rate −[\d.]+ to −[\d.]+ points/);
    await expect(flaky.getByTestId('recommendation-next-step')).toContainText('Quarantine these 2 tests');
    await expect(flaky.getByTestId('recommendation-evidence')).toBeHidden();
    await flaky.getByTestId('recommendation-evidence-toggle').click();
    await expect(flaky.getByTestId('recommendation-items')).toContainText('src/offers/offers.test.ts › refunds a rate quote');
    await expect(flaky.getByTestId('recommendation-items')).toContainText('failed 3, passed 1');
    await expect(flaky.getByTestId('recommendation-evidence-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  test('IMP-03 Add to Action plan: one click creates the tracked action linked to the recommendation and its metric', { tag: [TAG.role('lead')] }, async ({ signInAs, page }) => {
    await signInAs(lead());
    await openTeam(page);
    const rec = recs(page).locator('[data-rule="coverage_gap"]');
    const title = (await rec.getByTestId('recommendation-title').innerText()).trim();
    await rec.getByTestId('recommendation-accept').click();
    await expect(page.getByText(/^Added to the Action plan; its outcome is measured on test coverage/)).toBeVisible();
    // Moved to the decided group, with its action.
    await expect(recs(page).getByTestId('recommendations-decided')).toHaveAttribute('data-count', '1');
    await recs(page).getByTestId('recommendations-decided-toggle').click();
    const accepted = recs(page).getByTestId('recommendations-decided').locator('[data-rule="coverage_gap"]');
    await expect(accepted.getByTestId('recommendation-action')).toContainText(`In the Action plan: ${title} · Open · unassigned`);
    await expect(accepted.getByTestId('recommendation-movement')).toContainText(/Since it was added: Test coverage 56% \(\d+ \w+\) → no newer snapshot/);
    // The Action plan has it, from the recommendation, with the metric's baseline.
    const action = page.getByTestId('action-plan').getByTestId('action-item').filter({ hasText: title });
    await expect(action).toBeVisible();
    await expect(action.getByTestId('action-from-recommendation')).toHaveText('from the recommendation above');
    await expect(action.getByTestId('action-metric')).toContainText('Test coverage (higher is better): baseline 56%');
    await expect(action.getByTestId('action-movement')).toContainText('No new data yet');
    // Status changes show on the recommendation too.
    await action.getByTestId('action-status').selectOption('in_progress');
    await expect(accepted.getByTestId('recommendation-action')).toContainText('In progress');
  });

  test('IMP-04 the action shows whether the metric moved, with the dates (before / after from the snapshots)', { tag: [TAG.role('lead')] }, async ({ signInAs, page }) => {
    await sql(`UPDATE team_actions SET created_at = now() - interval '14 days' WHERE team_id = $1 AND origin = 'recommendation'`, [team.id]);
    await sql(`UPDATE kpi_snapshots SET test_coverage = 63 WHERE team_id = $1 AND snapshot_date = CURRENT_DATE`, [team.id]);
    try {
      await signInAs(lead());
      await openTeam(page);
      const action = page.getByTestId('action-plan').getByTestId('action-item').filter({ has: page.getByTestId('action-from-recommendation') });
      await expect(action.getByTestId('action-movement')).toContainText(/Since it was added: Test coverage 57\.6% \(\d+ \w+\) → 63% \(\d+ \w+\)\s*Improved/);
    } finally {
      await sql(`UPDATE kpi_snapshots SET test_coverage = 56 WHERE team_id = $1 AND snapshot_date = CURRENT_DATE`, [team.id]);
    }
  });

  test('IMP-05 Dismiss asks for a reason, shows who and why, and can be reopened', { tag: [TAG.role('lead'), TAG.a11y] }, async ({ signInAs, page }, testInfo) => {
    await signInAs(lead());
    await openTeam(page);
    const first = recs(page).getByTestId('recommendations-top').getByTestId('recommendation').first();
    const title = (await first.getByTestId('recommendation-title').innerText()).trim();
    await first.getByTestId('recommendation-dismiss').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(title);
    await checkA11y(page, testInfo, { include: '[role="dialog"]' });
    await dialog.getByLabel('Other').check();
    await dialog.getByTestId('dismiss-save').click();
    await expect(dialog.getByTestId('dismiss-note')).toBeFocused(); // a reason is required for "Other"
    await dialog.getByLabel('Already being handled').check();
    await dialog.getByTestId('dismiss-note').fill('the platform team owns it');
    await dialog.getByTestId('dismiss-save').click();
    await expect(dialog).toHaveCount(0);
    await recs(page).getByTestId('recommendations-decided-toggle').click();
    const dismissed = recs(page).getByTestId('recommendations-decided').locator('[data-status="dismissed"]');
    await expect(dismissed.getByTestId('recommendation-dismissed')).toHaveText(/^Dismissed by Fixture Lead on \d+ \w+: Already being handled: the platform team owns it$/);
    await expect(recs(page).getByTestId('recommendations-top').getByTestId('recommendation-title').filter({ hasText: title })).toHaveCount(0);
    await dismissed.getByTestId('recommendation-reopen').click();
    await expect(page.getByText('Recommendation reopened')).toBeVisible();
    await expect(recs(page).getByTestId('recommendation-title').filter({ hasText: title }).first()).toBeVisible();
    await expect(recs(page).locator('[data-status="dismissed"]')).toHaveCount(0);
  });

  test('IMP-06 an engineer of the team reads the recommendations but cannot act on them', { tag: [TAG.role('engineer'), TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs(engineer());
    await openTeam(page);
    await expect(recs(page).getByTestId('recommendation-accept')).toHaveCount(0);
    await expect(recs(page).getByTestId('recommendation-dismiss')).toHaveCount(0);
    await expect(recs(page).getByTestId('improve-refresh')).toHaveCount(0);
    const id = (await (await page.request.get(`${API_URL}/improve/teams/${team.id}`)).json()).recommendations.open[0].id;
    expect((await page.request.post(`${API_URL}/improve/recommendations/${id}/accept`, { data: {} })).status()).toBe(403);
    // Another team's recommendations: refused (analytics scope).
    expect((await page.request.get(`${API_URL}/improve/teams/${DEMO.otherTeam.id}`)).status()).toBe(403);
  });

  test('IMP-07 Recalculate (leads, managers, admins) recalculates and keeps the decisions', { tag: [TAG.role('admin')] }, async ({ signInAs, page }) => {
    await signInAs('admin');
    await openTeam(page);
    await recs(page).getByTestId('improve-refresh').click();
    await expect(page.getByText('Forecasts and recommendations recalculated')).toBeVisible();
    await expect(recs(page).getByTestId('recommendations-decided')).toHaveAttribute('data-count', '1');
    await expect(recs(page).getByTestId('recommendations-method')).toContainText('Rule-based and deterministic');
  });
});

test.describe('Improve on a phone', { tag: [TAG.area('improve')] }, () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('IMP-08 the recommendations fit the phone: no sideways scrolling, large buttons', { tag: [TAG.role('lead')] }, async ({ signInAs, page }) => {
    await signInAs(lead());
    await openTeam(page);
    const first = recs(page).getByTestId('recommendations-top').getByTestId('recommendation').first();
    await first.scrollIntoViewIfNeeded();
    const btn = await first.getByTestId('recommendation-accept').boundingBox();
    expect(btn!.height).toBeGreaterThanOrEqual(36);
    expect(btn!.x + btn!.width).toBeLessThanOrEqual(390);
    await first.getByTestId('recommendation-evidence-toggle').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(page.getByTestId('forecast-test_coverage')).toBeVisible();
  });
});

test.describe('Improve accessibility', { tag: [TAG.a11y, TAG.area('improve')] }, () => {
  const cases = [
    { id: 'A11Y-38', theme: 'Light' },
    { id: 'A11Y-39', theme: 'Dark' },
    { id: 'A11Y-40', theme: 'Graphite' },
    { id: 'A11Y-41', theme: 'Porcelain' },
  ] as const;
  for (const c of cases) {
    test(`${c.id} ${c.theme} theme: recommendations and forecast tiles have no serious violations`, async ({ signInAs, page, app }, testInfo) => {
      await signInAs(lead());
      await app.setTheme(c.theme);
      await openTeam(page);
      await recs(page).getByTestId('recommendations-top').getByTestId('recommendation-evidence-toggle').first().click();
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await checkA11y(page, testInfo, { include: '[data-testid="recommendations"]' });
      await checkA11y(page, testInfo, { include: '[data-testid="forecast-test_coverage"]' });
      await checkA11y(page, testInfo, { include: '[data-testid="team-kpis"]' });
      await page.evaluate(() => localStorage.removeItem('irongate_theme_mode'));
    });
  }
});

test.describe('Executive summary: at this rate', { tag: [TAG.area('summary'), TAG.area('improve')] }, () => {
  test('IMP-09 risk items carry the forecast of their metric, as the summary API says', { tag: [TAG.role('admin')] }, async ({ signInAs, page }) => {
    await signInAs('admin', '/summary');
    await expect(page.getByTestId('summary-risks')).toBeVisible();
    const api = await (await page.request.get(`${API_URL}/summary`)).json();
    const texts: string[] = [];
    api.risks.top.forEach((r: any, idx: number) => {
      const shownItems = r.items.filter((i: any) => i.key !== 'qaScore').slice(0, 2);
      for (const i of [...r.items.filter((x: any) => x.key === 'qaScore'), ...shownItems]) if (i.forecast) texts.push(`${idx}|${i.forecast.text}`);
    });
    for (const t of texts) {
      const [idx, text] = t.split('|');
      await expect(page.getByTestId('summary-risk').nth(Number(idx)).getByTestId('summary-risk-forecast').filter({ hasText: text }).first()).toBeVisible();
    }
    for (const t of texts.map((x) => x.split('|')[1])) expect(t).toMatch(/^At this rate /);
    if (api.upcoming?.total) await expect(page.getByTestId('summary-upcoming-item')).toHaveCount(api.upcoming.top.length);
  });
});
