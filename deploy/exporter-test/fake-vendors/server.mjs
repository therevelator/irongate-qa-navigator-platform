#!/usr/bin/env node
// Fake vendors for trying the QE Navigator Exporter without real tools or credentials (TEST ONLY).
//
// One plain Node server (no dependencies) that answers like GitHub, GitLab, Bitbucket Cloud, Jira Cloud, PagerDuty and
// SonarQube, with the response shapes of their public APIs (the same shapes as the Exporter's test stand-ins), and
// writes a KPI file for the Exporter's "kpis" source. Every value is made up and generated from the clock:
//   - 180 days of history: one CI run a day per repository, and one an hour for the last two days, so every sync
//     finds new runs; reruns that pass after a failure (flaky tests); test, coverage and SARIF artifacts;
//   - production deployments most days, with failed ones, hotfixes and a rollback; the commits they shipped;
//   - incidents (some linked to a deployment), sprints of two weeks with stories, bugs found in production or before,
//     story points, estimates and time logged, blocked periods;
//   - SonarQube findings, and KPI values without a raw source (automation coverage, automation ROI).
// Four "teams" of data: payments (GitHub acme/payments-api, Jira PAY, PagerDuty payments-api, SonarQube payments-api),
// mobile (GitHub acme/mobile-app, MOB, mobile-backend, mobile-app), data (GitLab analytics/data-pipeline, DATA,
// data-pipeline, data-pipeline) and reporting (Bitbucket analytics/reporting, REP, reporting-service, reporting).
//
// Credentials: any non-empty token is accepted (the pre-filled fake ones are "fake-…"); an empty one gets 401.
// Paths: /github/…, /gitlab/api/v4/…, /bitbucket/2.0/…, /jira/rest/api/3/…, /pagerduty/…, /sonar/api/…
import http from 'node:http';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const PORT = Number(process.env.PORT || 8080);
const HISTORY_DAYS = Number(process.env.HISTORY_DAYS || 180);
const KPI_FILE = process.env.KPI_FILE || '/shared/kpis.json';
const HOUR = 3600_000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------------------------
// Deterministic randomness: the same id gives the same value on every request.
// ---------------------------------------------------------------------------------------------
const rnd = (...parts) => parseInt(createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 8), 16) / 0xffffffff;
const sha = (...parts) => createHash('sha1').update(parts.join('|')).digest('hex');
const iso = (t) => new Date(t).toISOString();
const isoZ = (t) => iso(t).replace(/\.\d{3}Z$/, 'Z');
const jiraTime = (t) => iso(t).replace('Z', '+0000');

const REPOS = {
  payments: { github: 'acme/payments-api', jira: 'PAY', pd: 'payments-api', sonar: 'payments-api', suite: 'com.acme.payments', tests: ['authorises card', 'declines expired card', 'refunds partially', 'refunds fully', 'retries webhook', 'settles batch', 'rejects duplicate', 'converts currency'] },
  mobile: { github: 'acme/mobile-app', jira: 'MOB', pd: 'mobile-backend', sonar: 'mobile-app', suite: 'app.screens', tests: ['logs in', 'shows balance', 'lists transactions', 'sends money', 'handles offline mode', 'renders dark theme', 'registers push token'] },
  data: { gitlab: 'analytics/data-pipeline', jira: 'DATA', pd: 'data-pipeline', sonar: 'data-pipeline', suite: 'pipeline.jobs', tests: ['ingests events', 'deduplicates rows', 'handles late data', 'computes aggregates', 'exports parquet', 'validates schema'] },
  reporting: { bitbucket: 'analytics/reporting', jira: 'REP', pd: 'reporting-service', sonar: 'reporting', suite: 'reporting.api', tests: ['builds monthly report', 'filters by region', 'exports csv', 'caches queries', 'paginates results'] },
};
/** The flaky test of a team: fails on the first attempt now and then, passes on the rerun. */
const FLAKY = { payments: 'retries webhook', mobile: 'handles offline mode', data: 'handles late data', reporting: 'caches queries' };

/** CI runs of a team: one a day for HISTORY_DAYS (09:00 UTC plus an offset), and one an hour for the last 48 hours. */
function runsOf(team, now = Date.now()) {
  const out = [];
  const offset = { payments: 0, mobile: 20, data: 40, reporting: 50 }[team] * 60_000;
  const today = Math.floor(now / DAY) * DAY;
  for (let d = HISTORY_DAYS; d >= 2; d--) out.push(today - d * DAY + 9 * HOUR + offset);
  for (let t = Math.floor((now - 2 * DAY) / HOUR) * HOUR + offset; t < now - 15 * 60_000; t += HOUR) out.push(t);
  return out.filter((t) => t < now - 15 * 60_000).map((start, i) => {
    const id = Math.floor(start / 60_000) % 10_000_000 + { payments: 10_000_000, mobile: 20_000_000, data: 30_000_000, reporting: 40_000_000 }[team];
    const broken = rnd(team, 'fail', id) < 0.1;
    const flakyRerun = !broken && rnd(team, 'flaky', id) < 0.15;
    const failed = broken || flakyRerun;
    const commit = sha(team, 'commit', Math.floor(start / (6 * HOUR)));
    const build = 120 + Math.round(rnd(team, 'b', id) * 120);
    const test = 300 + Math.round(rnd(team, 't', id) * 240);
    return { id, index: i, start, end: start + (build + test + 60) * 1000, build, test, failed, broken, flakyRerun, commit, branch: rnd(team, 'br', id) < 0.8 ? 'main' : `feature/${team}-${id % 97}` };
  });
}

/** One attempt of a run: its test results (the flaky test fails on attempt 1 of a rerun run). */
function testResults(team, run, attempt) {
  const r = REPOS[team];
  return r.tests.map((name, i) => {
    let status = 'passed';
    if (name === FLAKY[team] && run.flakyRerun && attempt === 1) status = 'failed';
    if (run.broken && i === Math.floor(rnd(team, 'which', run.id) * r.tests.length)) status = 'failed';
    if (rnd(team, 'skip', name) < 0.08) status = 'skipped';
    return { suite: `${r.suite}.${['Core', 'Api', 'Flow'][i % 3]}Test`, name, status, seconds: Math.round((0.05 + rnd(team, name, run.id) * 2) * 1000) / 1000 };
  });
}
const junitXml = (cases) => `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${Object.entries(cases.reduce((m, c) => ((m[c.suite] ??= []).push(c), m), {})).map(([suite, list]) =>
  `<testsuite name="${suite}" tests="${list.length}">\n${list.map((c) => `  <testcase classname="${suite}" name="${c.name}" time="${c.seconds}">${c.status === 'failed' ? '<failure message="AssertionError: expected 200, got 500">at Object.test (spec.js:42)</failure><system-out>log output</system-out>' : c.status === 'skipped' ? '<skipped/>' : ''}</testcase>`).join('\n')}\n</testsuite>`).join('\n')}\n</testsuites>\n`;

/** Coverage files of a run: per file lines found / hit; slowly improving over time. */
function coverageFiles(team, run) {
  const trend = (run.start - (Date.now() - HISTORY_DAYS * DAY)) / (HISTORY_DAYS * DAY);
  return ['core', 'api', 'util', 'db', 'auth'].map((f, i) => {
    const found = 120 + i * 40;
    const ratio = Math.min(0.97, 0.55 + trend * 0.25 + rnd(team, 'cov', f, Math.floor(run.start / DAY)) * 0.15);
    return { path: `src/${f}/${f}.ts`, found, hit: Math.round(found * ratio), bfound: 20 + i * 4, bhit: Math.round((20 + i * 4) * ratio * 0.9) };
  });
}
/** lcov with line data (DA), so QE Navigator can tell the coverage of the changed lines. */
const lcov = (files) => files.map((f) => {
  const da = Array.from({ length: f.found }, (_, i) => `DA:${i + 1},${rnd(f.path, 'line', i) < f.hit / f.found ? 1 + (i % 3) : 0}`);
  const hit = da.filter((l) => !l.endsWith(',0')).length;
  return `TN:\nSF:${f.path}\n${da.join('\n')}\nLF:${f.found}\nLH:${hit}\nBRF:${f.bfound}\nBRH:${f.bhit}\nend_of_record\n`;
}).join('');
const cobertura = (files) => {
  const lf = files.reduce((n, f) => n + f.found, 0); const lh = files.reduce((n, f) => n + f.hit, 0);
  return `<?xml version="1.0"?>\n<coverage line-rate="${(lh / lf).toFixed(4)}" lines-covered="${lh}" lines-valid="${lf}" branches-covered="0" branches-valid="0" version="7.4"><packages><package name="pipeline"><classes>${files.map((f) => `<class name="${f.path}" filename="${f.path}" line-rate="${(f.hit / f.found).toFixed(4)}"><lines>${Array.from({ length: f.found }, (_, i) => `<line number="${i + 1}" hits="${i < f.hit ? 1 : 0}"/>`).join('')}</lines></class>`).join('')}</classes></package></packages></coverage>\n`;
};
/** SARIF of a weekly code scan: findings with severities; a few fixed and a few new each week. */
function sarif(team, week) {
  const results = [];
  for (let i = 0; i < 12; i++) {
    if (rnd(team, 'finding', i, Math.floor(week / 3)) < 0.35) continue;
    const level = ['error', 'warning', 'note'][i % 3];
    results.push({ ruleId: `js/rule-${i}`, level, message: { text: `Finding ${i} with a message that the Exporter strips` }, locations: [{ physicalLocation: { artifactLocation: { uri: `src/mod${i % 5}/file${i}.ts` }, region: { startLine: 10 + i } } }], partialFingerprints: { primaryLocationLineHash: sha(team, 'fp', i) } });
  }
  return JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'CodeQL', version: '2.19.0', rules: Array.from({ length: 12 }, (_, i) => ({ id: `js/rule-${i}`, properties: { 'security-severity': String([9.1, 6.5, 3.1][i % 3]) } })) } }, results }] });
}

/** Production deployments of a team: most days at 14:00; failures, hotfixes and a rollback. */
function deploymentsOf(team, now = Date.now()) {
  const out = [];
  const today = Math.floor(now / DAY) * DAY;
  let n = 0;
  for (let d = HISTORY_DAYS; d >= 0; d--) {
    const at = today - d * DAY + 14 * HOUR + { payments: 0, mobile: 30, data: 60, reporting: 90 }[team] * 60_000;
    if (at > now - 10 * 60_000) continue;
    if (d % 9 !== 4 && d % 11 !== 3 && d % 13 !== 6 && d % 7 !== 2 && rnd(team, 'deployday', d) < 0.25) continue;
    n++;
    const failed = d % 13 === 6 || rnd(team, 'depfail', d) < 0.07;
    out.push({ id: `${team}-${n}`, num: { payments: 9000, mobile: 8000, data: 7000, reporting: 6000 }[team] + n, at, start: at - 6 * 60_000, sha: sha(team, 'commit', Math.floor((at - 8 * HOUR) / (6 * HOUR))), ok: !failed, hotfix: !failed && (d % 11 === 3 || rnd(team, 'hotfix', d) < 0.05) });
    // Now and then a rollback: the commit of the deployment before the previous one, deployed again an hour later.
    const okBefore = out.filter((x) => x.ok);
    if (!failed && okBefore.length >= 3 && (d % 9 === 4 || rnd(team, 'rollback', d) < 0.04)) {
      out.push({ id: `${team}-${++n}`, num: { payments: 9000, mobile: 8000, data: 7000, reporting: 6000 }[team] + n, at: at + HOUR, start: at + HOUR - 4 * 60_000, sha: okBefore[okBefore.length - 2].sha, ok: true, hotfix: false });
      continue;
    }
    if (!failed && rnd(team, 'hotfix2', d) < 0.05) out.push({ id: `${team}-${++n}`, num: { payments: 9000, mobile: 8000, data: 7000, reporting: 6000 }[team] + n, at: at + 2 * HOUR, start: at + 2 * HOUR - 5 * 60_000, sha: sha(team, 'hotfix', d), ok: true, hotfix: true });
  }
  return out;
}
const commitsBetween = (team, fromSha, toSha, at) => {
  const k = 1 + Math.floor(rnd(team, 'ncommits', toSha) * 4);
  return Array.from({ length: k }, (_, i) => ({ sha: i === k - 1 ? toSha : sha(team, 'c', toSha, i), authored: at - (k - i) * 5 * HOUR, committed: at - (k - i) * 5 * HOUR + 30 * 60_000 }));
};

/** Incidents of a team: about every 9 days, some right after a deployment (linked to it). */
function incidentsOf(team, now = Date.now()) {
  const out = [];
  const today = Math.floor(now / DAY) * DAY;
  const deps = deploymentsOf(team, now);
  for (let d = HISTORY_DAYS; d >= 0; d--) {
    if (d % 7 !== 2 && rnd(team, 'inc', d) > 0.06) continue;
    const opened = today - d * DAY + (16 + Math.floor(rnd(team, 'incH', d) * 5)) * HOUR;
    if (opened > now - 30 * 60_000) continue;
    const resolved = opened + (20 + Math.floor(rnd(team, 'incDur', d) * 240)) * 60_000;
    const linked = deps.find((x) => x.at < opened && opened - x.at < 6 * HOUR);
    out.push({ id: `Q${team.slice(0, 3).toUpperCase()}${String(d).padStart(4, '0')}`, num: 1000 + d, opened, ack: opened + 6 * 60_000, resolved: resolved < now ? resolved : null, priority: ['P1', 'P2', 'P3'][Math.floor(rnd(team, 'pri', d) * 3)], deployment: linked ? String(linked.num) : null });
  }
  return out;
}

/** Jira issues of a team: two-week sprints, 8 issues each, bugs found in production or before. */
function issuesOf(team, now = Date.now()) {
  const key = REPOS[team].jira;
  const out = [];
  const firstSprint = Math.floor((now - HISTORY_DAYS * DAY) / (14 * DAY));
  const lastSprint = Math.floor(now / (14 * DAY));
  for (let s = firstSprint; s <= lastSprint; s++) {
    const start = s * 14 * DAY + 9 * HOUR;
    const end = start + 14 * DAY;
    const state = end < now ? 'closed' : start < now ? 'active' : 'future';
    const sprint = { id: 1000 + s, name: `${key} Sprint ${s - firstSprint + 1}`, state, boardId: 3, startDate: iso(start), endDate: iso(end), ...(state === 'closed' ? { completeDate: iso(end + 3 * HOUR) } : {}) };
    for (let i = 0; i < 8; i++) {
      const n = (s - firstSprint) * 8 + i + 1;
      const created = start - DAY + i * HOUR;
      if (created > now) continue;
      const bug = rnd(team, 'bug', s, i) < 0.25;
      const done = state === 'closed' ? rnd(team, 'done', s, i) < 0.85 : rnd(team, 'done', s, i) < 0.4 && start + (i + 3) * DAY < now;
      const resolvedAt = done ? Math.min(now - HOUR, start + (2 + i) * 36 * HOUR) : null;
      const blocked = rnd(team, 'blocked', s, i) < 0.2;
      const est = (2 + Math.floor(rnd(team, 'est', s, i) * 4)) * 4 * 3600;
      const histories = [{ id: `${n}1`, created: jiraTime(start + HOUR), items: [{ field: 'Sprint', fieldtype: 'custom', from: '', to: String(1000 + s) }] }];
      histories.push({ id: `${n}2`, created: jiraTime(start + (i + 1) * 12 * HOUR), items: [{ field: 'status', fieldtype: 'jira', fromString: 'To Do', toString: 'In Progress' }] });
      if (blocked) {
        histories.push({ id: `${n}3`, created: jiraTime(start + (i + 2) * 12 * HOUR), items: [{ field: 'status', fieldtype: 'jira', fromString: 'In Progress', toString: 'Blocked' }] });
        histories.push({ id: `${n}4`, created: jiraTime(start + (i + 2) * 12 * HOUR + 10 * HOUR), items: [{ field: 'status', fieldtype: 'jira', fromString: 'Blocked', toString: 'In Progress' }] });
      }
      if (resolvedAt) histories.push({ id: `${n}5`, created: jiraTime(resolvedAt), items: [{ field: 'status', fieldtype: 'jira', fromString: 'In Progress', toString: 'Done' }] });
      // Nothing in the future: a change that has not happened yet is not in the history.
      for (let k = histories.length - 1; k >= 0; k--) if (Date.parse(histories[k].created.replace('+0000', 'Z')) > now - 5 * 60_000) histories.splice(k, 1);
      const found = bug ? (rnd(team, 'env', s, i) < 0.35 ? 'Production' : 'Staging') : null;
      out.push({
        id: String(10000 + n), key: `${key}-${n}`,
        fields: {
          project: { key, name: `${key} project` }, issuetype: { name: bug ? 'Bug' : 'Story', subtask: false },
          status: resolvedAt ? { name: 'Done', statusCategory: { key: 'done' } } : state === 'future' ? { name: 'To Do', statusCategory: { key: 'new' } } : { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
          resolution: resolvedAt ? { name: 'Done' } : null, resolutiondate: resolvedAt ? jiraTime(resolvedAt) : null,
          created: jiraTime(created), updated: jiraTime(Math.max(...histories.map((h) => Date.parse(h.created.replace('+0000', 'Z'))), created)),
          labels: bug ? ['bug'] : ['feature'], environment: null, customfield_10060: found ? { value: found } : null,
          priority: { name: ['Highest', 'High', 'Medium', 'Low'][Math.floor(rnd(team, 'prio', s, i) * 4)] },
          timeoriginalestimate: est, timespent: resolvedAt ? Math.round(est * (0.6 + rnd(team, 'spent', s, i) * 0.9)) : null,
          customfield_10016: bug ? null : [1, 2, 3, 5, 8][Math.floor(rnd(team, 'sp', s, i) * 5)], customfield_10020: [sprint], customfield_10021: null,
          summary: `Made-up ${bug ? 'bug' : 'story'} ${n}`, description: 'Made-up text the Exporter never sends',
        },
        changelog: { startAt: 0, maxResults: histories.length, total: histories.length, histories },
      });
    }
  }
  return out;
}

/** SonarQube: the latest analysis (today 06:00) and its open issues. */
function sonarIssues(project) {
  return Array.from({ length: 40 }, (_, i) => ({ key: `AX-${project}-${i}`, rule: `typescript:S${1000 + i}`, severity: ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'][i % 5], type: ['BUG', 'VULNERABILITY', 'CODE_SMELL'][i % 3], component: `${project}:src/file${i % 9}.ts`, line: 10 + i, effort: ['5min', '1h', '2h30min', '1d', '15min'][i % 5], debt: ['5min', '1h', '2h30min', '1d', '15min'][i % 5], message: 'Made-up message', author: 'someone@example.com' }))
    .filter((_, i) => rnd(project, 'sonar', i, Math.floor(Date.now() / (7 * DAY))) < 0.7);
}

/** KPI values without a raw source, one per team and week (the Exporter's "kpis" source reads this file). */
function writeKpis(now = Date.now()) {
  const items = [];
  for (const team of Object.keys(REPOS)) {
    for (let w = Math.floor(HISTORY_DAYS / 7); w >= 0; w--) {
      const t = Math.floor(now / DAY) * DAY - w * 7 * DAY;
      items.push({ team, recordedAt: iso(t - DAY), metrics: { automation_coverage: Math.round((45 + (26 - w) * 0.8 + rnd(team, 'ac', w) * 6) * 10) / 10, automation_roi: Math.round((80 + (26 - w) * 3 + rnd(team, 'roi', w) * 20) * 10) / 10 } });
    }
  }
  try { mkdirSync(dirname(KPI_FILE), { recursive: true }); writeFileSync(KPI_FILE, JSON.stringify({ note: 'Made-up KPI values (fake vendors)', items }, null, 2)); } catch (e) { console.error(`kpis file: ${e.message}`); }
}

// ---------------------------------------------------------------------------------------------
// Zip archives (artifacts)
// ---------------------------------------------------------------------------------------------
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content); const comp = deflateRawSync(data); const n = Buffer.from(name); const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    locals.push(local, n, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, n);
    offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(centrals); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------
const teamOf = (field, value) => Object.keys(REPOS).find((t) => REPOS[t][field] === value);
const page = (list, q, size = 100) => { const p = Math.max(1, Number(q.get('page') || 1)); const per = Math.min(100, Number(q.get('per_page') || q.get('pagelen') || size)); return { items: list.slice((p - 1) * per, p * per), p, per, more: p * per < list.length }; };

function github(path, q, base) {
  let m;
  if ((m = /^\/repos\/([^/]+\/[^/]+)$/.exec(path)) && teamOf('github', m[1])) return { body: { full_name: m[1], private: true } };
  if ((m = /^\/repos\/([^/]+\/[^/]+)\/environments$/.exec(path))) return { body: { total_count: 2, environments: [{ name: 'production' }, { name: 'staging' }] } };
  if ((m = /^\/repos\/([^/]+\/[^/]+)\/actions\/runs$/.exec(path))) {
    const team = teamOf('github', m[1]);
    if (!team) return { status: 404, body: { message: 'Not Found' } };
    const since = Date.parse(String(q.get('created') || '').replace(/^>=/, '')) || 0;
    const runs = runsOf(team).filter((r) => r.start >= since).reverse();
    const pg = page(runs, q);
    const link = pg.more ? `<${base}/repos/${m[1]}/actions/runs?status=completed&created=${encodeURIComponent(q.get('created') || '')}&per_page=${pg.per}&page=${pg.p + 1}>; rel="next"` : '';
    return {
      headers: link ? { link } : {},
      body: { total_count: runs.length, workflow_runs: pg.items.map((r) => ({ id: r.id, name: 'CI', path: '.github/workflows/ci.yml', head_sha: r.commit, head_branch: r.branch, status: 'completed', conclusion: r.failed ? 'failure' : 'success', run_attempt: 1, created_at: isoZ(r.start), run_started_at: isoZ(r.start), updated_at: isoZ(r.end), html_url: `https://github.com/${m[1]}/actions/runs/${r.id}`, actor: { login: 'someone', email: 'someone@example.com' }, display_title: 'Made-up commit title' })) },
    };
  }
  if ((m = /^\/repos\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs$/.exec(path))) {
    const team = teamOf('github', m[1]); const run = runsOf(team).find((r) => r.id === Number(m[2])); const attempt = Number(m[3]);
    if (!run) return { status: 404, body: { message: 'Not Found' } };
    const s = run.start;
    const failed = run.failed && attempt === 1;
    const half = Math.round(run.test / 2);
    return { body: { total_count: 4, jobs: [
      { name: 'build', conclusion: 'success', started_at: isoZ(s), completed_at: isoZ(s + run.build * 1000), steps: [{ name: 'checkout', conclusion: 'success', started_at: isoZ(s), completed_at: isoZ(s + 10000) }, { name: 'npm ci', conclusion: 'success', started_at: isoZ(s + 10000), completed_at: isoZ(s + run.build * 1000) }] },
      { name: 'test (1, 2)', conclusion: failed ? 'failure' : 'success', started_at: isoZ(s + run.build * 1000), completed_at: isoZ(s + (run.build + half) * 1000), steps: [] },
      { name: 'test (2, 2)', conclusion: 'success', started_at: isoZ(s + run.build * 1000), completed_at: isoZ(s + (run.build + run.test) * 1000), steps: [] },
      { name: 'deploy', conclusion: failed ? 'skipped' : 'success', started_at: isoZ(s + (run.build + run.test) * 1000), completed_at: isoZ(run.end), steps: [] },
    ] } };
  }
  if ((m = /^\/repos\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)\/artifacts$/.exec(path))) {
    const id = Number(m[2]);
    const arts = [{ id: id * 10 + 1, name: 'test-results', size_in_bytes: 4096, expired: false }, { id: id * 10 + 2, name: 'coverage-report', size_in_bytes: 4096, expired: false }];
    const run = runsOf(teamOf('github', m[1])).find((r) => r.id === id);
    if (run && new Date(run.start).getUTCDay() === 1 && new Date(run.start).getUTCHours() === 9) arts.push({ id: id * 10 + 3, name: 'codeql-sarif', size_in_bytes: 4096, expired: false });
    return { body: { total_count: arts.length, artifacts: arts.map((a) => ({ ...a, archive_download_url: `${base}/repos/${m[1]}/actions/artifacts/${a.id}/zip` })) } };
  }
  if ((m = /^\/repos\/([^/]+\/[^/]+)\/actions\/artifacts\/(\d+)\/zip$/.exec(path))) {
    const team = teamOf('github', m[1]); const aid = Number(m[2]); const id = Math.floor(aid / 10); const kind = aid % 10;
    const run = runsOf(team).find((r) => r.id === id);
    if (!run) return { status: 404, body: { message: 'Not Found' } };
    const attempt = 1;
    if (kind === 1) return { raw: zip({ 'junit/results.xml': junitXml(testResults(team, run, attempt)) }), type: 'application/zip' };
    if (kind === 2) return { raw: zip({ 'coverage/lcov.info': lcov(coverageFiles(team, run)) }), type: 'application/zip' };
    return { raw: zip({ 'results/codeql.sarif': sarif(team, Math.floor(run.start / (7 * DAY))) }), type: 'application/zip' };
  }
  if ((m = /^\/repos\/([^/]+\/[^/]+)\/deployments$/.exec(path))) {
    const team = teamOf('github', m[1]);
    if (q.get('environment') !== 'production') return { body: [] };
    const list = deploymentsOf(team).reverse();
    const pg = page(list, q);
    const link = pg.more ? `<${base}/repos/${m[1]}/deployments?environment=production&per_page=${pg.per}&page=${pg.p + 1}>; rel="next"` : '';
    return { headers: link ? { link } : {}, body: pg.items.map((d) => ({ id: d.num, sha: d.sha, ref: d.hotfix ? 'hotfix/urgent' : 'main', description: d.hotfix ? 'hotfix' : 'release', environment: 'production', created_at: isoZ(d.start), creator: { login: 'someone' } })) };
  }
  if ((m = /^\/repos\/([^/]+\/[^/]+)\/deployments\/(\d+)\/statuses$/.exec(path))) {
    const d = deploymentsOf(teamOf('github', m[1])).find((x) => x.num === Number(m[2]));
    return { body: d ? [{ state: d.ok ? 'success' : 'failure', created_at: isoZ(d.at), log_url: `https://github.com/${m[1]}/deployments` }, { state: 'in_progress', created_at: isoZ(d.start) }] : [] };
  }
  if ((m = /^\/repos\/([^/]+\/[^/]+)\/compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)$/.exec(path))) {
    const team = teamOf('github', m[1]); const d = deploymentsOf(team).find((x) => x.sha === m[3]);
    return { body: { status: 'ahead', commits: commitsBetween(team, m[2], m[3], d?.at ?? Date.now()).map((c) => ({ sha: c.sha, commit: { author: { name: 'Someone', email: 'someone@example.com', date: isoZ(c.authored) }, committer: { date: isoZ(c.committed) }, message: 'Made-up message' } })) } };
  }
  if ((m = /^\/repos\/([^/]+\/[^/]+)\/commits\/([0-9a-f]+)$/.exec(path))) {
    // A commit with its changed files and patches (the Exporter reads only the line numbers of the hunks).
    const files = ['core', 'api', 'util'].filter((_, i) => rnd(m[2], 'file', i) < 0.6).map((f, i) => ({ filename: `src/${f}/${f}.ts`, status: 'modified', patch: `@@ -${10 + i} ,3 +${10 + i},6 @@\n context\n+const a = 1; // made-up code the Exporter never sends\n+const b = 2;\n+const c = a + b;\n context`.replace(' ,3', ',3') }));
    return { body: { sha: m[2], commit: { author: { date: isoZ(Date.now() - 2 * DAY) }, committer: { date: isoZ(Date.now() - 2 * DAY) }, message: 'Made-up' }, files } };
  }
  return null;
}

function gitlab(path, q) {
  let m;
  const team = 'data';
  const P = '/projects/' + encodeURIComponent(REPOS.data.gitlab);
  if (path === P || path === '/projects/77') return { body: { id: 77, path_with_namespace: REPOS.data.gitlab } };
  if (path === '/projects/77/environments') return { body: [{ name: 'production' }, { name: 'staging' }] };
  if (path === '/projects/77/pipelines') {
    const after = Date.parse(q.get('updated_after') || '') || 0; const before = Date.parse(q.get('updated_before') || '') || Date.now();
    const list = runsOf(team).filter((r) => r.end >= after && r.end < before);
    const pg = page(list, q);
    return { headers: pg.more ? { 'x-next-page': String(pg.p + 1) } : { 'x-next-page': '' }, body: pg.items.map((r) => ({ id: r.id, status: r.failed ? 'failed' : 'success', updated_at: iso(r.end), ref: r.branch, sha: r.commit })) };
  }
  if ((m = /^\/projects\/77\/pipelines\/(\d+)$/.exec(path))) {
    const r = runsOf(team).find((x) => x.id === Number(m[1]));
    return r ? { body: { id: r.id, status: r.failed ? 'failed' : 'success', sha: r.commit, ref: r.branch, created_at: iso(r.start), started_at: iso(r.start), finished_at: iso(r.end), duration: Math.round((r.end - r.start) / 1000), web_url: `https://gitlab.com/${REPOS.data.gitlab}/-/pipelines/${r.id}`, name: 'pipeline' } } : { status: 404, body: { message: '404 Not found' } };
  }
  if ((m = /^\/projects\/77\/pipelines\/(\d+)\/jobs$/.exec(path))) {
    const r = runsOf(team).find((x) => x.id === Number(m[1]));
    if (!r) return { body: [] };
    const s = r.start;
    return { headers: { 'x-next-page': '' }, body: [
      { id: r.id * 10 + 1, name: 'build', stage: 'build', status: 'success', started_at: iso(s), finished_at: iso(s + r.build * 1000), duration: r.build, artifacts: [] },
      { id: r.id * 10 + 2, name: 'pytest 1/2', stage: 'test', status: r.failed ? 'failed' : 'success', started_at: iso(s + r.build * 1000), finished_at: iso(s + (r.build + r.test / 2) * 1000), duration: r.test / 2, artifacts: [] },
      { id: r.id * 10 + 3, name: 'pytest 2/2', stage: 'test', status: 'success', started_at: iso(s + r.build * 1000), finished_at: iso(s + (r.build + r.test) * 1000), duration: r.test, artifacts: [{ file_type: 'archive', size: 4096, filename: 'coverage.zip' }] },
    ] };
  }
  if ((m = /^\/projects\/77\/pipelines\/(\d+)\/test_report$/.exec(path))) {
    const r = runsOf(team).find((x) => x.id === Number(m[1]));
    if (!r) return { status: 404, body: {} };
    const cases = testResults(team, r, 1);
    return { body: { total_time: cases.reduce((n, c) => n + c.seconds, 0), total_count: cases.length, test_suites: [{ name: 'pytest', test_cases: cases.map((c) => ({ status: c.status === 'passed' ? 'success' : c.status, name: c.name, classname: c.suite, execution_time: c.seconds, system_output: c.status === 'failed' ? 'Made-up output the Exporter does not send' : null })) }] } };
  }
  if ((m = /^\/projects\/77\/jobs\/(\d+)\/artifacts$/.exec(path))) {
    const r = runsOf(team).find((x) => x.id === Math.floor(Number(m[1]) / 10));
    return r ? { raw: zip({ 'coverage/coverage.xml': cobertura(coverageFiles(team, r)) }), type: 'application/zip' } : { status: 404, body: {} };
  }
  if (path === '/projects/77/deployments') {
    if (q.get('environment') !== 'production') return { body: [] };
    const after = Date.parse(q.get('updated_after') || '') || 0;
    const list = deploymentsOf(team).filter((d) => d.at >= after);
    const pg = page(list, q);
    return { headers: { 'x-next-page': pg.more ? String(pg.p + 1) : '' }, body: pg.items.map((d) => ({ id: d.num, status: d.ok ? 'success' : 'failed', sha: d.sha, ref: d.hotfix ? 'hotfix/data' : 'main', created_at: iso(d.start), updated_at: iso(d.at), finished_at: iso(d.at), environment: { name: 'production' } })) };
  }
  if ((m = /^\/projects\/77\/repository\/commits\/([0-9a-f]+)\/diff$/.exec(path))) {
    return { body: ['core', 'api', 'util'].filter((_, i) => rnd(m[1], 'file', i) < 0.6).map((f, i) => ({ old_path: `src/${f}/${f}.ts`, new_path: `src/${f}/${f}.ts`, diff: `@@ -${10 + i},3 +${10 + i},6 @@\n context\n+made-up line one\n+made-up line two\n+made-up line three\n context` })) };
  }
  if (path === '/projects/77/repository/compare') {
    const to = q.get('to'); const d = deploymentsOf(team).find((x) => x.sha === to);
    return { body: { commits: commitsBetween(team, q.get('from'), to, d?.at ?? Date.now()).map((c) => ({ id: c.sha, authored_date: iso(c.authored), committed_date: iso(c.committed), author_email: 'someone@example.com', title: 'Made-up' })) } };
  }
  return null;
}

function bitbucket(path, q, base) {
  let m;
  const team = 'reporting';
  const R = `/repositories/${REPOS.reporting.bitbucket}`;
  if (path === R) return { body: { full_name: REPOS.reporting.bitbucket, is_private: true } };
  if (path === `${R}/pipelines/`) {
    const list = runsOf(team).slice().reverse();
    const pg = page(list, q);
    return { body: { pagelen: pg.per, size: list.length, page: pg.p, ...(pg.more ? { next: `${base}${R}/pipelines/?sort=-created_on&pagelen=${pg.per}&page=${pg.p + 1}` } : {}), values: pg.items.map((r) => ({ type: 'pipeline', uuid: `{${r.id}}`, build_number: r.id, run_number: 1, created_on: iso(r.start), completed_on: iso(r.end), duration_in_seconds: Math.round((r.end - r.start) / 1000), state: { name: 'COMPLETED', result: { name: r.failed ? 'FAILED' : 'SUCCESSFUL' } }, target: { ref_type: 'branch', ref_name: r.branch, commit: { hash: r.commit }, selector: { type: 'default' } }, creator: { display_name: 'Someone' } })) } };
  }
  if ((m = new RegExp(`^${R}/pipelines/%7B(\\d+)%7D/steps/$`).exec(path))) {
    const r = runsOf(team).find((x) => x.id === Number(m[1]));
    if (!r) return { status: 404, body: { type: 'error' } };
    return { body: { pagelen: 100, values: [
      { uuid: `{${r.id}-1}`, name: 'Build', started_on: iso(r.start), completed_on: iso(r.start + r.build * 1000), duration_in_seconds: r.build, state: { name: 'COMPLETED', result: { name: 'SUCCESSFUL' } } },
      { uuid: `{${r.id}-2}`, name: 'Tests 1/2', started_on: iso(r.start + r.build * 1000), completed_on: iso(r.end), duration_in_seconds: r.test, state: { name: 'COMPLETED', result: { name: r.failed ? 'FAILED' : 'SUCCESSFUL' } } },
      { uuid: `{${r.id}-3}`, name: 'Tests 2/2', started_on: iso(r.start + r.build * 1000), completed_on: iso(r.end - 60_000), duration_in_seconds: r.test - 60, state: { name: 'COMPLETED', result: { name: 'SUCCESSFUL' } } },
    ] } };
  }
  if ((m = new RegExp(`^${R}/pipelines/%7B(\\d+)%7D/steps/%7B(\\d+)-(\\d)%7D/test_reports/test_cases$`).exec(path))) {
    const r = runsOf(team).find((x) => x.id === Number(m[1]));
    if (!r || m[3] !== '2') return { status: 404, body: { type: 'error', error: { message: 'No test report' } } };
    return { body: { pagelen: 100, values: testResults(team, r, 1).map((c) => ({ name: c.name, fully_qualified_name: `${c.suite}.${c.name}`, status: c.status.toUpperCase(), duration: `PT${c.seconds}S` })) } };
  }
  if (path === `${R}/environments/`) return { body: { pagelen: 100, values: [{ uuid: '{env-prod}', name: 'Production', environment_type: { name: 'Production' } }, { uuid: '{env-stg}', name: 'Staging', environment_type: { name: 'Staging' } }] } };
  if (path === `${R}/deployments/`) {
    const list = deploymentsOf(team).slice().reverse();
    const pg = page(list, q);
    return { body: { pagelen: pg.per, page: pg.p, ...(pg.more ? { next: `${base}${R}/deployments/?sort=-state.started_on&pagelen=${pg.per}&page=${pg.p + 1}` } : {}), values: pg.items.map((d) => ({ type: 'deployment', uuid: `{dep-${d.num}}`, environment: { uuid: '{env-prod}' }, state: { name: 'COMPLETED', status: { name: d.ok ? 'SUCCESSFUL' : 'FAILED' }, started_on: iso(d.start), completed_on: iso(d.at) }, release: { name: d.hotfix ? 'hotfix-release' : 'release', commit: { hash: d.sha } } })) } };
  }
  if ((m = new RegExp(`^${R}/commits/([0-9a-f]{40})$`).exec(path))) {
    const d = deploymentsOf(team).find((x) => x.sha === m[1]);
    return { body: { pagelen: 100, values: commitsBetween(team, q.get('exclude'), m[1], d?.at ?? Date.now()).reverse().map((c) => ({ type: 'commit', hash: c.sha, date: iso(c.authored), message: 'Made-up', author: { raw: 'Someone <someone@example.com>' } })) } };
  }
  return null;
}

const JIRA_FIELDS = [
  { id: 'summary', name: 'Summary', custom: false }, { id: 'customfield_10016', name: 'Story point estimate', custom: true, schema: { type: 'number', custom: 'com.pyxis.greenhopper.jira:jsw-story-points' } },
  { id: 'customfield_10020', name: 'Sprint', custom: true, schema: { type: 'array', items: 'json', custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
  { id: 'customfield_10021', name: 'Flagged', custom: true, schema: { type: 'array', items: 'option' } }, { id: 'customfield_10060', name: 'Found in', custom: true, schema: { type: 'option' } },
];
const JIRA_STATUSES = [['To Do', 'new'], ['In Progress', 'indeterminate'], ['Blocked', 'indeterminate'], ['Done', 'done']].map(([name, key], i) => ({ id: String(i + 1), name, statusCategory: { key } }));
let jiraCache = { at: 0, issues: [] };
function jira(path, q) {
  if (path === '/rest/api/3/myself') return { body: { accountId: 'fake-account', displayName: 'QE Exporter (fake)', timeZone: 'UTC', active: true } };
  if (path === '/rest/api/3/field') return { body: JIRA_FIELDS };
  if (path === '/rest/api/3/status') return { body: JIRA_STATUSES };
  if (path === '/rest/api/3/search/approximate-count') return { body: { count: 500 } };
  if (path === '/rest/api/3/search/jql') {
    if (Date.now() - jiraCache.at > 60_000) jiraCache = { at: Date.now(), issues: Object.keys(REPOS).flatMap((t) => issuesOf(t)) };
    const jql = q.get('jql') || '';
    const keys = (/project in \(([^)]*)\)/i.exec(jql)?.[1] ?? '').split(',').map((s) => s.trim().replace(/"/g, '')).filter(Boolean);
    const since = (/updated >= "(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})"/.exec(jql));
    const sinceT = since ? Date.UTC(+since[1], +since[2] - 1, +since[3], +since[4], +since[5]) : 0;
    const list = jiraCache.issues.filter((i) => (!keys.length || keys.includes(i.fields.project.key)) && Date.parse(i.fields.updated.replace('+0000', 'Z')) >= sinceT)
      .sort((a, b) => a.fields.updated.localeCompare(b.fields.updated) || a.key.localeCompare(b.key));
    const start = Number(q.get('nextPageToken') || 0); const per = Math.min(100, Number(q.get('maxResults') || 50));
    const issues = list.slice(start, start + per);
    return { body: { issues, ...(start + per < list.length ? { nextPageToken: String(start + per), isLast: false } : { isLast: true }) } };
  }
  return null;
}

function pagerduty(path, q) {
  const services = Object.keys(REPOS).map((t, i) => ({ id: `PSVC${i}`, name: REPOS[t].pd, summary: REPOS[t].pd, team: t }));
  if (path === '/services') return { body: { services: services.map(({ team: _t, ...s }) => s), more: false, limit: 100, offset: 0 } };
  const entriesOf = (team, inc) => {
    const svc = services.find((s) => s.team === team);
    const incident = { id: inc.id, incident_number: inc.num, title: 'Made-up incident', status: inc.resolved ? 'resolved' : 'acknowledged', urgency: inc.priority === 'P1' ? 'high' : 'low', priority: { summary: inc.priority }, created_at: isoZ(inc.opened), resolved_at: inc.resolved ? isoZ(inc.resolved) : null, service: { id: svc.id, summary: svc.name }, metadata: inc.deployment ? { deployment_id: inc.deployment } : {} };
    const es = [{ id: `${inc.id}-t`, type: 'trigger_log_entry', created_at: isoZ(inc.opened), incident }, { id: `${inc.id}-a`, type: 'acknowledge_log_entry', created_at: isoZ(inc.ack), incident, agent: { summary: 'Someone' } }];
    if (inc.resolved) es.push({ id: `${inc.id}-r`, type: 'resolve_log_entry', created_at: isoZ(inc.resolved), incident });
    return es;
  };
  if (path === '/log_entries') {
    const since = Date.parse(q.get('since')); const until = Date.parse(q.get('until'));
    const all = Object.keys(REPOS).flatMap((t) => incidentsOf(t).flatMap((inc) => entriesOf(t, inc))).filter((e) => Date.parse(e.created_at) >= since && Date.parse(e.created_at) < until);
    const offset = Number(q.get('offset') || 0); const limit = Number(q.get('limit') || 100);
    return { body: { log_entries: all.slice(offset, offset + limit), more: offset + limit < all.length, offset, limit } };
  }
  const m = /^\/incidents\/([^/]+)\/log_entries$/.exec(path);
  if (m) {
    for (const t of Object.keys(REPOS)) { const inc = incidentsOf(t).find((x) => x.id === m[1]); if (inc) return { body: { log_entries: entriesOf(t, inc), more: false } }; }
    return { body: { log_entries: [], more: false } };
  }
  return null;
}

function sonar(path, q) {
  const project = q.get('project') || q.get('componentKeys') || q.get('component') || q.get('projectKey');
  if (!Object.values(REPOS).some((r) => r.sonar === project)) return { status: 404, body: { errors: [{ msg: 'Component not found' }] } };
  const at = Math.floor(Date.now() / DAY) * DAY + 6 * HOUR - (Date.now() % DAY < 6 * HOUR ? DAY : 0);
  if (path === '/api/project_analyses/search') return { body: { paging: { pageIndex: 1, pageSize: 1, total: 1 }, analyses: [{ key: `AN-${project}-${Math.floor(at / DAY)}`, date: iso(at).replace('.000Z', '+0000'), revision: sha(project, 'rev', Math.floor(at / DAY)) }] } };
  if (path === '/api/issues/search') { const issues = sonarIssues(project); return { body: { paging: { pageIndex: 1, pageSize: 500, total: issues.length }, issues } }; }
  if (path === '/api/measures/component') return { body: { component: { key: project, measures: [{ metric: 'ncloc', value: String(20000 + Math.floor(rnd(project, 'loc') * 30000)) }] } } };
  if (path === '/api/qualitygates/project_status') return { body: { projectStatus: { status: rnd(project, 'gate') < 0.7 ? 'OK' : 'ERROR' } } };
  return null;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const send = (status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  if (u.pathname === '/health') return send(200, { ok: true });
  const auth = String(req.headers.authorization || req.headers['private-token'] || '');
  const tokenPart = auth.replace(/^(Bearer|Basic|Token token=|GenieKey)\s*/i, '');
  if (!tokenPart) return send(401, { message: 'Bad credentials (fake vendors: any non-empty token works)' });
  if (/^Basic /i.test(auth) && !/^[^:]+:.+$/.test(Buffer.from(tokenPart, 'base64').toString('utf8'))) return send(401, { message: 'Bad credentials' });
  const base = `http://${req.headers.host}`;
  const routes = [['/github', (p) => github(p, u.searchParams, `${base}/github`)], ['/gitlab/api/v4', (p) => gitlab(p, u.searchParams)], ['/bitbucket/2.0', (p) => bitbucket(p, u.searchParams, `${base}/bitbucket/2.0`)], ['/jira', (p) => jira(p, u.searchParams)], ['/pagerduty', (p) => pagerduty(p, u.searchParams)], ['/sonar', (p) => sonar(p, u.searchParams)]];
  try {
    for (const [prefix, fn] of routes) {
      if (u.pathname !== prefix && !u.pathname.startsWith(prefix + '/')) continue;
      const out = fn(u.pathname.slice(prefix.length) || '/');
      if (!out) break;
      if (out.raw) { res.writeHead(200, { 'Content-Type': out.type || 'application/octet-stream' }); return res.end(out.raw); }
      return send(out.status || 200, out.body, out.headers || {});
    }
    return send(404, { message: `fake vendors: no route for ${u.pathname}` });
  } catch (e) {
    return send(500, { message: e.message });
  }
});

writeKpis();
setInterval(writeKpis, 15 * 60_000).unref();
server.listen(PORT, '0.0.0.0', () => console.log(`fake vendors (TEST ONLY, made-up data) on :${PORT} — ${HISTORY_DAYS} days of history; KPI file ${KPI_FILE}`));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => server.close(() => process.exit(0)));
