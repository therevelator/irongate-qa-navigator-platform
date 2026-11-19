import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import dotenv from 'dotenv';

/**
 * Wellbeing pulse non-response handling in the UI: a member who has not answered sees the
 * app-wide banner (warning delay 0 days here), opens the survey from it and answers; the banner
 * then goes away. The team's lead edits the reminder and escalation settings.
 * Own fixture team (e2e-prem-*) in the IronGate company, created and removed in the LOCAL database.
 */

dotenv.config();

const TEAM = 'e2e-prem-team';
const USER = 'e2e-prem-user';
const LEAD = 'e2e-prem-lead';
const EMAIL = 'e2e-prem-user@irongate.test';
const LEAD_EMAIL = 'e2e-prem-lead@irongate.test';

async function db(): Promise<Client> {
  const url = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/irongate_dev');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error(`Refusing non-local database host ${url.hostname}`);
  const client = new Client({
    host: url.hostname, port: parseInt(url.port || '5432', 10), user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), database: url.pathname.slice(1),
  });
  await client.connect();
  return client;
}

async function cleanup(c: Client) {
  await c.query(`DELETE FROM role_assignments WHERE user_id IN ($1, $2) OR scope_id = $3`, [USER, LEAD, TEAM]);
  await c.query(`DELETE FROM team_members WHERE user_id IN ($1, $2) OR team_id = $3`, [USER, LEAD, TEAM]);
  await c.query(`DELETE FROM audit_log WHERE entity_id = $1`, [TEAM]).catch(() => undefined);
  await c.query(`DELETE FROM user_activity WHERE user_id IN ($1, $2)`, [USER, LEAD]).catch(() => undefined);
  await c.query(`DELETE FROM users WHERE id IN ($1, $2)`, [USER, LEAD]);
  await c.query(`DELETE FROM teams WHERE id = $1`, [TEAM]); // pulse rows cascade
}

async function signIn(page: Page, email: string) {
  await page.goto('http://localhost:5173');
  await page.waitForSelector('input[type="email"]', { timeout: 30000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', 'demo123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });
}

test.describe('Wellbeing pulse reminders', { tag: ['@area:pulse'] }, () => {
  // Written for one worker: these tests run in order, in one worker (a failure does not skip the rest).
  test.describe.configure({ mode: 'default' });
  test.setTimeout(90000);

  test.beforeAll(async () => {
    const c = await db();
    try {
      await cleanup(c);
      const eng = (await c.query(`SELECT company_id, department_id, password_hash FROM users WHERE email = 'engineer@irongate.com'`)).rows[0];
      const today = (await c.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`)).rows[0].d;
      await c.query(`INSERT INTO teams (id, company_id, department_id, name, is_active, ai_enabled, exclude_from_auto_sync) VALUES ($1, $2, $3, 'E2E Reminder Team', TRUE, FALSE, TRUE)`,
        [TEAM, eng.company_id, eng.department_id]);
      for (const [id, mail, role, first] of [[USER, EMAIL, 'qa_engineer', 'Remi'], [LEAD, LEAD_EMAIL, 'team_lead', 'Lena']]) {
        await c.query(
          `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, is_active, email_verified)
           VALUES ($1, $2, $3, $4, 'Tester', $5, $6, $7, $8, TRUE, TRUE)`,
          [id, mail, eng.password_hash, first, role, eng.company_id, eng.department_id, TEAM]);
        await c.query(`INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id) VALUES ($1, $2, $3, $4, 'team', $5)`,
          [`${id}-ra`, eng.company_id, id, role, TEAM]);
      }
      // Weekly from today; the survey went out today; warning right away.
      await c.query(`INSERT INTO pulse_cadences (company_id, team_id, cadence, effective_from) VALUES ($1, $2, 'weekly', $3::date)`, [eng.company_id, TEAM, today]);
      await c.query(`INSERT INTO pulse_settings (team_id, company_id, auto_send, auto_send_decided, warning_after_days) VALUES ($1, $2, FALSE, FALSE, 0)`, [TEAM, eng.company_id]);
      await c.query(
        `INSERT INTO pulse_sends (company_id, team_id, period_start, period_end, kind, trigger, channel, recipients, delivered)
         VALUES ($1, $2, $3::date, ($3::date + 7), 'survey', 'manual', 'log', 2, 0)`, [eng.company_id, TEAM, today]);
    } finally {
      await c.end();
    }
  });

  test.afterAll(async () => {
    const c = await db();
    try { await cleanup(c); } finally { await c.end(); }
  });

  test('a member sees the banner, answers from it, and the banner goes away', async ({ page }) => {
    await signIn(page, EMAIL);
    const banner = page.locator('[data-testid="pulse-pending-banner"]');
    await expect(banner).toContainText("Your team's wellbeing pulse is waiting — it takes 1 minute. Your answers are anonymous.");
    await page.click('[data-testid="pulse-pending-open"]');
    await expect(page).toHaveURL(new RegExp(`/analytics/pulse\\?team=${TEAM}`));
    await expect(page.getByText('Your manager can see whether you have responded, not what you answered.')).toBeVisible({ timeout: 30000 });
    for (const q of ['workload', 'focus', 'support', 'energy', 'outlook']) await page.locator(`label[for="pulse-${q}-4"]`).click();
    await page.click('[data-testid="pulse-submit"]');
    await expect(page.locator('[data-testid="pulse-already-answered"]')).toBeVisible();
    await page.reload();
    await page.waitForSelector('[data-testid="pulse-already-answered"]', { timeout: 30000 });
    await expect(banner).toHaveCount(0);
  });

  test('the lead sees "Not today" hide it, and edits the reminder settings', async ({ page }) => {
    await signIn(page, LEAD_EMAIL);
    await expect(page.locator('[data-testid="pulse-pending-banner"]')).toBeVisible();
    await page.click('[data-testid="pulse-pending-hide"]');
    await expect(page.locator('[data-testid="pulse-pending-banner"]')).toHaveCount(0);
    await page.goto(`http://localhost:5173/analytics/pulse?team=${TEAM}`);
    const card = page.locator('[data-testid="pulse-reminders"]');
    await expect(card).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid="pulse-escalation-recipients"]')).toContainText('Lena Tester');
    await page.fill('[data-testid="pulse-escalateAfterDays"]', '10');
    await page.click('[data-testid="pulse-reminders-save"]');
    await expect(page.locator('[data-testid="pulse-effective"]')).toContainText('escalation after 6 days');
  });
});
