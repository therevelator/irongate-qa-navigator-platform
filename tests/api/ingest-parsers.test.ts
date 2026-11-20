import fs from 'fs';
import path from 'path';
import { gzipSync } from 'zlib';
import { parseXml, XmlError } from '../../server/lib/ingest/xml';
import {
  detectTestFormat, parseCucumber, parseJUnit, parseSeconds, parseTestReport, parseTimeSpan, parseTrx, ReportError, testKey,
} from '../../server/lib/ingest/testReports';
import {
  changedCoverage, detectCoverageFormat, parseChangedLinesList, parseCoverageReport, parseUnifiedDiff, pathsMatch,
} from '../../server/lib/ingest/coverageReports';
import { parsePipelineBody, stageKind } from '../../server/lib/ingest/pipelineEvents';
import { gunzipLimited, maybeGunzip, parseMultipart, BodyError, isRawIngestPath } from '../../server/lib/ingest/body';
import { affectedDays, confidenceFor, median } from '../../server/lib/calc/engine';

/**
 * Unit tests of the v2 raw ingestion parsers (server/lib/ingest) against real-world report files
 * (tests/fixtures/ingest), including hostile and malformed XML. The expected numbers are counted by
 * hand from the fixture files. No backend needed.
 */
const F = (name: string) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'ingest', name), 'utf8');

describe('JUnit XML', () => {
  it('PARSE-001 pytest: failures, errors, skipped, suite time and timestamp', () => {
    const r = parseJUnit(F('junit-pytest.xml'));
    expect(r.counts).toEqual({ total: 5, passed: 2, failed: 1, errored: 1, skipped: 1 });
    expect(r.durationMs).toBe(3250);
    expect(r.startedAt?.toISOString()).toBe('2026-11-18T09:15:02.123Z');
    const failed = r.cases.find((c) => c.name === 'test_refund_partial')!;
    expect(failed.suite).toBe('tests.test_payments');
    expect(failed.message).toBe('AssertionError: assert 40 == 45');
    expect(failed.durationMs).toBe(1204);
    expect(r.cases.find((c) => c.name === 'test_ledger_close')!.status).toBe('error');
  });

  it('PARSE-002 Jest (jest-junit): file suites, root time, message from the element text', () => {
    const r = parseJUnit(F('junit-jest.xml'));
    expect(r.counts).toEqual({ total: 4, passed: 2, failed: 1, errored: 0, skipped: 1 });
    expect(r.durationMs).toBe(2871);
    const f = r.cases.find((c) => c.status === 'failed')!;
    expect(f.suite).toBe('src/cart/cart.test.ts');
    expect(f.message).toContain('Expected: 90');
    expect(r.startedAt?.toISOString()).toBe('2026-11-18T10:00:00.000Z');
  });

  it('PARSE-003 Maven Surefire: properties, comma thousands, flakyFailure (a passed retry) and rerunFailure', () => {
    const r = parseJUnit(F('junit-maven-surefire.xml'));
    expect(r.counts).toEqual({ total: 4, passed: 3, failed: 1, errored: 0, skipped: 0 });
    expect(r.durationMs).toBe(4_321_500);
    const flaky = r.cases.find((c) => c.name === 'rejectsBadCredit')!;
    expect(flaky).toMatchObject({ status: 'passed', retries: 1 });
    expect(flaky.message).toContain('expected: <REJECTED>');
    expect(r.cases.find((c) => c.name === 'computesInterest')).toMatchObject({ status: 'failed', retries: 1 });
  });

  it('PARSE-004 Gradle, Playwright and Cypress (nested suites) variants', () => {
    const g = parseJUnit(F('junit-gradle.xml'));
    expect(g.counts).toEqual({ total: 3, passed: 2, failed: 0, errored: 0, skipped: 1 });
    expect(g.durationMs).toBe(876);
    const p = parseJUnit(F('junit-playwright.xml'));
    expect(p.counts).toMatchObject({ total: 3, passed: 2, failed: 1 });
    expect(p.durationMs).toBe(12_480);
    expect(p.cases[1].message).toBe('checkout.spec.ts:30:5 shows the receipt');
    const c = parseJUnit(F('junit-cypress.xml'));
    expect(c.counts).toMatchObject({ total: 3, passed: 3 });
    expect(c.durationMs).toBe(7020);
    expect(c.cases.map((x) => x.suite)).toEqual(['Login', 'Login errors', 'Login']);
  });

  it('PARSE-005 a <testsuite> root and a case without time; durations in seconds with a decimal comma', () => {
    const r = parseJUnit('<testsuite name="s"><testcase name="a"/><testcase name="b" time="1,5"/></testsuite>');
    expect(r.counts.total).toBe(2);
    expect(r.cases[1].durationMs).toBe(1500);
    expect(parseSeconds('1,234.5')).toBe(1234.5);
    expect(parseSeconds('abc')).toBe(0);
  });

  it('PARSE-006 a document that is not JUnit is refused with the root element named', () => {
    expect(() => parseJUnit('<html><body/></html>')).toThrow(/root element is <html>/);
  });
});

describe('TRX and Cucumber JSON', () => {
  it('PARSE-010 TRX: outcomes, class names from the definitions, data-driven results counted once, run time', () => {
    const r = parseTrx(F('trx-dotnet.trx'));
    expect(r.counts).toEqual({ total: 4, passed: 2, failed: 1, errored: 0, skipped: 1 });
    expect(r.durationMs).toBe(5500);
    const f = r.cases.find((c) => c.status === 'failed')!;
    expect(f.suite).toBe('Bank.Tests.TransferTests');
    expect(f.message).toBe('Assert.AreEqual failed. Expected:<Frozen>. Actual:<Active>.');
    expect(f.durationMs).toBe(1000);
    expect(parseTimeSpan('1.02:00:00.5')).toBe(26 * 3600_000 + 500);
  });

  it('PARSE-011 Cucumber JSON: scenario status from its steps, background steps included, durations in ns', () => {
    const r = parseCucumber(F('cucumber.json'));
    expect(r.counts).toEqual({ total: 3, passed: 1, failed: 1, errored: 0, skipped: 1 });
    expect(r.cases.map((c) => c.durationMs)).toEqual([600, 600, 100]);
    expect(r.durationMs).toBe(1300);
    expect(r.cases[1].message).toContain('Expected an error banner');
    expect(r.cases[0].suite).toBe('features/transfer.feature');
  });

  it('PARSE-012 Cucumber JSON that is not an array of features is refused', () => {
    expect(() => parseCucumber('{"a":1}')).toThrow(ReportError);
    expect(() => parseCucumber('[{"name":"x"}]')).toThrow(/elements/);
    expect(() => parseCucumber('[not json')).toThrow(/not valid JSON/);
  });

  it('PARSE-013 format detection', () => {
    expect(detectTestFormat(F('junit-pytest.xml'))).toBe('junit');
    expect(detectTestFormat(F('junit-playwright.xml'))).toBe('junit');
    expect(detectTestFormat(F('trx-dotnet.trx'))).toBe('trx');
    expect(detectTestFormat(F('cucumber.json'))).toBe('cucumber');
    expect(detectTestFormat('<!-- a comment <x> --><testsuite/>')).toBe('junit');
    expect(detectTestFormat('hello')).toBeNull();
    expect(detectTestFormat(F('cobertura.xml'))).toBeNull();
  });

  it('PARSE-014 the test key is stable per suite and name', () => {
    expect(testKey('a', 'b')).toBe(testKey('a', 'b'));
    expect(testKey('a', 'b')).not.toBe(testKey('ab', ''));
  });
});

describe('Hostile and malformed XML', () => {
  it('PARSE-020 external entities (XXE) are refused and nothing is read from disk', () => {
    expect(() => parseTestReport(F('hostile-xxe.xml'), 'junit')).toThrow(/entity declarations are not allowed/);
  });
  it('PARSE-021 entity expansion ("billion laughs") is refused quickly', () => {
    const t0 = Date.now();
    expect(() => parseTestReport(F('hostile-billion-laughs.xml'), 'junit')).toThrow(/entity declarations are not allowed/);
    expect(Date.now() - t0).toBeLessThan(200);
  });
  it('PARSE-022 an undeclared entity is an error, never expanded', () => {
    expect(() => parseTestReport(F('hostile-undeclared-entity.xml'), 'junit')).toThrow(/Undefined entity &secret;/);
  });
  it('PARSE-023 truncated and mismatched documents name the problem', () => {
    expect(() => parseTestReport(F('malformed-truncated.xml'), 'junit')).toThrow(/Invalid XML: Unterminated start tag/);
    expect(() => parseTestReport(F('malformed-mismatched.xml'), 'junit')).toThrow(/Mismatched end tag <\/testsuite>/);
  });
  it('PARSE-024 deep nesting, two roots and text outside the root are refused', () => {
    const deep = '<a>'.repeat(300) + '</a>'.repeat(300);
    expect(() => parseXml(deep, { open() {}, close() {} })).toThrow(/nested too deeply/);
    expect(() => parseXml('<a/><b/>', { open() {}, close() {} })).toThrow(/More than one root/);
    expect(() => parseXml('junk<a/>', { open() {}, close() {} })).toThrow(XmlError);
  });
  it('PARSE-025 a JaCoCo DOCTYPE with an external DTD is skipped, the DTD is never fetched', () => {
    expect(() => parseCoverageReport(F('jacoco.xml'), 'jacoco')).not.toThrow();
  });
  it('PARSE-026 predefined entities, numeric references, CDATA and a bare ampersand', () => {
    const names: string[] = [];
    parseXml('<a><b n="x &amp; y &#65;&#x42; &lt;ok&gt; R&D"/><![CDATA[<raw>]]></a>', { open(n, at) { if (n === 'b') names.push(at.n); }, close() {} });
    expect(names).toEqual(['x & y AB <ok> R&D']);
  });
});

describe('Coverage reports', () => {
  it('PARSE-030 lcov: lines from DA, branches from BRF/BRH, absolute paths kept', () => {
    const r = parseCoverageReport(F('lcov.info'), 'lcov');
    expect(r.totals).toEqual({ linesFound: 14, linesHit: 11, branchesFound: 2, branchesHit: 1 });
    expect(r.files.map((f) => [f.path, f.linesFound, f.linesHit])).toEqual([['src/a.ts', 4, 2], ['/home/runner/work/app/app/src/b.ts', 10, 9]]);
  });
  it('PARSE-031 Cobertura: classes of one file merged, method lines not counted twice, condition coverage', () => {
    const r = parseCoverageReport(F('cobertura.xml'), 'cobertura');
    expect(r.totals).toEqual({ linesFound: 6, linesHit: 3, branchesFound: 2, branchesHit: 1 });
    expect(r.files.find((f) => f.path === 'com/bank/Foo.java')).toMatchObject({ linesFound: 4, linesHit: 3 });
  });
  it('PARSE-032 JaCoCo: per-line data, else the sourcefile counters', () => {
    const r = parseCoverageReport(F('jacoco.xml'), 'jacoco');
    expect(r.totals).toEqual({ linesFound: 23, linesHit: 17, branchesFound: 10, branchesHit: 7 });
    expect(r.files.map((f) => f.path)).toEqual(['com/bank/loans/LoanService.java', 'com/bank/loans/Rate.java']);
  });
  it('PARSE-033 Istanbul coverage-final.json: line hits = the most-hit statement on the line', () => {
    const r = parseCoverageReport(F('istanbul-final.json'), 'istanbul');
    expect(r.totals).toEqual({ linesFound: 3, linesHit: 2, branchesFound: 4, branchesHit: 1 });
  });
  it('PARSE-034 Istanbul json-summary: per file and total', () => {
    const r = parseCoverageReport(F('istanbul-summary.json'), 'istanbul-summary');
    expect(r.totals).toEqual({ linesFound: 30, linesHit: 18, branchesFound: 4, branchesHit: 2 });
    expect(r.files[0].lines).toBeNull();
  });
  it('PARSE-035 format detection, and wrong content for a format', () => {
    expect(detectCoverageFormat(F('lcov.info'))).toBe('lcov');
    expect(detectCoverageFormat(F('cobertura.xml'))).toBe('cobertura');
    expect(detectCoverageFormat(F('jacoco.xml'))).toBe('jacoco');
    expect(detectCoverageFormat(F('istanbul-final.json'))).toBe('istanbul');
    expect(detectCoverageFormat(F('istanbul-summary.json'))).toBe('istanbul-summary');
    expect(detectCoverageFormat(F('junit-jest.xml'))).toBeNull();
    expect(() => parseCoverageReport('nothing here', 'lcov')).toThrow(/no SF/);
    expect(() => parseCoverageReport(F('jacoco.xml'), 'cobertura')).toThrow(/Not a Cobertura report/);
    expect(() => parseCoverageReport('{"x": 1}', 'istanbul')).toThrow(/statementMap/);
  });
  it('PARSE-036 coverage of changed code from a unified diff (absolute coverage paths match relative diff paths)', () => {
    const cov = parseCoverageReport(F('lcov.info'), 'lcov');
    const changed = parseUnifiedDiff(F('changes.diff'));
    expect(Array.from(changed.get('src/a.ts')!)).toEqual([2, 3]);
    expect(Array.from(changed.get('src/b.ts')!)).toEqual([10]);
    expect(changed.get('README.md')!.size).toBe(1);
    const c = changedCoverage(cov, changed);
    expect({ found: c.found, hit: c.hit }).toEqual({ found: 3, hit: 1 });
    expect(pathsMatch('/home/runner/work/app/app/src/b.ts', 'src/b.ts')).toBe(true);
    expect(pathsMatch('src/ab.ts', 'b.ts')).toBe(false);
  });
  it('PARSE-037 a changed-lines list with ranges', () => {
    const cl = parseChangedLinesList('{"files": {"src/a.ts": [2, "3-4"]}}');
    expect(Array.from(cl.get('src/a.ts')!)).toEqual([2, 3, 4]);
    expect(() => parseChangedLinesList('{"a": "x"}')).toThrow(/must be an array/);
  });
});

describe('Pipeline events', () => {
  it('PARSE-040 a GitHub Actions run: result names, refs/heads/ stripped, stage durations and kinds', () => {
    const [run] = parsePipelineBody(JSON.parse(F('pipeline-github.json')));
    expect(run).toMatchObject({ id: '6612345678', attempt: 1, branch: 'main', result: 'success', durationS: 720 });
    expect(run.stages.map((s) => [s.kind, s.durationS, s.parallelGroup])).toEqual([
      ['build', 180, null], ['test', 360, 'unit'], ['test', 240, 'unit'], ['test', 300, 'unit'], ['deploy', 180, null],
    ]);
  });
  it('PARSE-041 Jenkins / GitLab / Azure result names and errors naming the field', () => {
    const base = { id: '1', startedAt: '2026-11-18T08:00:00Z' };
    expect(parsePipelineBody([{ ...base, result: 'UNSTABLE' }])[0].result).toBe('failed');
    expect(parsePipelineBody({ runs: [{ ...base, result: 'canceled' }] })[0].result).toBe('cancelled');
    expect(parsePipelineBody([{ ...base, result: 'succeeded' }])[0].result).toBe('success');
    expect(() => parsePipelineBody([{ ...base, result: 'maybe' }])).toThrow(/runs\[0\]\.result must be one of/);
    expect(() => parsePipelineBody([{ startedAt: base.startedAt, result: 'success' }])).toThrow(/runs\[0\]\.id is required/);
    expect(() => parsePipelineBody([{ ...base, result: 'success', finishedAt: '2026-11-18T07:00:00Z' }])).toThrow(/before startedAt/);
    expect(() => parsePipelineBody([])).toThrow(/between 1 and 100/);
    expect(stageKind('integration-tests')).toBe('test');
  });
});

describe('Upload bodies', () => {
  it('PARSE-050 multipart: the report file and the fields', () => {
    const b = '----x';
    const body = Buffer.from(
      `--${b}\r\nContent-Disposition: form-data; name="team"\r\n\r\nteam-1\r\n` +
      `--${b}\r\nContent-Disposition: form-data; name="report"; filename="r.xml"\r\nContent-Type: application/xml\r\n\r\n<testsuite/>\r\n` +
      `--${b}--\r\n`
    );
    const mp = parseMultipart(body, `multipart/form-data; boundary=${b}`);
    expect(mp.fields.team).toBe('team-1');
    expect(mp.files.report.data.toString()).toBe('<testsuite/>');
    expect(() => parseMultipart(body, 'multipart/form-data')).toThrow(/boundary/);
  });
  it('PARSE-051 gzip: a gzipped file is detected by its magic bytes; a gzip bomb stops at the limit', () => {
    expect(maybeGunzip(gzipSync(Buffer.from('<a/>'))).toString()).toBe('<a/>');
    expect(() => maybeGunzip(Buffer.from('x'), 'br')).toThrow(BodyError);
    const bomb = gzipSync(Buffer.alloc(120 * 1024 * 1024));
    expect(() => gunzipLimited(bomb)).toThrow(/too large after decompression/);
  });
  it('PARSE-052 the app-wide JSON parser skips only the raw endpoints', () => {
    expect(isRawIngestPath('/api/ingest/tests')).toBe(true);
    expect(isRawIngestPath('/ingest/pipelines')).toBe(true);
    expect(isRawIngestPath('/api/ingest/kpis')).toBe(false);
  });
});

describe('Calculation helpers', () => {
  it('CALC-001 median, confidence and the days a late upload affects', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect([confidenceFor(1), confidenceFor(3), confidenceFor(10)]).toEqual(['low', 'medium', 'high']);
    expect(affectedDays('coverage', '2026-11-10', '2026-11-20')).toEqual(['2026-11-10']);
    expect(affectedDays('tests', '2026-11-10', '2026-11-20')).toHaveLength(7);
    expect(affectedDays('tests', '2026-11-19', '2026-11-20')).toEqual(['2026-11-19', '2026-11-20']);
  });
});
