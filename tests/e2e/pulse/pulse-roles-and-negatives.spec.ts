import { createHash, randomBytes } from 'crypto';
import { test, expect, TAG } from '../support/fixtures';
import { ALL_ROLES, DEMO, type Role } from '../support/roles';
import { createFixtureTeam, deleteFixtureTeam, type FixtureTeam } from '../support/data';
import { sql } from '../support/db';
import { API_URL } from '../support/env';

/**
 * Wellbeing pulse beyond tests/e2e/pulse-*.spec.ts: what each role gets on the pulse page, the
 * cadence change by a manager, reminder settings out of range, the escalation list of members who
 * have not answered, expired links, double submits and refusals by the API. Changes run on a fixture
 * team in the manager's department (removed afterwards); the demo team is only read.
 */

const CAN_SEND: Role[] = ['admin', 'manager', 'lead'];
const CAN_CADENCE: Role[] = ['admin', 'manager'];

let team: FixtureTeam;
let period: { start: string; end: string };
test.beforeAll(async ({ request }) => {
  team = await createFixtureTeam({ lead: true, members: 3 });
  await request.post(`${API_URL}/auth/login`, { data: { email: 'admin@irongate.com', password: 'demo123' } });
  const res = await request.get(`${API_URL}/pulse/teams/${team.id}`);
  period = (await res.json()).currentPeriod;
});
test.afterAll(async () => { await deleteFixtureTeam(team); });

test.describe('Wellbeing pulse: roles', { tag: [TAG.area('pulse')] }, () => {
  for (const role of ALL_ROLES) {
    test(`PUL-01 ${role} on the pulse page of ${DEMO.leadTeam.name}: send panel, cadence and reminders per role`, { tag: [TAG.role(role)] }, async ({ signInAs, page }) => {
      // engineer@ is not on that team: their own team is shown instead.
      await signInAs(role, `/analytics/pulse?team=${DEMO.leadTeam.id}`);
      await expect(page.getByTestId('pulse-privacy').or(page.getByTestId('team-wellbeing')).first()).toBeVisible();
      await expect(page.getByTestId('pulse-send')).toHaveCount(CAN_SEND.includes(role) ? 1 : 0);
      await expect(page.getByTestId('pulse-cadence')).toHaveCount(CAN_CADENCE.includes(role) ? 1 : 0);
      await expect(page.getByTestId('pulse-reminders')).toHaveCount(CAN_SEND.includes(role) ? 1 : 0);
      expect(await page.content()).not.toMatch(/igp_[A-Za-z0-9_-]{10,}/);
    });
  }

  test('PUL-02 the API refuses sending and cadence changes from roles without them', { tag: [TAG.negative, TAG.role('viewer'), TAG.role('lead')] }, async ({ signInAs, page, app }) => {
    await signInAs('viewer');
    const send = await page.request.post(`${API_URL}/pulse/teams/${DEMO.leadTeam.id}/send`);
    expect([403, 404]).toContain(send.status());
    await app.signOut();
    await signInAs('lead');
    const cadence = await page.request.put(`${API_URL}/pulse/teams/${DEMO.leadTeam.id}/cadence`, { data: { cadence: 'weekly' } });
    expect(cadence.status()).toBe(403);
  });
});

test.describe('Wellbeing pulse: changes on a fixture team', { tag: [TAG.area('pulse')] }, () => {
  test.describe.configure({ mode: 'serial' });

  test('PUL-10 a manager changes the cadence: it applies from the next period; choosing the current one cancels', { tag: [TAG.role('manager')] }, async ({ signInAs, page }) => {
    await signInAs('manager', `/analytics/pulse?team=${team.id}`);
    const cadence = page.getByTestId('pulse-cadence');
    await expect(cadence).toHaveValue('biweekly');
    await cadence.selectOption('monthly');
    await expect(page.getByText(/^Every month from .* \(the running period keeps its length\)\./)).toBeVisible();
    await expect(cadence).toHaveValue('monthly');
    await cadence.selectOption('biweekly');
    await expect(page.getByText(/^Stays every two weeks\./)).toBeVisible();
  });

  test('PUL-11 reminder settings outside the allowed range are refused with the reason', { tag: [TAG.negative, TAG.role('lead')] }, async ({ signInAs, page }) => {
    await signInAs({ email: team.leadEmail!, password: 'demo123' }, `/analytics/pulse?team=${team.id}`);
    const card = page.getByTestId('pulse-reminders');
    await expect(card).toBeVisible();
    await page.getByTestId('pulse-warningAfterDays').fill('99');
    await page.getByTestId('pulse-reminders-save').click();
    await expect(card.getByRole('alert')).toContainText('from 0 to 30');
    await page.getByTestId('pulse-warningAfterDays').fill('3');
    await page.getByTestId('pulse-reminders-save').click();
    await expect(page.getByText('Reminder settings saved.')).toBeVisible();
  });

  test('PUL-12 after the escalation the lead sees who has not answered (names only, never answers)', { tag: [TAG.role('lead')] }, async ({ signInAs, page }) => {
    await sql(
      `INSERT INTO pulse_sends (company_id, team_id, period_start, period_end, kind, trigger, recipients, delivered, escalated_to)
       VALUES ($1, $2, $3, $4, 'escalation', 'auto', 1, 1, ARRAY[$5]::varchar[])`,
      [DEMO.companyId, team.id, period.start, period.end, team.leadId]);
    await sql(
      `INSERT INTO pulse_nonresponder_days (team_id, company_id, period_start, day, user_ids) VALUES ($1, $2, $3, $3, $4::varchar[])`,
      [team.id, DEMO.companyId, period.start, [team.memberIds[0], team.memberIds[1]]]);
    await signInAs({ email: team.leadEmail!, password: 'demo123' }, `/analytics/pulse?team=${team.id}`);
    const list = page.getByTestId('pulse-non-responders');
    await expect(list).toContainText('Not answered yet (2)');
    await expect(list).toContainText('Fixture Member1');
    await expect(list).toContainText('Fixture Member2');
    await expect(list).not.toContainText('Fixture Member3');
  });

  test('PUL-13 people the escalation did not go to do not see the list', { tag: [TAG.negative, TAG.role('manager')] }, async ({ signInAs, page }) => {
    await signInAs('manager', `/analytics/pulse?team=${team.id}`);
    await expect(page.getByTestId('pulse-send')).toBeVisible();
    await expect(page.getByTestId('pulse-non-responders')).toHaveCount(0);
  });

  test('PUL-14 an expired personal link says the survey has closed', { tag: [TAG.negative] }, async ({ page }) => {
    const token = `igp_${randomBytes(32).toString('base64url')}`;
    await sql(
      `INSERT INTO pulse_links (token_hash, company_id, team_id, user_id, period_start, period_end, expires_at)
       VALUES ($1, $2, $3, $4, $5::date - 14, $5::date, now() - interval '1 hour')`,
      [createHash('sha256').update(token).digest('hex'), DEMO.companyId, team.id, team.memberIds[2], period.start]);
    await page.goto(`/pulse/answer?token=${token}`);
    await expect(page.getByTestId('pulse-link-expired')).toContainText('This survey has closed');
  });

  test('PUL-15 answering through a link with a double click records one answer', { tag: [TAG.negative] }, async ({ page }) => {
    const token = `igp_${randomBytes(32).toString('base64url')}`;
    await sql(
      `INSERT INTO pulse_links (token_hash, company_id, team_id, user_id, period_start, period_end, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $6::date)`,
      [createHash('sha256').update(token).digest('hex'), DEMO.companyId, team.id, team.memberIds[2], period.start, period.end]);
    await page.goto(`/pulse/answer?token=${token}`);
    await expect(page.getByTestId('pulse-link-form')).toBeVisible();
    for (const q of ['workload', 'focus', 'support', 'energy', 'outlook']) await page.click(`label[for="pulse-${q}-3"]`);
    await page.getByTestId('pulse-comment').fill('<b>bold?</b> 🚀 ünïcødé');
    await page.getByTestId('pulse-submit').dblclick();
    await expect(page.getByTestId('pulse-link-thanks')).toBeVisible();
    const rows = await sql(`SELECT count(*)::int AS n FROM pulse_responses WHERE team_id = $1 AND period_start = $2`, [team.id, period.start]);
    expect(rows[0].n).toBe(1);
  });

  test('PUL-16 the comment box keeps to its maximum length', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs({ email: team.memberEmails[0], password: 'demo123' }, `/analytics/pulse?team=${team.id}`);
    const comment = page.getByTestId('pulse-comment');
    await expect(comment).toBeVisible();
    const max = Number(await comment.getAttribute('maxlength'));
    expect(max).toBeGreaterThan(0);
    await comment.fill('x'.repeat(max + 50));
    expect((await comment.inputValue()).length).toBeLessThanOrEqual(max);
  });
});
