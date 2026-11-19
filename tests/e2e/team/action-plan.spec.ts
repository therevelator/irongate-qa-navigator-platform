import { test, expect, TAG } from '../support/fixtures';
import { createFixtureTeam, deleteFixtureTeam, type FixtureTeam } from '../support/data';
import { sql } from '../support/db';
import { DEMO } from '../support/roles';
import type { Page } from '@playwright/test';

/**
 * Team detail → Action plan (src/components/ActionsPanel.tsx, src/lib/actionPlanView.ts,
 * src/components/Pagination.tsx): actions grouped by status (Open, In progress, Done, Dropped) in
 * accordions with counts; Done and Dropped collapsed by default; paging per group (5 / 10 / 20);
 * the section itself collapsible; the expanded state remembered per person across reloads; a
 * status change moves the action to its new group.
 */

let team: FixtureTeam;
const COUNTS = { open: 7, in_progress: 2, done: 12, dropped: 3 } as const;

test.beforeAll(async () => {
  team = await createFixtureTeam({ lead: true, members: 1 });
  let n = 0;
  for (const [status, count] of Object.entries(COUNTS)) {
    for (let i = 1; i <= count; i++) {
      n++;
      await sql(
        `INSERT INTO team_actions (company_id, team_id, title, status, owner_id, created_by, created_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $5, now() - ($6 || ' hours')::interval, CASE WHEN $4 = 'done' THEN now() ELSE NULL END)`,
        [DEMO.companyId, team.id, `APL ${status} ${String(i).padStart(2, '0')}`, status, team.leadId, String(100 - n)]);
    }
  }
});
test.afterAll(async () => {
  await sql('DELETE FROM team_actions WHERE team_id = $1', [team.id]);
  await deleteFixtureTeam(team);
});

const lead = () => ({ email: team.leadEmail!, password: 'demo123' });

/** Team detail is opened from the overview (it has no address of its own). */
async function openTeam(page: Page) {
  await page.getByLabel('Search teams').fill(team.name);
  await page.getByTestId('team-card').filter({ hasText: team.name }).click();
  await expect(page.getByTestId('action-plan')).toBeVisible();
}

const group = (page: Page, s: keyof typeof COUNTS) => page.getByTestId(`action-group-${s}`);
const toggle = (page: Page, s: keyof typeof COUNTS) => page.getByTestId(`action-group-toggle-${s}`);
const visibleItems = (page: Page, s: keyof typeof COUNTS) => group(page, s).getByTestId('action-item').filter({ visible: true });

test.describe('Action plan', { tag: [TAG.area('actions')] }, () => {
  test.describe.configure({ mode: 'serial' });

  test('APL-01 grouped by status with counts; Open and In progress expanded, Done and Dropped collapsed', { tag: [TAG.smoke, TAG.role('lead')] }, async ({ signInAs, page }) => {
    await signInAs(lead());
    await openTeam(page);
    const headers = await page.locator('[data-testid^="action-group-toggle-"]').allInnerTexts();
    expect(headers.map((h) => h.trim())).toEqual(['Open (7)', 'In progress (2)', 'Done (12)', 'Dropped (3)']);
    for (const s of ['open', 'in_progress'] as const) await expect(toggle(page, s)).toHaveAttribute('aria-expanded', 'true');
    for (const s of ['done', 'dropped'] as const) {
      await expect(toggle(page, s)).toHaveAttribute('aria-expanded', 'false');
      await expect(visibleItems(page, s)).toHaveCount(0);
    }
    const controls = await toggle(page, 'done').getAttribute('aria-controls');
    await expect(page.locator(`[id="${controls}"]`)).toBeHidden();
    // Click and keyboard both open a group.
    await toggle(page, 'done').click();
    await expect(toggle(page, 'done')).toHaveAttribute('aria-expanded', 'true');
    await expect(visibleItems(page, 'done')).toHaveCount(5);
    await toggle(page, 'dropped').focus();
    await page.keyboard.press('Enter');
    await expect(visibleItems(page, 'dropped')).toHaveCount(3);
    await expect(page.getByTestId('action-pager-dropped')).toHaveCount(0); // 3 items: no pager
  });

  test('APL-02 paging per group: 5 per page by default, previous / next / numbers, page size 10 and 20', async ({ signInAs, page }) => {
    await signInAs(lead());
    await openTeam(page);
    const pager = page.getByTestId('action-pager-open');
    await expect(pager.getByTestId('action-pager-open-range')).toHaveText('Showing 1–5 of 7');
    await expect(visibleItems(page, 'open')).toHaveCount(5);
    await expect(pager.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await pager.getByRole('button', { name: 'Next page' }).click();
    await expect(pager.getByTestId('action-pager-open-range')).toHaveText('Showing 6–7 of 7');
    await expect(visibleItems(page, 'open')).toHaveCount(2);
    await expect(pager.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
    await expect(pager.getByRole('button', { name: 'Next page' })).toBeDisabled();
    await pager.getByTestId('action-pager-open-size').selectOption('10');
    await expect(pager.getByTestId('action-pager-open-range')).toHaveText('Showing 1–7 of 7');
    await expect(visibleItems(page, 'open')).toHaveCount(7);
    await expect(pager.getByRole('button', { name: 'Next page' })).toHaveCount(0);

    // Done (12) pages on its own, independently of Open.
    await toggle(page, 'done').click();
    const done = page.getByTestId('action-pager-done');
    await expect(done.getByTestId('action-pager-done-range')).toHaveText('Showing 1–5 of 12');
    await done.getByRole('button', { name: 'Page 3' }).click();
    await expect(done.getByTestId('action-pager-done-range')).toHaveText('Showing 11–12 of 12');
    await expect(visibleItems(page, 'done')).toHaveCount(2);
    await done.getByTestId('action-pager-done-size').selectOption('20');
    await expect(visibleItems(page, 'done')).toHaveCount(12);
    await expect(pager.getByTestId('action-pager-open-range')).toHaveText('Showing 1–7 of 7');
  });

  test('APL-03 the expanded state of the groups and the section survives a reload', async ({ signInAs, page }) => {
    await signInAs(lead());
    await openTeam(page);
    await toggle(page, 'done').click();
    await toggle(page, 'open').click();
    await page.reload();
    await openTeam(page);
    await expect(toggle(page, 'done')).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle(page, 'open')).toHaveAttribute('aria-expanded', 'false');
    await expect(visibleItems(page, 'open')).toHaveCount(0);

    const section = page.getByTestId('action-plan-toggle');
    await expect(section).toHaveAttribute('aria-expanded', 'true');
    await section.click();
    await expect(section).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('action-plan-body')).toBeHidden();
    await expect(page.getByTestId('action-new')).toBeVisible(); // creating stays possible
    await page.reload();
    await openTeam(page);
    await expect(page.getByTestId('action-plan-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('action-plan-body')).toBeHidden();
    await page.getByTestId('action-plan-toggle').click();
    await toggle(page, 'open').click();
    await expect(page.getByTestId('action-plan-body')).toBeVisible();
  });

  test('APL-04 a status change moves the action to its group and updates the counts', async ({ signInAs, page }) => {
    await signInAs(lead());
    await openTeam(page);
    const item = group(page, 'in_progress').getByTestId('action-item').filter({ hasText: 'APL in_progress 01' });
    await item.getByTestId('action-status').selectOption('dropped');
    await expect(page.getByText('Status: Dropped')).toBeVisible();
    await expect(toggle(page, 'in_progress')).toHaveText('In progress (1)');
    await expect(toggle(page, 'dropped')).toHaveText('Dropped (4)');
    await toggle(page, 'dropped').click();
    const moved = group(page, 'dropped').getByTestId('action-item').filter({ hasText: 'APL in_progress 01' });
    await expect(moved).toBeVisible();
    await moved.getByTestId('action-status').selectOption('in_progress');
    await expect(toggle(page, 'in_progress')).toHaveText('In progress (2)');
    await expect(toggle(page, 'dropped')).toHaveText('Dropped (3)');
  });
});
