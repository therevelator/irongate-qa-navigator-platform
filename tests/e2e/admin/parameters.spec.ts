import http from 'http';
import type { AddressInfo } from 'net';
import { test, expect, TAG } from '../support/fixtures';
import { API_URL } from '../support/env';
import type { Page } from '@playwright/test';

/**
 * Parameters (src/components/ParametersConfiguration.tsx, KpiTargetsConfig.tsx, SessionSettings.tsx,
 * AlertSettings.tsx) and Expected update frequency (MetricIntervalsConfig.tsx). Company-wide changes
 * run in a fresh organisation (freshCompany fixture); the demo company is only read.
 */

const target = (page: Page, label: string) => ({
  good: page.getByLabel(`${label} target at this level`),
  watch: page.getByLabel(`${label} watch level at this level`),
});
const COVERAGE = 'Test coverage';

/** The targets and settings have loaded (the page loads them more than once in development: wait for quiet). */
async function ready(page: Page) {
  await expect(page.getByRole('button', { name: /Target history at this level/ })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

async function scope(page: Page, department: string | 'all', team: string | 'all' = 'all') {
  const field = (name: string) => page.locator('label').filter({ has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) }).locator('select');
  if (department === 'all') await field('Department').selectOption('all');
  else await field('Department').selectOption({ label: department });
  if (department !== 'all') await field('Team').selectOption(team === 'all' ? 'all' : { label: team });
  await ready(page);
}

test.describe('KPI targets', { tag: [TAG.area('parameters'), TAG.area('targets')] }, () => {
  test('PAR-01 a super admin sets a company target; it appears in the history', { tag: [TAG.smoke, TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/parameters-config');
    await ready(page);
    // "Apply to every department and team" is on by default for super admins.
    await expect(page.getByTestId('apply-to-all')).toBeChecked();
    await page.getByTestId('apply-to-all').uncheck();
    const t = target(page, COVERAGE);
    await t.good.fill('85');
    await t.watch.fill('75');
    await page.getByTestId('kpi-targets-save').click();
    await expect(page.getByText(`KPI targets saved (Company-wide). Earlier values keep their old targets.`)).toBeVisible();
    await expect(t.good).toHaveValue('85');
    await page.getByRole('button', { name: /Target history at this level \(1\)/ }).click();
    await expect(page.getByTestId('kpi-target-history')).toContainText('target 85 · watch 75');
    await page.reload();
    await expect(target(page, COVERAGE).good).toHaveValue('85');
  });

  test('PAR-02 the target form checks both values, numbers and the watch side', { tag: [TAG.negative] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/parameters-config');
    await ready(page);
    await page.getByTestId('apply-to-all').uncheck();
    const row = page.getByTestId('kpi-target-test_coverage');
    const t = target(page, COVERAGE);
    await t.good.fill('80');
    await expect(row.getByRole('alert')).toHaveText('Enter both values, or clear both to inherit');
    await expect(page.getByTestId('kpi-targets-save')).toBeDisabled();
    await t.watch.fill('90');
    await expect(row.getByRole('alert')).toHaveText('Watch level must be at or below the target');
    await expect(page.getByTestId('kpi-targets-save')).toBeDisabled();
    await t.good.fill('');
    await t.watch.fill('');
    await expect(row.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('kpi-targets-save')).toHaveText(/No changes/);
  });

  test('PAR-03 a coverage target above 100 % is refused by the API with its reason', { tag: [TAG.negative] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/parameters-config');
    await ready(page);
    const t = target(page, COVERAGE);
    await t.good.fill('150');
    await t.watch.fill('120');
    await page.getByTestId('kpi-targets-save').click();
    await expect(page.getByRole('status').filter({ hasText: /100|range|between/i })).toBeVisible();
    await page.getByRole('button', { name: /Target history at this level \(0\)/ }).click();
    await expect(page.getByText('No target has been set at this level; the level above applies.')).toBeVisible();
  });

  test('PAR-04 "Apply to every department and team" replaces a team\'s own target', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/parameters-config');
    await ready(page);
    await scope(page, freshCompany.departmentName, freshCompany.teamName);
    await expect(page.getByText(`Currently editing: Team: ${freshCompany.teamName}`)).toBeVisible();
    let t = target(page, COVERAGE);
    await t.good.fill('60');
    await t.watch.fill('50');
    await page.getByTestId('kpi-targets-save').click();
    await expect(page.getByText(/KPI targets saved/)).toBeVisible();

    await scope(page, 'all');
    await expect(page.getByTestId('apply-to-all')).toBeChecked();
    t = target(page, COVERAGE);
    await t.good.fill('90');
    await t.watch.fill('80');
    await expect(page.getByTestId('kpi-targets-save')).toHaveText(/for all departments/);
    await page.getByTestId('kpi-targets-save').click();
    await expect(page.getByText(/applied to every department and team \(1 department\/team target replaced\)/)).toBeVisible();

    await page.getByTestId('apply-to-all').uncheck();
    await scope(page, freshCompany.departmentName, freshCompany.teamName);
    await expect(target(page, COVERAGE).good).toHaveValue('');
    await expect(page.getByTestId('kpi-target-test_coverage')).toContainText('≥ 90');
  });

  test('PAR-05 a manager sees company targets read-only, no "apply to all", no sign-in or Slack settings', { tag: [TAG.negative, TAG.role('manager')] }, async ({ signInAs, page }) => {
    await signInAs('manager', '/parameters-config');
    await ready(page);
    // Saving company-level values never asks to replace other departments' values (the API refuses that
    // from a manager). The request is answered here, so the demo company is not changed.
    let body: any = null;
    await page.route(`${API_URL}/admin/configs`, (r) => { body = r.request().postDataJSON(); return r.fulfill({ json: { ok: true } }); });
    await page.getByRole('button', { name: 'Save configuration' }).click();
    await expect(page.getByText('Configuration saved (Company-wide)')).toBeVisible();
    expect(body?.applyToAll).toBeUndefined();
    await expect(page.getByText('Company-wide targets are set by super admins.', { exact: false })).toBeVisible();
    await expect(target(page, COVERAGE).good).toBeDisabled();
    await expect(page.getByTestId('kpi-targets-save')).toHaveCount(0);
    await expect(page.getByTestId('session-lifetime')).toHaveCount(0);
    await expect(page.getByTestId('slack-settings')).toHaveCount(0);
    await expect(page.getByTestId('apply-to-all')).toHaveCount(0);
  });

  test('PAR-06 the API refuses a company target from a manager', { tag: [TAG.negative, TAG.role('manager')] }, async ({ signInAs, page }) => {
    await signInAs('manager');
    const res = await page.request.put(`${API_URL}/targets`, { data: { scopeType: 'company', scopeId: null, targets: { test_coverage: { good: 1, warning: 0 } } } });
    expect(res.status()).toBe(403);
  });
});

test.describe('Configuration values and sign-in lifetime', { tag: [TAG.area('parameters')] }, () => {
  test('PAR-10 configuration values are saved and inherited fields stay empty', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/parameters-config');
    await ready(page);
    await page.getByTestId('apply-to-all').uncheck();
    const p95 = page.locator('label', { hasText: 'P95 response time (ms)' }).locator('input');
    await p95.fill('750');
    await page.getByRole('button', { name: 'Save configuration' }).click();
    await expect(page.getByRole('status').filter({ hasText: /saved/i })).toBeVisible();
    await page.reload();
    await expect(page.locator('label', { hasText: 'P95 response time (ms)' }).locator('input')).toHaveValue('750');
    await page.getByTestId('apply-to-all').check();
    await expect(page.getByRole('button', { name: 'Save for all departments' }).first()).toBeVisible();
  });

  test('PAR-11 a negative or non-numeric configuration value is not stored', { tag: [TAG.negative] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/parameters-config');
    await ready(page);
    await page.getByTestId('apply-to-all').uncheck();
    const p95 = page.locator('label', { hasText: 'P95 response time (ms)' }).locator('input');
    await p95.fill('-5');
    await page.getByRole('button', { name: 'Save configuration' }).click();
    await expect(page.getByText('P95 response time (ms): enter a number of 0 or more, or leave it empty to inherit.')).toBeVisible();
    await page.reload();
    await expect(page.locator('label', { hasText: 'P95 response time (ms)' }).locator('input')).not.toHaveValue('-5');
  });

  test('PAR-14 a configuration value above its range is refused by the page and by the API', { tag: [TAG.negative] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/parameters-config');
    await ready(page);
    await page.getByTestId('apply-to-all').uncheck();
    const rate = page.locator('label', { hasText: 'Error rate threshold (%)' }).locator('input');
    await rate.fill('150');
    await page.getByRole('button', { name: 'Save configuration' }).click();
    await expect(page.getByText('Error rate threshold (%): enter a number from 0 to 100, or leave it empty to inherit.')).toBeVisible();
    // Sent directly, the API refuses it with the same words and stores nothing (FI-10b).
    const res = await page.request.post(`${API_URL}/admin/configs`, { data: { departmentId: 'all', teamId: 'all', configs: { sla_error_rate_percent: '150', sla_response_time_ms: '-5' } } });
    expect(res.status()).toBe(400);
    expect((await res.json()).errors).toEqual([
      'Error rate threshold (%): enter a number from 0 to 100, or leave it empty to inherit.',
      'P95 response time (ms): enter a number of 0 or more, or leave it empty to inherit.',
    ]);
    await page.reload();
    await ready(page);
    await expect(page.locator('label', { hasText: 'Error rate threshold (%)' }).locator('input')).not.toHaveValue('150');
  });

  test('PAR-12 "Sign-in lasts" can be changed by a super admin; the label follows', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/parameters-config');
    await ready(page);
    const select = page.getByTestId('session-lifetime');
    await expect(select).toHaveValue('168');
    await expect(page.getByTestId('session-lifetime-save')).toBeDisabled();
    await select.selectOption('8');
    await page.getByTestId('session-lifetime-save').click();
    await expect(page.getByTestId('session-lifetime-current')).toContainText('Current: 8 hours.');
    await page.reload();
    await expect(page.getByTestId('session-lifetime')).toHaveValue('8');
  });

  test('PAR-13 expected update frequency: change, discard, save and reset to default', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/metric-intervals');
    const first = page.getByLabel(/ interval$/).first();
    const label = (await first.getAttribute('aria-label'))!.replace(/ interval$/, '');
    const original = await first.inputValue();
    await first.fill(String(Number(original) + 2));
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await expect(first).toHaveValue(original);
    await first.fill(String(Number(original) + 2));
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Expected update frequencies saved')).toBeVisible();
    const row = page.locator('li', { has: page.getByLabel(`${label} interval`) });
    await expect(row.getByText('Custom')).toBeVisible();
    await row.getByRole('button').click();
    await expect(page.getByText('Reset to default')).toBeVisible();
    await expect(row.getByText('Default')).toBeVisible();
  });
});

test.describe('Alert rules, Slack and the digest', { tag: [TAG.area('alerts'), TAG.area('slack')] }, () => {
  test('ALR-01 a super admin switches an alert rule off for the company and back', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/parameters-config');
    await ready(page);
    const toggle = page.getByTestId('alert-rule-metric_stale-toggle');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await page.getByTestId('alert-rules-save').click();
    await expect(page.getByText('Alert rules saved (Company-wide)')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('alert-rule-metric_stale')).toContainText('Off');
    await page.getByTestId('alert-rule-metric_stale-toggle').click();
    await page.getByTestId('alert-rules-save').click();
    await expect(page.getByText('Alert rules saved (Company-wide)')).toBeVisible();
  });

  test('ALR-02 a team rule inherits until "inherit" is unticked', async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/parameters-config');
    await ready(page);
    await scope(page, freshCompany.departmentName, freshCompany.teamName);
    const rule = page.getByTestId('alert-rule-score_drop');
    await expect(rule).toContainText('From');
    await expect(page.getByTestId('alert-rule-score_drop-toggle')).toBeDisabled();
    await rule.getByRole('checkbox').uncheck();
    await expect(page.getByTestId('alert-rule-score_drop-toggle')).toBeEnabled();
  });

  test('SLK-01 Slack: a webhook that is not Slack is refused; a valid one is stored masked, tested and removed', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    // A local receiver stands in for Slack (NOTIFY_SLACK_ALLOW_LOCAL=true, never in production).
    const received: string[] = [];
    const server = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { received.push(b); res.end('ok'); }); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;
    try {
      await signInAs(freshCompany, '/parameters-config');
    await ready(page);
      const input = page.getByTestId('slack-webhook-input');
      await input.fill('https://evil.example/hooks/abc');
      await page.getByTestId('slack-save').click();
      await expect(page.getByText('Enter a Slack incoming webhook URL (https://hooks.slack.com/services/…)')).toBeVisible();

      await input.fill(`http://127.0.0.1:${port}/services/UITEST/secretvalue1234`);
      await page.getByTestId('slack-save').click();
      await expect(page.getByText('Slack settings saved')).toBeVisible();
      await expect(input).toHaveValue('');
      await expect(input).toHaveAttribute('placeholder', /^Configured: /);
      expect(await page.content()).not.toContain('secretvalue');

      await page.getByRole('button', { name: 'Send test message' }).click();
      await expect.poll(() => received.length).toBeGreaterThan(0);
      await page.getByRole('button', { name: 'Remove webhook' }).click();
      await expect(page.getByText('Slack webhook removed')).toBeVisible();
      await expect(input).toHaveAttribute('placeholder', 'https://hooks.slack.com/services/…');
    } finally {
      server.close();
    }
  });

  test('DIG-01 "Evaluate alerts now" and the test digest report what they did', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/parameters-config');
    await ready(page);
    await page.getByTestId('alerts-evaluate').click();
    await expect(page.getByRole('status').filter({ hasText: /^Evaluated \d+ teams?: \d+ opened, \d+ resolved, \d+ still open\.$/ })).toBeVisible();
    await page.getByTestId('admin-send-test-digest').click();
    await expect(page.getByRole('status').filter({ hasText: /digest/i })).toBeVisible();
  });

  test('DIG-02 a team lead can send themselves a test digest; an engineer has no digest', { tag: [TAG.role('lead'), TAG.role('engineer')] }, async ({ signInAs, page, app }) => {
    await signInAs('lead', '/notifications?tab=preferences');
    await page.getByTestId('send-test-digest').click();
    await expect(page.getByText(/digest/i).last()).toBeVisible();
    await app.signOut();
    await signInAs('engineer', '/notifications?tab=preferences');
    await expect(page.getByTestId('notification-prefs')).toBeVisible();
    await expect(page.getByTestId('pref-digest')).toHaveCount(0);
    await expect(page.getByText('The weekly digest is sent to super admins, managers and team leads.')).toBeVisible();
  });

  test('DIG-03 notification preferences: nothing to save until something changes; a failed save is reported', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs('viewer', '/notifications?tab=preferences');
    await expect(page.getByTestId('prefs-save')).toBeDisabled();
    await page.getByTestId('pref-min-severity').selectOption('critical');
    await page.route(`${API_URL}/notifications/preferences`, (r) => (r.request().method() === 'PUT'
      ? r.fulfill({ status: 500, json: { error: 'Internal server error', requestId: 'rid-prefs' } }) : r.continue()));
    await page.getByTestId('prefs-save').click();
    await expect(page.getByText('Internal server error')).toBeVisible();
  });
});
