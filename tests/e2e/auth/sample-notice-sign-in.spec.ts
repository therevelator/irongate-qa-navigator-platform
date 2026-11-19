import { test, expect, TAG } from '../support/fixtures';
import { sql } from '../support/db';
import { signInWithForm } from '../support/auth';

/**
 * SIGN-SN-01: a company that hides the sample-data notices (companies.settings.hideSampleDataNotice,
 * e.g. the Meridian showcase) shows no "Includes sample data" banner right after signing in with the
 * form: the sign-in answer carries hide_sample_notice like /api/auth/me (no reload needed).
 */
test.describe('Sign-in and the sample-data notice', { tag: [TAG.area('auth')] }, () => {
  test('SIGN-SN-01 the banner follows the company setting straight after the sign-in form', async ({ freshCompany, page, app }) => {
    // One sample (synthetic) value for the company's team, so the overview has sample data to flag.
    await sql(
      `INSERT INTO kpi_snapshots (team_id, snapshot_date, test_coverage, field_sources)
       VALUES ($1, CURRENT_DATE, 81, '{"test_coverage": {"source": "synthetic"}}'::jsonb)`,
      [freshCompany.teamId],
    );
    await page.goto('/');
    await signInWithForm(page, { email: freshCompany.email, password: freshCompany.password });
    await expect(page.getByTestId('sample-data-banner')).toBeVisible({ timeout: 30000 });
    await app.signOut();

    await sql(`UPDATE companies SET settings = COALESCE(settings, '{}'::jsonb) || '{"hideSampleDataNotice": true}'::jsonb WHERE id = $1`, [freshCompany.id]);
    await signInWithForm(page, { email: freshCompany.email, password: freshCompany.password });
    await expect(page.getByTestId('team-card').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('sample-data-banner')).toHaveCount(0);
  });
});
