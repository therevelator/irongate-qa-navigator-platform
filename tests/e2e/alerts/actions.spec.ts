import { test, expect, TAG } from '../support/fixtures';
import { createFixtureTeam, deleteFixtureTeam, type FixtureTeam } from '../support/data';
import { API_URL } from '../support/env';
import { sql } from '../support/db';
import type { Page } from '@playwright/test';

/**
 * Tracked actions on Team detail (src/components/ActionsPanel.tsx, /api/actions) on a fixture team:
 * create with an owner and a linked KPI, done with a computed outcome, edit, delete (with cancel),
 * the owner's limited rights, validation, markup in titles, refusals by the API. Alert
 * acknowledgement refusals are checked through the API.
 */

let team: FixtureTeam;
test.beforeAll(async () => { team = await createFixtureTeam({ lead: true, members: 2 }); });
test.afterAll(async () => {
  await sql('DELETE FROM team_actions WHERE team_id = $1', [team.id]);
  await deleteFixtureTeam(team);
});

const lead = () => ({ email: team.leadEmail!, password: 'demo123' });
const member = () => ({ email: team.memberEmails[0], password: 'demo123' });

async function openTeam(page: Page) {
  await page.getByLabel('Search teams').fill(team.name);
  await page.getByTestId('team-card').filter({ hasText: team.name }).click();
  await expect(page.getByTestId('action-plan')).toBeVisible();
}

async function createAction(page: Page, title: string, opts: { owner?: string; metric?: string } = {}) {
  await page.getByTestId('action-new').click();
  const form = page.getByTestId('action-form');
  await form.getByTestId('action-title').fill(title);
  if (opts.owner) await form.getByTestId('action-owner').selectOption({ label: opts.owner });
  if (opts.metric) await form.getByTestId('action-metric-select').selectOption(opts.metric);
  await form.getByTestId('action-due').fill('2030-06-30');
  await form.getByTestId('action-save').click();
}

test.describe('Tracked actions', { tag: [TAG.area('actions')] }, () => {
  test.describe.configure({ mode: 'serial' });

  test('ACT-01 a lead creates an action for a member, edits it, marks it done (outcome shown) and deletes it after a cancel', { tag: [TAG.smoke, TAG.role('lead')] }, async ({ signInAs, page }) => {
    await signInAs(lead());
    await openTeam(page);
    await createAction(page, 'Stabilise the checkout suite', { owner: 'Fixture Member1', metric: 'test_coverage' });
    await expect(page.getByText('Action created')).toBeVisible();
    const item = page.getByTestId('action-item').filter({ hasText: 'Stabilise the checkout suite' });
    await expect(item).toContainText('Fixture Member1');

    await item.getByRole('button', { name: /^Edit/ }).click();
    await page.getByTestId('action-title').fill('Stabilise the checkout suite (phase 1)');
    await page.getByTestId('action-save').click();
    await expect(page.getByText('Action updated')).toBeVisible();
    const renamed = page.getByTestId('action-item').filter({ hasText: 'phase 1' });

    await renamed.getByTestId('action-status').selectOption('done');
    await expect(page.getByText('Marked done; the outcome is computed from the stored values')).toBeVisible();
    // Done actions move to the Done group, collapsed by default (Team detail → Action plan).
    await expect(page.getByTestId('action-group-toggle-done')).toHaveText(/Done \(1\)/);
    await expect(renamed).toBeHidden();
    await page.getByTestId('action-group-toggle-done').click();
    await expect(renamed.getByTestId('action-outcomes')).toBeVisible();

    page.once('dialog', (d) => d.dismiss());
    await renamed.getByRole('button', { name: /^Delete/ }).click();
    await expect(renamed).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await renamed.getByRole('button', { name: /^Delete/ }).click();
    await expect(page.getByText('Action deleted')).toBeVisible();
    await expect(renamed).toHaveCount(0);
  });

  test('ACT-02 a title must have 3 to 200 characters; markup in a title is only text', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs(lead());
    await openTeam(page);
    await page.getByTestId('action-new').click();
    const title = page.getByTestId('action-title');
    await title.fill('ab');
    await page.getByTestId('action-save').click();
    expect(await title.evaluate((el: HTMLInputElement) => el.validity.tooShort || el.validity.valid === false)).toBe(true);
    await title.fill('x'.repeat(250));
    expect((await title.inputValue()).length).toBe(200);
    await title.fill('<img src=x onerror="window.__xss=1"> Fix it');
    await page.getByTestId('action-save').click();
    await expect(page.getByTestId('action-item').filter({ hasText: '<img src=x onerror="window.__xss=1"> Fix it' })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  });

  test('ACT-03 a double click on "Create action" creates one action', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs(lead());
    await openTeam(page);
    await page.getByTestId('action-new').click();
    await page.getByTestId('action-title').fill('Only once please');
    await page.getByTestId('action-save').dblclick();
    await expect(page.getByTestId('action-item').filter({ hasText: 'Only once please' })).toHaveCount(1);
    const rows = await sql(`SELECT count(*)::int AS n FROM team_actions WHERE team_id = $1 AND title = 'Only once please'`, [team.id]);
    expect(rows[0].n).toBe(1);
  });

  test('ACT-04 the owner (a software engineer) may change the status of their action only', { tag: [TAG.negative, TAG.role('engineer')] }, async ({ signInAs, page, app }) => {
    await signInAs(lead());
    await openTeam(page);
    await createAction(page, 'Owned by member one', { owner: 'Fixture Member1' });
    await createAction(page, 'Owned by member two', { owner: 'Fixture Member2' });
    await app.signOut();

    await signInAs(member());
    await openTeam(page);
    await expect(page.getByTestId('action-new')).toHaveCount(0);
    const mine = page.getByTestId('action-item').filter({ hasText: 'Owned by member one' });
    await expect(mine.getByRole('button', { name: /^Edit/ })).toHaveCount(0);
    await mine.getByTestId('action-status').selectOption('in_progress');
    await expect(page.getByText('Status: In progress')).toBeVisible();
    const other = page.getByTestId('action-item').filter({ hasText: 'Owned by member two' });
    await expect(other.getByTestId('action-status')).toHaveCount(0);

    const res = await page.request.post(`${API_URL}/actions`, { data: { teamId: team.id, title: 'Not allowed' } });
    expect(res.status()).toBe(403);
  });

  test('ACT-05 a failed save keeps the form open with the reason', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs(lead());
    await openTeam(page);
    await page.route(`${API_URL}/actions`, (r) => (r.request().method() === 'POST'
      ? r.fulfill({ status: 500, json: { error: 'Internal server error', requestId: 'rid-act' } }) : r.continue()));
    await page.getByTestId('action-new').click();
    await page.getByTestId('action-title').fill('Will fail');
    await page.getByTestId('action-save').click();
    await expect(page.getByTestId('action-form')).toContainText('Internal server error');
  });

  test('ALT-01 alerts cannot be acknowledged by an engineer even through the API', { tag: [TAG.negative, TAG.role('engineer')] }, async ({ signInAs, page }) => {
    const [alert] = await sql<{ id: string }>(`SELECT id FROM alerts WHERE company_id = 'novatech' AND resolved_at IS NULL AND acknowledged_at IS NULL LIMIT 1`);
    test.skip(!alert, 'No open alert in the demo data to try with.');
    await signInAs('engineer');
    const res = await page.request.post(`${API_URL}/alerts/${alert.id}/acknowledge`);
    expect([403, 404]).toContain(res.status());
  });
});
