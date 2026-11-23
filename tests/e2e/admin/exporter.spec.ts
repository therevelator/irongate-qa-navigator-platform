import type { Page } from '@playwright/test';
import { test, expect, TAG } from '../support/fixtures';
import { API_URL } from '../support/env';
import { operatorSignIn } from '../support/operator';

/**
 * The QE Navigator Exporter in the app: Admin console → Connect your CI explains it (raw data in, QE Navigator
 * calculates) with the company, department and team ids filled in; a batch the Exporter sends (here: the same JSON
 * envelope, sent by the test) lands in the team, the heartbeat shows in Exporter status, the Ingestion log marks it
 * Exporter, and "How this was calculated" shows the value QE Navigator calculated. The operator panel lists the batch
 * in Exporter deliveries with its sanitised preview.
 */

async function openTeam(page: Page, name: string) {
  await page.getByLabel('Search teams').fill(name);
  await page.getByTestId('team-card').filter({ hasText: name }).first().click();
  await expect(page.getByTestId('team-detail')).toBeVisible();
}

const JUNIT = '<testsuites><testsuite name="s" time="1.5"><testcase classname="checkout" name="pays" time="0.5"/><testcase classname="checkout" name="refunds" time="1"><failure/></testcase></testsuite></testsuites>';

test.describe('QE Navigator Exporter', { tag: [TAG.area('admin'), TAG.area('ci-evidence')] }, () => {
  test('EXP-01 Connect your CI explains the Exporter; a batch lands in the team; status, ingestion log and the calculated value show it', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page, request, app }) => {
    await signInAs(freshCompany, '/admin-panel');
    const agent = page.getByTestId('connect-ci-agent');
    await expect(agent).toContainText('QE Navigator Exporter');
    await expect(agent).toContainText('QE Navigator calculates every value; the Exporter calculates nothing');
    await expect(agent).not.toContainText('privacy mode');
    await expect(page.getByTestId('connect-ci-company-id')).toHaveText(freshCompany.id);
    const code = agent.getByTestId('connect-ci-agent-snippet');
    await expect(code).toContainText('qe-exporter:0.4.0 setup');
    await agent.getByRole('tab', { name: 'Config file' }).click();
    await expect(code).toContainText(`companyId: ${freshCompany.id}`);
    await expect(code).toContainText(`${freshCompany.teamId}: ${freshCompany.departmentId}`);
    await expect(page.getByTestId('connect-ci-exporter-status')).toContainText('No Exporter has reported yet');

    await page.getByPlaceholder('Key name, e.g. Jenkins production').fill('Exporter UI key');
    // An Exporter key: it may also read the company context (a plain ingest key gets 403 there).
    await page.getByTestId('api-key-scope').selectOption('exporter');
    await page.getByRole('button', { name: 'Create key' }).click();
    const key = (await page.getByTestId('api-key-created').locator('code').innerText()).trim();
    await page.getByRole('button', { name: 'Done' }).click();

    const headers = { Authorization: `Bearer ${key}`, 'User-Agent': 'qe-exporter/0.3.0 (ui test)', 'Content-Type': 'application/json' };
    const envelope = {
      companyId: freshCompany.id, departmentId: freshCompany.departmentId, teamId: freshCompany.teamId, source: 'github', kind: 'test-report',
      items: [{ commit: 'abcd1234', branch: 'main', run: 'ui-1', attempt: 1, startedAt: new Date(Date.now() - 3600_000).toISOString(), files: [{ name: 'junit.xml', content: JUNIT }] }],
    };
    const sent = await request.post(`${API_URL}/ingest/exporter/batch`, { headers, data: envelope });
    expect(sent.status(), await sent.text()).toBe(201);
    const wrong = await request.post(`${API_URL}/ingest/exporter/batch`, { headers, data: { ...envelope, teamId: 'not-a-team-of-yours' } });
    expect(wrong.status()).toBe(403);
    const ctx = await request.get(`${API_URL}/ingest/exporter/context`, { headers });
    expect(ctx.status(), await ctx.text()).toBe(200);
    const hb = await request.post(`${API_URL}/ingest/exporter/heartbeat`, { headers, data: { exporter: 'qe-exporter/0.3.0', version: '0.3.0', sources: [{ name: 'github', type: 'github', lastSuccessAt: new Date().toISOString(), errors: 0 }] } });
    expect(hb.status()).toBe(200);

    await page.reload();
    const status = page.getByTestId('connect-ci-exporter-row');
    await expect(status).toContainText('Exporter UI key');
    await expect(status).toContainText('0.3.0');
    await expect(status).toContainText('github (github): last success');
    await expect(page.getByTestId('connect-ci-row').filter({ hasText: freshCompany.teamName })).toContainText('junit');

    await app.go('nav-ingestion-log', 'Ingestion log');
    const entry = page.getByTestId('ingestion-entry').filter({ hasText: 'tests (junit)' }).first();
    await expect(entry.getByTestId('ingestion-entry-agent')).toContainText('Exporter');

    await page.goto('/');
    await openTeam(page, freshCompany.teamName);
    await page.getByTestId('how-calculated-first_time_pass_rate').click();
    await expect(page.getByRole('dialog')).toContainText('Written to the team’s KPI as source “computed”');
    await expect(page.getByRole('dialog')).not.toContainText('Collector');
  });

  test('EXP-02 the operator sees the batches in Exporter deliveries, with the summary and the sanitised preview', { tag: [TAG.area('operator')] }, async ({ freshCompany, page, request }) => {
    // A key and a batch for this company (through the API), then the operator panel.
    const login = await request.post(`${API_URL}/auth/login`, { data: { email: freshCompany.email, password: freshCompany.password } });
    expect(login.ok()).toBeTruthy();
    const k = await request.post(`${API_URL}/admin/api-keys`, { data: { name: 'Exporter operator key' } });
    const key = (await k.json()).plaintextKey;
    const envelope = {
      companyId: freshCompany.id, departmentId: freshCompany.departmentId, teamId: freshCompany.teamId, source: 'jira', kind: 'issues',
      items: [{ key: 'EXP-1', type: 'bug', status: 'Done', statusCategory: 'done', createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(), resolvedAt: new Date(Date.now() - 86_400_000).toISOString(), description: 'a secret description' }],
    };
    const headers = { Authorization: `Bearer ${key}`, 'User-Agent': 'qe-exporter/0.3.0 (ui test)', 'X-Exporter-Host': 'ui-host' };
    // A field QE Navigator does not store (a description) is refused with a message, never silently dropped.
    const refused = await request.post(`${API_URL}/ingest/exporter/batch`, { headers, data: envelope });
    expect(refused.status()).toBe(400);
    expect(await refused.text()).toContain('unknown field(s) description');
    const { description: _d, ...item } = envelope.items[0];
    const sent = await request.post(`${API_URL}/ingest/exporter/batch`, { headers, data: { ...envelope, items: [item] } });
    expect(sent.status(), await sent.text()).toBe(201);

    await operatorSignIn(page);
    await page.getByRole('button', { name: 'Exporter deliveries', exact: true }).click();
    const list = page.getByTestId('op-exporter-deliveries');
    await expect(list).toBeVisible();
    await list.getByTestId('ed-team').fill(freshCompany.teamId);
    await list.getByTestId('ed-apply').click();
    const row = list.getByTestId('op-exporter-delivery').first();
    await expect(row).toContainText(freshCompany.name);
    await expect(row).toContainText('jira · issues');
    await expect(row).toContainText('accepted');
    await expect(row).toContainText('ui-host');
    await row.getByTestId('ed-open').click();
    const preview = page.getByTestId('ed-preview');
    await expect(preview).toContainText('EXP-1');
    await expect(preview).not.toContainText('secret description');
    await expect(page.getByTestId('ed-detail')).not.toContainText(key);
  });
});
