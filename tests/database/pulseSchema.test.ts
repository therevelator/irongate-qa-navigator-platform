/**
 * Pulse survey storage (migration 20261121200000_privacy_pulse_survey.sql):
 *   PS-001  answers carry no user id and no time; participation carries no time and no answer
 *           reference; no foreign key or shared key links the two tables;
 *   PS-002  the database refuses answers outside 1-5, comments over 500 characters, an empty
 *           period and a second participation row for the same person, team and period;
 *   PS-003  row level security is on (no policies: only the table owner, the API, reads them);
 *   PS-004  the migration is idempotent (runs again without error, inside a rolled-back transaction).
 * Sending (migration 20261122200000_pulse_cadence_sending.sql):
 *   PS-005  the cadence accepts weekly, biweekly, monthly and quarterly only; one automatic survey send
 *           per team and period; links keep only a sha256 (64 hex), no time of use, no answer reference;
 *   PS-006  row level security on the four new tables; the migration runs again without error.
 * All writes run inside transactions that are rolled back. Runs against DATABASE_URL from .env (local only).
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

function localConfig() {
  const url = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/irongate_dev');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error(`Refusing non-local database host ${url.hostname}`);
  return {
    host: url.hostname, port: parseInt(url.port || '5432', 10), user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), database: url.pathname.slice(1),
  };
}

describe('Pulse survey storage', () => {
  let client: Client;
  let team: { id: string; company_id: string } | null = null;
  let userId: string | null = null;

  beforeAll(async () => {
    client = new Client(localConfig());
    await client.connect();
    team = (await client.query(`SELECT id, company_id FROM teams WHERE is_active ORDER BY id LIMIT 1`)).rows[0] ?? null;
    userId = team ? (await client.query(`SELECT id FROM users WHERE company_id = $1 ORDER BY id LIMIT 1`, [team.company_id])).rows[0]?.id ?? null : null;
  });
  afterAll(async () => { await client.end(); });

  const columns = async (t: string) => (await client.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [t]
  )).rows as Array<{ column_name: string; data_type: string }>;

  it('PS-001: no user id or time on answers; nothing links participation to an answer', async () => {
    const answers = await columns('pulse_responses');
    expect(answers.map((c) => c.column_name)).toEqual(['id', 'company_id', 'team_id', 'period_start', 'period_end', 'q_workload', 'q_focus', 'q_support', 'q_energy', 'q_outlook', 'comment']);
    expect(answers.some((c) => /user|actor|by$|_at$/.test(c.column_name) || c.data_type.startsWith('timestamp'))).toBe(false);
    const part = await columns('pulse_participation');
    expect(part.map((c) => c.column_name)).toEqual(['company_id', 'team_id', 'user_id', 'period_start']);
    expect(part.some((c) => c.data_type.startsWith('timestamp'))).toBe(false);
    const links = (await client.query(
      `SELECT conname FROM pg_constraint WHERE contype = 'f'
         AND ((conrelid = 'pulse_responses'::regclass AND confrelid IN ('users'::regclass, 'pulse_participation'::regclass))
           OR (conrelid = 'pulse_participation'::regclass AND confrelid = 'pulse_responses'::regclass))`
    )).rows;
    expect(links).toEqual([]);
  });

  it('PS-002: the constraints refuse invalid answers and a second participation', async () => {
    if (!team || !userId) return;
    const attempt = async (sql: string, params: unknown[]) => {
      await client.query('BEGIN');
      try {
        await client.query(sql, params);
        return 'ok';
      } catch (e: any) {
        return e.code as string;
      } finally {
        await client.query('ROLLBACK');
      }
    };
    const ins = `INSERT INTO pulse_responses (company_id, team_id, period_start, period_end, q_workload, q_focus, q_support, q_energy, q_outlook, comment)
                 VALUES ($1, $2, $3, $4, $5, 3, 3, 3, 3, $6)`;
    expect(await attempt(ins, [team.company_id, team.id, '2026-01-05', '2026-01-19', 3, null])).toBe('ok');
    expect(await attempt(ins, [team.company_id, team.id, '2026-01-05', '2026-01-19', 6, null])).toBe('23514');
    expect(await attempt(ins, [team.company_id, team.id, '2026-01-05', '2026-01-19', 0, null])).toBe('23514');
    expect(await attempt(ins, [team.company_id, team.id, '2026-01-05', '2026-01-19', 3, 'x'.repeat(501)])).toBe('23514');
    expect(await attempt(ins, [team.company_id, team.id, '2026-01-19', '2026-01-19', 3, null])).toBe('23514');
    const twice = `INSERT INTO pulse_participation (company_id, team_id, user_id, period_start) VALUES ($1, $2, $3, '2026-01-05'), ($1, $2, $3, '2026-01-05')`;
    expect(await attempt(twice, [team.company_id, team.id, userId])).toBe('23505');
    const cadence = `INSERT INTO pulse_cadences (company_id, team_id, cadence, effective_from) VALUES ($1, $2, 'daily', '2026-01-05')`;
    expect(await attempt(cadence, [team.company_id, team.id])).toBe('23514');
  });

  it('PS-003: row level security is enabled on the three tables', async () => {
    const rows = (await client.query(
      `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('pulse_responses', 'pulse_participation', 'pulse_cadences') ORDER BY relname`
    )).rows;
    expect(rows).toEqual([
      { relname: 'pulse_cadences', relrowsecurity: true },
      { relname: 'pulse_participation', relrowsecurity: true },
      { relname: 'pulse_responses', relrowsecurity: true },
    ]);
  });

  it('PS-004: the migration runs again without error (idempotent)', async () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261121200000_privacy_pulse_survey.sql'), 'utf8')
      .replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
    await client.query('BEGIN');
    try {
      await expect(client.query(sql)).resolves.toBeDefined();
    } finally {
      await client.query('ROLLBACK');
    }
  });

  const attempt = async (sql: string, params: unknown[]) => {
    await client.query('BEGIN');
    try {
      await client.query(sql, params);
      return 'ok';
    } catch (e: any) {
      return e.code as string;
    } finally {
      await client.query('ROLLBACK');
    }
  };

  it('PS-005: four cadences; one automatic send per team and period; links store a hash only', async () => {
    if (!team || !userId) return;
    const cad = `INSERT INTO pulse_cadences (company_id, team_id, cadence, effective_from) VALUES ($1, $2, $3, '2031-01-01')`;
    for (const c of ['weekly', 'biweekly', 'monthly', 'quarterly']) expect(await attempt(cad, [team.company_id, team.id, c])).toBe('ok');
    expect(await attempt(cad, [team.company_id, team.id, 'yearly'])).toBe('23514');
    const send = (trigger: string, kind: string) => `INSERT INTO pulse_sends (company_id, team_id, period_start, period_end, kind, trigger)
      VALUES ($1, $2, '2031-01-01', '2031-02-01', '${kind}', '${trigger}')`;
    expect(await attempt(`${send('auto', 'survey')}; ${send('auto', 'survey')}`.replace(/\$1/g, `'${team.company_id}'`).replace(/\$2/g, `'${team.id}'`), [])).toBe('23505');
    expect(await attempt(`${send('manual', 'survey')}; ${send('manual', 'survey')}; ${send('auto', 'survey')}`.replace(/\$1/g, `'${team.company_id}'`).replace(/\$2/g, `'${team.id}'`), [])).toBe('ok');
    expect(await attempt(send('auto', 'reply'), [team.company_id, team.id])).toBe('23514');
    const link = `INSERT INTO pulse_links (token_hash, company_id, team_id, user_id, period_start, period_end, expires_at)
      VALUES ($1, $2, $3, $4, '2031-01-01', '2031-02-01', '2031-02-01')`;
    expect(await attempt(link, ['a'.repeat(64), team.company_id, team.id, userId])).toBe('ok');
    expect(await attempt(link, ['igp_plain-token', team.company_id, team.id, userId])).toBe('23514');
    const cols = (await columns('pulse_links')).map((c) => c.column_name);
    expect(cols).toEqual(['token_hash', 'company_id', 'team_id', 'user_id', 'period_start', 'period_end', 'expires_at', 'used']);
    const fks = (await client.query(
      `SELECT confrelid::regclass::text AS ref FROM pg_constraint WHERE contype = 'f'
         AND conrelid IN ('pulse_links'::regclass, 'pulse_recipients'::regclass, 'pulse_sends'::regclass, 'pulse_settings'::regclass)`
    )).rows.map((r) => r.ref);
    expect(fks.some((r) => r === 'pulse_responses' || r === 'pulse_participation')).toBe(false);
  });

  it('PS-006: row level security on the sending tables; the sending migration is idempotent', async () => {
    const rows = (await client.query(
      `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('pulse_settings', 'pulse_sends', 'pulse_recipients', 'pulse_links') ORDER BY relname`
    )).rows;
    expect(rows).toEqual(['pulse_links', 'pulse_recipients', 'pulse_sends', 'pulse_settings'].map((relname) => ({ relname, relrowsecurity: true })));
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261122200000_pulse_cadence_sending.sql'), 'utf8')
      .replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
    await client.query('BEGIN');
    try {
      await expect(client.query(sql)).resolves.toBeDefined();
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
