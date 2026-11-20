import { test, expect, TAG } from '../support/fixtures';
import { checkA11y } from '../support/a11y';
import { createFixtureTeam, deleteFixtureTeam, type FixtureTeam } from '../support/data';
import { sql } from '../support/db';
import { DEMO } from '../support/roles';
import type { Page } from '@playwright/test';

/**
 * Team detail → Action plan: who changed the status of an action, and when (src/components/ActionsPanel.tsx
 * StatusChangeLine / History, src/lib/actionHistory.ts, team_action_events). On the left of every action:
 * "Changed to Dropped by Fixture Lead on 20th Nov 2026, 10:11 PM", "Created by … on …", "… automatically
 * on …", nothing for an old row without history; a "History" toggle lists every change newest first.
 * Dates in the viewer's time zone (UTC here, Tokyo in AHU-03).
 */

let team: FixtureTeam;
const ids = { dropped: '', created: '', auto: '', old: '' };

test.beforeAll(async () => {
  team = await createFixtureTeam({ lead: true, members: 1 });
  const add = async (title: string, status: string) => (await sql<{ id: string }>(
    `INSERT INTO team_actions (company_id, team_id, title, status, owner_id, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, '2026-11-02T09:30:00Z', '2026-11-20T22:11:00Z') RETURNING id`,
    [DEMO.companyId, team.id, title, status, team.memberIds[0], team.leadId]))[0].id;
  const ev = (action: string, from: string | null, to: string, by: string | null, at: string) => sql(
    `INSERT INTO team_action_events (company_id, team_id, action_id, from_status, to_status, changed_by, source, changed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)`,
    [DEMO.companyId, team.id, action, from, to, by, by ? 'user' : 'system', at]);
  ids.dropped = await add('AHU retro: alert on the weakest dependencies before they fail', 'dropped');
  await ev(ids.dropped, null, 'open', team.leadId!, '2026-11-02T09:30:00Z');
  await ev(ids.dropped, 'open', 'in_progress', team.memberIds[0], '2026-11-04T14:05:00Z');
  await ev(ids.dropped, 'in_progress', 'dropped', team.leadId!, '2026-11-20T22:11:00Z');
  ids.created = await add('AHU only created', 'open');
  await ev(ids.created, null, 'open', team.leadId!, '2026-11-03T08:00:00Z');
  ids.auto = await add('AHU closed by the system', 'done');
  await ev(ids.auto, null, 'open', team.leadId!, '2026-11-02T09:30:00Z');
  await ev(ids.auto, 'open', 'done', null, '2026-11-12T03:00:00Z');
  ids.old = await add('AHU old row without history', 'in_progress');
  await sql(`UPDATE team_actions SET status_changed_by = $2, status_changed_at = '2026-11-20T22:11:00Z' WHERE id = $1`, [ids.dropped, team.leadId]);
});
test.afterAll(async () => {
  await sql('DELETE FROM team_actions WHERE team_id = $1', [team.id]);
  await deleteFixtureTeam(team);
});

const lead = () => ({ email: team.leadEmail!, password: 'demo123' });
const item = (page: Page, title: string) => page.getByTestId('action-item').filter({ hasText: title });

async function openTeam(page: Page) {
  await page.getByLabel('Search teams').fill(team.name);
  await page.getByTestId('team-card').filter({ hasText: team.name }).click();
  await expect(page.getByTestId('action-plan')).toBeVisible();
  for (const s of ['done', 'dropped'] as const) {
    const t = page.getByTestId(`action-group-toggle-${s}`);
    if ((await t.getAttribute('aria-expanded')) === 'false') await t.click();
  }
}

test.describe('Action status history', { tag: [TAG.area('actions')] }, () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ timezoneId: 'UTC' });

  test('AHU-01 the line on the left: changed / created / automatically, nothing for an old row; <time> carries the instant', { tag: [TAG.role('lead')] }, async ({ signInAs, page }) => {
    await signInAs(lead());
    await openTeam(page);
    const dropped = item(page, 'AHU retro');
    const line = dropped.getByTestId('action-status-line');
    await expect(line).toHaveText('Changed to Dropped by Fixture Lead on 20th Nov 2026, 10:11 PM');
    await expect(line.locator('time')).toHaveAttribute('dateTime', '2026-11-20T22:11:00.000Z');
    await expect(line.getByText('Dropped', { exact: true })).toHaveClass(/text-amber-800/);
    // On the left of the title (desktop).
    const lineBox = (await line.boundingBox())!;
    const titleBox = (await dropped.getByText('AHU retro: alert on the weakest dependencies before they fail', { exact: true }).boundingBox())!;
    expect(lineBox.x + lineBox.width).toBeLessThanOrEqual(titleBox.x + 1);

    await expect(item(page, 'AHU only created').getByTestId('action-status-line')).toHaveText('Created by Fixture Lead on 3rd Nov 2026, 8:00 AM');
    await expect(item(page, 'AHU closed by the system').getByTestId('action-status-line')).toHaveText('Changed to Done automatically on 12th Nov 2026, 3:00 AM');
    const old = item(page, 'AHU old row without history');
    await expect(old.getByTestId('action-status-line')).toHaveCount(0);
    await expect(old.getByTestId('action-history-toggle')).toHaveCount(0);
  });

  test('AHU-02 History lists every change newest first (from → to, who, when); keyboard toggles it', async ({ signInAs, page }) => {
    await signInAs(lead());
    await openTeam(page);
    const dropped = item(page, 'AHU retro');
    const toggle = dropped.getByTestId('action-history-toggle');
    await expect(toggle).toHaveText(/History.*\(3\)/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(dropped.getByTestId('action-history-list')).toBeHidden();
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const entries = dropped.getByTestId('action-history-entry');
    await expect(entries).toHaveText([
      /In progress\s*→\s*to Dropped by Fixture Lead on 20th Nov 2026, 10:11 PM/,
      /Open\s*→\s*to In progress by Fixture Member1 on 4th Nov 2026, 2:05 PM/,
      /Created as Open by Fixture Lead on 2nd Nov 2026, 9:30 AM/,
    ]);
    await expect(entries.first().locator('time')).toHaveAttribute('dateTime', '2026-11-20T22:11:00.000Z');
    await toggle.click();
    await expect(dropped.getByTestId('action-history-list')).toBeHidden();
  });

  test('AHU-04 a status change in the UI shows the signed-in person and adds a history entry', { tag: [TAG.role('lead')] }, async ({ signInAs, page }) => {
    await signInAs(lead());
    await openTeam(page);
    await item(page, 'AHU only created').getByTestId('action-status').selectOption('in_progress');
    await expect(page.getByText('Status: In progress')).toBeVisible();
    const row = item(page, 'AHU only created');
    await expect(row.getByTestId('action-status-line')).toContainText(/^Changed to In progress by Fixture Lead on \d{1,2}(st|nd|rd|th) [A-Z][a-z]{2} \d{4}, \d{1,2}:\d{2} (AM|PM)$/);
    await row.getByTestId('action-history-toggle').click();
    await expect(row.getByTestId('action-history-entry')).toHaveCount(2);
    await expect(row.getByTestId('action-history-entry').first()).toContainText('Open → to In progress by Fixture Lead');
  });

  test('AHU-05 phone width: the line wraps above the title and nothing scrolls sideways', async ({ signInAs, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(lead());
    await openTeam(page);
    const dropped = item(page, 'AHU retro');
    const line = dropped.getByTestId('action-status-line');
    await expect(line).toBeVisible();
    const lineBox = (await line.boundingBox())!;
    const titleBox = (await dropped.getByText('AHU retro: alert on the weakest dependencies before they fail', { exact: true }).boundingBox())!;
    expect(lineBox.y + lineBox.height).toBeLessThanOrEqual(titleBox.y + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});

test.describe('Action status history in the viewer time zone', { tag: [TAG.area('actions')] }, () => {
  test.use({ timezoneId: 'Asia/Tokyo' });
  test('AHU-03 the time is shown in the viewer time zone (Tokyo: next morning)', async ({ signInAs, page }) => {
    await signInAs(lead());
    await openTeam(page);
    await expect(item(page, 'AHU retro').getByTestId('action-status-line')).toHaveText('Changed to Dropped by Fixture Lead on 21st Nov 2026, 7:11 AM');
  });
});

test.describe('Action status history accessibility', { tag: [TAG.a11y, TAG.area('actions')] }, () => {
  const cases = [
    { id: 'A11Y-58', theme: 'Light' },
    { id: 'A11Y-59', theme: 'Dark' },
    { id: 'A11Y-60', theme: 'Graphite' },
    { id: 'A11Y-61', theme: 'Porcelain' },
  ] as const;
  for (const c of cases) {
    test(`${c.id} ${c.theme} theme: the Action plan with the status lines and an open history has no serious violations`, async ({ signInAs, page, app }, testInfo) => {
      await signInAs(lead());
      await app.setTheme(c.theme);
      await openTeam(page);
      await item(page, 'AHU retro').getByTestId('action-history-toggle').click();
      await item(page, 'AHU closed by the system').getByTestId('action-history-toggle').click();
      await expect(item(page, 'AHU retro').getByTestId('action-history-list')).toBeVisible();
      await checkA11y(page, testInfo, { known: [], include: '[data-testid="action-plan"]' });
      await page.evaluate(() => localStorage.removeItem('irongate_theme_mode'));
    });
  }
});
