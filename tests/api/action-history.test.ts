import type { Client } from 'pg';
import { backendUp, get, localDb, login, patch, post } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';

/**
 * Status history of tracked actions (server/lib/actions.ts, team_action_events, migration
 * 20261202100000_action_status_history.sql): who changed the status and when.
 *
 *   AHI-001  creation records "created" (by the signed-in user, now, UTC) on the action and in the history
 *   AHI-002  a status change by the owner records the owner, the time and from → to; history newest first
 *   AHI-003  a change of other fields (title, due date) records nothing; the same status again records nothing
 *   AHI-004  scoping: the history comes only with the list the caller may read (other teams / companies get
 *            403 / 404); a name only, never an e-mail
 *   AHI-005  an automatic change (no signed-in user) is recorded as automatic (changed_by null, source system)
 *   AHI-006  accepting a recommendation records the creation by the person who accepted it, in the same
 *            transaction as the decision
 *   AHI-007  a failed change (refused status) records nothing
 * Runs against a live backend at API_URL; skips cleanly when none is running.
 */

let up = true;
let db: Client;
const c: Record<string, string> = {};
const PARTIAL = 'golden-team-partial';
const BIG = 'golden-team-big';
const LEAD = 'golden-u-partial-1';
const ENGINEER = 'golden-u-partial-2';

const listOf = async (cookie: string, team = PARTIAL) => (await get(`/api/actions?teamId=${team}`, cookie)).body.actions as any[];
const find = async (cookie: string, id: string) => (await listOf(cookie)).find((a) => a.id === id);

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  await createGolden(db);
  c.admin = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  c.lead = (await login('partial-1@golden.example')).cookie;      // lead of Partial Team
  c.engineer = (await login('partial-2@golden.example')).cookie;  // engineer of Partial Team
  c.otherLead = (await login('big-1@golden.example')).cookie;     // lead of Big Team
  c.foreign = (await login('alex.morgan@northwind.example')).cookie;
});

afterAll(async () => {
  if (db) {
    await db.query(`DELETE FROM recommendations WHERE company_id = $1`, [GOLDEN_COMPANY]).catch(() => undefined);
    await db.query(`DELETE FROM team_actions WHERE company_id = $1`, [GOLDEN_COMPANY]).catch(() => undefined);
    await removeGolden(db);
    await db.end();
  }
  // AHI-005 calls the library directly, which opens the app's own pool.
  const { pool } = await import('../../src/lib/db');
  await pool.end().catch(() => undefined);
});

describe('Action status history', () => {
  let actionId = '';

  it('AHI-001: creation records "created" by the signed-in user, now (UTC), on the action and in the history', async () => {
    if (!up) return;
    const before = Date.now();
    const res = await post('/api/actions', c.lead, { teamId: PARTIAL, title: 'History: stabilise the suite', ownerId: ENGINEER });
    expect(res.status).toBe(201);
    actionId = res.body.action.id;
    const a = await find(c.lead, actionId);
    expect(a.statusChangedBy).toEqual({ id: LEAD, name: expect.any(String) });
    expect(a.statusChangedBy.name).not.toMatch(/@/);
    expect(a.statusChangedAt).toMatch(/Z$/);
    expect(Date.parse(a.statusChangedAt)).toBeGreaterThanOrEqual(before - 5000);
    expect(a.history).toHaveLength(1);
    expect(a.history[0]).toMatchObject({ fromStatus: null, toStatus: 'open', changedBy: { id: LEAD }, automatic: false, changedAt: a.statusChangedAt });
    const row = (await db.query(`SELECT status_changed_by, status_changed_at, created_at FROM team_actions WHERE id = $1`, [actionId])).rows[0];
    expect(row.status_changed_by).toBe(LEAD);
    expect(new Date(row.status_changed_at).toISOString()).toBe(new Date(row.created_at).toISOString());
  });

  it('AHI-002: a status change by the owner records who, when and from → to; the history is newest first', async () => {
    if (!up) return;
    expect((await patch(`/api/actions/${actionId}`, c.engineer, { status: 'in_progress' })).status).toBe(200);
    expect((await patch(`/api/actions/${actionId}`, c.lead, { status: 'dropped' })).status).toBe(200);
    const a = await find(c.lead, actionId);
    expect(a.status).toBe('dropped');
    expect(a.statusChangedBy.id).toBe(LEAD);
    expect(a.history.map((e: any) => [e.fromStatus, e.toStatus, e.changedBy?.id])).toEqual([
      ['in_progress', 'dropped', LEAD], ['open', 'in_progress', ENGINEER], [null, 'open', LEAD],
    ]);
    const times = a.history.map((e: any) => Date.parse(e.changedAt));
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    expect(a.statusChangedAt).toBe(a.history[0].changedAt);
    const events = (await db.query(`SELECT company_id, team_id, source FROM team_action_events WHERE action_id = $1`, [actionId])).rows;
    expect(events.every((e) => e.company_id === GOLDEN_COMPANY && e.team_id === PARTIAL && e.source === 'user')).toBe(true);
  });

  it('AHI-003: editing other fields, or setting the same status again, records nothing', async () => {
    if (!up) return;
    const count = async () => (await db.query(`SELECT count(*)::int AS n FROM team_action_events WHERE action_id = $1`, [actionId])).rows[0].n;
    const n = await count();
    const at = (await find(c.lead, actionId)).statusChangedAt;
    expect((await patch(`/api/actions/${actionId}`, c.lead, { title: 'History: stabilise the suite (renamed)', dueDate: '2031-01-31' })).status).toBe(200);
    expect((await patch(`/api/actions/${actionId}`, c.lead, { status: 'dropped' })).status).toBe(200);
    expect(await count()).toBe(n);
    expect((await find(c.lead, actionId)).statusChangedAt).toBe(at);
  });

  it('AHI-004: the history comes with the list the caller may read; others get 403 / 404; names only', async () => {
    if (!up) return;
    expect((await get(`/api/actions?teamId=${PARTIAL}`, c.otherLead)).status).toBe(403);
    expect([403, 404]).toContain((await get(`/api/actions?teamId=${PARTIAL}`, c.foreign)).status);
    expect((await get(`/api/actions?teamId=${PARTIAL}`, '')).status).toBe(401);
    // The other team's list never carries this action or its history.
    const big = await listOf(c.otherLead, BIG);
    expect(big.some((a) => a.id === actionId)).toBe(false);
    const raw = JSON.stringify(await listOf(c.engineer));
    expect(raw).not.toMatch(/@golden\.example/);
    const a = await find(c.engineer, actionId);
    expect(Object.keys(a.statusChangedBy).sort()).toEqual(['id', 'name']);
    for (const e of a.history) if (e.changedBy) expect(Object.keys(e.changedBy).sort()).toEqual(['id', 'name']);
  });

  it('AHI-005: an automatic change (no signed-in user) is shown as automatic', async () => {
    if (!up) return;
    const { updateAction } = await import('../../server/lib/actions');
    await updateAction({ companyId: GOLDEN_COMPANY, actorId: null, team: { id: PARTIAL, name: 'Partial Team', department_id: 'golden-dept-b' } }, actionId, { status: 'open' });
    const a = await find(c.lead, actionId);
    expect(a.status).toBe('open');
    expect(a.statusChangedBy).toBeNull();
    expect(a.history[0]).toMatchObject({ fromStatus: 'dropped', toStatus: 'open', changedBy: null, automatic: true });
    const ev = (await db.query(`SELECT changed_by, source FROM team_action_events WHERE action_id = $1 ORDER BY changed_at DESC LIMIT 1`, [actionId])).rows[0];
    expect(ev).toEqual({ changed_by: null, source: 'system' });
  });

  it('AHI-006: accepting a recommendation records the creation by the person who accepted it', async () => {
    if (!up) return;
    await db.query(
      `INSERT INTO recommendations (id, company_id, team_id, rule_key, subject_key, metric_key, title, evidence, next_step, confidence, status, active)
       VALUES ('golden-rec-hist', $1, $2, 'history_test', '', 'test_coverage', 'Raise coverage on the checkout module', '[]'::jsonb, 'Add tests', 'medium', 'open', TRUE)
       ON CONFLICT (id) DO NOTHING`,
      [GOLDEN_COMPANY, PARTIAL]
    );
    const res = await post('/api/improve/recommendations/golden-rec-hist/accept', c.lead, {});
    expect(res.status).toBe(201);
    const a = await find(c.lead, res.body.actionId);
    expect(a.origin).toBe('recommendation');
    expect(a.recommendation).toMatchObject({ id: 'golden-rec-hist' });
    expect(a.statusChangedBy.id).toBe(LEAD);
    expect(a.history).toEqual([expect.objectContaining({ fromStatus: null, toStatus: 'open', changedBy: expect.objectContaining({ id: LEAD }), automatic: false })]);
  });

  it('AHI-007: a refused change records nothing', async () => {
    if (!up) return;
    const count = async () => (await db.query(`SELECT count(*)::int AS n FROM team_action_events WHERE action_id = $1`, [actionId])).rows[0].n;
    const n = await count();
    expect((await patch(`/api/actions/${actionId}`, c.lead, { status: 'finished' })).status).toBe(400);
    expect((await patch(`/api/actions/${actionId}`, c.otherLead, { status: 'done' })).status).toBe(404);
    expect(await count()).toBe(n);
  });
});
