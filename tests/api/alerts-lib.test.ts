import { backendUp, localDb } from './helpers/http';
import type { Client } from 'pg';
import { createGolden, removeGolden, GOLDEN_COMPANY } from './helpers/goldenFixture';
import { judgeOutcome, OUTCOME_TOLERANCE } from '../../server/lib/actions';
import { dedupeKey, normaliseParams, RuleBook, thresholdCondition } from '../../server/lib/alerts';
import { decryptSecret, encryptSecret, maskWebhook, validateSlackWebhook, defaultPrefs } from '../../server/lib/notifications';
import { isoWeek, renderDigest, runWeeklyDigest, type Digest } from '../../server/lib/digest';
import { pool } from '../../src/lib/db';

/**
 * The pure parts of alerts / notifications / digest / actions, and the weekly digest run
 * (one email per recipient and ISO week, whatever the number of runs).
 */

afterAll(async () => {
  await pool.end().catch(() => undefined);
});

describe('Outcome rule (judgeOutcome)', () => {
  it('LIB-001: improved / worse beyond 2% of the baseline in the metric direction, else unchanged', () => {
    expect(OUTCOME_TOLERANCE).toBe(0.02);
    expect(judgeOutcome(70, 75, false)).toBe('improved');   // higher is better
    expect(judgeOutcome(70, 65, false)).toBe('worse');
    expect(judgeOutcome(70, 71, false)).toBe('unchanged');  // within 1.4
    expect(judgeOutcome(5, 3, true)).toBe('improved');      // lower is better
    expect(judgeOutcome(5, 6, true)).toBe('worse');
    expect(judgeOutcome(0, 0.005, true)).toBe('unchanged'); // at least ±0.01
    expect(judgeOutcome(0, 0.5, true)).toBe('worse');
  });
});

describe('Rules', () => {
  it('LIB-002: params are validated and defaulted; the rule book resolves team > department > company > default', () => {
    expect(normaliseParams('score_drop', {})).toEqual({ points: 10, days: 7 });
    expect(normaliseParams('score_drop', { points: '5', other: 1 })).toEqual({ points: 5, days: 7 });
    expect(() => normaliseParams('score_drop', { points: 1.5 })).toThrow();
    expect(() => normaliseParams('ingestion_failure', { hours: 0 })).toThrow();
    expect(() => normaliseParams('threshold_breach', { minSeverity: 'info' })).toThrow();
    const book = new RuleBook([
      { scope_type: 'company', scope_id: 'co', rule: 'score_drop', enabled: true, params: { points: 12, days: 5 } },
      { scope_type: 'department', scope_id: 'd1', rule: 'score_drop', enabled: true, params: { points: 9 } },
      { scope_type: 'team', scope_id: 't1', rule: 'score_drop', enabled: false, params: {} },
    ]);
    expect(book.resolve('score_drop', { companyId: 'co', departmentId: 'd1', teamId: 't1' })).toMatchObject({ enabled: false, scope: 'team' });
    expect(book.resolve('score_drop', { companyId: 'co', departmentId: 'd1', teamId: 't2' })).toMatchObject({ params: { points: 9, days: 7 }, scope: 'department' });
    expect(book.resolve('score_drop', { companyId: 'co', departmentId: 'd2', teamId: 't3' })).toMatchObject({ params: { points: 12, days: 5 }, scope: 'company' });
    expect(book.resolve('metric_stale', { companyId: 'co' })).toMatchObject({ enabled: true, scope: 'default' });
  });

  it('LIB-003: threshold condition = the Team detail status (watch = warning, off target = critical), honouring the minimum severity', () => {
    const t = { good: 80, warning: 70, lowerIsBetter: false };
    expect(thresholdCondition('t', 'test_coverage', 85, t)).toBeNull();
    expect(thresholdCondition('t', 'test_coverage', 75, t)).toMatchObject({ severity: 'warning', message: 'Test coverage is at watch level: 75% (target ≥ 80%, watch ≥ 70%)' });
    expect(thresholdCondition('t', 'test_coverage', 60, t)).toMatchObject({ severity: 'critical' });
    expect(thresholdCondition('t', 'test_coverage', 75, t, 'critical')).toBeNull();
    const c = thresholdCondition('t', 'defect_escape_rate', 12, { good: 5, warning: 10, lowerIsBetter: true })!;
    expect(c.message).toBe('Defect escape rate is off target: 12% (target ≤ 5%, watch ≤ 10%)');
    expect(dedupeKey(c)).toBe('threshold_breach|t|defect_escape_rate');
  });
});

describe('Secrets and preferences', () => {
  it('LIB-004: the Slack webhook is validated, encrypted (AES-GCM, random IV) and masked', () => {
    const url = 'https://hooks.slack.com/services/T123/B456/abcdefghijklmnop';
    expect(validateSlackWebhook(` ${url} `)).toBe(url);
    expect(() => validateSlackWebhook('https://hooks.slack.com.evil.example/services/x/y/zzzzzzzz')).toThrow();
    expect(() => validateSlackWebhook('http://hooks.slack.com/services/T123/B456/abcdefgh')).toThrow();
    expect(() => validateSlackWebhook('https://example.com/services/T123/B456/abcdefgh')).toThrow();
    const a = encryptSecret(url);
    const b = encryptSecret(url);
    expect(a).not.toBe(b);
    expect(a).not.toContain('T123');
    expect(decryptSecret(a)).toBe(url);
    expect(decryptSecret(a.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A')))).toBeNull(); // tampered
    expect(decryptSecret('garbage')).toBeNull();
    expect(maskWebhook(url)).toBe('hooks.slack.com/services/…mnop');
  });

  it('LIB-005: default preferences — in-app on, immediate email off, digest for leads and above, from warning', () => {
    expect(defaultPrefs({ id: 'u', role: 'team_lead', grants: [{ role: 'team_lead', scopeType: 'team', scopeId: 't' }] }))
      .toEqual({ inApp: true, emailImmediate: false, weeklyDigest: true, minSeverity: 'warning' });
    expect(defaultPrefs({ id: 'u', role: 'qa_engineer', grants: [{ role: 'qa_engineer', scopeType: 'team', scopeId: 't' }] }).weeklyDigest).toBe(false);
  });
});

describe('Digest', () => {
  it('LIB-006: ISO week keys and the rendered email', () => {
    expect(isoWeek(Date.parse('2026-11-16T07:00:00Z'))).toBe('2026-W47');
    expect(isoWeek(Date.parse('2026-01-01T07:00:00Z'))).toBe('2026-W01');
    expect(isoWeek(Date.parse('2027-01-01T07:00:00Z'))).toBe('2026-W53');
    const d: Digest = {
      recipient: { id: 'u', name: 'Pat <Lead>', email: 'p@x' }, periodStart: '2026-11-09T07:00:00Z', periodEnd: '2026-11-16T07:00:00Z',
      teams: [{ id: 't', name: 'Team & Co', qaNow: 72.3, qaNowDay: '2026-11-16', qaBefore: 80, qaBeforeDay: '2026-11-09', delta: -7.7, inputsUsed: 3, inputsTotal: 4 }],
      alerts: { opened: [], openCount: { info: 1, warning: 2, critical: 0 } }, stale: [], actions: { overdue: [], dueSoon: [], completed: [] }, empty: false,
    };
    const r = renderDigest(d);
    expect(r.subject).toMatch(/^IronGate weekly digest · /);
    expect(r.text).toContain('Team & Co: 72.3 (-7.7; based on 3 of 4 inputs)');
    expect(r.html).toContain('Team &amp; Co');
    expect(r.html).toContain('Pat &lt;Lead&gt;');
    expect(r.html).not.toContain('<Lead>');
  });

  it('LIB-007: the weekly run queues one digest per recipient with the digest on, once per ISO week', async () => {
    if (!(await backendUp())) return;
    const db: Client = await localDb();
    try {
      await createGolden(db);
      const now = Date.now();
      const first = await runWeeklyDigest(now, { companyIds: [GOLDEN_COMPANY] });
      expect(first.companies).toBe(1);
      // Recipients: the super admin and the leads of the five active teams (the inactive team's
      // lead has no active team to report on, so gets nothing).
      const rows = (await db.query(`SELECT user_id, recipient, status, dedupe_key FROM notification_deliveries WHERE company_id = $1 AND kind = 'digest'`, [GOLDEN_COMPANY])).rows;
      expect(rows.length).toBe(first.queued);
      expect(rows.length).toBe(6);
      expect(rows.some((r) => /^inactive-1@/.test(r.recipient))).toBe(false);
      expect(rows.every((r) => r.dedupe_key === `digest:${r.user_id}:${isoWeek(now)}`)).toBe(true);
      expect(rows.some((r) => r.recipient === 'golden.admin@golden.example')).toBe(true);
      expect(rows.some((r) => /^big-2@/.test(r.recipient))).toBe(false); // engineers get no digest
      expect(rows.every((r) => ['logged', 'sent'].includes(r.status))).toBe(true);
      const second = await runWeeklyDigest(now, { companyIds: [GOLDEN_COMPANY] });
      expect(second.queued).toBe(0);
    } finally {
      await removeGolden(db);
      await db.end();
    }
  });
});
