/**
 * Action status history storage (migration 20261202100000_action_status_history.sql) and the sample
 * history generator (server/seeds/actionHistory.ts):
 *   AHM-001  columns, the history table with its foreign keys, index and row level security (no policies)
 *   AHM-002  backfill: the knowable history from audit_log (created + status changes, by whom); without one,
 *            status_changed_at from completed_at (done / dropped) else updated_at, status_changed_by NULL;
 *            the migration runs again without duplicates
 *   AHM-003  the history goes with its action (cascade); a deleted person leaves the change with no name
 *   AHM-004  sample history: a chain per status by people allowed to change actions, after the creation,
 *            before now, on weekdays 09:00-17:00 UTC (done: at completed_at); a second run adds nothing
 * All writes run inside transactions that are rolled back. Runs against DATABASE_URL from .env (local only).
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { sampleActionHistorySql } from '../../server/seeds/actionHistory';

dotenv.config();

function localConfig() {
  const url = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/irongate_dev');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error(`Refusing non-local database host ${url.hostname}`);
  return {
    host: url.hostname, port: parseInt(url.port || '5432', 10), user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), database: url.pathname.slice(1),
  };
}

const MIGRATION = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261202100000_action_status_history.sql'), 'utf8')
  .replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');

describe('Action status history storage', () => {
  let client: Client;
  let team: { id: string; company_id: string; department_id: string | null } | null = null;
  let userId: string | null = null;

  beforeAll(async () => {
    client = new Client(localConfig());
    await client.connect();
    team = (await client.query(
      `SELECT t.id, t.company_id, t.department_id FROM teams t
        WHERE t.is_active AND EXISTS (SELECT 1 FROM role_assignments ra JOIN users u ON u.id = ra.user_id AND u.is_active
                                       WHERE ra.role = 'team_lead' AND ra.scope_type = 'team' AND ra.scope_id = t.id AND ra.revoked_at IS NULL)
        ORDER BY t.id LIMIT 1`)).rows[0] ?? null;
    userId = team ? (await client.query(`SELECT id FROM users WHERE company_id = $1 AND is_active ORDER BY id LIMIT 1`, [team.company_id])).rows[0]?.id ?? null : null;
  });
  afterAll(async () => { await client.end(); });

  const inTx = async (fn: () => Promise<void>) => {
    await client.query('BEGIN');
    try { await fn(); } finally { await client.query('ROLLBACK'); }
  };
  const addAction = async (id: string, status: string, extra: { completed?: string | null; updated?: string } = {}) => {
    await client.query(
      `INSERT INTO team_actions (id, company_id, team_id, title, status, owner_id, created_at, updated_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, '2026-10-05T09:00:00Z', $7::timestamptz, $8::timestamptz)`,
      [id, team!.company_id, team!.id, `History test ${id}`, status, userId, extra.updated ?? '2026-10-20T10:00:00Z', extra.completed ?? null]);
  };

  it('AHM-001: columns, history table, foreign keys, index, row level security', async () => {
    const cols = (await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'team_actions' AND column_name LIKE 'status_changed_%' ORDER BY 1`)).rows.map((r) => r.column_name);
    expect(cols).toEqual(['status_changed_at', 'status_changed_by']);
    const ev = (await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'team_action_events' ORDER BY ordinal_position`)).rows.map((r) => r.column_name);
    expect(ev).toEqual(['id', 'company_id', 'team_id', 'action_id', 'from_status', 'to_status', 'changed_by', 'source', 'changed_at', 'note']);
    const fks = (await client.query(
      `SELECT conname, confdeltype FROM pg_constraint WHERE conname IN ('team_actions_status_changed_by_fk', 'team_action_events_action_fk', 'team_action_events_changed_by_fk') ORDER BY 1`)).rows;
    expect(fks).toEqual([
      { conname: 'team_action_events_action_fk', confdeltype: 'c' },
      { conname: 'team_action_events_changed_by_fk', confdeltype: 'n' },
      { conname: 'team_actions_status_changed_by_fk', confdeltype: 'n' },
    ]);
    const idx = (await client.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'team_action_events_action_idx'`)).rows[0]?.indexdef;
    expect(idx).toMatch(/\(action_id, changed_at\)/);
    const rls = (await client.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'team_action_events'`)).rows[0];
    expect(rls.relrowsecurity).toBe(true);
    expect((await client.query(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'team_action_events'`)).rows[0].n).toBe(0);
  });

  it('AHM-002: backfill from audit_log where knowable, else completed_at / updated_at; idempotent', async () => {
    if (!team || !userId) return;
    await inTx(async () => {
      await addAction('ahm-known', 'dropped');
      await addAction('ahm-done', 'done', { completed: '2026-10-18T15:00:00Z' });
      await addAction('ahm-dropped', 'dropped');
      await addAction('ahm-stale', 'done', { completed: '2026-10-19T15:00:00Z' });
      await client.query(
        `INSERT INTO audit_log (company_id, actor_id, action, entity_type, entity_id, summary, before, after, created_at) VALUES
           ($1, $2, 'action.create', 'action', 'ahm-known', 'c', NULL, '{"status":"open"}', '2026-10-05T09:00:00Z'),
           ($1, $2, 'action.status', 'action', 'ahm-known', 's', '{"status":"open"}', '{"status":"in_progress"}', '2026-10-06T11:00:00Z'),
           ($1, $2, 'action.status', 'action', 'ahm-known', 's', '{"status":"in_progress"}', '{"status":"dropped"}', '2026-10-09T16:20:00Z'),
           ($1, $2, 'action.update', 'action', 'ahm-known', 'u', '{"status":"dropped"}', '{"status":"dropped"}', '2026-10-10T10:00:00Z'),
           ($1, $2, 'action.status', 'action', 'ahm-stale', 's', '{"status":"open"}', '{"status":"in_progress"}', '2026-10-07T11:00:00Z')`,
        [team!.company_id, userId]);
      await client.query(MIGRATION);
      await client.query(MIGRATION);
      const rows = Object.fromEntries((await client.query(
        `SELECT id, status_changed_by, status_changed_at FROM team_actions WHERE id LIKE 'ahm-%'`)).rows.map((r) => [r.id, r]));
      expect(rows['ahm-known'].status_changed_by).toBe(userId);
      expect(rows['ahm-known'].status_changed_at.toISOString()).toBe('2026-10-09T16:20:00.000Z');
      expect(rows['ahm-done']).toMatchObject({ status_changed_by: null });
      expect(rows['ahm-done'].status_changed_at.toISOString()).toBe('2026-10-18T15:00:00.000Z');
      expect(rows['ahm-dropped'].status_changed_at.toISOString()).toBe('2026-10-20T10:00:00.000Z');
      // A known change that does not lead to the current status: the time falls back, no person.
      expect(rows['ahm-stale']).toMatchObject({ status_changed_by: null });
      expect(rows['ahm-stale'].status_changed_at.toISOString()).toBe('2026-10-19T15:00:00.000Z');
      const ev = (await client.query(
        `SELECT from_status, to_status, changed_by, source FROM team_action_events WHERE action_id = 'ahm-known' ORDER BY changed_at`)).rows;
      expect(ev).toEqual([
        { from_status: null, to_status: 'open', changed_by: userId, source: 'user' },
        { from_status: 'open', to_status: 'in_progress', changed_by: userId, source: 'user' },
        { from_status: 'in_progress', to_status: 'dropped', changed_by: userId, source: 'user' },
      ]);
    });
  });

  it('AHM-003: the history goes with its action; the database refuses unknown statuses and sources', async () => {
    if (!team) return;
    await inTx(async () => {
      await addAction('ahm-cascade', 'open');
      await client.query(`INSERT INTO team_action_events (company_id, team_id, action_id, to_status) VALUES ($1, $2, 'ahm-cascade', 'open')`, [team!.company_id, team!.id]);
      await client.query(`DELETE FROM team_actions WHERE id = 'ahm-cascade'`);
      expect((await client.query(`SELECT count(*)::int AS n FROM team_action_events WHERE action_id = 'ahm-cascade'`)).rows[0].n).toBe(0);
      await addAction('ahm-check', 'open');
      await client.query('SAVEPOINT s');
      await expect(client.query(`INSERT INTO team_action_events (company_id, team_id, action_id, to_status) VALUES ($1, $2, 'ahm-check', 'finished')`, [team!.company_id, team!.id])).rejects.toThrow();
      await client.query('ROLLBACK TO SAVEPOINT s');
      await expect(client.query(`INSERT INTO team_action_events (company_id, team_id, action_id, to_status, source) VALUES ($1, $2, 'ahm-check', 'open', 'robot')`, [team!.company_id, team!.id])).rejects.toThrow();
    });
  });

  it('AHM-004: sample history: allowed people, plausible times, a chain per status; a second run adds nothing', async () => {
    if (!team) return;
    await inTx(async () => {
      for (const [id, status, completed] of [['ahs-open', 'open', null], ['ahs-prog', 'in_progress', null], ['ahs-done', 'done', '2026-10-21T15:30:00Z'], ['ahs-drop', 'dropped', null]] as const) {
        await addAction(id, status, { completed });
      }
      const sql = sampleActionHistorySql({ where: `a.id LIKE 'ahs-%'`, idPrefix: 'ahs-e-' });
      await client.query(sql);
      const n1 = (await client.query(`SELECT count(*)::int AS n FROM team_action_events WHERE action_id LIKE 'ahs-%'`)).rows[0].n;
      await client.query(sql);
      expect((await client.query(`SELECT count(*)::int AS n FROM team_action_events WHERE action_id LIKE 'ahs-%'`)).rows[0].n).toBe(n1);
      const ev = (await client.query(
        `SELECT e.action_id, e.from_status, e.to_status, e.changed_by, e.changed_at, a.created_at, a.completed_at,
                EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.user_id = e.changed_by AND ra.revoked_at IS NULL AND ra.company_id = a.company_id
                         AND ((ra.role = 'team_lead' AND ra.scope_id = a.team_id) OR (ra.role = 'qa_manager' AND ra.scope_id = $1) OR ra.role = 'super_admin')) AS writer,
                e.changed_by = a.owner_id AS owner
           FROM team_action_events e JOIN team_actions a ON a.id = e.action_id WHERE e.action_id LIKE 'ahs-%' ORDER BY e.action_id, e.changed_at`,
        [team!.department_id])).rows;
      const chain = (id: string) => ev.filter((e) => e.action_id === id).map((e) => e.to_status);
      expect(chain('ahs-open')).toEqual(['open']);
      expect(chain('ahs-prog')).toEqual(['open', 'in_progress']);
      expect(chain('ahs-done')).toEqual(['open', 'in_progress', 'done']);
      expect(chain('ahs-drop').slice(-1)[0]).toBe('dropped');
      for (const e of ev) {
        expect(e.changed_by).toBeTruthy();
        // Creation by a writer; status changes by a writer or the action's owner.
        expect(e.writer || (e.from_status !== null && e.owner)).toBe(true);
        expect(e.changed_at.getTime()).toBeLessThan(Date.now());
        if (e.from_status === null) { expect(e.changed_at.getTime()).toBe(e.created_at.getTime()); continue; }
        expect(e.changed_at.getTime()).toBeGreaterThan(e.created_at.getTime());
        if (e.to_status === 'done') { expect(e.changed_at.getTime()).toBe(e.completed_at.getTime()); continue; }
        const dow = e.changed_at.getUTCDay();
        expect(dow >= 1 && dow <= 5).toBe(true);
        expect(e.changed_at.getUTCHours()).toBeGreaterThanOrEqual(9);
        expect(e.changed_at.getUTCHours()).toBeLessThan(17);
      }
      const acts = (await client.query(`SELECT a.id, a.status_changed_by, a.status_changed_at FROM team_actions a WHERE a.id LIKE 'ahs-%' ORDER BY a.id`)).rows;
      for (const a of acts) {
        const last = ev.filter((e) => e.action_id === a.id).slice(-1)[0];
        expect(a.status_changed_by).toBe(last.changed_by);
        expect(a.status_changed_at.getTime()).toBe(last.changed_at.getTime());
      }
    });
  });
});
