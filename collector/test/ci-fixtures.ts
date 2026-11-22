/**
 * Vendor API stand-ins for the CI connectors, modelled on the documented responses of each API (field names and
 * shapes as GitHub REST v2022-11-28, GitLab REST v4, Jenkins JSON API + Pipeline Stage View wfapi, Azure DevOps
 * REST 7.1 and SonarQube Web API return them), with times relative to now. The artifacts are real zip archives
 * holding JUnit XML, lcov and SARIF files. Each mock records its requests (MockServer).
 */
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { MockServer, type Recorded } from './helpers';

const DAY = 86_400_000;
export const BASE = Date.now() - 2 * DAY;
export const at = (minutes: number) => new Date(BASE + minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** A zip archive (deflate) of the given files. */
export function zip(files: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const comp = deflateRawSync(data);
    const n = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8); local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, n, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, n);
    offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** A JUnit report; `flaky` fails the checkout test (the same commit passes it in another run). */
export const junit = (failCheckout: boolean) => `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="jest tests" tests="4" failures="${failCheckout ? 1 : 0}" time="12.5">
  <testsuite name="src/checkout/checkout.test.ts" tests="2" failures="${failCheckout ? 1 : 0}" time="8.0" timestamp="${at(1)}">
    <testcase classname="checkout" name="pays with a saved card" time="6.5">${failCheckout ? '<failure message="Timeout waiting for SECRET-STACK alice@example.com">at Object.&lt;anonymous&gt; (/home/runner/work/checkout.test.ts:42)</failure>' : ''}</testcase>
    <testcase classname="checkout" name="shows the total" time="1.5"/>
  </testsuite>
  <testsuite name="src/cart/cart.test.ts" tests="2" failures="0" time="4.5">
    <testcase classname="cart" name="adds an item" time="2.5"/>
    <testcase classname="cart" name="removes an item" time="2.0"><skipped/></testcase>
  </testsuite>
</testsuites>`;

export const LCOV = `TN:
SF:src/checkout/pay.ts
DA:1,1
DA:2,0
DA:3,0
DA:4,1
LF:4
LH:2
BRF:2
BRH:1
end_of_record
TN:
SF:src/cart/cart.ts
DA:1,1
DA:2,1
DA:3,1
DA:4,1
DA:5,0
LF:5
LH:4
end_of_record
`;

export const SARIF = (fp: string) => JSON.stringify({
  version: '2.1.0', $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
  runs: [{
    tool: { driver: { name: 'CodeQL', semanticVersion: '2.19.0', rules: [{ id: 'js/sql-injection', name: 'SqlInjection', properties: { 'security-severity': '8.8' } }, { id: 'js/unused-local-variable', defaultConfiguration: { level: 'note' } }] } },
    results: [
      { ruleId: 'js/sql-injection', level: 'error', message: { text: 'Query built from user input (contains SECRET-QUERY)' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/db/query.ts' }, region: { startLine: 42 } } }], partialFingerprints: { primaryLocationLineHash: fp } },
      { ruleId: 'js/unused-local-variable', message: { text: 'Unused variable x' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.ts' }, region: { startLine: 3 } } }], partialFingerprints: { primaryLocationLineHash: 'bbb:1' } },
    ],
  }],
});

const sha = (s: string) => createHash('sha1').update(s).digest('hex');
export const SHA = { c1: sha('c1'), c2: sha('c2'), c3: sha('c3'), d0: sha('d0'), d1: sha('d1'), d2: sha('d2') };

export interface StorageMock { server: MockServer; blobs: Map<string, Buffer> }

/** The signed-URL storage host artifacts redirect to (a different origin: no credentials may reach it). */
export async function storage(): Promise<StorageMock> {
  const server = await new MockServer().start();
  const blobs = new Map<string, Buffer>();
  server.on('GET', /^\/blob\//, (r: Recorded) => {
    const b = blobs.get(r.path.slice('/blob/'.length));
    if (!b) return { status: 404, body: 'gone' };
    return { status: 200, headers: { 'Content-Type': 'application/zip' }, body: b as any };
  });
  return { server, blobs };
}

/** GitHub REST: workflow runs (2 pages), jobs with steps, artifacts (tests, coverage, SARIF, expired, too large), deployments, statuses, compare. */
export function mockGitHub(s: MockServer, store: StorageMock, opts: { rateLimitOnce?: boolean } = {}) {
  const repo = '/repos/acme/payments';
  let limited = !!opts.rateLimitOnce;
  const run = (id: number, attempt: number, conclusion: string, head: string, start: number, end: number) => ({
    id, name: 'CI', path: '.github/workflows/ci.yml', head_branch: 'main', head_sha: head, run_attempt: attempt, status: 'completed', conclusion,
    created_at: at(start), run_started_at: at(start), updated_at: at(end), html_url: `https://github.com/acme/payments/actions/runs/${id}`,
    actor: { login: 'alice', email: 'alice@example.com' }, display_title: 'Fix refund for alice@example.com',
  });
  const runs = [run(101, 1, 'failure', SHA.c1, 0, 15), run(101, 2, 'success', SHA.c1, 20, 34), run(102, 1, 'success', SHA.c2, 60, 72), run(103, 1, 'cancelled', SHA.c3, 90, 91)];
  s.on('GET', repo, () => ({ body: { id: 1, full_name: 'acme/payments', private: true } }));
  s.on('GET', `${repo}/actions/runs`, (r) => {
    if (limited) { limited = false; return { status: 403, headers: { 'retry-after': '0' }, body: { message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' } }; }
    if (r.query.get('per_page') === '1') return { body: { total_count: runs.length, workflow_runs: runs.slice(0, 1) } };
    const page = Number(r.query.get('page') ?? '1');
    const list = page === 1 ? runs.slice(0, 2) : runs.slice(2);
    const headers: Record<string, string> = { 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600) };
    if (page === 1) headers.link = `<${s.url}${repo}/actions/runs?status=completed&page=2&per_page=100>; rel="next", <${s.url}${repo}/actions/runs?page=2>; rel="last"`;
    return { headers, body: { total_count: runs.length, workflow_runs: list } };
  });
  const jobs = (id: number, attempt: number) => {
    const off = runs.find((x) => x.id === id && x.run_attempt === attempt)!;
    const t0 = Date.parse(off.run_started_at);
    const t = (m: number) => new Date(t0 + m * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const failed = off.conclusion === 'failure';
    return [
      { id: id * 10 + 1, name: 'build', status: 'completed', conclusion: 'success', started_at: t(0), completed_at: t(3), steps: [{ name: 'Set up job', conclusion: 'success', started_at: t(0), completed_at: t(0.5) }, { name: 'npm ci', conclusion: 'success', started_at: t(0.5), completed_at: t(2.5) }] },
      { id: id * 10 + 2, name: 'test (1, 2)', status: 'completed', conclusion: failed ? 'failure' : 'success', started_at: t(3), completed_at: t(9), steps: [{ name: 'Run tests', conclusion: failed ? 'failure' : 'success', started_at: t(3), completed_at: t(9) }] },
      { id: id * 10 + 3, name: 'test (2, 2)', status: 'completed', conclusion: 'success', started_at: t(3), completed_at: t(7), steps: [{ name: 'Run tests', conclusion: 'success', started_at: t(3), completed_at: t(7) }] },
      { id: id * 10 + 4, name: 'deploy', status: 'completed', conclusion: failed ? 'skipped' : 'success', started_at: failed ? null : t(10), completed_at: failed ? null : t(12), steps: [] },
    ];
  };
  s.on('GET', new RegExp(`^${repo}/actions/runs/(\\d+)/attempts/(\\d+)/jobs$`), (r) => {
    const [, id, attempt] = /runs\/(\d+)\/attempts\/(\d+)/.exec(r.path)!;
    return { body: { total_count: 4, jobs: jobs(Number(id), Number(attempt)) } };
  });
  // Artifacts per run: run 101 attempt 1 failed the checkout test; attempt 2 passed it (flaky on c1).
  const arts = (id: number) => {
    const base = id * 100;
    return [
      { id: base + 1, name: 'test-results', size_in_bytes: 2048, expired: false, archive_download_url: `${s.url}${repo}/actions/artifacts/${base + 1}/zip` },
      { id: base + 2, name: 'coverage-report', size_in_bytes: 1024, expired: false, archive_download_url: `${s.url}${repo}/actions/artifacts/${base + 2}/zip` },
      { id: base + 3, name: 'codeql-sarif', size_in_bytes: 1024, expired: false, archive_download_url: `${s.url}${repo}/actions/artifacts/${base + 3}/zip` },
      { id: base + 4, name: 'test-results-old', size_in_bytes: 1024, expired: true, archive_download_url: `${s.url}${repo}/actions/artifacts/${base + 4}/zip` },
      { id: base + 5, name: 'coverage-huge', size_in_bytes: 900 * 1024 * 1024, expired: false, archive_download_url: `${s.url}${repo}/actions/artifacts/${base + 5}/zip` },
      { id: base + 6, name: 'build-output', size_in_bytes: 4096, expired: false, archive_download_url: `${s.url}${repo}/actions/artifacts/${base + 6}/zip` },
    ];
  };
  let attemptOf101 = 0;
  s.on('GET', new RegExp(`^${repo}/actions/runs/(\\d+)/artifacts$`), (r) => {
    const id = Number(/runs\/(\d+)\/artifacts/.exec(r.path)![1]);
    if (id === 101) attemptOf101++;
    if (id === 103) return { body: { total_count: 0, artifacts: [] } };
    return { body: { total_count: 6, artifacts: arts(id) } };
  });
  s.on('GET', new RegExp(`^${repo}/actions/artifacts/(\\d+)/zip$`), (r) => {
    const aid = Number(/artifacts\/(\d+)\/zip/.exec(r.path)![1]);
    const run = Math.floor(aid / 100);
    const kind = aid % 100;
    const key = `${aid}-${run === 101 ? attemptOf101 : 1}`;
    if (kind === 1) store.blobs.set(key, zip({ 'junit/checkout.xml': junit(run === 101 && attemptOf101 === 1) }));
    else if (kind === 2) store.blobs.set(key, zip({ 'coverage/lcov.info': LCOV }));
    else if (kind === 3) store.blobs.set(key, zip({ 'results/codeql.sarif': SARIF(run === 102 ? 'ccc:1' : 'aaa:1') }));
    else if (kind === 4) return { status: 410, body: { message: 'Artifact has expired' } };
    else store.blobs.set(key, zip({ 'dist/app.js': 'console.log(1)' }));
    return { status: 302, headers: { location: `${store.server.url}/blob/${key}?sig=signed-url-token` } };
  });
  s.on('GET', `${repo}/environments`, () => ({ body: { total_count: 2, environments: [{ name: 'staging' }, { name: 'production' }] } }));
  const deps = [
    { id: 9001, sha: SHA.d0, ref: 'main', environment: 'production', description: 'Deploy', created_at: at(-60 * 24), creator: { login: 'bob' } },
    { id: 9002, sha: SHA.d1, ref: 'main', environment: 'production', description: 'Deploy', created_at: at(100) },
    { id: 9003, sha: SHA.d2, ref: 'hotfix/refund', environment: 'production', description: 'Hotfix', created_at: at(200) },
    { id: 9004, sha: SHA.d1, ref: 'main', environment: 'production', description: 'Rollback', created_at: at(300) },
    { id: 9005, sha: SHA.c3, ref: 'main', environment: 'production', description: 'Deploy', created_at: at(400) },
    { id: 9006, sha: SHA.c3, ref: 'main', environment: 'production', description: 'Deploy', created_at: at(500) },
  ];
  s.on('GET', `${repo}/deployments`, (r) => ({ body: r.query.get('environment') === 'production' ? [...deps].reverse() : [] }));
  const statuses: Record<number, any[]> = {
    9001: [{ state: 'success', created_at: at(-60 * 24 + 5), log_url: 'https://github.com/acme/payments/actions/runs/1' }],
    9002: [{ state: 'success', created_at: at(105) }, { state: 'in_progress', created_at: at(101) }],
    9003: [{ state: 'success', created_at: at(206) }],
    9004: [{ state: 'success', created_at: at(305) }],
    9005: [{ state: 'failure', created_at: at(406) }],
    9006: [{ state: 'in_progress', created_at: at(501) }],
  };
  s.on('GET', new RegExp(`^${repo}/deployments/(\\d+)/statuses$`), (r) => ({ body: statuses[Number(/deployments\/(\d+)\/statuses/.exec(r.path)![1])] ?? [] }));
  s.on('GET', new RegExp(`^${repo}/compare/`), (r) => {
    const [from, to] = r.path.split('/compare/')[1].split('...');
    return { body: { status: 'ahead', commits: [{ sha: to, commit: { author: { name: 'Alice', email: 'alice@example.com', date: at(-120) }, committer: { date: at(-110) }, message: 'Refund fix SECRET-MSG' } }, { sha: sha(`${from}-mid`), commit: { author: { date: at(-300) }, committer: { date: at(-290) } } }] } };
  });
  s.on('GET', new RegExp(`^${repo}/commits/`), (r) => ({ body: { sha: r.path.split('/commits/')[1], commit: { author: { date: at(-60 * 26) }, committer: { date: at(-60 * 26) } } } }));
}

/** GitLab REST v4: pipelines (2 pages, X-Next-Page), pipeline detail, jobs (include_retried), test report, job artifacts, deployments, compare. */
export function mockGitLab(s: MockServer, store: StorageMock) {
  const p = '/api/v4/projects/42';
  s.on('GET', '/api/v4/projects/acme%2Fweb', () => ({ body: { id: 42, path_with_namespace: 'acme/web' } }));
  s.on('GET', `${p}/environments`, () => ({ body: [{ id: 1, name: 'production' }, { id: 2, name: 'review/feature' }] }));
  const pipes = [
    { id: 501, status: 'failed', ref: 'main', sha: SHA.c1, updated_at: at(20), created_at: at(0) },
    { id: 502, status: 'success', ref: 'main', sha: SHA.c1, updated_at: at(50), created_at: at(30) },
    { id: 503, status: 'running', ref: 'main', sha: SHA.c2, updated_at: at(70), created_at: at(60) },
  ];
  s.on('GET', `${p}/pipelines`, (r) => {
    if (r.query.get('per_page') === '1') return { body: pipes.slice(0, 1) };
    const page = Number(r.query.get('page') ?? '1');
    return { headers: { 'x-next-page': page === 1 ? '2' : '', 'x-total-pages': '2' }, body: page === 1 ? pipes.slice(0, 2) : pipes.slice(2) };
  });
  s.on('GET', new RegExp(`^${p}/pipelines/(\\d+)$`), (r) => {
    const id = Number(r.path.split('/').pop());
    const x = pipes.find((y) => y.id === id)!;
    return { body: { ...x, started_at: x.created_at, finished_at: x.updated_at, duration: (Date.parse(x.updated_at) - Date.parse(x.created_at)) / 1000, web_url: `https://gitlab.com/acme/web/-/pipelines/${id}`, user: { username: 'carol', name: 'Carol' } } };
  });
  s.on('GET', new RegExp(`^${p}/pipelines/(\\d+)/jobs$`), (r) => {
    const id = Number(r.path.split('/')[6]);
    const x = pipes.find((y) => y.id === id)!;
    const t0 = Date.parse(x.created_at);
    const t = (m: number) => new Date(t0 + m * 60_000).toISOString();
    return {
      body: [
        { id: id * 10 + 1, name: 'compile', stage: 'build', status: 'success', started_at: t(0), finished_at: t(4), duration: 240, artifacts: [] },
        { id: id * 10 + 2, name: 'rspec 1/2', stage: 'test', status: x.status === 'failed' ? 'failed' : 'success', started_at: t(4), finished_at: t(12), duration: 480, artifacts: [{ file_type: 'archive', size: 2048, filename: 'artifacts.zip' }, { file_type: 'junit', size: 300, filename: 'junit.xml.gz' }] },
        { id: id * 10 + 3, name: 'rspec 2/2', stage: 'test', status: 'success', started_at: t(4), finished_at: t(10), duration: 360, artifacts: [], artifacts_expire_at: null },
        { id: id * 10 + 4, name: 'coverage', stage: 'test', status: 'success', started_at: t(12), finished_at: t(14), duration: 120, artifacts: [{ file_type: 'archive', size: 1024, filename: 'coverage.zip' }], artifacts_expire_at: new Date(Date.now() + DAY).toISOString() },
        { id: id * 10 + 5, name: 'sast-report', stage: 'test', status: 'success', started_at: t(12), finished_at: t(13), duration: 60, artifacts: [{ file_type: 'archive', size: 1024, filename: 'gl-sast.zip' }], artifacts_expire_at: new Date(Date.now() - DAY).toISOString() },
      ],
    };
  });
  s.on('GET', new RegExp(`^${p}/pipelines/(\\d+)/test_report$`), (r) => {
    const id = Number(r.path.split('/')[6]);
    return {
      body: {
        total_time: 9.5, total_count: 3, success_count: id === 501 ? 1 : 2, failed_count: id === 501 ? 1 : 0,
        test_suites: [{ name: 'rspec', total_time: 9.5, test_cases: [
          { status: id === 501 ? 'failed' : 'success', name: 'Refund approves partial refunds', classname: 'spec.refund_spec', execution_time: 4.5, system_output: 'Failure/Error: expected SECRET-OUT from dave@example.com' },
          { status: 'success', name: 'Refund rejects negative amounts', classname: 'spec.refund_spec', execution_time: 5.0 },
          { status: 'skipped', name: 'Refund handles currencies', classname: 'spec.refund_spec', execution_time: 0 },
        ] }],
      },
    };
  });
  s.on('GET', new RegExp(`^${p}/jobs/(\\d+)/artifacts$`), (r): { status: number; headers: Record<string, string>; body?: unknown } => {
    const job = Number(r.path.split('/')[6]);
    if (job % 10 === 4) {
      store.blobs.set(`gl-${job}`, zip({ 'coverage/cobertura.xml': `<?xml version="1.0"?><coverage line-rate="0.75" lines-covered="3" lines-valid="4" branches-covered="0" branches-valid="0"><packages><package name="app"><classes><class name="Refund" filename="app/refund.rb" line-rate="0.75"><lines><line number="1" hits="1"/><line number="2" hits="1"/><line number="3" hits="0"/><line number="4" hits="2"/></lines></class></classes></package></packages></coverage>` }));
      return { status: 302, headers: { location: `${store.server.url}/blob/gl-${job}` } };
    }
    return { status: 200, headers: { 'Content-Type': 'application/zip' }, body: zip({ 'tmp/notes.txt': 'nothing' }) as any };
  });
  s.on('GET', `${p}/deployments`, (r) => ({
    body: r.query.get('environment') === 'production' ? [
      { id: 701, iid: 1, sha: SHA.d0, ref: 'main', status: 'success', created_at: at(-500), updated_at: at(-490), finished_at: at(-490), environment: { name: 'production' }, user: { username: 'erin' } },
      { id: 702, iid: 2, sha: SHA.d1, ref: 'main', status: 'success', created_at: at(100), updated_at: at(110), finished_at: at(110), environment: { name: 'production' } },
      { id: 703, iid: 3, sha: SHA.d2, ref: 'main', status: 'failed', created_at: at(200), updated_at: at(205), finished_at: at(205), environment: { name: 'production' } },
      { id: 704, iid: 4, sha: SHA.c3, ref: 'main', status: 'running', created_at: at(300), updated_at: at(301), environment: { name: 'production' } },
    ] : [],
  }));
  s.on('GET', `${p}/repository/compare`, (r) => ({ body: { commits: [{ id: r.query.get('to'), authored_date: at(-200), committed_date: at(-190), author_email: 'erin@example.com', title: 'SECRET-TITLE' }] } }));
}

/** Jenkins JSON API: builds with revision and artifacts, wfapi stages, testReport, archived artifacts, a deployment job. */
export function mockJenkins(s: MockServer) {
  const job = '/job/payments/job/main';
  const build = (n: number, result: string, start: number, dur: number) => ({
    number: n, result, building: false, timestamp: Date.parse(at(start)), duration: dur * 60_000, url: `https://jenkins.example.com${job}/${n}/`,
    actions: [{ _class: 'hudson.model.CauseAction', causes: [{ userId: 'frank', userName: 'Frank Smith' }] }, { _class: 'hudson.plugins.git.util.BuildData', lastBuiltRevision: { SHA1: n === 12 ? SHA.c2 : SHA.c1, branch: [{ name: 'refs/remotes/origin/main' }] } }],
    artifacts: [{ fileName: 'lcov.info', relativePath: 'coverage/lcov.info' }, { fileName: 'eslint.sarif', relativePath: 'reports/eslint.sarif' }, { fileName: 'app.jar', relativePath: 'build/app.jar' }],
    changeSets: [],
  });
  s.on('GET', `${job}/api/json`, (r) => {
    if (String(r.query.get('tree')).startsWith('fullName')) return { body: { fullName: 'payments/main', lastCompletedBuild: { number: 12, timestamp: Date.parse(at(60)) } } };
    return { body: { builds: [{ number: 13, building: true, timestamp: Date.now() }, build(12, 'SUCCESS', 60, 14), build(11, 'UNSTABLE', 0, 12), build(10, 'ABORTED', -30, 1)] } };
  });
  s.on('GET', new RegExp(`^${job}/(\\d+)/wfapi/describe$`), (r) => {
    const n = Number(r.path.split('/')[5]);
    const t0 = Date.parse(at(n === 12 ? 60 : 0));
    return { body: { id: String(n), status: n === 11 ? 'UNSTABLE' : 'SUCCESS', stages: [
      { name: 'Build', status: 'SUCCESS', startTimeMillis: t0, durationMillis: 180_000 },
      { name: 'Unit tests', status: n === 11 ? 'UNSTABLE' : 'SUCCESS', startTimeMillis: t0 + 180_000, durationMillis: 420_000 },
      { name: 'Integration tests', status: 'SUCCESS', startTimeMillis: t0 + 200_000, durationMillis: 300_000 },
      { name: 'Deploy', status: 'NOT_EXECUTED', startTimeMillis: 0, durationMillis: 0 },
    ] } };
  });
  s.on('GET', new RegExp(`^${job}/(\\d+)/testReport/api/json$`), (r) => {
    const n = Number(r.path.split('/')[5]);
    return { body: { duration: 11.0, suites: [{ name: 'com.acme.PaymentTest', cases: [
      { className: 'com.acme.PaymentTest', name: 'refundsPartially', status: n === 11 ? 'FAILED' : 'FIXED', duration: 5.5, errorDetails: 'expected SECRET-ERR', errorStackTrace: 'at com.acme...' },
      { className: 'com.acme.PaymentTest', name: 'chargesCard', status: 'PASSED', duration: 5.5 },
    ] }] } };
  });
  s.on('GET', new RegExp(`^${job}/(\\d+)/artifact/coverage/lcov.info$`), () => ({ status: 200, headers: { 'Content-Type': 'text/plain' }, body: LCOV }));
  s.on('GET', new RegExp(`^${job}/(\\d+)/artifact/reports/eslint.sarif$`), () => ({ status: 200, headers: { 'Content-Type': 'application/json' }, body: SARIF('jen:1') }));
  s.on('GET', '/job/deploy-prod/api/json', (r) => {
    if (String(r.query.get('tree')).startsWith('fullName')) return { body: { fullName: 'deploy-prod', lastCompletedBuild: null } };
    return { body: { builds: [
      { number: 7, result: 'SUCCESS', building: false, timestamp: Date.parse(at(100)), duration: 120_000, url: 'https://jenkins.example.com/job/deploy-prod/7/', actions: [{ lastBuiltRevision: { SHA1: SHA.d1, branch: [{ name: 'origin/main' }] } }], changeSets: [{ items: [{ commitId: SHA.d1, timestamp: Date.parse(at(-100)), authorEmail: 'frank@example.com', msg: 'SECRET-COMMIT' }] }] },
      { number: 8, result: 'FAILURE', building: false, timestamp: Date.parse(at(200)), duration: 60_000, actions: [{ lastBuiltRevision: { SHA1: SHA.d2, branch: [{ name: 'origin/hotfix/x' }] } }], changeSets: [] },
    ] } };
  });
}

/** Azure DevOps REST 7.1: definitions, builds (continuation token), timeline, test runs and results, code coverage, artifacts, environments and deployment records, changes. */
export function mockAzure(s: MockServer) {
  const p = '/acme/Payments/_apis';
  s.on('GET', `${p}/build/definitions`, () => ({ body: { count: 2, value: [{ id: 7, name: 'payments-ci' }, { id: 8, name: 'web-ci' }] } }));
  const build = (id: number, result: string, start: number, end: number, version: string) => ({
    id, buildNumber: `2026.${id}`, status: 'completed', result, definition: { id: 7, name: 'payments-ci' }, sourceVersion: version, sourceBranch: 'refs/heads/main',
    startTime: at(start), finishTime: at(end), queueTime: at(start - 1), requestedFor: { displayName: 'Grace Hopper', uniqueName: 'grace@example.com' }, _links: { web: { href: `https://dev.azure.com/acme/Payments/_build/results?buildId=${id}` } }, repository: { name: 'payments' },
  });
  s.on('GET', `${p}/build/builds`, (r) => {
    if (r.query.get('continuationToken') === 'page2') return { body: { count: 1, value: [build(302, 'succeeded', 60, 75, SHA.c2)] } };
    return { headers: { 'x-ms-continuationtoken': 'page2' }, body: { count: 1, value: [build(301, 'partiallySucceeded', 0, 20, SHA.c1)] } };
  });
  s.on('GET', new RegExp(`^${p}/build/builds/(\\d+)/timeline$`), (r) => {
    const id = Number(r.path.split('/')[6]);
    const t0 = Date.parse(at(id === 301 ? 0 : 60));
    const t = (m: number) => new Date(t0 + m * 60_000).toISOString();
    return { body: { records: [
      { id: 'st', parentId: null, type: 'Stage', name: 'Test', startTime: t(0), finishTime: t(15), result: 'succeeded' },
      { id: 'ph', parentId: 'st', type: 'Phase', name: 'UnitTests', startTime: t(0), finishTime: t(15), result: 'succeeded' },
      { id: 'j1', parentId: 'ph', type: 'Job', name: 'UnitTests 1', startTime: t(1), finishTime: t(9), result: id === 301 ? 'failed' : 'succeeded', attempt: 1 },
      { id: 'j2', parentId: 'ph', type: 'Job', name: 'UnitTests 2', startTime: t(1), finishTime: t(7), result: 'succeeded', attempt: 1 },
      { id: 'k1', parentId: 'j1', type: 'Task', name: 'dotnet test', startTime: t(2), finishTime: t(8), result: 'succeeded' },
    ] } };
  });
  s.on('GET', `${p}/test/runs`, (r) => ({ body: { count: 1, value: [{ id: Number(/Build\/(\d+)/.exec(String(r.query.get('buildUri')))![1]) * 10, name: 'VSTest run' }] } }));
  s.on('GET', new RegExp(`^${p}/test/Runs/(\\d+)/results$`), (r) => {
    const run = Number(r.path.split('/')[6]);
    if (Number(r.query.get('$skip')) > 0) return { body: { count: 0, value: [] } };
    return { body: { count: 3, value: [
      { outcome: run === 3010 ? 'Failed' : 'Passed', automatedTestName: 'Payments.Tests.RefundTests.RefundsPartially', automatedTestStorage: 'Payments.Tests.dll', durationInMs: 3200, errorMessage: 'Assert failed SECRET-AZ', runBy: { displayName: 'Grace' } },
      { outcome: 'Passed', automatedTestName: 'Payments.Tests.RefundTests.RejectsNegative', automatedTestStorage: 'Payments.Tests.dll', durationInMs: 800 },
      { outcome: 'NotExecuted', automatedTestName: 'Payments.Tests.RefundTests.Currencies', automatedTestStorage: 'Payments.Tests.dll', durationInMs: 0 },
    ] } };
  });
  s.on('GET', `${p}/test/codecoverage`, () => ({ body: { coverageData: [{ coverageStats: [{ label: 'Lines', covered: 820, total: 1000 }, { label: 'Branches', covered: 150, total: 200 }] }] } }));
  s.on('GET', new RegExp(`^${p}/build/builds/(\\d+)/artifacts$`), (r) => {
    const id = Number(r.path.split('/')[6]);
    return { body: { count: 2, value: [
      { name: 'CodeAnalysisLogs', resource: { type: 'Container', downloadUrl: `${s.url}/acme/Payments/_apis/resources/Containers/1/CodeAnalysisLogs?itemPath=CodeAnalysisLogs&$format=zip&build=${id}` } },
      { name: 'coverage-pipeline', resource: { type: 'PipelineArtifact', downloadUrl: 'https://artprodcus3.artifacts.visualstudio.com/abc/_apis/artifact/xyz/content?format=zip' } },
    ] } };
  });
  s.on('GET', `${p}/resources/Containers/1/CodeAnalysisLogs`, () => ({ status: 200, headers: { 'Content-Type': 'application/zip' }, body: zip({ 'CodeAnalysisLogs/roslyn.sarif': SARIF('az:1') }) as any }));
  s.on('GET', `${p}/distributedtask/environments`, () => ({ body: { count: 2, value: [{ id: 3, name: 'Production' }, { id: 4, name: 'Staging' }] } }));
  s.on('GET', `${p}/distributedtask/environments/3/environmentdeploymentrecords`, () => ({ body: { count: 2, value: [
    { id: 11, environmentId: 3, definition: { id: 7, name: 'payments-ci' }, owner: { id: 302, name: '2026.302' }, result: 'succeeded', startTime: at(80), finishTime: at(85), stageName: 'Deploy' },
    { id: 12, environmentId: 3, definition: { id: 9, name: 'unmapped-pipeline' }, owner: { id: 303 }, result: 'failed', startTime: at(90), finishTime: at(95) },
  ] } }));
  s.on('GET', new RegExp(`^${p}/build/builds/(\\d+)$`), (r) => ({ body: build(Number(r.path.split('/').pop()), 'succeeded', 60, 75, SHA.d1) }));
  s.on('GET', new RegExp(`^${p}/build/builds/(\\d+)/changes$`), () => ({ body: { count: 1, value: [{ id: SHA.d1, type: 'TfsGit', timestamp: at(-50), author: { displayName: 'Grace', uniqueName: 'grace@example.com' }, message: 'SECRET-CHANGE' }] } }));
}

/** SonarQube Web API: analyses, issues (2 pages), measures, quality gate. */
export function mockSonar(s: MockServer) {
  s.on('GET', '/api/project_analyses/search', () => ({ body: { paging: { pageIndex: 1, pageSize: 1, total: 4 }, analyses: [{ key: 'AYx-1', date: at(120).replace('Z', '+0000'), revision: SHA.c2 }] } }));
  s.on('GET', '/api/issues/search', (r) => {
    const p = Number(r.query.get('p') ?? '1');
    const issue = (i: number, severity: string, type: string, impacts?: any[]) => ({ key: `AX-${p}-${i}`, rule: `typescript:S${1000 + i}`, severity, type, component: `acme_payments:src/file${i}.ts`, line: i, message: 'Remove this SECRET-SONAR', author: 'heidi@example.com', ...(impacts ? { impacts } : {}) });
    const list = p === 1 ? Array.from({ length: 500 }, (_, i) => issue(i, i % 50 === 0 ? 'BLOCKER' : 'MAJOR', i % 50 === 0 ? 'VULNERABILITY' : 'CODE_SMELL')) : [issue(1, 'MINOR', 'BUG', [{ softwareQuality: 'RELIABILITY', severity: 'HIGH' }]), issue(2, 'INFO', 'CODE_SMELL')];
    return { body: { total: 502, p, ps: 500, paging: { pageIndex: p, pageSize: 500, total: 502 }, issues: list } };
  });
  s.on('GET', '/api/measures/component', () => ({ body: { component: { key: 'acme_payments', measures: [{ metric: 'ncloc', value: '48000' }] } } }));
  s.on('GET', '/api/qualitygates/project_status', () => ({ body: { projectStatus: { status: 'ERROR', conditions: [] } } }));
}
