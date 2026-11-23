/**
 * File uploads, pure parts (no backend): CSV reading, dates, the CSV formats and their column mapping,
 * detection by content, the field allow-list (shared with the agent) and the ZIP reader's limits, on
 * fixtures that mimic real exports (tests/fixtures/upload: Jira all fields with BOM, repeated columns
 * and quoted line breaks; Jira current fields in German with semicolons and decimal commas; Linear;
 * PagerDuty incidents and analytics; Opsgenie alerts and incidents; the deployments and sprints templates).
 *
 *   UPP-001..009  CSV reader and values (BOM, UTF-16, separators, quotes, line breaks, limits, dates, numbers)
 *   UPP-010..019  formats: detection, mapping (variants, languages, user override), conversion, limits
 *   UPP-020..029  field allow-list: descriptions, comments, e-mail addresses never kept; hashes; titles setting
 *   UPP-030..039  planning a file: preview content, team scope, map by key, dates out of range, duplicates
 *   UPP-040..049  ZIP: zip-slip, zip bomb, nesting, encryption, symbolic links, caps
 */
import fs from 'fs';
import path from 'path';
import { gzipSync } from 'zlib';
import { decodeText, detectDateOrder, detectDelimiter, parseCsv, parseDate, parseDurationHours, parseNumber, CsvError, MAX_COLUMNS } from '../../server/lib/ingest/csv';
import { CSV_SPECS, autoMapping, convertCsv, detectCsvFormat, limitsOf } from '../../server/lib/ingest/csvImports';
import { FIELD_ALLOW_LIST, minimise, storedFieldNames, ALWAYS_DROPPED, formulaSafe, hashPerson, usefulLabel } from '../../server/lib/ingest/fieldAllowList';
import { minimiseRecord } from '../../server/lib/ingest/allowListPolicy';
import { authorHash } from '../../server/lib/ingest/deliveryEvents';
import { detectFile, expandUpload, planFile, type UploadContext } from '../../server/lib/ingest/upload';
import { readZip, ZipError, unsafeName } from '../../server/lib/ingest/zip';
import { BodyError } from '../../server/lib/ingest/body';
import { buildZip } from './helpers/zipBuilder';

const U = (n: string) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'upload', n));
const I = (n: string) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'ingest', n));
const NOW = Date.parse('2026-11-22T12:00:00Z');

const ctx = (o: Partial<UploadContext> = {}): UploadContext => ({
  companyId: 'co-1', mode: 'team', teamId: 't-pay', now: NOW, storeTitles: true,
  companyTeams: new Map([['t-pay', 'Payments'], ['t-other', 'Other department team']]),
  allowedTeams: new Map([['t-pay', 'Payments']]),
  serviceTeams: new Map([['PAY', 't-pay'], ['checkout-api', 't-pay'], ['ledger-db', 't-other']]),
  ...o,
});

/** Things a real export carries that must never be stored (descriptions, comments, people, notes). */
const SECRETS = ['SECRET-TOKEN', 'Steps:', 'Fixed in 4.2', 'Verified', 'screenshot', '+44 20', 'Acme asked', '@example', 'Dana Wright', 'Telefon', 'Stack trace', 'Postmortem', 'Long description', 'Rolled back release', 'customer-acme', 'Sam Lee'];

describe('CSV reader', () => {
  test('UPP-001 a UTF-8 BOM is removed and repeated header names are kept apart', () => {
    const text = decodeText(U('jira-all-fields.csv'));
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    const csv = parseCsv(text);
    expect(csv.headers[0]).toBe('Summary');
    expect(csv.headers.filter((h) => h === 'Sprint')).toHaveLength(2);
    expect(csv.headers.filter((h) => h === 'Comment')).toHaveLength(2);
    expect(csv.rows).toHaveLength(7);
  });

  test('UPP-002 quoted fields hold separators, doubled quotes and line breaks (CRLF and LF)', () => {
    const csv = parseCsv(decodeText(U('jira-all-fields.csv')));
    const desc = csv.rows[0][csv.headers.indexOf('Description')];
    expect(desc).toContain('\n1. Refund 5.00 of 20.00\n');
    expect(desc).toContain('"Amount invalid"');
    const lf = parseCsv('a,b\n"x\ny",2\n3,"q ""z"""\n');
    expect(lf.rows).toEqual([['x\ny', '2'], ['3', 'q "z"']]);
  });

  test('UPP-003 the separator is detected: comma, semicolon (decimal-comma locales), tab, pipe', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter(decodeText(U('jira-current-fields-de.csv')))).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('a|b|c')).toBe('|');
    expect(detectDelimiter('"a;b",c,d')).toBe(',');
  });

  test('UPP-004 UTF-16 (Excel "Unicode text") is decoded; ragged rows are padded and counted', () => {
    const s = 'Issue key\tStatus\nPAY-1\tDone\n';
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
    expect(parseCsv(decodeText(le)).rows).toEqual([['PAY-1', 'Done']]);
    const r = parseCsv('a,b,c\n1,2\n1,2,3,4\n');
    expect(r.ragged).toBe(2);
    expect(r.rows).toEqual([['1', '2', ''], ['1', '2', '3']]);
  });

  test('UPP-005 malformed input: an unclosed quote, too many columns; a formula cell is only text', () => {
    expect(() => parseCsv('a,b\n"open,1\n')).toThrow(CsvError);
    expect(() => parseCsv(Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => `c${i}`).join(','))).toThrow(/Too many columns/);
    const r = parseCsv('a\n=1+1\n@SUM(A1)\n');
    expect(r.rows).toEqual([['=1+1'], ['@SUM(A1)']]);
  });

  test('UPP-006 dates: ISO, epoch, Jira "21/Nov/26 3:45 PM", German month names, dd.MM.yyyy, offsets', () => {
    expect(parseDate('2026-11-21T10:00:00Z')!.toISOString()).toBe('2026-11-21T10:00:00.000Z');
    expect(parseDate('2026-11-21 10:00')!.toISOString()).toBe('2026-11-21T10:00:00.000Z');
    expect(parseDate('1763719200000')!.toISOString()).toBe('2025-11-21T10:00:00.000Z');
    expect(parseDate('21/Nov/26 3:45 PM')!.toISOString()).toBe('2026-11-21T15:45:00.000Z');
    expect(parseDate('02/Nov/26 12:05 AM')!.toISOString()).toBe('2026-11-02T00:05:00.000Z');
    expect(parseDate('21/Dez/26 15:45')!.toISOString()).toBe('2026-12-21T15:45:00.000Z');
    expect(parseDate('03/mars/26 09:00')!.toISOString()).toBe('2026-03-03T09:00:00.000Z');
    expect(parseDate('21.11.2026 15:45')!.toISOString()).toBe('2026-11-21T15:45:00.000Z');
    expect(parseDate('11/21/2026 3:45 PM', 'mdy')!.toISOString()).toBe('2026-11-21T15:45:00.000Z');
    expect(parseDate('2026-11-21 10:00', 'dmy', 60)!.toISOString()).toBe('2026-11-21T09:00:00.000Z');
    expect(parseDate('Nov 21, 2026 10:00')!.toISOString()).toBe('2026-11-21T10:00:00.000Z');
    expect(parseDate('')).toBeNull();
    expect(parseDate('next Tuesday')).toBeUndefined();
    expect(parseDate('31/02/2026')).toBeUndefined();
  });

  test('UPP-007 the day / month order of a column is detected; all values ≤ 12 is ambiguous', () => {
    expect(detectDateOrder(['21/11/2026', '03/04/2026'])).toEqual({ order: 'dmy', ambiguous: false });
    expect(detectDateOrder(['11/21/2026', '03/04/2026'])).toEqual({ order: 'mdy', ambiguous: false });
    expect(detectDateOrder(['03/04/2026'])).toEqual({ order: 'dmy', ambiguous: true });
    expect(detectDateOrder(['2026-11-21'])).toEqual({ order: 'dmy', ambiguous: false });
  });

  test('UPP-008 numbers with decimal commas and thousands separators; Jira time fields in seconds or "1w 2d 3h"', () => {
    expect(parseNumber('2,5')).toBe(2.5);
    expect(parseNumber('1.234,5')).toBe(1234.5);
    expect(parseNumber('1,234.5')).toBe(1234.5);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('three')).toBeNaN();
    expect(parseDurationHours('14400')).toBe(4);
    expect(parseDurationHours('1d 4h')).toBe(12);
    expect(parseDurationHours('1w')).toBe(40);
    expect(parseDurationHours('soon')).toBeUndefined();
  });
});

describe('CSV formats and the column mapping', () => {
  const headers = (f: string) => parseCsv(decodeText(U(f))).headers;

  test('UPP-010 every fixture export is detected by its header row (and the JSON / XML reports by content)', () => {
    expect(detectCsvFormat(headers('jira-all-fields.csv'))?.format).toBe('jira-csv');
    expect(detectCsvFormat(headers('jira-current-fields-de.csv'))?.format).toBe('jira-csv');
    expect(detectCsvFormat(headers('linear-export.csv'))?.format).toBe('linear-csv');
    expect(detectCsvFormat(headers('pagerduty-incidents.csv'))?.format).toBe('pagerduty-csv');
    expect(detectCsvFormat(headers('pagerduty-analytics.csv'))?.format).toBe('pagerduty-csv');
    expect(detectCsvFormat(headers('opsgenie-alerts.csv'))?.format).toBe('opsgenie-csv');
    expect(detectCsvFormat(headers('opsgenie-incidents.csv'))?.format).toBe('opsgenie-csv');
    expect(detectCsvFormat(headers('deployments-template.csv'))?.format).toBe('deployments-csv');
    expect(detectCsvFormat(headers('sprints-template.csv'))?.format).toBe('sprints-csv');
    expect(detectCsvFormat(['Name', 'Age', 'City'])).toBeNull();
    const d = (b: Buffer) => { const x = detectFile(decodeText(b)); return x && `${x.kind}:${x.format}`; };
    expect(d(I('junit-pytest.xml'))).toBe('tests:junit');
    expect(d(I('trx-dotnet.trx'))).toBe('tests:trx');
    expect(d(I('cucumber.json'))).toBe('tests:cucumber');
    expect(d(I('lcov.info'))).toBe('coverage:lcov');
    expect(d(I('cobertura.xml'))).toBe('coverage:cobertura');
    expect(d(I('jacoco.xml'))).toBe('coverage:jacoco');
    expect(d(I('istanbul-final.json'))).toBe('coverage:istanbul');
    expect(d(I('istanbul-summary.json'))).toBe('coverage:istanbul-summary');
    expect(d(I('pipeline-github.json'))).toBe('pipelines:json');
    expect(d(Buffer.from(JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'ESLint' } }, results: [] }] })))).toBe('static-analysis:sarif');
    expect(d(Buffer.from(JSON.stringify({ issues: [{ key: 'PAY-1', fields: { summary: 'x' } }] })))).toBe('issues:jira');
    expect(d(Buffer.from(JSON.stringify({ data: { issues: { nodes: [{ identifier: 'ENG-1', state: { name: 'Todo' } }] } } })))).toBe('issues:linear');
    expect(d(Buffer.from(JSON.stringify({ incidents: [{ id: 'P1', incident_number: 3, urgency: 'high' }] })))).toBe('incidents:pagerduty');
    expect(d(Buffer.from(JSON.stringify({ data: [{ id: 'a', tinyId: '4' }] })))).toBe('incidents:opsgenie');
    expect(d(Buffer.from(JSON.stringify({ deployments: [{ id: 'd1' }] })))).toBe('deployments:json');
    expect(d(Buffer.from(JSON.stringify([{ id: 'i1', severity: 'high', openedAt: '2026-11-01T00:00:00Z' }])))).toBe('incidents:json');
    expect(d(Buffer.from('just some text'))).toBeNull();
  });

  test('UPP-011 Jira header variants: English all fields, German current fields, custom-field story points', () => {
    const en = autoMapping(CSV_SPECS['jira-csv'], headers('jira-all-fields.csv'));
    expect(en).toMatchObject({ key: 'Issue key', type: 'Issue Type', created: 'Created', resolved: 'Resolved', storyPoints: 'Custom field (Story Points)', sprint: 'Sprint', statusCategoryChanged: 'Status Category Changed', estimate: 'Original Estimate', timeSpent: 'Time Spent' });
    const de = autoMapping(CSV_SPECS['jira-csv'], headers('jira-current-fields-de.csv'));
    expect(de).toMatchObject({ key: 'Schlüssel', type: 'Vorgangstyp', title: 'Zusammenfassung', created: 'Erstellt', resolved: 'Erledigt', resolution: 'Lösung', labels: 'Stichwörter', environment: 'Umgebung', storyPoints: 'Benutzerdefiniertes Feld (Story Points)' });
    expect(autoMapping(CSV_SPECS['jira-csv'], ['Clé de ticket', 'Type de ticket', 'État', 'Création', 'Résolue', 'Résumé'])).toMatchObject({ key: 'Clé de ticket', type: 'Type de ticket', status: 'État', created: 'Création', resolved: 'Résolue' });
    expect(autoMapping(CSV_SPECS['jira-csv'], ['Clave de incidencia', 'Tipo de Incidencia', 'Estado', 'Creada', 'Resuelta'])).toMatchObject({ key: 'Clave de incidencia', type: 'Tipo de Incidencia', created: 'Creada', resolved: 'Resuelta' });
    expect(autoMapping(CSV_SPECS['jira-csv'], ['Issue key', 'Issue Type', 'Status', 'Created', 'Custom field (Story point estimate)'])).toMatchObject({ storyPoints: 'Custom field (Story point estimate)' });
  });

  test('UPP-012 Jira all fields: issues, sprints from repeated columns, story points, estimates in hours, one status change; a row without a key is reported', () => {
    const c = convertCsv(parseCsv(decodeText(U('jira-all-fields.csv'))), 'jira-csv');
    expect(c.records).toHaveLength(6);
    expect(c.errors).toEqual([{ row: 7, reason: 'Issue key is empty' }]);
    const pay101 = c.records[0];
    expect(pay101).toMatchObject({ key: 'PAY-101', type: 'Bug', status: 'Done', statusCategory: 'done', resolution: 'Fixed', project: 'PAY', createdAt: '2026-11-02T09:15:00.000Z', resolvedAt: '2026-11-09T15:30:00.000Z', storyPoints: 3, estimateHours: 4, timeLoggedHours: 5, environment: 'Production', components: ['Refunds', 'API'] });
    expect(pay101.sprints).toEqual([{ id: 'name:Sprint-41', name: 'Sprint 41' }]);
    expect(pay101.transitions).toEqual([{ field: 'status', to: 'Done', toCategory: 'done', at: '2026-11-09T15:30:00.000Z' }]);
    expect((c.records[1].sprints as any[]).map((s) => s.name)).toEqual(['Sprint 41', 'Sprint 42']);
    expect(c.unusedColumns).toEqual(expect.arrayContaining(['Description', 'Comment', 'Attachment', 'Custom field (Customer notes)']));
    expect(c.unusedColumns).not.toContain('Priority');
    expect(c.records[0].priority).toBeTruthy();
  });

  test('UPP-013 Jira current fields in German: semicolons, dd.MM.yyyy, decimal-comma points, German status and environment', () => {
    const c = convertCsv(parseCsv(decodeText(U('jira-current-fields-de.csv'))), 'jira-csv');
    expect(c.errors).toEqual([]);
    expect(c.records[0]).toMatchObject({ key: 'SHOP-7', type: 'Bug', status: 'Erledigt', statusCategory: 'done', createdAt: '2026-11-03T08:15:00.000Z', resolvedAt: '2026-11-09T16:20:00.000Z', storyPoints: 2.5, environment: 'Produktion', project: 'SHOP' });
    expect(c.records[1]).toMatchObject({ key: 'SHOP-8', statusCategory: 'in_progress', storyPoints: 5 });
    expect(c.records[2]).toMatchObject({ key: 'SHOP-9', statusCategory: 'todo' });
  });

  test('UPP-014 the mapping chosen in the preview wins; a missing required column stops the file with the column named', () => {
    const csv = parseCsv('Ticket,Kind,State,Opened,Done at,Pts\nPAY-9,Bug,Done,2026-11-01,2026-11-03,3\n');
    const none = convertCsv(csv, 'jira-csv');
    expect(none.errors[0]).toMatchObject({ row: 1 });
    expect(none.errors[0].reason).toMatch(/Issue key.*Issue type.*Created/);
    const mapped = convertCsv(csv, 'jira-csv', { mapping: { key: 'Ticket', type: 'Kind', status: 'State', created: 'Opened', resolved: 'Done at', storyPoints: 'Pts', title: null } });
    expect(mapped.errors).toEqual([]);
    expect(mapped.records[0]).toMatchObject({ key: 'PAY-9', type: 'Bug', storyPoints: 3, resolvedAt: '2026-11-03T00:00:00.000Z' });
    const missing = convertCsv(csv, 'jira-csv', { mapping: { key: 'Nope' } });
    expect(missing.missingColumns).toEqual(['Nope']);
  });

  test('UPP-015 ambiguous numeric dates are read day first unless the preview says month first', () => {
    const csv = parseCsv('Issue key,Issue Type,Status,Created\nPAY-1,Bug,Open,03/04/2026 10:00\n');
    const a = convertCsv(csv, 'jira-csv');
    expect(a.dateOrderAmbiguous).toBe(true);
    expect(a.records[0].createdAt).toBe('2026-04-03T10:00:00.000Z');
    const b = convertCsv(csv, 'jira-csv', { dateOrder: 'mdy' });
    expect(b.records[0].createdAt).toBe('2026-03-04T10:00:00.000Z');
    expect(b.dateOrderAmbiguous).toBe(false);
  });

  test('UPP-016 Linear CSV: cycles with dates (closed when ended), started / completed / canceled as status changes, type from labels', () => {
    const c = convertCsv(parseCsv(decodeText(U('linear-export.csv'))), 'linear-csv', { now: NOW });
    expect(c.errors).toEqual([]);
    const [done, started, canceled, sub] = c.records;
    expect(done).toMatchObject({ key: 'ENG-210', type: 'Bug', statusCategory: 'done', resolvedAt: '2026-11-05T15:59:00.000Z', storyPoints: 2, project: 'ENG' });
    expect((done.sprints as any[])[0]).toMatchObject({ id: 'cycle-18', state: 'closed', completedAt: '2026-11-09T00:00:00.000Z' });
    expect(done.transitions).toEqual([
      { field: 'status', to: 'Started', toCategory: 'in_progress', at: '2026-10-28T10:00:00.000Z' },
      { field: 'status', to: 'Done', toCategory: 'done', at: '2026-11-05T15:59:00.000Z' },
    ]);
    expect(started).toMatchObject({ type: 'Story', statusCategory: 'in_progress' });
    expect(canceled).toMatchObject({ resolution: 'Canceled', statusCategory: 'done' });
    expect(sub).toMatchObject({ type: 'Bug' }); // a Bug label wins over the parent issue (as in the Linear JSON parser)
    expect((sub.sprints as any[])[0]).toMatchObject({ id: 'cycle-19', state: 'active', completedAt: null });
  });

  test('UPP-017 PagerDuty: incidents export and analytics export (durations in seconds); Opsgenie: alerts (ms offsets, service tag) and incidents (semicolons)', () => {
    const pd = convertCsv(parseCsv(decodeText(U('pagerduty-incidents.csv'))), 'pagerduty-csv');
    expect(pd.records[0]).toMatchObject({ id: 'Q1ABCDEF', severity: 'P1', service: 'checkout-api', status: 'resolved', openedAt: '2026-11-03T10:00:00.000Z', acknowledgedAt: '2026-11-03T10:04:00.000Z', resolvedAt: '2026-11-03T10:50:00.000Z' });
    expect(pd.records[1]).toMatchObject({ severity: 'low' });
    const pda = convertCsv(parseCsv(decodeText(U('pagerduty-analytics.csv'))), 'pagerduty-csv');
    expect(pda.records[0]).toMatchObject({ id: 'Q9XYZ001', acknowledgedAt: '2026-11-10T09:02:00.000Z', resolvedAt: '2026-11-10T10:30:00.000Z', service: 'search' });
    const og = convertCsv(parseCsv(decodeText(U('opsgenie-alerts.csv'))), 'opsgenie-csv');
    expect(og.records[0]).toMatchObject({ id: '311', severity: 'P1', service: 'payments', status: 'resolved', acknowledgedAt: '2026-11-04T13:05:00.000Z', resolvedAt: '2026-11-04T14:30:00.000Z' });
    expect(og.records[1]).toMatchObject({ id: '312', status: 'open', service: 'queue', resolvedAt: null });
    const ogi = convertCsv(parseCsv(decodeText(U('opsgenie-incidents.csv'))), 'opsgenie-csv');
    expect(ogi.records[0]).toMatchObject({ service: 'auth', status: 'resolved', resolvedAt: '2026-11-12T07:15:00.000Z' });
  });

  test('UPP-018 the deployments and sprints templates; a sprint date without a time closes at the end of that day', () => {
    const d = convertCsv(parseCsv(decodeText(U('deployments-template.csv'))), 'deployments-csv');
    expect(d.records[0]).toMatchObject({ id: 'rel-4.2.0', environment: 'production', commit: 'a1b2c3d4e5', commits: [{ sha: 'a1b2c3d4e5', authoredAt: '2026-11-01T15:00:00.000Z' }], result: 'success', hotfix: false });
    expect(d.records[2]).toMatchObject({ rollbackOf: 'rel-4.2.1', commits: [] });
    const s = convertCsv(parseCsv(decodeText(U('sprints-template.csv'))), 'sprints-csv', { now: NOW });
    expect(s.records[1]).toMatchObject({ id: 'name:Sprint-41', state: 'closed', startedAt: '2026-11-02T00:00:00.000Z', completedAt: '2026-11-15T23:59:59.000Z' });
    expect(s.records[2]).toMatchObject({ state: 'active', completedAt: null });
  });

  test('UPP-019 the limits of each export are stated (Jira CSV: no history, no sprint dates)', () => {
    expect(limitsOf('jira-csv').join(' ')).toMatch(/no status-change history.*blocked time cannot be calculated/);
    expect(limitsOf('jira-csv').join(' ')).toMatch(/sprint dates/);
    expect(limitsOf('linear-csv').join(' ')).toMatch(/blocked time cannot be calculated/);
    expect(limitsOf('junit')).toEqual([]);
  });
});

describe('Field allow-list (shared with the agent)', () => {
  test('UPP-020 the shared file is plain data and pure functions: no import but Node crypto, vendored byte for byte by the agent', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'lib', 'ingest', 'fieldAllowList.ts'), 'utf8');
    const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(imports).toEqual(['crypto']);
    expect(src).not.toMatch(/require\(/);
    expect(Object.keys(FIELD_ALLOW_LIST)).toEqual(['issue', 'sprint', 'incident']);
    for (const kind of ['issue', 'sprint', 'incident'] as const) for (const f of FIELD_ALLOW_LIST[kind]) expect(f.why.length).toBeGreaterThan(5);
    expect(ALWAYS_DROPPED.join(' ')).toMatch(/descriptions.*comments.*attachments/);
    const vendored = path.join(__dirname, '..', '..', 'agent', 'src', 'vendor', 'fieldAllowList.ts');
    if (fs.existsSync(vendored)) expect(fs.readFileSync(vendored, 'utf8').endsWith(src)).toBe(true);
  });

  test('UPP-021 descriptions, comments, attachments, custom free text, other labels and raw people never survive minimise (priority is kept)', () => {
    const rec = {
      key: 'PAY-1', type: 'Bug', status: 'Done', description: 'secret', comments: [{ body: 'c', author: 'a@example.com' }], attachment: 'x.png',
      customfield_10050: 'free text', priority: 'High', labels: ['customer-acme', 'production'], assignee: 'dana@example.com', reporter: { emailAddress: 'r@example.com' },
      sprints: [{ id: 'S1', name: 'Sprint 1', goal: 'secret goal', state: 'closed' }], transitions: [{ field: 'status', to: 'Done', at: '2026-11-01T00:00:00Z', author: 'x@example.com' }],
      createdAt: '2026-11-01T00:00:00Z', title: 'A title', fields: { summary: 'nested' },
    };
    const { record, dropped } = minimise('issue', rec, { storeTitles: true, salt: 'co-1' });
    const s = JSON.stringify(record);
    for (const bad of ['secret', 'example.com', 'free text', 'customer-acme', 'x.png', 'goal', 'nested']) expect(s).not.toContain(bad);
    expect(record.priority).toBe('High');
    expect(record).toMatchObject({ key: 'PAY-1', type: 'Bug', status: 'Done', title: 'A title', labels: ['production'], sprints: [{ id: 'S1', name: 'Sprint 1', state: 'closed' }] });
    expect(dropped).toEqual(expect.arrayContaining(['description', 'comments', 'attachment', 'customfield_10050', 'assignee', 'reporter', 'fields']));
    const allowed = new Set(storedFieldNames('issue', { storeTitles: true, salt: 'co-1' }));
    expect(Object.keys(record).every((k) => allowed.has(k))).toBe(true);
    expect(usefulLabel('env:staging')).toBe(true);
    expect(usefulLabel('customer-acme')).toBe(false);
  });

  test('UPP-022 people are kept only as the salted hash (the commit-author hash); a raw name or e-mail never; without a salt, nothing', () => {
    expect(hashPerson('co-1', 'Dana@Example.com ')).toBe(authorHash('co-1', 'dana@example.com'));
    expect(hashPerson('co-1', 'x')).not.toBe(hashPerson('co-2', 'x'));
    const { record, dropped } = minimiseRecord('issue', { key: 'PAY-1', type: 'Bug', createdAt: '2026-11-01T00:00:00Z', assignee: 'dana@example.com', reporter: 'sam@example.com' }, { salt: 'co-1', storeTitles: true });
    expect(record).toMatchObject({ assigneeHash: hashPerson('co-1', 'dana@example.com'), reporterHash: hashPerson('co-1', 'sam@example.com') });
    expect(JSON.stringify(record)).not.toContain('example.com');
    expect(dropped).toEqual(expect.arrayContaining(['assignee (stored as a salted hash only)', 'reporter (stored as a salted hash only)']));
    const inc = minimiseRecord('incident', { id: 'I1', severity: 'P1', status: 'triggered', responder: { email: 'oncall@example.com' }, notes: 'customer called' }, { salt: 'co-1', storeTitles: true });
    expect(inc.record).toMatchObject({ id: 'I1', severity: 'P1', status: 'triggered', responderHash: hashPerson('co-1', 'oncall@example.com') });
    expect(JSON.stringify(inc.record)).not.toMatch(/example\.com|customer called/);
    expect(minimise('issue', { key: 'K-1', assignee: 'a@example.com' }).record).toEqual({ key: 'K-1' });
  });

  test('UPP-023 "Store issue and incident titles" off: titles are dropped (preview fields too); on: kept', () => {
    const rec = { key: 'PAY-1', type: 'Bug', createdAt: '2026-11-01T00:00:00Z', title: 'Refund fails' };
    expect(minimiseRecord('issue', rec, { salt: 'c', storeTitles: true }).record).toMatchObject({ title: 'Refund fails' });
    const off = minimiseRecord('issue', rec, { salt: 'c', storeTitles: false });
    expect(off.record).not.toHaveProperty('title');
    expect(off.dropped).toContain('title');
    expect(storedFieldNames('incident', { storeTitles: false, salt: 'c' })).not.toContain('title');
    expect(storedFieldNames('incident', { storeTitles: true, salt: 'c' })).toContain('title');
  });

  test('UPP-024 CSV injection: text that a spreadsheet would run is prefixed with an apostrophe; numbers are left alone', () => {
    expect(formulaSafe('=HYPERLINK("http://evil")')).toBe('\'=HYPERLINK("http://evil")');
    expect(formulaSafe('+cmd|calc')).toBe("'+cmd|calc");
    expect(formulaSafe('@SUM(1)')).toBe("'@SUM(1)");
    expect(formulaSafe('-5')).toBe('-5');
    expect(formulaSafe('Refund')).toBe('Refund');
    const { record } = minimiseRecord('issue', { key: 'PAY-1', type: 'Bug', createdAt: '2026-11-01T00:00:00Z', title: '=1+1', status: '@x' }, { salt: 'c', storeTitles: true });
    expect(record).toMatchObject({ title: "'=1+1", status: "'@x" });
  });

  test('UPP-025 nested structured values keep their plain name only; links only as http(s)', () => {
    const { record } = minimise('issue', { key: 'K-1', status: { name: 'Done', self: 'x' }, url: 'javascript:alert(1)', environment: { value: 'Production' } });
    expect(record).toEqual({ key: 'K-1', status: 'Done', environment: 'Production' });
    expect(minimise('issue', { key: 'K-1', url: 'https://jira.example.net/browse/K-1' }).record.url).toBe('https://jira.example.net/browse/K-1');
  });
});

describe('Planning a file (the preview)', () => {
  test('UPP-030 a Jira CSV preview: records, dates, stored fields, 3 minimised records with no description, comment, e-mail or name', () => {
    const p = planFile({ name: 'jira.csv', data: U('jira-all-fields.csv') }, {}, ctx());
    expect(p.status).toBe('ready');
    expect(p.type?.value).toBe('issues:jira-csv');
    expect(p.records).toBe(6);
    expect(p.dateRange).toEqual({ from: '2026-10-20T10:00:00.000Z', to: '2026-11-08T08:30:00.000Z' });
    expect(p.skipped).toEqual([{ reason: 'Issue key is empty', count: 1, rows: [7] }]);
    expect(p.fields).toEqual(expect.arrayContaining(['key', 'type', 'status', 'transitions', 'createdAt', 'resolvedAt', 'storyPoints', 'sprints', 'environment', 'estimateHours', 'timeLoggedHours', 'title', 'assigneeHash']));
    expect(p.fields).not.toEqual(expect.arrayContaining(['description', 'comments', 'labels', 'assignee']));
    expect(p.dropped).toEqual(expect.arrayContaining(['column “Description”', 'column “Comment”', 'column “Attachment”', 'column “Custom field (Customer notes)”']));
    expect(p.sample).toHaveLength(3);
    const everything = JSON.stringify(p.sample) + p.submissions.map((s) => s.body.toString()).join('');
    for (const s of SECRETS) expect(everything).not.toContain(s);
    expect(p.metrics).toEqual(expect.arrayContaining(['Defect escape rate', 'Sprint velocity', 'Blocked time']));
    expect(p.limits.join(' ')).toMatch(/no status-change history/);
    expect(p.warnings.join(' ')).toMatch(/3 sprints have no dates/);
    expect(p.submissions).toHaveLength(1);
    const body = JSON.parse(p.submissions[0].body.toString());
    expect(body.issues).toHaveLength(6);
    expect(body.issues.every((i: any) => i.team === 't-pay')).toBe(true);
    expect(body.issues.find((i: any) => i.key === 'PAY-107').title).toBe('\'=HYPERLINK("http://evil.example/","click")');
  });

  test('UPP-031 every other fixture export plans without leaking anything it must not keep', () => {
    for (const f of ['jira-current-fields-de.csv', 'linear-export.csv', 'pagerduty-incidents.csv', 'pagerduty-analytics.csv', 'opsgenie-alerts.csv', 'opsgenie-incidents.csv', 'deployments-template.csv', 'sprints-template.csv']) {
      const p = planFile({ name: f, data: U(f) }, {}, ctx());
      expect({ f, status: p.status, error: p.error }).toEqual({ f, status: 'ready', error: undefined });
      const everything = JSON.stringify(p.sample) + p.submissions.map((s) => s.body.toString()).join('');
      for (const s of SECRETS) expect({ f, leaked: everything.includes(s) ? s : null }).toEqual({ f, leaked: null });
      expect(p.sample.length).toBeGreaterThan(0);
    }
  });

  test('UPP-032 titles off: the preview says so, the fields and the requests carry no title', () => {
    const p = planFile({ name: 'jira.csv', data: U('jira-all-fields.csv') }, {}, ctx({ storeTitles: false }));
    expect(p.fields).not.toContain('title');
    expect(p.submissions[0].body.toString()).not.toContain('Card refund fails');
    expect(p.warnings.join(' ')).toMatch(/Titles are not stored/);
  });

  test('UPP-033 map by key: rows go to the team of their mapped project or service; unmapped rows are left out with the reason', () => {
    const p = planFile({ name: 'pd.csv', data: U('pagerduty-incidents.csv') }, {}, ctx({ mode: 'map', teamId: null, allowedTeams: new Map([['t-pay', 'Payments'], ['t-other', 'Other']]) }));
    expect(p.status).toBe('ready');
    expect(p.teams).toEqual(expect.arrayContaining([{ id: 't-pay', name: 'Payments', records: 1 }, { id: 't-other', name: 'Other department team', records: 1 }]));
    expect(p.skipped).toEqual([{ reason: 'No team: service "webhooks" is not mapped to a team (Connect your CI)', count: 1, rows: [4] }]);
  });

  test('UPP-034 a file whose rows map to a team outside the person\'s scope is refused (403), not partly stored', () => {
    const p = planFile({ name: 'pd.csv', data: U('pagerduty-incidents.csv') }, {}, ctx({ mode: 'map', teamId: null }));
    expect(p.status).toBe('error');
    expect(p.errorStatus).toBe(403);
    expect(p.error).toMatch(/Other department team, which you may not upload to/);
    expect(p.submissions).toEqual([]);
    // A team id written into the file itself is not a way round it.
    const own = Buffer.from(JSON.stringify({ incidents: [{ id: 'X1', team: 't-other', severity: 'high', openedAt: '2026-11-10T00:00:00Z' }] }));
    const q = planFile({ name: 'own.json', data: own }, {}, ctx({ mode: 'map', teamId: null }));
    expect(q).toMatchObject({ status: 'error', errorStatus: 403 });
    // Upload to a team: the file's own team ids are replaced by the chosen team.
    const r = planFile({ name: 'own.json', data: own }, {}, ctx());
    expect(JSON.parse(r.submissions[0].body.toString()).incidents[0].team).toBe('t-pay');
  });

  test('UPP-035 reports need a team; sprints need a team; a report is sent as it is to the chosen team', () => {
    const m = planFile({ name: 'junit.xml', data: I('junit-pytest.xml') }, {}, ctx({ mode: 'map', teamId: null }));
    expect(m).toMatchObject({ status: 'error', errorStatus: 400 });
    expect(m.error).toMatch(/carries no team/);
    const t = planFile({ name: 'junit.xml', data: I('junit-pytest.xml') }, {}, ctx());
    expect(t.status).toBe('ready');
    expect(t.submissions[0]).toMatchObject({ kind: 'tests', query: { team: 't-pay', format: 'junit' } });
    expect(t.submissions[0].body.equals(I('junit-pytest.xml'))).toBe(true);
    expect(t.reportIdentity?.runId).toMatch(/^sha:[0-9a-f]{16}$/);
    expect(planFile({ name: 's.csv', data: U('sprints-template.csv') }, {}, ctx({ mode: 'map', teamId: null })).error).toMatch(/carries no team/);
  });

  test('UPP-036 dates out of range (future, older than a year for incidents and deployments) and duplicate rows are left out with the reason', () => {
    const csv = 'id,environment,commit,finishedAt,result\nd-old,production,abc1234,2024-01-01T00:00:00Z,success\nd-future,production,abc1234,2027-06-01T00:00:00Z,success\nd-ok,production,abc1234,2026-11-20T00:00:00Z,success\nd-ok,production,abc1235,2026-11-21T00:00:00Z,failed\nd-bad,production,,2026-11-21T00:00:00Z,success\n';
    const p = planFile({ name: 'dep.csv', data: Buffer.from(csv) }, {}, ctx());
    expect(p.records).toBe(1);
    expect(p.skipped.map((s) => s.reason)).toEqual([
      'Date out of range: older than 365 days (the API keeps a year)', 'Date out of range: a date is in the future', 'Appears more than once in the file (the last row is kept)',
      'Not valid: commit is required (the deployed commit sha, or a commits list)',
    ]);
    expect(JSON.parse(p.submissions[0].body.toString()).deployments[0]).toMatchObject({ id: 'd-ok', result: 'failed' });
  });

  test('UPP-037 the manual type override; an unknown file asks for a type; a file with nothing storable is an error', () => {
    const unknown = planFile({ name: 'x.txt', data: Buffer.from('hello world') }, {}, ctx());
    expect(unknown).toMatchObject({ status: 'error', errorStatus: 415 });
    const csv = Buffer.from('Ticket,Kind,State,Opened\nPAY-9,Bug,Open,2026-11-01\n');
    expect(planFile({ name: 't.csv', data: csv }, {}, ctx()).status).toBe('error');
    const forced = planFile({ name: 't.csv', data: csv }, { type: 'issues:jira-csv', mapping: { key: 'Ticket', type: 'Kind', status: 'State', created: 'Opened' } }, ctx());
    expect(forced.status).toBe('ready');
    expect(forced.records).toBe(1);
    expect(planFile({ name: 't.csv', data: csv }, { type: 'nonsense:x' }, ctx())).toMatchObject({ status: 'error', errorStatus: 400 });
    expect(planFile({ name: 't.csv', data: csv }, { skip: true, type: 'issues:jira-csv' }, ctx()).status).toBe('skipped');
  });

  test('UPP-038 vendor JSON larger than one request is split (1,000 issues, 500 incidents per request)', () => {
    const issues = Array.from({ length: 2300 }, (_, i) => ({ key: `BIG-${i + 1}`, fields: { summary: `Issue ${i}`, description: 'do not keep', issuetype: { name: 'Task' }, status: { name: 'To Do', statusCategory: { key: 'new' } }, created: '2026-11-01T10:00:00.000+0000', assignee: { emailAddress: 'a@example.com' } } }));
    const p = planFile({ name: 'search.json', data: Buffer.from(JSON.stringify({ issues })) }, {}, ctx());
    expect(p.status).toBe('ready');
    expect(p.records).toBe(2300);
    expect(p.submissions.map((s) => s.count)).toEqual([1000, 1000, 300]);
    expect(p.submissions.map((s) => s.body.toString()).join('')).not.toMatch(/do not keep|example\.com/);
    const inc = Array.from({ length: 700 }, (_, i) => ({ id: `I${i}`, severity: 'low', openedAt: '2026-11-10T00:00:00Z', description: 'no' }));
    expect(planFile({ name: 'inc.json', data: Buffer.from(JSON.stringify({ incidents: inc })) }, {}, ctx()).submissions.map((s) => s.count)).toEqual([500, 200]);
  });
});

describe('ZIP archives', () => {
  test('UPP-040 a zip is unpacked into its files (gzip inside too); system files are skipped; names are kept unique', () => {
    const zip = buildZip([
      { name: 'reports/junit.xml', data: I('junit-pytest.xml') },
      { name: 'reports/lcov.info.gz', data: gzipSync(I('lcov.info')) },
      { name: '__MACOSX/._junit.xml', data: 'x' },
      { name: 'reports/', data: '' },
    ]);
    const { files, notes } = expandUpload([{ filename: 'ci.zip', data: zip }, { filename: 'ci.zip', data: zip }]);
    expect(files.map((f) => f.name)).toEqual(['ci.zip/reports/junit.xml', 'ci.zip/reports/lcov.info.gz', 'ci.zip/reports/junit.xml (2)', 'ci.zip/reports/lcov.info.gz (2)']);
    expect(files[1].data.toString()).toBe(I('lcov.info').toString());
    expect(notes[0]).toMatchObject({ name: 'ci.zip/__MACOSX/._junit.xml' });
  });

  test('UPP-041 zip-slip: "..", absolute paths, drive letters and backslashes refuse the whole archive', () => {
    for (const name of ['../../etc/passwd', '/etc/passwd', 'C:/Windows/x.csv', 'a\\..\\b.csv', 'ok/../../x']) {
      expect(() => readZip(buildZip([{ name: 'fine.csv', data: 'a' }, { name, data: 'evil' }]))).toThrow(ZipError);
      expect(unsafeName(name)).not.toBeNull();
    }
    expect(() => expandUpload([{ filename: 'evil.zip', data: buildZip([{ name: '../x.csv', data: 'a' }]) }])).toThrow(BodyError);
  });

  test('UPP-042 zip bombs: a compression ratio above 200:1, a size beyond the limits, or more data than declared are refused', () => {
    const zeros = Buffer.alloc(20 * 1024 * 1024);
    expect(() => readZip(buildZip([{ name: 'bomb.csv', data: zeros }]))).toThrow(/expands \d+ times/);
    expect(() => readZip(buildZip([{ name: 'lie.csv', data: Buffer.alloc(300_000, 'a'), declaredSize: 1000 }]), { maxRatio: 1e9 })).toThrow(/beyond its declared size/);
    expect(() => readZip(buildZip([{ name: 'big.csv', data: Buffer.alloc(2048, 'b') }]), { maxEntry: 1024, maxRatio: 1e9 })).toThrow(/at most/);
    expect(() => readZip(buildZip([{ name: 'a.csv', data: Buffer.alloc(800, 'a') }, { name: 'b.csv', data: Buffer.alloc(800, 'b') }]), { maxTotal: 1000, maxRatio: 1e9 })).toThrow(/expands to more than/);
  });

  test('UPP-043 caps and odd entries: too many files, nested zips (not opened), encrypted entries, symbolic links', () => {
    expect(() => readZip(buildZip(Array.from({ length: 101 }, (_, i) => ({ name: `f${i}.csv`, data: 'a' }))))).toThrow(/at most 100/);
    const nested = readZip(buildZip([{ name: 'inner.zip', data: buildZip([{ name: 'x.csv', data: 'a' }]), store: true }, { name: 'ok.csv', data: 'a,b' }]));
    expect(nested.entries.map((e) => e.name)).toEqual(['ok.csv']);
    expect(nested.skipped[0]).toMatchObject({ name: 'inner.zip', reason: expect.stringMatching(/not opened/) });
    expect(() => readZip(buildZip([{ name: 'secret.csv', data: 'a', flags: 1 }]))).toThrow(/encrypted/);
    const link = readZip(buildZip([{ name: 'link', data: '/etc/passwd', store: true, externalAttr: (0o120777 << 16) >>> 0 }]));
    expect(link.entries).toEqual([]);
    expect(link.skipped[0].reason).toMatch(/symbolic link/);
    expect(() => readZip(Buffer.from('PK\x03\x04 not really a zip'))).toThrow(/damaged/);
  });

  test('UPP-044 too many parts or too much data once unpacked is refused (413)', () => {
    expect(() => expandUpload(Array.from({ length: 21 }, (_, i) => ({ filename: `f${i}.csv`, data: Buffer.from('a') })))).toThrow(/at most 20/);
    try { expandUpload(Array.from({ length: 21 }, (_, i) => ({ filename: `f${i}.csv`, data: Buffer.from('a') }))); } catch (e) { expect((e as BodyError).status).toBe(413); }
  });
});
