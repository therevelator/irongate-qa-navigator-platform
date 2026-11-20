import {
  classifyEnvironment, detectIssueFormat, isCompleted, normaliseType, parseIssueBody, plainText, statusCategoryOf, transitionCategory, MAX_ISSUES,
} from '../../server/lib/ingest/issueEvents';
import { parseSarif, repoName, severityOf, severityCounts } from '../../server/lib/ingest/sarif';
import { ReportError } from '../../server/lib/ingest/testReports';
import { isRawIngestPath } from '../../server/lib/ingest/body';
import {
  blockedHours, computeWorkDay, inSprintAt, summariseSprint, workAffectedDays, type IssueRow, type SprintRow, type WorkData,
} from '../../server/lib/calc/work';
import { computeQualityDay, latestReports, qualityAffectedDays, qualityScore, weightedOf, type QualityData, type ReportRow } from '../../server/lib/calc/quality';
import { projectKey } from '../../server/seeds/demoWork';

/**
 * Unit tests of v2 phase 3 (work and code quality): the Jira / Linear / JSON issue parsers and the
 * SARIF parser (server/lib/ingest/issueEvents.ts, sarif.ts), and the calculations (server/lib/calc/
 * work.ts, quality.ts) on hand-built issues, sprints and reports whose expected values are worked out
 * in the comments. No backend needed.
 */

const err = (fn: () => unknown): string => {
  try { fn(); } catch (e) { if (e instanceof ReportError) return e.message; throw e; }
  throw new Error('expected a ReportError');
};
const DAY = 86_400_000;
const H = 3_600_000;
const T0 = Date.parse('2026-10-05T00:00:00Z'); // a Monday
const at = (days: number, hours = 0) => T0 + days * DAY + hours * H;
const iso = (ms: number) => new Date(ms).toISOString();

describe('Issue parsers', () => {
  test('WP-001 the raw ingestion paths include issues and static-analysis', () => {
    expect(isRawIngestPath('/api/ingest/issues')).toBe(true);
    expect(isRawIngestPath('/ingest/static-analysis')).toBe(true);
    expect(isRawIngestPath('/api/ingest/issue')).toBe(false);
  });

  test('WP-002 format detection: Jira search result, Jira webhook, Linear export and webhook, JSON', () => {
    expect(detectIssueFormat({ issues: [{ key: 'A-1', fields: {} }] })).toBe('jira');
    expect(detectIssueFormat({ webhookEvent: 'jira:issue_updated', issue: { key: 'A-1', fields: {} } })).toBe('jira');
    expect(detectIssueFormat({ data: { issues: { nodes: [] } } })).toBe('linear');
    expect(detectIssueFormat({ action: 'update', type: 'Issue', data: { identifier: 'ENG-1' } })).toBe('linear');
    expect(detectIssueFormat([{ identifier: 'ENG-1', state: { name: 'Todo', type: 'unstarted' } }])).toBe('linear');
    expect(detectIssueFormat({ issues: [{ key: 'A-1', type: 'bug' }] })).toBe('json');
  });

  test('WP-003 types, status categories, blocked statuses and resolutions', () => {
    expect(normaliseType('Bug')).toBe('bug');
    expect(normaliseType('Production Defect')).toBe('bug');
    expect(normaliseType('User Story')).toBe('story');
    expect(normaliseType('Sub-task')).toBe('subtask');
    expect(normaliseType('Whatever', true)).toBe('subtask');
    expect(normaliseType('Epic')).toBe('epic');
    expect(normaliseType('Initiative')).toBe('other');
    expect(statusCategoryOf('Anything', 'indeterminate')).toBe('in_progress');
    expect(statusCategoryOf('Closed')).toBe('done');
    expect(statusCategoryOf('Selected for Development')).toBe('todo');
    expect(transitionCategory('Blocked')).toBe('blocked');
    expect(transitionCategory('Waiting for customer')).toBe('blocked');
    expect(transitionCategory('In Review')).toBe('in_progress');
    expect(isCompleted('done', 'Done')).toBe(true);
    expect(isCompleted('done', "Won't Do")).toBe(false);
    expect(isCompleted('done', 'Cannot Reproduce')).toBe(false);
    expect(isCompleted('in_progress', null)).toBe(false);
  });

  test('WP-004 environments: production (escaped), before release, unknown; Atlassian documents as text', () => {
    expect(classifyEnvironment('Production')).toBe('production');
    expect(classifyEnvironment('prod-eu')).toBe('production');
    expect(classifyEnvironment('customer reported')).toBe('production');
    expect(classifyEnvironment('Pre-production')).toBe('pre_release');
    expect(classifyEnvironment('Staging')).toBe('pre_release');
    expect(classifyEnvironment('UAT')).toBe('pre_release');
    expect(classifyEnvironment('Chrome 120 on Windows')).toBeNull();
    expect(plainText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Found on staging' }] }] })).toBe('Found on staging');
    expect(plainText({ value: 'Production' })).toBe('Production');
  });

  test('WP-005 Jira: story points and sprint by the names map, estimate and time logged in seconds, changelog, URL, project key', () => {
    const body = {
      names: { customfield_10026: 'Story Points', customfield_10020: 'Sprint' },
      issues: [{
        key: 'PAY-7', self: 'https://acme.atlassian.net/rest/api/3/issue/10007',
        fields: {
          summary: 'Refund to card', issuetype: { name: 'Story' }, status: { name: 'Done', statusCategory: { key: 'done' } }, resolution: { name: 'Done' },
          created: '2026-10-01T10:00:00Z', resolutiondate: '2026-10-12T15:00:00Z', updated: '2026-10-12T15:00:00Z', customfield_10026: 5,
          timeoriginalestimate: 28800, timespent: 36000, project: { key: 'PAY' }, labels: ['payments'], components: [{ name: 'refunds' }],
          customfield_10020: [{ id: 41, name: 'Sprint 41', state: 'closed', startDate: '2026-10-05T09:00:00Z', endDate: '2026-10-16T17:00:00Z', completeDate: '2026-10-16T15:00:00Z' }],
        },
        changelog: { histories: [
          { created: '2026-10-06T09:00:00Z', items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }] },
          { created: '2026-10-07T09:00:00Z', items: [{ field: 'Flagged', fromString: null, toString: 'Impediment' }] },
          { created: '2026-10-07T13:00:00Z', items: [{ field: 'Flagged', fromString: 'Impediment', toString: null }] },
          { created: '2026-10-05T08:00:00Z', items: [{ field: 'Sprint', from: '', to: '41' }] },
        ] },
      }],
    };
    const p = parseIssueBody(body, 'jira', { team: 't1' });
    const e = p.issues[0];
    expect(e).toMatchObject({ key: 'PAY-7', team: 't1', project: 'PAY', type: 'story', statusCategory: 'done', storyPoints: 5, estimateHours: 8, timeLoggedHours: 10, components: ['refunds'] });
    expect(e.url).toBe('https://acme.atlassian.net/browse/PAY-7');
    expect(e.sprints.map((s) => s.id)).toEqual(['41']);
    expect(p.sprints[0]).toMatchObject({ id: '41', name: 'Sprint 41', state: 'closed' });
    expect(e.transitions.map((t) => `${t.field}:${t.to}`)).toEqual(['sprint:41', 'status:In Progress', 'flagged:on', 'flagged:off']);
  });

  test('WP-006 Jira: legacy sprint strings, an explicit field, the environment custom field; webhooks add their changelog; deletions are ignored', () => {
    const legacy = 'com.atlassian.greenhopper.service.sprint.Sprint@1a2b[id=12,rapidViewId=3,state=CLOSED,name=Sprint 4,startDate=2026-10-05T09:00:00.000Z,endDate=2026-10-16T17:00:00.000Z,completeDate=2026-10-16T15:00:00.000Z,sequence=12]';
    const p = parseIssueBody({ issues: [{ key: 'LEND-3', fields: { issuetype: { name: 'Bug' }, status: { name: 'Open' }, created: '2026-10-08T10:00:00Z', customfield_10111: [legacy], customfield_10500: { value: 'Production' }, customfield_10600: 3 } }] },
      'jira', { sprintField: 'customfield_10111', environmentField: 'customfield_10500', storyPointsField: 'customfield_10600' });
    expect(p.issues[0]).toMatchObject({ type: 'bug', environment: 'Production', foundIn: 'production', storyPoints: 3, statusCategory: 'todo', resolvedAt: null });
    expect(p.issues[0].sprints[0]).toMatchObject({ id: '12', name: 'Sprint 4', state: 'closed' });
    const w = parseIssueBody({ webhookEvent: 'jira:issue_updated', timestamp: Date.parse('2026-10-09T10:00:00Z'), issue: { key: 'LEND-3', fields: { issuetype: { name: 'Bug' }, status: { name: 'Blocked' }, created: '2026-10-08T10:00:00Z' } }, changelog: { items: [{ field: 'status', fromString: 'Open', toString: 'Blocked' }] } }, 'jira');
    expect(w.issues[0].transitions[0]).toMatchObject({ field: 'status', to: 'Blocked', toCategory: 'blocked' });
    const d = parseIssueBody({ webhookEvent: 'jira:issue_deleted', issue: { key: 'LEND-3', fields: {} } }, 'jira');
    expect(d.issues).toHaveLength(0);
    expect(d.ignored[0].reason).toMatch(/deleted/);
  });

  test('WP-007 Linear: export with labels, estimate, cycle and state history; webhook; canceled issues are not completed', () => {
    const p = parseIssueBody({ data: { issues: { nodes: [{
      identifier: 'ENG-12', title: 'Crash on login', url: 'https://linear.app/acme/issue/ENG-12', createdAt: '2026-10-02T10:00:00Z', completedAt: '2026-10-09T10:00:00Z',
      estimate: 3, state: { name: 'Done', type: 'completed' }, labels: { nodes: [{ name: 'Bug' }, { name: 'env:production' }] }, team: { key: 'ENG' },
      cycle: { id: 'c-9', number: 9, startsAt: '2026-10-05T00:00:00Z', endsAt: '2026-10-19T00:00:00Z', completedAt: '2026-10-19T00:00:00Z' },
      history: { nodes: [{ createdAt: '2026-10-06T09:00:00Z', fromState: { name: 'Todo', type: 'unstarted' }, toState: { name: 'In Progress', type: 'started' } }] },
    }, { identifier: 'ENG-13', title: 'Old idea', createdAt: '2026-10-02T10:00:00Z', canceledAt: '2026-10-03T10:00:00Z', state: { name: 'Canceled', type: 'canceled' } }] } } }, 'linear', { team: 't1' });
    expect(p.issues[0]).toMatchObject({ key: 'ENG-12', type: 'bug', environment: 'production', foundIn: 'production', storyPoints: 3, statusCategory: 'done', project: 'ENG' });
    expect(p.issues[0].sprints[0]).toMatchObject({ id: 'c-9', name: 'Cycle 9', state: 'closed' });
    expect(p.issues[0].transitions[0]).toMatchObject({ field: 'status', to: 'In Progress', toCategory: 'in_progress' });
    expect(isCompleted(p.issues[1].statusCategory, p.issues[1].resolution)).toBe(false);
    const w = parseIssueBody({ action: 'update', type: 'Issue', data: { identifier: 'ENG-14', createdAt: '2026-10-02T10:00:00Z', updatedAt: '2026-10-04T10:00:00Z', state: { name: 'Blocked', type: 'started' } }, updatedFrom: { stateId: 'x' } }, 'linear', { team: 't1' });
    expect(w.issues[0].transitions[0]).toMatchObject({ to: 'Blocked', toCategory: 'blocked' });
  });

  test('WP-008 JSON: sprints listed once, transitions, blocked periods, hours or seconds; validation errors name the field', () => {
    const p = parseIssueBody({
      sprints: [{ id: 'S1', name: 'Sprint 1', startedAt: '2026-10-05T09:00:00Z', completedAt: '2026-10-16T15:00:00Z' }],
      issues: [{ key: 'A-1', type: 'story', status: 'Done', createdAt: '2026-10-01T00:00:00Z', resolvedAt: '2026-10-10T00:00:00Z', storyPoints: 2, estimateSeconds: 7200, timeSpentSeconds: 10800, sprint: 'S1',
        blocked: [{ from: '2026-10-06T10:00:00Z', to: '2026-10-06T14:00:00Z' }], transitions: [{ at: '2026-10-06T09:00:00Z', to: 'In Progress' }] }],
    }, 'json', { team: 't1' });
    expect(p.issues[0]).toMatchObject({ estimateHours: 2, timeLoggedHours: 3, sprints: [{ id: 'S1', name: 'Sprint 1' }] });
    expect(p.issues[0].transitions.map((t) => `${t.field}:${t.to}`)).toEqual(['status:In Progress', 'flagged:on', 'flagged:off']);
    expect(err(() => parseIssueBody({ issues: [{ type: 'bug', createdAt: '2026-10-01T00:00:00Z' }] }, 'json'))).toMatch(/issues\[0\]\.key is required/);
    expect(err(() => parseIssueBody({ issues: [{ key: 'A-1' }] }, 'json'))).toMatch(/createdAt is required/);
    expect(err(() => parseIssueBody({ issues: [{ key: 'A-1', createdAt: 'yesterday' }] }, 'json'))).toMatch(/ISO 8601/);
    expect(err(() => parseIssueBody({ issues: [{ key: 'A-1', createdAt: '2026-10-01T00:00:00Z', storyPoints: -1 }] }, 'json'))).toMatch(/storyPoints must be a number/);
    expect(err(() => parseIssueBody({ issues: [{ key: 'A-1', createdAt: '2026-10-01T00:00:00Z' }, { key: 'A-1', createdAt: '2026-10-01T00:00:00Z' }] }, 'json'))).toMatch(/more than once/);
    expect(err(() => parseIssueBody({ issues: Array.from({ length: MAX_ISSUES + 1 }, (_, i) => ({ key: `A-${i}`, createdAt: '2026-10-01T00:00:00Z' })) }, 'json'))).toMatch(/at most 1000/);
  });

  test('WP-009 computed values are refused (QE Navigator calculates them)', () => {
    expect(err(() => parseIssueBody({ issues: [{ key: 'A-1', createdAt: '2026-10-01T00:00:00Z', velocity: 40 }] }, 'json'))).toMatch(/velocity: QE Navigator calculates this/);
    expect(err(() => parseIssueBody({ defect_escape_rate: 3, issues: [] }, 'json'))).toMatch(/defect_escape_rate/);
    expect(err(() => parseIssueBody({ issues: [{ key: 'A-1', fields: { summary: 'x', created: '2026-10-01T00:00:00Z', sizing_accuracy: 1.1 } }] }, 'jira'))).toMatch(/sizing_accuracy/);
  });
});

describe('SARIF parser', () => {
  const sarif = (results: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({
    version: '2.1.0', runs: [{ tool: { driver: { name: 'CodeQL', semanticVersion: '2.19.0', rules: [
      { id: 'js/sql-injection', name: 'SqlInjection', properties: { 'security-severity': '9.8', tags: ['security'] } },
      { id: 'js/unused', defaultConfiguration: { level: 'note' }, properties: { tags: ['maintainability'] } },
    ] } }, versionControlProvenance: [{ repositoryUri: 'https://github.com/acme/payments.git', revisionId: 'abc1234', branch: 'refs/heads/main' }],
    invocations: [{ endTimeUtc: '2026-10-07T10:00:00Z' }], results, ...extra }],
  });

  test('WP-010 severities: Sonar severity and impacts, security-severity, SARIF level', () => {
    expect(severityOf({ properties: { severity: 'BLOCKER' } }, null).severity).toBe('critical');
    expect(severityOf({ properties: { severity: 'MAJOR' } }, null).severity).toBe('medium');
    expect(severityOf({ properties: { impacts: [{ severity: 'LOW' }, { severity: 'HIGH' }] } }, null).severity).toBe('high');
    expect(severityOf({}, { properties: { 'security-severity': '7.5' } }).severity).toBe('high');
    expect(severityOf({ level: 'error' }, null).severity).toBe('high');
    expect(severityOf({}, { defaultConfiguration: { level: 'note' } }).severity).toBe('low');
    expect(severityOf({}, null).severity).toBe('medium');
  });

  test('WP-011 a report: repository, branch, commit and time from the run; suppressed, absent and pass results are not findings; fingerprints', () => {
    const [r] = parseSarif(sarif([
      { ruleId: 'js/sql-injection', level: 'error', message: { text: 'Query from user input' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/db.ts' }, region: { startLine: 4 } } }], partialFingerprints: { primaryLocationLineHash: 'a:1' } },
      { ruleId: 'js/unused', message: { text: 'Unused x' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.ts' } } }] },
      { ruleId: 'js/unused', message: { text: 'Unused x' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.ts' } } }] },
      { ruleId: 'js/unused', message: { text: 'Unused y' }, suppressions: [{ kind: 'inSource' }] },
      { ruleId: 'js/unused', message: { text: 'Gone' }, baselineState: 'absent' },
      { ruleId: 'js/unused', kind: 'pass', message: { text: 'ok' } },
    ]));
    expect(r).toMatchObject({ tool: 'CodeQL', toolVersion: '2.19.0', repo: 'acme/payments', branch: 'main', commit: 'abc1234', suppressed: 1, rules: 2 });
    expect(r.analyzedAt?.toISOString()).toBe('2026-10-07T10:00:00.000Z');
    expect(severityCounts(r.findings)).toEqual({ critical: 1, high: 0, medium: 0, low: 2, info: 0 });
    expect(r.findings[0]).toMatchObject({ category: 'security', path: 'src/db.ts', line: 4 });
    expect(new Set(r.findings.map((f) => f.fingerprint)).size).toBe(3);
    // The same finding in the next report has the same fingerprint.
    const [r2] = parseSarif(sarif([{ ruleId: 'js/sql-injection', level: 'error', message: { text: 'moved' }, partialFingerprints: { primaryLocationLineHash: 'a:1' } }]));
    expect(r2.findings[0].fingerprint).toBe(r.findings[0].fingerprint);
  });

  test('WP-012 errors: not JSON, not SARIF, another version, a run without a tool name; repository names', () => {
    expect(err(() => parseSarif('<xml/>'))).toMatch(/SARIF 2.1.0 JSON/);
    expect(err(() => parseSarif('{"a":1}'))).toMatch(/Not a SARIF document/);
    expect(err(() => parseSarif('{"version":"1.0.0","runs":[]}'))).toMatch(/version 1.0.0 is not supported/);
    expect(err(() => parseSarif('{"version":"2.1.0","runs":[{"tool":{"driver":{}}}]}'))).toMatch(/driver.name is required/);
    expect(repoName('git@github.com:acme/app.git')).toBe('acme/app');
    expect(repoName('payments-core')).toBe('payments-core');
  });
});

describe('Work calculation', () => {
  // Sprint S1: starts day 0 09:00, closes day 11 15:00. S2 starts day 14 09:00.
  const S1: SprintRow = { id: 's1', externalId: 'S1', name: 'Sprint 1', startedAt: at(0, 9), completedAt: at(11, 15) };
  const S2: SprintRow = { id: 's2', externalId: 'S2', name: 'Sprint 2', startedAt: at(14, 9), completedAt: null };
  const issue = (key: string, o: Partial<IssueRow> = {}): IssueRow => ({
    id: key, key, title: key, type: 'story', statusCategory: 'done', resolution: 'Done', foundIn: null, environment: null, points: 3, estimate: null, logged: null,
    sprintIds: ['S1'], openedAt: at(-3), resolvedAt: at(5), url: null, components: [], transitions: [], ...o,
  });
  const data = (issues: IssueRow[], extra: Partial<WorkData> = {}): WorkData => ({ sprints: [S1, S2], issues, coverage: [{ id: 'cov1', at: at(1), linesFound: 8000 }], hasSprints: true, ...extra });

  test('WC-001 velocity, commitment and carryover of the latest closed sprint (worked example)', () => {
    // Committed at the start: A (5, done), B (3, done), C (8, carried over into S2). D (2) was added on day 3 (sprint change) and done.
    // E is an epic (not counted). F (3) was done long before (resolved day 13 > close + 1 h: not completed in S1).
    const issues = [
      issue('A', { points: 5 }), issue('B'), issue('C', { points: 8, statusCategory: 'in_progress', resolution: null, resolvedAt: null, sprintIds: ['S1', 'S2'] }),
      issue('D', { points: 2, transitions: [{ field: 'sprint', from: '', to: 'S1', toCategory: null, at: at(3) }] }),
      issue('E', { type: 'epic', points: 20 }), issue('F', { resolvedAt: at(13) }),
    ];
    const m = Object.fromEntries(computeWorkDay('2026-10-20', data(issues), at(30)).map((x) => [x.key, x]));
    // Completed: A 5 + B 3 + D 2 = 10. Committed: A 5 + B 3 + C 8 + F 3 = 19. Not completed: C 8 + F 3 = 11.
    expect(m.velocity.value).toBe(10);
    expect(m.commitment.value).toBe(52.63); // 10 ÷ 19
    expect(m.carryover.value).toBe(57.89); // 11 ÷ 19
    expect(m.commitment.inputs).toMatchObject({ committedPoints: 19, addedIssues: 1, addedPoints: 2 });
    expect(m.velocity.sources.completed).toEqual(['A', 'B', 'D']);
    expect(m.velocity.sampleSize).toBe(5);
  });

  test('WC-002 the sprint value carries until a newer sprint closes, and stops after 42 days', () => {
    const d = data([issue('A')]);
    expect(computeWorkDay('2026-10-15', d, at(30)).find((x) => x.key === 'velocity')).toBeUndefined(); // before S1 closed
    expect(computeWorkDay('2026-10-16', d, at(30)).find((x) => x.key === 'velocity')?.value).toBe(3);
    expect(computeWorkDay('2026-11-25', d, at(60)).find((x) => x.key === 'velocity')?.value).toBe(3); // 40 days after
    expect(computeWorkDay('2026-11-28', d, at(60)).find((x) => x.key === 'velocity')).toBeUndefined(); // 43 days after
  });

  test('WC-003 blocked time: Blocked statuses and Flagged periods, overlaps once, within the sprint', () => {
    const a = issue('A', { transitions: [
      { field: 'status', from: 'To Do', to: 'In Progress', toCategory: 'in_progress', at: at(1, 9) },
      { field: 'status', from: 'In Progress', to: 'Blocked', toCategory: 'blocked', at: at(1, 10) },
      { field: 'status', from: 'Blocked', to: 'In Progress', toCategory: 'in_progress', at: at(1, 16) }, // 6 h
      { field: 'flagged', from: null, to: 'on', toCategory: 'on', at: at(1, 14) }, // overlaps 2 h, then 2 h more
      { field: 'flagged', from: null, to: 'off', toCategory: 'off', at: at(1, 18) },
    ] });
    expect(blockedHours(a, S1.startedAt!, S1.completedAt!)).toBe(8);
    // Before the sprint start, not counted.
    const b = issue('B', { transitions: [{ field: 'status', from: null, to: 'Blocked', toCategory: 'blocked', at: at(-1) }, { field: 'status', from: null, to: 'In Progress', toCategory: 'in_progress', at: at(0, 12) }] });
    expect(blockedHours(b, S1.startedAt!, S1.completedAt!)).toBe(3);
    const m = computeWorkDay('2026-10-20', data([a, b]), at(30)).find((x) => x.key === 'blocked_time')!;
    expect(m.value).toBe(11);
    expect(m.sources.blocked).toEqual([{ key: 'A', hours: 8 }, { key: 'B', hours: 3 }]);
  });

  test('WC-004 sizing accuracy: time logged ÷ estimate over completed issues with both', () => {
    const issues = [issue('A', { estimate: 8, logged: 10 }), issue('B', { estimate: 4, logged: 6 }), issue('C', { estimate: 5, logged: null }), issue('D', { estimate: 6, logged: 9, statusCategory: 'in_progress', resolution: null, resolvedAt: null })];
    const m = computeWorkDay('2026-10-20', data(issues), at(30)).find((x) => x.key === 'sizing_accuracy')!;
    expect(m.value).toBe(1.33); // (10 + 6) ÷ (8 + 4)
    expect(m.sampleSize).toBe(2);
  });

  test('WC-005 defect escape rate and density over 28 days; won’t-fix bugs and bugs without an environment left out; no coverage, no density', () => {
    const bug = (key: string, foundIn: string | null, opened: number, o: Partial<IssueRow> = {}) => issue(key, { type: 'bug', foundIn, points: null, sprintIds: [], openedAt: opened, statusCategory: 'in_progress', resolution: null, resolvedAt: null, ...o });
    const issues = [
      bug('B1', 'production', at(10)), bug('B2', 'production', at(20)), bug('B3', 'pre_release', at(12)), bug('B4', 'pre_release', at(15)), bug('B5', 'pre_release', at(18)),
      bug('B6', 'production', at(19), { statusCategory: 'done', resolution: 'Cannot Reproduce', resolvedAt: at(20) }), bug('B7', null, at(19)),
      bug('B8', 'production', at(-20)), // outside the 28 days
    ];
    const m = Object.fromEntries(computeWorkDay('2026-10-30', data(issues), at(30)).map((x) => [x.key, x]));
    expect(m.escape_rate.value).toBe(40); // 2 of 5
    expect(m.escape_rate.inputs).toMatchObject({ escapedBugs: 2, bugsWithEnvironment: 5, bugsWithoutEnvironment: 1 });
    expect(m.defect_density.value).toBe(0.25); // 2 ÷ 8 KLOC
    expect(m.defect_density.sources.coverageReports).toEqual(['cov1']);
    const noCov = computeWorkDay('2026-10-30', data(issues, { coverage: [] }), at(30)).map((x) => x.key);
    expect(noCov).toContain('escape_rate');
    expect(noCov).not.toContain('defect_density');
    // As of a day: a bug opened later is not known yet.
    expect(computeWorkDay('2026-10-17', data(issues), at(30)).find((x) => x.key === 'escape_rate')!.value).toBe(50); // B1 (production) and B3 (staging) are known by then: 1 of 2
  });

  test('WC-006 committed: Sprint changes when sent, else created before the start; a team without sprints gets sizing and blocked over 14 days', () => {
    const late = issue('L', { openedAt: at(4) });
    expect(inSprintAt(late, S1, S1.startedAt! + H)).toBe(false);
    const moved = issue('M', { transitions: [{ field: 'sprint', from: 'S0', to: 'S0, S1', toCategory: null, at: at(-1) }] });
    expect(inSprintAt(moved, S1, S1.startedAt! + H)).toBe(true);
    const removedLater = issue('R', { transitions: [{ field: 'sprint', from: 'S1', to: '', toCategory: null, at: at(5) }] });
    expect(inSprintAt(removedLater, S1, S1.startedAt! + H)).toBe(true);
    const s = summariseSprint(S1, data([late, moved]), at(30));
    expect(s.added.map((i) => i.key)).toEqual(['L']);
    const kanban = data([issue('K', { sprintIds: [], estimate: 4, logged: 5, resolvedAt: at(20), transitions: [{ field: 'flagged', from: null, to: 'on', toCategory: 'on', at: at(19) }, { field: 'flagged', from: null, to: 'off', toCategory: 'off', at: at(19, 5) }] })], { sprints: [], hasSprints: false });
    const m = Object.fromEntries(computeWorkDay('2026-10-26', kanban, at(30)).map((x) => [x.key, x]));
    expect(m.sizing_accuracy.value).toBe(1.25);
    expect(m.blocked_time.value).toBe(5);
    expect(m.velocity).toBeUndefined();
  });

  test('WC-007 affected days: each change day and the 41 days after it, within the recalculation window, up to today', () => {
    const days = workAffectedDays(['2026-11-10'], '2026-11-20');
    expect(days[0]).toBe('2026-11-10');
    expect(days[days.length - 1]).toBe('2026-11-20');
    expect(workAffectedDays(['2025-01-01'], '2026-11-20', 190)).toEqual([]);
    expect(workAffectedDays(['2026-12-01'], '2026-11-20')).toEqual([]);
  });
});

describe('Code quality calculation', () => {
  const rep = (id: string, o: Partial<ReportRow> = {}): ReportRow => ({
    id, tool: 'SonarQube', repo: 'acme/app', branch: 'main', commit: 'c', analyzedAt: at(10, 12), linesOfCode: 10000, findings: 0,
    critical: 0, high: 0, medium: 0, low: 0, info: 0, newFindings: null, fixedFindings: null, main: true, ...o,
  });

  test('WC-010 the score formula: 100 × e^(−weighted per KLOC ÷ 20), weights 10 / 5 / 2 / 0.5 / 0', () => {
    expect(weightedOf({ critical: 1, high: 2, medium: 3, low: 4, info: 9 })).toBe(28);
    expect(qualityScore(0, 10000)).toBe(100);
    expect(qualityScore(28, 10000)).toBe(87); // 2.8 per KLOC → e^(−0.14) = 0.869
    expect(qualityScore(200, 10000)).toBe(37); // 20 per KLOC → e^(−1)
  });

  test('WC-011 a day with reports: the latest main-branch report per repository and tool; coverage gives the size when no lines of code are sent', () => {
    const d: QualityData = {
      reports: [
        rep('r1', { critical: 1, high: 2, findings: 3, analyzedAt: at(8) }),
        rep('r2', { critical: 0, high: 2, medium: 3, findings: 5, newFindings: 1, fixedFindings: 2 }), // replaces r1 (same repo and tool)
        rep('r3', { tool: 'ESLint', linesOfCode: null, low: 10, findings: 10, newFindings: 4, fixedFindings: 0 }), // same repo: its size is r2's
        rep('r4', { repo: 'acme/web', linesOfCode: null, medium: 5, findings: 5 }), // another repository without a size: coverage
        rep('r5', { branch: 'feature/x', critical: 9, findings: 9 }), // not the main branch
      ],
      coverage: [{ id: 'cov', at: at(9), linesFound: 5000 }],
    };
    expect(latestReports(d, at(11)).map((r) => r.id)).toEqual(['r3', 'r2', 'r4']); // by repository, then tool
    const m = Object.fromEntries(computeQualityDay('2026-10-15', d, at(30)).map((x) => [x.key, x]));
    // weighted: r2 2×5 + 3×2 = 16, r3 10 × 0.5 = 5, r4 5 × 2 = 10 → 31; lines 10,000 (acme/app) + 5,000 (coverage, acme/web) → 2.067 per KLOC
    expect(m.code_quality.value).toBe(Math.round(100 * Math.exp(-(31 / 15) / 20)));
    expect(m.code_quality.inputs).toMatchObject({ weightedFindings: 31, linesOfCode: 15000, linesOfCodeFrom: 'reports and coverage' });
    expect(m.findings.value).toBe(20);
    expect(m.new_findings.value).toBe(5);
    expect(m.fixed_findings.value).toBe(2);
    // A day without a report: nothing (the evidence of the report's day stays).
    expect(computeQualityDay('2026-10-16', d, at(30))).toEqual([]);
    // No size at all: the score is not calculated, the findings are.
    const noSize = computeQualityDay('2026-10-15', { reports: [rep('x', { linesOfCode: null, high: 1, findings: 1 })], coverage: [] }, at(30)).map((x) => x.key);
    expect(noSize).toEqual(['findings']);
    expect(qualityAffectedDays(['2026-11-18'], '2026-11-20')).toEqual(['2026-11-18', '2026-11-19', '2026-11-20']);
  });

  test('WC-012 sample project keys', () => {
    expect(projectKey('Payments Core')).toBe('PAY');
    expect(projectKey('Lending Journey')).toBe('LEN');
    expect(projectKey('The Away Team')).toBe('AWAY');
    expect(projectKey('QA')).toBe('QA');
  });
});

void iso;
