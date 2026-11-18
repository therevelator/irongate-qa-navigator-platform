import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import dotenv from 'dotenv';
import { setupAuth } from './fixtures/auth';

/**
 * Wellbeing pulse survey and privacy in the UI: a team member answers the anonymous survey once
 * per period and sees the team's results (closed periods with at least 3 responses); an admin sees
 * the results and comments but cannot answer for a team they do not belong to; a team below 3
 * responses shows "Not shown: fewer than 3 contributors".
 *
 * Uses its own fixture teams (e2e-pulse-*) in the IronGate company, created and removed through the
 * LOCAL database, so re-runs always start with an unanswered period.
 */

dotenv.config();

const TEAM = 'e2e-pulse-team';
const SMALL = 'e2e-pulse-small';
const USER = 'e2e-pulse-user';
const EMAIL = 'e2e-pulse-user@irongate.test';

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
  await c.query(`DELETE FROM role_assignments WHERE user_id = $1 OR scope_id IN ($2, $3)`, [USER, TEAM, SMALL]);
  await c.query(`DELETE FROM team_members WHERE user_id = $1 OR team_id IN ($2, $3)`, [USER, TEAM, SMALL]);
  await c.query(`DELETE FROM audit_log WHERE entity_id IN ($1, $2)`, [TEAM, SMALL]).catch(() => undefined);
  await c.query(`DELETE FROM users WHERE id = $1`, [USER]);
  await c.query(`DELETE FROM teams WHERE id IN ($1, $2)`, [TEAM, SMALL]); // pulse rows cascade
}

/** The period before the running one, as server/lib/pulseRules.ts counts it (default: biweekly from 2026-01-05). */
function previousDefaultPeriod(today: string): { start: string; end: string } {
  const day = (s: string) => Math.floor(Date.parse(`${s}T00:00:00Z`) / 86400000);
  const str = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
  const anchor = day('2026-01-05');
  const start = anchor + Math.floor((day(today) - anchor) / 14) * 14;
  return { start: str(start - 14), end: str(start) };
}

test.describe('Wellbeing pulse survey', () => {
  test.setTimeout(90000);

  test.beforeAll(async () => {
    const c = await db();
    try {
      await cleanup(c);
      const eng = (await c.query(`SELECT company_id, department_id, password_hash FROM users WHERE email = 'engineer@irongate.com'`)).rows[0];
      const today = (await c.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`)).rows[0].d;
      for (const [id, name] of [[TEAM, 'E2E Pulse Team'], [SMALL, 'E2E Pulse Small Team']]) {
        await c.query(
          `INSERT INTO teams (id, company_id, department_id, name, is_active, ai_enabled, exclude_from_auto_sync) VALUES ($1, $2, $3, $4, TRUE, FALSE, TRUE)`,
          [id, eng.company_id, eng.department_id, name]
        );
      }
      await c.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, is_active, email_verified)
         VALUES ($1, $2, $3, 'Pulse', 'Tester', 'qa_engineer', $4, $5, $6, TRUE, TRUE)`,
        [USER, EMAIL, eng.password_hash, eng.company_id, eng.department_id, TEAM]
      );
      await c.query(
        `INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id) VALUES ('e2e-pulse-ra', $1, $2, 'qa_engineer', 'team', $3)`,
        [eng.company_id, USER, TEAM]
      );
      const p = previousDefaultPeriod(today);
      const add = async (team: string, v: number, comment: string | null) => c.query(
        `INSERT INTO pulse_responses (company_id, team_id, period_start, period_end, q_workload, q_focus, q_support, q_energy, q_outlook, comment)
         VALUES ($1, $2, $3, $4, $5, $5, $5, $5, $5, $6)`,
        [eng.company_id, team, p.start, p.end, v, comment]
      );
      // Last period: 3 answers (shown) for the team, 2 (suppressed) for the small team.
      await add(TEAM, 5, 'Retro actions helped');
      await add(TEAM, 4, null);
      await add(TEAM, 3, null);
      await add(SMALL, 5, 'Only two of us');
      await add(SMALL, 1, null);
    } finally {
      await c.end();
    }
  });

  test.afterAll(async () => {
    const c = await db();
    try { await cleanup(c); } finally { await c.end(); }
  });

  async function signIn(page: Page, email: string) {
    await page.goto('http://localhost:5173');
    await page.waitForSelector('input[type="email"]', { timeout: 30000 });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });
  }

  test('A team member answers the survey once and sees the team results', async ({ page }) => {
    await signIn(page, EMAIL);
    await page.click('[data-testid="nav-toggle"]');
    await page.click('[data-testid="nav-team-pulse"]');
    await expect(page).toHaveURL(/\/analytics\/pulse/);
    const form = page.locator('[data-testid="pulse-form"]');
    await expect(form).toBeVisible({ timeout: 15000 });
    // Last period's results: (mean 4 - 1) / 4 x 100 = 75.
    await expect(page.locator('[data-testid="pulse-latest"]')).toContainText('75');
    await expect(page.locator('[data-testid="pulse-latest"]')).toContainText('4.0');
    // Members see the averages, not the comments.
    await expect(page.getByText('Retro actions helped')).toHaveCount(0);

    // Sending with a question unanswered is refused in the form.
    const pick = (q: string, v: number) => page.click(`label[for="pulse-${q}-${v}"]`);
    await pick('workload', 4);
    await expect(page.locator('[data-testid="pulse-workload-4"]')).toBeChecked();
    await page.click('[data-testid="pulse-submit"]');
    await expect(form.locator('[role="alert"]')).toContainText('Answer every question');

    for (const [q, v] of [['focus', 3], ['support', 5], ['energy', 2], ['outlook', 4]] as const) {
      await pick(q, v);
    }
    await page.fill('[data-testid="pulse-comment"]', 'Fewer meetings please');
    await page.click('[data-testid="pulse-submit"]');
    await expect(page.locator('[data-testid="pulse-already-answered"]')).toBeVisible();
    await expect(page.locator('[data-testid="pulse-form"]')).toHaveCount(0);
    // The running period is never shown, so the new answer does not change the results.
    await expect(page.locator('[data-testid="pulse-latest"]')).toContainText('75');

    await page.reload();
    await expect(page.locator('[data-testid="pulse-already-answered"]')).toBeVisible({ timeout: 15000 });
  });

  test('An admin sees results and comments but cannot answer for a team they are not in', async ({ page }) => {
    await setupAuth(page, 'super_admin');
    await page.goto(`http://localhost:5173/analytics/pulse?team=${TEAM}`);
    await expect(page.locator('[data-testid="pulse-latest"]')).toContainText('75', { timeout: 15000 });
    await expect(page.getByText('Retro actions helped')).toBeVisible();
    await expect(page.locator('[data-testid="pulse-not-member"]')).toBeVisible();
    await expect(page.locator('[data-testid="pulse-cadence"]')).toBeVisible();
  });

  test('A team with fewer than 3 responses shows no results', async ({ page }) => {
    await setupAuth(page, 'super_admin');
    await page.goto(`http://localhost:5173/analytics/pulse?team=${SMALL}`);
    await expect(page.locator('[data-testid="pulse-latest-suppressed"]')).toContainText('Not shown: fewer than 3 contributors', { timeout: 15000 });
    await expect(page.getByText('Only two of us')).toHaveCount(0);
    await expect(page.locator('[data-testid="pulse-trend-suppressed"]')).toBeVisible();
  });

  test('Developer productivity withholds team figures below 3 opted-in developers', async ({ page }) => {
    // Sample company: Checkout Core has one developer who opted in to developer insights.
    await signIn(page, 'alex.morgan@northwind.example');
    await page.goto('http://localhost:5173/analytics/productivity?team=demo-team-checkout');
    await expect(page.locator('[data-testid="dev-summary-suppressed"]').first()).toContainText('Not shown: fewer than 3 contributors', { timeout: 15000 });
    await expect(page.locator('[data-testid="ddps-history-suppressed"]')).toBeVisible();
    // A team with enough developers shows the team averages.
    await page.goto('http://localhost:5173/analytics/productivity?team=demo-team-fraud');
    await expect(page.getByText('Team avg DDPS')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="dev-summary-suppressed"]')).toHaveCount(0);
  });

  test('The dashboard shows Wellbeing (survey) and engineering health includes it', async ({ page }) => {
    await setupAuth(page, 'super_admin');
    await expect(page.getByText('Wellbeing (survey)').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Delivery, pipeline, debt, wellbeing survey|Excludes/).first()).toBeVisible();
  });
});
