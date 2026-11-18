import { test, expect, request as pwRequest, type Page } from '@playwright/test';
import { setupAuth } from './fixtures/auth';

/**
 * Alerts and tracked actions in the UI: the notifications bell (unread count, panel, mark all
 * read), the Notifications page (alerts, preferences), the alert / Slack section of Parameters,
 * and the Action plan on Team detail (create an action, change its status), which TV mode shows.
 */

const API = 'http://localhost:3000';

async function api(page: Page) {
  return pwRequest.newContext({ baseURL: API, storageState: await page.context().storageState() });
}

/** The signed-in user's own team (primary team) as { id, name }. */
async function ownTeam(page: Page): Promise<{ id: string; name: string }> {
  const ctx = await api(page);
  const me = await (await ctx.get('/api/auth/me')).json();
  const teamId = me.user?.primary_team_id ?? me.user?.primaryTeamId;
  const { teams } = await (await ctx.get('/api/teams')).json();
  const team = teams.find((t: any) => t.id === teamId) ?? teams[0];
  await ctx.dispose();
  return { id: team.id, name: team.name };
}

test.describe('Alerts, notifications and tracked actions', () => {
  test.setTimeout(120000);

  test('A team lead sees a new alert in the bell, can open the panel and mark everything read', async ({ page }) => {
    await setupAuth(page, 'team_lead');
    const team = await ownTeam(page);
    // On target first (resolves any open escape-rate alert), then off target: a new alert opens.
    const ctx = await api(page);
    expect((await ctx.post('/api/metrics/manual', { data: { teamId: team.id, defect_escape_rate: 2 } })).status()).toBe(200);
    await ctx.post('/api/notifications/read-all');
    const write = await ctx.post('/api/metrics/manual', { data: { teamId: team.id, defect_escape_rate: 27 } });
    expect(write.status()).toBe(200);
    await ctx.dispose();

    await page.reload();
    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible({ timeout: 30000 });
    const bell = page.locator('[data-testid="notifications-bell"]');
    await expect(bell).toBeVisible();
    await expect(page.locator('[data-testid="notifications-unread"]')).toBeVisible({ timeout: 15000 });
    await bell.click();
    const panel = page.locator('[data-testid="notifications-panel"]');
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-testid="notification-item"]').first()).toContainText(team.name);
    await panel.locator('[data-testid="notifications-read-all"]').click();
    await expect(page.locator('[data-testid="notifications-unread"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    // All alerts: the Notifications page lists the alert with an Acknowledge button for the lead.
    await bell.click();
    await page.locator('[data-testid="notifications-view-alerts"]').click();
    await expect(page.locator('[data-testid="alerts-tab"]')).toBeVisible({ timeout: 15000 });
    const row = page.locator('[data-testid="alert-row"]', { hasText: 'Defect escape rate' }).first();
    await expect(row).toBeVisible();
    await row.locator('[data-testid="alert-ack"]').click();
    await expect(page.getByText('Alert acknowledged')).toBeVisible();

    // Put the value back on target (resolves the alert).
    const ctx2 = await api(page);
    await ctx2.post('/api/metrics/manual', { data: { teamId: team.id, defect_escape_rate: 2 } });
    await ctx2.dispose();
  });

  test('Notification preferences can be changed and saved', async ({ page }) => {
    await setupAuth(page, 'team_lead');
    await page.goto('http://localhost:5173/notifications?tab=preferences');
    await expect(page.locator('[data-testid="notification-prefs"]')).toBeVisible({ timeout: 15000 });
    const email = page.locator('[data-testid="pref-email"]');
    const before = await email.getAttribute('aria-checked');
    await email.click();
    await page.locator('[data-testid="prefs-save"]').click();
    await expect(page.getByText('Notification preferences saved')).toBeVisible();
    await email.click();
    await page.locator('[data-testid="prefs-save"]').click();
    await expect(email).toHaveAttribute('aria-checked', before ?? 'false');
    await expect(page.locator('[data-testid="send-test-digest"]')).toBeVisible();
  });

  test('An engineer has no digest option and cannot acknowledge alerts', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');
    await page.goto('http://localhost:5173/notifications?tab=preferences');
    await expect(page.locator('[data-testid="notification-prefs"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="send-test-digest"]')).toHaveCount(0);
    await page.goto('http://localhost:5173/notifications');
    await expect(page.locator('[data-testid="alerts-tab"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="alert-ack"]')).toHaveCount(0);
  });

  test('Parameters shows the alert rules and, for super admins, the Slack settings', async ({ page }) => {
    await setupAuth(page, 'super_admin');
    await page.goto('http://localhost:5173/parameters-config');
    await expect(page.locator('[data-testid="alert-settings"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="alert-rule-threshold_breach"]')).toBeVisible();
    await expect(page.locator('[data-testid="slack-settings"]')).toBeVisible();
    await expect(page.locator('[data-testid="slack-webhook-input"]')).toHaveAttribute('type', 'password');
  });

  test('A team lead creates a tracked action on Team detail, moves it to in progress, and TV mode shows it', async ({ page }) => {
    await setupAuth(page, 'team_lead');
    const team = await ownTeam(page);
    const title = `E2E action ${Date.now()}`;
    await page.locator('[data-testid="team-card"]', { hasText: team.name }).first().click();
    const plan = page.locator('[data-testid="action-plan"]');
    await expect(plan).toBeVisible({ timeout: 20000 });
    await plan.locator('[data-testid="action-new"]').click();
    const form = page.locator('[data-testid="action-form"]');
    await expect(form).toBeVisible();
    await form.locator('[data-testid="action-title"]').fill(title);
    await form.locator('[data-testid="action-metric-select"]').selectOption('test_coverage');
    await form.locator('[data-testid="action-due"]').fill('2030-03-01');
    await form.locator('[data-testid="action-save"]').click();
    await expect(page.getByText('Action created')).toBeVisible();
    const item = plan.locator('[data-testid="action-item"]', { hasText: title });
    await expect(item).toBeVisible();
    await expect(item.locator('[data-testid="action-metric"]')).toContainText(/Test coverage .*baseline/);
    await item.locator('[data-testid="action-status"]').selectOption('in_progress');
    await expect(item).toContainText('In progress');

    await page.goto(`http://localhost:5173/tv?team=${encodeURIComponent(team.id)}`);
    await page.mouse.move(300, 300);
    await page.locator('button:has-text("Focus areas")').first().click();
    await expect(page.locator('[data-testid="tv-tracked-actions"]')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-testid="tv-tracked-actions"]')).not.toContainText('Team Lead'); // no owner names on TV

    // Clean up.
    const ctx = await api(page);
    const { actions } = await (await ctx.get(`/api/actions?teamId=${encodeURIComponent(team.id)}`)).json();
    for (const a of actions.filter((x: any) => x.title === title)) await ctx.delete(`/api/actions/${a.id}`);
    await ctx.dispose();
  });
});
