import { test, expect, TAG } from '../support/fixtures';
import { ALL_ROLES, DEMO, type Role } from '../support/roles';
import { trackPageErrors } from '../support/app';

/**
 * Business impact / revenue impact (src/components/BusinessImpactAnalysisV2.tsx, RevenueImpact.tsx)
 * beyond tests/e2e/revenue-impact.spec.ts: the tabs per role (the "All teams" roll-up is for super
 * admins and managers) and odd what-if inputs (empty, huge, negative) that must not break the page.
 */

const ROLLUP: Role[] = ['admin', 'manager'];

test.describe('Business impact', { tag: [TAG.area('business-impact')] }, () => {
  for (const role of ALL_ROLES) {
    test(`BIZ-01 ${role}: money summary first; "All teams" only for super admins and managers`, { tag: [TAG.role(role)] }, async ({ signInAs, page }) => {
      await signInAs(role, '/analytics/business-impact');
      await expect(page.getByTestId('revenue-money').or(page.getByText('Revenue impact not available')).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'All teams', exact: true })).toHaveCount(ROLLUP.includes(role) ? 1 : 0);
    });
  }

  test('BIZ-02 what-if with empty, huge and negative changes keeps the page working', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    const noErrors = trackPageErrors(page);
    await signInAs('admin', `/analytics/business-impact?team=${DEMO.leadTeam.id}`);
    await page.getByRole('button', { name: 'What-if', exact: true }).click();
    const change = page.getByTestId('whatif-change');
    const result = page.getByTestId('whatif-result');
    for (const v of ['', '-5', '99999999', '0', '0.00001']) {
      await change.fill(v);
      await expect(result).toBeVisible();
      await expect(result).not.toContainText(/NaN|Infinity|undefined/);
    }
    noErrors();
  });
});
