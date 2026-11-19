import { test, expect, TAG } from '../support/fixtures';
import { createFixtureTeam, deleteFixtureTeam, type FixtureTeam } from '../support/data';
import { sql } from '../support/db';
import { API_URL } from '../support/env';
import type { Page } from '@playwright/test';

/**
 * Manual metrics (src/components/ManualMetricsInput.tsx, POST /api/metrics/manual), on a fixture
 * team led by a fixture team lead, so the demo teams keep their values.
 */

let team: FixtureTeam;
test.beforeAll(async () => { team = await createFixtureTeam({ lead: true, members: 1 }); });
test.afterAll(async () => { await deleteFixtureTeam(team); });

const lead = () => ({ email: team.leadEmail!, password: 'demo123' });
const coverageInputs = (page: Page) => ({
  executed: page.getByPlaceholder('e.g., 8500'),
  total: page.getByPlaceholder('e.g., 10000'),
});
const save = (page: Page) => page.getByRole('button', { name: 'Save team metrics' });
const coverageRows = () => sql<{ n: string }>(
  `SELECT count(*)::int AS n FROM metric_values WHERE team_id = $1 AND metric_key IN ('test_coverage', 'testCoverage')`, [team.id]).then((r) => Number(r[0].n));

test.describe('Manual metrics', { tag: [TAG.area('admin'), TAG.area('metrics')] }, () => {
  test.describe.configure({ mode: 'serial' });

  test('MM-01 a team lead sees only the teams they lead and saves a value; the team page shows it', { tag: [TAG.smoke, TAG.role('lead')] }, async ({ signInAs, page }) => {
    await signInAs(lead(), '/manual-metrics');
    const select = page.locator('select').filter({ has: page.locator('option', { hasText: '-- Select a team --' }) });
    await expect(select.locator('option')).toHaveCount(2);
    await select.selectOption(team.id);
    const { executed, total } = coverageInputs(page);
    await executed.first().fill('850');
    await total.first().fill('1000');
    await save(page).click();
    await expect(page.getByRole('heading', { name: 'Team Metrics Saved' })).toBeVisible();
    await page.getByRole('button', { name: 'OK' }).click();
    expect(await coverageRows()).toBeGreaterThan(0);
  });

  test('MM-02 nothing to save: the button stays disabled until a value is entered; no team chosen is refused', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs(lead(), '/manual-metrics');
    await expect(save(page)).toBeDisabled();
    await page.locator('select').first().selectOption('');
    const { executed, total } = coverageInputs(page);
    await executed.first().fill('1');
    await total.first().fill('2');
    await expect(save(page)).toBeEnabled();
    await save(page).click();
    await expect(page.getByRole('heading', { name: 'No Team Selected' })).toBeVisible();
    await page.getByRole('button', { name: 'OK' }).click();
  });

  test('MM-03 a coverage above 100 % is refused and nothing is stored', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    const before = await coverageRows();
    await signInAs(lead(), '/manual-metrics');
    await page.locator('select').first().selectOption(team.id);
    const { executed, total } = coverageInputs(page);
    await executed.first().fill('1500');
    await total.first().fill('1000');
    await save(page).click();
    await expect(page.getByRole('heading', { name: 'Failed to Save Team Metrics' })).toBeVisible();
    await page.getByRole('button', { name: 'OK' }).click();
    expect(await coverageRows()).toBe(before);
  });

  test('MM-04 the date cannot be in the future; an earlier day is saved for that day', async ({ signInAs, page }) => {
    await signInAs(lead(), '/manual-metrics');
    const date = page.getByTestId('manual-values-for');
    const max = await date.getAttribute('max');
    expect(max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const [{ d }] = await sql<{ d: string }>(`SELECT to_char(($1::date - 3), 'YYYY-MM-DD') AS d`, [max]);
    await page.locator('select').first().selectOption(team.id);
    await date.fill(d);
    await expect(page.getByText(`Saved as values for ${d}`)).toBeVisible();
    const { executed, total } = coverageInputs(page);
    await executed.first().fill('700');
    await total.first().fill('1000');
    await save(page).click();
    await expect(page.getByRole('heading', { name: 'Team Metrics Saved' })).toBeVisible();
    await expect(page.locator('.swal2-html-container')).toContainText(d);
    await page.getByRole('button', { name: 'OK' }).click();
  });

  test('MM-05 a server error and an unreachable server are reported', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs(lead(), '/manual-metrics');
    await page.locator('select').first().selectOption(team.id);
    const { executed, total } = coverageInputs(page);
    await page.route(`${API_URL}/metrics/manual`, (r) => r.fulfill({ status: 500, json: { error: 'Internal server error', requestId: 'rid-mm' } }), { times: 1 });
    await executed.first().fill('800');
    await total.first().fill('1000');
    await save(page).click();
    await expect(page.getByRole('heading', { name: 'Failed to Save Team Metrics' })).toBeVisible();
    await expect(page.locator('.swal2-html-container')).toHaveText('Internal server error');
    await page.getByRole('button', { name: 'OK' }).click();
    await page.route(`${API_URL}/metrics/manual`, (r) => r.abort('internetdisconnected'), { times: 1 });
    await save(page).click();
    await expect(page.getByRole('heading', { name: 'Error' })).toBeVisible();
    await page.getByRole('button', { name: 'OK' }).click();
  });

  test('MM-06 a double click on Save writes once', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs(lead(), '/manual-metrics');
    await page.locator('select').first().selectOption(team.id);
    let posts = 0;
    await page.route(`${API_URL}/metrics/manual`, (r) => { posts++; return r.continue(); });
    const { executed, total } = coverageInputs(page);
    await executed.first().fill('810');
    await total.first().fill('1000');
    await save(page).dblclick();
    await expect(page.getByRole('heading', { name: 'Team Metrics Saved' })).toBeVisible();
    expect(posts).toBe(1);
  });

  test('MM-07 a lead cannot write another team\'s metrics through the API', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs(lead());
    const res = await page.request.post(`${API_URL}/metrics/manual`, { data: { teamId: 'team-1764026236967-uphpblii4', testCoverage: 50 } });
    expect([403, 404]).toContain(res.status());
  });
});
