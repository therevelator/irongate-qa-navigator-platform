import { test, expect, TAG } from '../support/fixtures';
import { withDb } from '../support/db';

/**
 * The latest data when nothing new arrived for over a day (FI-22): a fresh organisation whose
 * only KPI snapshots end two days ago. The overview, team detail and TV mode show the latest
 * snapshot's QA score (as it stood then) with "Last updated <date>", never "No data".
 */

const DAY = 86_400_000;
const dayIso = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const shown = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

test.describe('Latest data older than a day', { tag: [TAG.area('dashboard')] }, () => {
  test('LATEST-01 overview, team detail and TV mode show the latest snapshot with "Last updated"', async ({ freshCompany, signInAs, page }) => {
    await withDb(async (c) => {
      for (const [day, coverage] of [[dayIso(-3), 80], [dayIso(-2), 82]] as const) {
        await c.query(
          `INSERT INTO kpi_snapshots (team_id, snapshot_date, test_coverage, defect_escape_rate, change_failure_rate, code_quality_score, automation_coverage, test_flakiness_rate)
           VALUES ($1, $2, $3, 4, 6, 80, 72, 1.5)`,
          [freshCompany.teamId, day, coverage]);
      }
    });
    const lastUpdated = `Last updated ${shown(dayIso(-2))}`;

    await signInAs({ email: freshCompany.email, password: freshCompany.password });
    await expect(page.getByTestId('last-updated').first()).toHaveText(lastUpdated);
    await expect(page.getByText('No KPI snapshots recorded')).toHaveCount(0);
    await expect(page.getByText('No KPI data available')).toHaveCount(0);
    const card = page.getByTestId('team-card').filter({ hasText: freshCompany.teamName });
    await expect(card).toBeVisible();
    await expect(card).not.toContainText('No data');

    await card.click();
    await expect(page.getByRole('heading', { name: freshCompany.teamName })).toBeVisible();
    await expect(page.getByTestId('last-updated')).toHaveText(lastUpdated);
    await expect(page.getByText(/Based on 4 of 4 inputs/).first()).toBeVisible();

    await page.goto(`/tv?team=${freshCompany.teamId}`);
    await expect(page.getByTestId('tv-mode')).toBeVisible();
    await expect(page.getByTestId('last-updated')).toHaveText(lastUpdated);
    await expect(page.getByText('No QA score recorded')).toHaveCount(0);
  });
});
