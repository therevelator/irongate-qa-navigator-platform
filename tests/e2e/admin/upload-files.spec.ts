import { test, expect, TAG } from '../support/fixtures';
import { DEMO } from '../support/roles';
import { checkA11y } from '../support/a11y';
import type { Page } from '@playwright/test';

/**
 * Upload files ("Level 0": Admin console → Upload files) in the app: a company that cannot connect its
 * tools exports files and uploads them. The preview comes first (nothing stored): detected type,
 * records, date range, the fields that will be stored, a minimised sample, warnings and what the export
 * cannot carry; a CSV whose columns are named differently is fixed in the column mapping and previewed
 * again; Upload stores, the result links to the ingestion log entry that names the file. Team leads
 * upload to the teams they lead; engineers have no entry. Accessibility in the four themes.
 */

const day = (n: number, h = 10) => {
  const d = new Date(Date.now() - n * 86_400_000);
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${String(d.getUTCDate()).padStart(2, '0')}/${m}/${String(d.getUTCFullYear()).slice(2)} ${h > 12 ? h - 12 : h}:00 ${h >= 12 ? 'PM' : 'AM'}`;
};
const iso = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 19) + 'Z';

/** A Jira "CSV (all fields)" export: BOM, description and comment columns, people, a sprint. */
const jiraCsv = () => '﻿' + [
  'Summary,Issue key,Issue Type,Status,Project key,Assignee,Created,Resolved,Description,Environment,Sprint,Custom field (Story Points),Status Category,Comment',
  `Refund fails,UIUP-1,Bug,Done,UIUP,dana@corp.example,${day(6)},${day(3)},"Steps:\nsecret repro",Production,Sprint 3,3,Done,"${day(4)};dana@corp.example;please retest"`,
  `Ledger slow,UIUP-2,Bug,Open,UIUP,,${day(5)},,x,Staging,Sprint 3,2,To Do,`,
  `Checkout story,UIUP-3,Story,Done,UIUP,,${day(8)},${day(2)},,,Sprint 3,5,Done,`,
].join('\r\n') + '\r\n';
const pagerdutyCsv = () => `id,incident_number,description,status,urgency,priority,service_name,created_on,acknowledged_on,resolved_on,notes\nPDUI1,9,Checkout errors,resolved,high,P1,checkout,${iso(4)},${iso(4)},${iso(3)},customer list attached\n`;
/** A tracker export whose columns QE Navigator cannot guess: mapped by hand in the preview. */
const oddCsv = () => `Ticket,Kind,State,Opened on,Points\nODD-1,Bug,Done,${iso(3).slice(0, 10)},2\nODD-2,Story,Open,${iso(2).slice(0, 10)},3\n`;

async function addFiles(page: Page, files: Array<{ name: string; text: string }>) {
  await page.getByTestId('upload-input').setInputFiles(files.map((f) => ({ name: f.name, mimeType: 'text/csv', buffer: Buffer.from(f.text) })));
}

test.describe('Upload files', { tag: [TAG.area('admin'), TAG.area('upload')] }, () => {
  test('UPL-01 from the Admin console: preview first (nothing stored), the fields and a minimised sample, then upload and the ingestion log entry', { tag: [TAG.smoke, TAG.role('admin')] }, async ({ freshCompany, signInAs, page, app }) => {
    await signInAs(freshCompany, '/admin-panel');
    await page.getByTestId('upload-files-card').getByTestId('upload-files-open').click();
    await expect(app.title).toHaveText('Upload files');
    const screen = page.getByTestId('upload-files');
    await expect(screen.getByTestId('upload-allow-list')).toContainText('Never stored');
    await screen.getByTestId('upload-team').selectOption(freshCompany.teamId);
    await addFiles(page, [{ name: 'jira-export.csv', text: jiraCsv() }, { name: 'pagerduty.csv', text: pagerdutyCsv() }]);
    await expect(screen.getByTestId('upload-file-list')).toContainText('jira-export.csv');
    await screen.getByTestId('upload-preview-btn').click();

    const preview = screen.getByTestId('upload-preview');
    await expect(preview).toContainText('Nothing has been stored yet');
    const jira = preview.locator('[data-testid="upload-preview-file"][data-file="jira-export.csv"]');
    await expect(jira).toContainText('detected: Jira issues (CSV export)');
    await expect(jira.getByTestId('upload-records')).toHaveText('3');
    await expect(jira.getByTestId('upload-fields')).toContainText('assigneeHash');
    await expect(jira.getByTestId('upload-dropped')).toContainText('column “Description”');
    await expect(jira.getByTestId('upload-dropped')).toContainText('column “Comment”');
    await expect(jira.getByTestId('upload-limits')).toContainText('no status-change history');
    await expect(jira.getByTestId('upload-warnings')).toContainText('no dates in this file');
    const sample = jira.getByTestId('upload-sample');
    await expect(sample).toContainText('UIUP-1');
    await expect(sample).not.toContainText('secret repro');
    await expect(sample).not.toContainText('corp.example');
    await expect(sample).not.toContainText('please retest');
    const pd = preview.locator('[data-testid="upload-preview-file"][data-file="pagerduty.csv"]');
    await expect(pd).toContainText('detected: PagerDuty incidents (CSV export)');
    await expect(pd.getByTestId('upload-sample')).not.toContainText('customer list');

    // Nothing is stored before Upload: the ingestion log has no upload yet.
    await page.goto('/ingestion-log');
    await expect(page.getByTestId('ingestion-log')).toBeVisible();
    await expect(page.getByTestId('ingestion-entries').or(page.getByText('No requests yet'))).toBeVisible();
    await expect(page.getByText('uploaded “jira-export.csv”')).toHaveCount(0);

    await page.goto('/upload-files');
    await page.getByTestId('upload-team').selectOption(freshCompany.teamId);
    await addFiles(page, [{ name: 'jira-export.csv', text: jiraCsv() }, { name: 'pagerduty.csv', text: pagerdutyCsv() }]);
    await page.getByTestId('upload-preview-btn').click();
    await page.getByTestId('upload-commit-btn').click();
    const results = page.getByTestId('upload-results');
    await expect(results.getByTestId('upload-result')).toHaveCount(2);
    await expect(results.getByTestId('upload-result').first()).toContainText('Stored');
    await expect(results.getByTestId('upload-result-counts').first()).toContainText('3 new');
    await expect(results.getByTestId('upload-result').first()).toContainText('Recalculated:');
    await results.getByTestId('upload-result-log').first().click();
    await expect(app.title).toHaveText('Ingestion log');
    await expect(page.getByTestId('ingestion-entries')).toContainText('uploaded “jira-export.csv”');
  });

  test('UPL-02 a CSV with unknown column names: the mapping is confirmed by hand, previewed again, then uploaded', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/upload-files');
    await page.getByTestId('upload-team').selectOption(freshCompany.teamId);
    await addFiles(page, [{ name: 'tracker.csv', text: oddCsv() }]);
    await page.getByTestId('upload-preview-btn').click();
    const file = page.locator('[data-testid="upload-preview-file"][data-file="tracker.csv"]');
    await expect(file.getByTestId('upload-file-error')).toContainText('type of this file was not recognised');
    await file.getByTestId('upload-type').selectOption('issues:jira-csv');
    await expect(page.getByTestId('upload-stale')).toBeVisible();
    await expect(page.getByTestId('upload-commit-btn')).toBeDisabled();
    await page.getByTestId('upload-preview-btn').click();
    await expect(file.getByTestId('upload-file-error')).toContainText('Required columns not mapped: Issue key, Issue type, Status, Created');
    const mapping = file.getByTestId('upload-mapping');
    await expect(mapping).toHaveAttribute('open', '');
    await mapping.getByTestId('upload-map-key').selectOption('Ticket');
    await mapping.getByTestId('upload-map-type').selectOption('Kind');
    await mapping.getByTestId('upload-map-status').selectOption('State');
    await mapping.getByTestId('upload-map-created').selectOption('Opened on');
    await mapping.getByTestId('upload-map-storyPoints').selectOption('Points');
    await expect(page.getByTestId('upload-commit-btn')).toBeDisabled();
    await page.getByTestId('upload-preview-btn').click();
    await expect(file).toContainText('Ready');
    await expect(file.getByTestId('upload-records')).toHaveText('2');
    await expect(file.getByTestId('upload-sample')).toContainText('ODD-1');
    await page.getByTestId('upload-commit-btn').click();
    await expect(page.getByTestId('upload-result-counts')).toContainText('2 new');
  });

  test('UPL-03 a team lead uploads to the team they lead only; an engineer has no Upload files entry', { tag: [TAG.role('lead'), TAG.role('engineer'), TAG.negative] }, async ({ signInAs, page, app }) => {
    await signInAs('lead', '/');
    await app.go('nav-upload-files', 'Upload files');
    const team = page.getByTestId('upload-team');
    await expect(team.locator('option')).toHaveCount(2); // "Choose a team…" and the team they lead
    await expect(team).toContainText(DEMO.leadTeam.name);
    await expect(page.getByTestId('upload-store-titles')).toBeDisabled();
    await signInAs('engineer', '/');
    await app.openNav();
    await expect(page.getByTestId('nav-upload-files')).toHaveCount(0);
    await page.goto('/upload-files');
    await expect(app.title).toHaveText('Overview');
  });

  const cases = [
    { id: 'A11Y-71', theme: 'Light' },
    { id: 'A11Y-72', theme: 'Dark' },
    { id: 'A11Y-73', theme: 'Graphite' },
    { id: 'A11Y-74', theme: 'Porcelain' },
  ] as const;
  for (const c of cases) {
    test(`${c.id} ${c.theme} theme: Upload files with a preview and its column mapping has no serious violations`, { tag: [TAG.a11y, TAG.role('admin')] }, async ({ freshCompany, signInAs, page, app }, testInfo) => {
      await signInAs(freshCompany, '/upload-files');
      await app.setTheme(c.theme);
      await page.getByTestId('upload-team').selectOption(freshCompany.teamId);
      await addFiles(page, [{ name: 'jira-export.csv', text: jiraCsv() }]);
      await page.getByTestId('upload-preview-btn').click();
      await expect(page.getByTestId('upload-sample')).toBeVisible();
      await page.getByTestId('upload-mapping').locator('summary').click();
      await checkA11y(page, testInfo, { include: '[data-testid="upload-files"]' });
      await page.evaluate(() => localStorage.removeItem('irongate_theme_mode'));
    });
  }
});
