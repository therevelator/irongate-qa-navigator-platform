import fs from 'fs';
import { createHash, randomBytes } from 'crypto';
import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import dotenv from 'dotenv';
import { setupAuth } from './fixtures/auth';

/**
 * Sending the wellbeing pulse: an admin presses "Send survey to the team", a member answers through
 * the personal link (no sign-in), sees the thank-you, the link then reports "Already answered"; the
 * team's closed period (seeded through the LOCAL database) shows its results with the response
 * rate; the lead cannot change the cadence (managers decide); nobody sees who answered.
 *
 * Own fixture team (e2e-psend-*) in the IronGate company, created and removed through the database.
 * The link's token only exists in the e-mail: with MAIL_CAPTURE_FILE (development aid of the log
 * mailer) it is read from there, otherwise a link is issued for the member the same way the server
 * does (only the sha256 is stored).
 */

dotenv.config();

const TEAM = 'e2e-psend-team';
const USERS = ['e2e-psend-u1', 'e2e-psend-u2', 'e2e-psend-u3', 'e2e-psend-u4'];
const email = (id: string) => `${id}@irongate.test`;

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
  await c.query(`DELETE FROM role_assignments WHERE scope_id = $1 OR user_id = ANY($2)`, [TEAM, USERS]);
  await c.query(`DELETE FROM audit_log WHERE entity_id = $1`, [TEAM]).catch(() => undefined);
  await c.query(`DELETE FROM teams WHERE id = $1`, [TEAM]); // pulse rows cascade
  await c.query(`DELETE FROM users WHERE id = ANY($1)`, [USERS]);
}

/** Default cadence (biweekly from Monday 2026-01-05): the running and the previous period. */
function periods(today: string) {
  const day = (s: string) => Math.floor(Date.parse(`${s}T00:00:00Z`) / 86400000);
  const str = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
  const anchor = day('2026-01-05');
  const start = anchor + Math.floor((day(today) - anchor) / 14) * 14;
  return { current: { start: str(start), end: str(start + 14) }, previous: { start: str(start - 14), end: str(start) } };
}

let company = '';
let today = '';

test.describe('Wellbeing pulse: sending and answering through the link', () => {
  test.setTimeout(120000);

  test.beforeAll(async () => {
    const c = await db();
    try {
      await cleanup(c);
      const eng = (await c.query(`SELECT company_id, department_id, password_hash FROM users WHERE email = 'engineer@irongate.com'`)).rows[0];
      company = eng.company_id;
      today = (await c.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`)).rows[0].d;
      await c.query(
        `INSERT INTO teams (id, company_id, department_id, name, is_active, ai_enabled, exclude_from_auto_sync) VALUES ($1, $2, $3, 'E2E Pulse Send Team', TRUE, FALSE, TRUE)`,
        [TEAM, eng.company_id, eng.department_id]
      );
      for (const [i, id] of USERS.entries()) {
        await c.query(
          `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, is_active, email_verified)
           VALUES ($1, $2, $3, 'Send', $4, 'qa_engineer', $5, $6, $7, TRUE, TRUE)`,
          [id, email(id), eng.password_hash, `Member${i + 1}`, eng.company_id, eng.department_id, TEAM]
        );
        await c.query(`INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id) VALUES ($1, $2, $3, 'qa_engineer', 'team', $4)`,
          [`${id}-ra`, eng.company_id, id, TEAM]);
      }
      // The previous (closed) period: 3 answers, e-mailed to all 4 members -> 75% response rate.
      const { previous } = periods(today);
      for (const v of [5, 4, 3]) {
        await c.query(
          `INSERT INTO pulse_responses (company_id, team_id, period_start, period_end, q_workload, q_focus, q_support, q_energy, q_outlook)
           VALUES ($1, $2, $3, $4, $5, $5, $5, $5, $5)`, [eng.company_id, TEAM, previous.start, previous.end, v]);
      }
      for (const id of USERS) {
        await c.query(`INSERT INTO pulse_recipients (company_id, team_id, user_id, period_start, period_end, delivered) VALUES ($1, $2, $3, $4, $5, TRUE)`,
          [eng.company_id, TEAM, id, previous.start, previous.end]);
      }
    } finally {
      await c.end();
    }
  });

  test.afterAll(async () => {
    const c = await db();
    try { await cleanup(c); } finally { await c.end(); }
  });

  /** The personal link of a member for the running period (from the captured e-mail, else issued like the server does). */
  async function linkFor(userId: string): Promise<string> {
    const capture = process.env.MAIL_CAPTURE_FILE;
    if (capture && fs.existsSync(capture)) {
      const mails = fs.readFileSync(capture, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.to === email(userId));
      const m = mails.at(-1)?.text.match(/token=([A-Za-z0-9_%-]+)/);
      if (m) return decodeURIComponent(m[1]);
    }
    const token = `igp_${randomBytes(32).toString('base64url')}`;
    const { current } = periods(today);
    const c = await db();
    try {
      await c.query(
        `INSERT INTO pulse_links (token_hash, company_id, team_id, user_id, period_start, period_end, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $6::date)`,
        [createHash('sha256').update(token).digest('hex'), company, TEAM, userId, current.start, current.end]
      );
    } finally {
      await c.end();
    }
    return token;
  }

  const pick = async (page: Page, answers: Record<string, number>) => {
    for (const [q, v] of Object.entries(answers)) await page.click(`label[for="pulse-${q}-${v}"]`);
  };

  test('An admin sends the survey; the team sees the closed period with its response rate', async ({ page }) => {
    await setupAuth(page, 'super_admin');
    await page.goto(`http://localhost:5173/analytics/pulse?team=${TEAM}`);
    const panel = page.locator('[data-testid="pulse-send"]').first();
    await expect(panel).toBeVisible({ timeout: 15000 });
    await expect(panel.locator('[data-testid="pulse-send-status"]')).toContainText('Not sent yet for this period (4 members)');
    await expect(panel.locator('[data-testid="pulse-not-sent"] li')).toHaveCount(4);
    await panel.locator('[data-testid="pulse-send-button"]').click();
    // Without SMTP the page says so (nothing e-mailed; members answer in the app); with SMTP the count shows.
    await expect(panel.locator('[data-testid="pulse-send-log"]')).toContainText(/Survey sent to 4 members/, { timeout: 15000 });
    const c = await db();
    try {
      const links = (await c.query(`SELECT user_id, token_hash FROM pulse_links WHERE team_id = $1`, [TEAM])).rows;
      expect(links.map((l: any) => l.user_id).sort()).toEqual([...USERS].sort());
      expect(links.every((l: any) => /^[0-9a-f]{64}$/.test(l.token_hash))).toBe(true);
    } finally {
      await c.end();
    }
    // No personal link is ever shown on the page.
    expect(await page.content()).not.toMatch(/igp_|pulse\/answer\?token/);
    // Closed period: (mean 4 - 1) / 4 x 100 = 75, 3 responses of 4 e-mailed.
    await expect(page.locator('[data-testid="pulse-latest"]')).toContainText('75');
    await expect(page.locator('[data-testid="pulse-response-rate"]')).toContainText('75% (3 responses, survey e-mailed to 4 members)');
    // An admin may set every cadence.
    await expect(page.locator('[data-testid="pulse-cadence"] option')).toHaveText(['Every week', 'Every two weeks', 'Every month', 'Every three months']);
  });

  test('A member answers through the personal link without signing in; the link then works no more', async ({ page }) => {
    const token = await linkFor(USERS[0]);
    await page.goto(`http://localhost:5173/pulse/answer?token=${encodeURIComponent(token)}`);
    await expect(page.locator('[data-testid="pulse-link-form"]')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Wellbeing pulse · E2E Pulse Send Team')).toBeVisible();
    await page.click('[data-testid="pulse-submit"]');
    await expect(page.locator('[role="alert"]')).toContainText('Answer every question');
    await pick(page, { workload: 4, focus: 3, support: 5, energy: 4, outlook: 4 });
    await page.fill('[data-testid="pulse-comment"]', 'Answered from the e-mail');
    await page.click('[data-testid="pulse-submit"]');
    await expect(page.locator('[data-testid="pulse-link-thanks"]')).toBeVisible({ timeout: 15000 });

    const c = await db();
    try {
      const { current } = periods(today);
      const rows = (await c.query(`SELECT * FROM pulse_responses WHERE team_id = $1 AND period_start = $2`, [TEAM, current.start])).rows;
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0])).not.toContain('user_id');
      const part = (await c.query(`SELECT user_id FROM pulse_participation WHERE team_id = $1`, [TEAM])).rows.map((r: any) => r.user_id);
      expect(part).toEqual([USERS[0]]);
    } finally {
      await c.end();
    }
    await page.goto(`http://localhost:5173/pulse/answer?token=${encodeURIComponent(token)}`);
    await expect(page.locator('[data-testid="pulse-link-used"]')).toBeVisible({ timeout: 15000 });
    await page.goto('http://localhost:5173/pulse/answer?token=igp_not-a-valid-token-at-all');
    await expect(page.locator('[data-testid="pulse-link-invalid"]')).toBeVisible({ timeout: 15000 });
  });

  test('The send panel shows counts only, and the lead cannot change the cadence', async ({ page }) => {
    await setupAuth(page, 'super_admin');
    await page.goto(`http://localhost:5173/analytics/pulse?team=${TEAM}`);
    const panel = page.locator('[data-testid="pulse-send"]').first();
    await expect(panel).toBeVisible({ timeout: 15000 });
    // One answer so far: below 3, so not even the count is shown, and no name.
    await expect(panel.locator('[data-testid="pulse-send-answered"]')).toContainText('fewer than 3 responses so far');
    await expect(page.getByText('Answered from the e-mail')).toHaveCount(0);

    await page.context().clearCookies();
    await setupAuth(page, 'team_lead');
    await page.goto('http://localhost:5173/analytics/pulse');
    await expect(page.locator('[data-testid="pulse-send"]').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="pulse-cadence"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pulse-auto-readonly"]')).toContainText('QA managers decide');
  });
});
