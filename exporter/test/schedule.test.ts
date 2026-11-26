/**
 * Collection frequency (src/schedule.ts): the schedule QE Navigator holds decides which sources a run reads.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { groupsOf, intervalOf, isDue, scheduleFrom } from '../src/schedule';
import { config } from './helpers';

const cfg = config({ sources: [
  { type: 'jira', name: 'jira', baseUrl: 'https://jira.example', deployment: 'cloud', jql: 'project in (PAY, WEB)', teams: { PAY: 'team-pay', WEB: 'team-web' } },
  { type: 'pagerduty', name: 'pd', apiUrl: 'https://pd.example', services: { checkout: 'team-web' } },
  { type: 'jenkins', name: 'jk', baseUrl: 'https://jenkins.example', user: 'qe', jobs: { app: 'team-pay' } },
] });
const [jira, pd, jk] = cfg.sources;
const schedule = { defaultMinutes: 15, teams: { 'team-pay': { work: 1440, ci: 1440, delivery: 60 }, 'team-web': { work: 240 } } };
const now = new Date('2026-11-26T12:00:00Z');

describe('collection schedule', () => {
  test('a source follows the shortest interval among its teams and data groups', () => {
    assert.deepEqual(groupsOf(jira), ['work']);
    assert.deepEqual(groupsOf(jk), ['ci', 'delivery']);
    assert.equal(intervalOf(jira, schedule), 240); // team-pay once a day, team-web every 4 hours
    assert.equal(intervalOf(jk, schedule), 60); // ci once a day, delivery every hour
    assert.equal(intervalOf(pd, schedule), 15); // team-web has no delivery interval: the default
  });

  test('a source read less than its interval ago is not due; one never read, or without a schedule, is', () => {
    assert.equal(isDue(jira, schedule, '2026-11-26T09:00:00Z', now).due, false);
    assert.equal(isDue(jira, schedule, '2026-11-26T08:00:30Z', now).due, true); // 4 hours ago, within the minute of tolerance
    assert.equal(isDue(jira, schedule, null, now).due, true);
    assert.equal(isDue(jira, null, '2026-11-26T11:59:00Z', now).due, true);
    assert.equal(isDue(jira, schedule, '2026-11-26T09:00:00Z', now).nextAt, '2026-11-26T13:00:00.000Z');
  });

  test('the schedule is read from the context; an older server has none', () => {
    assert.deepEqual(scheduleFrom({ schedule: { defaultMinutes: 15, teams: { t: { ci: 60, work: 'x' } } } }), { defaultMinutes: 15, teams: { t: { ci: 60 } } });
    assert.equal(scheduleFrom({ company: { id: 'c' } }), null);
    assert.equal(scheduleFrom(null), null);
  });
});
