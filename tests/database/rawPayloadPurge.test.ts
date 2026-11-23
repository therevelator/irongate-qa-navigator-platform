/**
 * The one-off privacy purge of raw_uploads.payload (scripts/privacy/purge-raw-payloads.ts and .sql):
 *   PURGE-001  a dry run counts and writes nothing
 *   PURGE-002  applied: every stored body (commits, deployments, push webhooks, tests, coverage, pipelines, SARIF,
 *              incidents, issues) is replaced by the minimised copy new requests keep: no name, e-mail address,
 *              message, host or user name is left; commit authors as the salted hash; an unreadable body is cleared;
 *              a copy already minimised is left as it is; a second run changes nothing
 * Runs against DATABASE_URL (local only).
 */
import { readFileSync } from 'fs';
import path from 'path';
import { gunzipSync, gzipSync } from 'zlib';
import { pool } from '../../src/lib/db';
import { purgeRawPayloads } from '../../scripts/privacy/rawPayloadPurge';
import { authorHash } from '../../server/lib/ingest/deliveryEvents';

const url = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/irongate_dev');
const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
const SQL = readFileSync(path.join(__dirname, '../../scripts/privacy/purge-raw-payloads.sql'), 'utf8');
const T = `purge-team-${Date.now()}`;
let company = '';

const SECRETS = ['dev.one@acme.example', 'Dev One', 'SECRET-COMMIT-MESSAGE', 'Pusher Person', 'build-host-jdoe', 'jdoe', 'SECRET-FAILURE', 'SECRET-SARIF', 'secret description', 'Jane Responder', 'jane@acme.example'];
const iso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

const BODIES: Array<{ kind: string; format: string; body: string | Buffer }> = [
  { kind: 'commits', format: 'json', body: JSON.stringify({ deployment: 'd1', commits: [{ sha: 'aaaa0001', authoredAt: iso(2), author: 'dev.one@acme.example', authorName: 'Dev One', message: 'SECRET-COMMIT-MESSAGE' }] }) },
  { kind: 'commits', format: 'github', body: JSON.stringify({ ref: 'refs/heads/main', pusher: { name: 'Pusher Person' }, repository: { name: 'r' }, commits: [{ id: 'aaaa0002', timestamp: iso(2), message: 'SECRET-COMMIT-MESSAGE', author: { name: 'Dev One', email: 'dev.one@acme.example', username: 'jdoe' } }] }) },
  { kind: 'deployments', format: 'json', body: JSON.stringify({ id: 'd1', environment: 'production', finishedAt: iso(1), result: 'success', triggeredBy: 'Pusher Person', commits: [{ sha: 'aaaa0003', author: { name: 'Dev One', email: 'dev.one@acme.example' }, message: 'SECRET-COMMIT-MESSAGE' }] }) },
  { kind: 'tests', format: 'junit', body: `<?xml version="1.0"?><testsuites><testsuite name="s" hostname="build-host-jdoe"><properties><property name="user" value="jdoe"/></properties><testcase classname="a" name="t" time="1"><failure message="SECRET-FAILURE">SECRET-FAILURE</failure></testcase></testsuite></testsuites>` },
  { kind: 'coverage', format: 'lcov', body: 'SF:/home/jdoe/src/a.ts\nDA:1,1\nend_of_record\n' },
  { kind: 'pipelines', format: 'json', body: JSON.stringify({ team: 'x', id: 'p1', startedAt: iso(1), result: 'success', triggeredBy: 'Pusher Person', actor: 'jdoe' }) },
  { kind: 'static-analysis', format: 'sarif', body: JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'ESLint' } }, results: [{ ruleId: 'r', message: { text: 'SECRET-SARIF' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///home/jdoe/a.js' } } }] }] }] }) },
  { kind: 'incidents', format: 'json', body: JSON.stringify({ id: 'I1', title: 't', openedAt: iso(2), responder: 'jane@acme.example', description: 'secret description', commander: 'Jane Responder' }) },
  { kind: 'issues', format: 'json', body: JSON.stringify({ key: 'P-1', type: 'bug', status: 'Open', createdAt: iso(3), assignee: 'jane@acme.example', description: 'secret description', reporterName: 'Jane Responder' }) },
];

async function insert(kind: string, format: string, body: Buffer, run: string): Promise<string> {
  return (await pool.query(
    `INSERT INTO raw_uploads (company_id, team_id, kind, format, commit_sha, run_id, attempt, size_bytes, payload, status)
     VALUES ($1, $2, $3, $4, '', $5, 1, $6, $7, 'parsed') RETURNING id`,
    [company, T, kind, format, run, body.length, gzipSync(body)])).rows[0].id;
}
const stored = async (id: string) => {
  const r = (await pool.query('SELECT payload FROM raw_uploads WHERE id = $1', [id])).rows[0];
  return r.payload ? gunzipSync(r.payload).toString('utf8') : null;
};

describe('Privacy purge of the raw payloads', () => {
  jest.setTimeout(60000);
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    if (!local) return;
    const dep = (await pool.query(`SELECT id, company_id FROM departments WHERE is_active IS NOT FALSE ORDER BY id LIMIT 1`)).rows[0];
    company = dep.company_id;
    await pool.query(`INSERT INTO teams (id, company_id, department_id, name, is_active) VALUES ($1, $2, $3, $1, TRUE)`, [T, company, dep.id]);
    for (const [i, b] of BODIES.entries()) ids[`${b.kind}-${b.format}`] = await insert(b.kind, b.format, Buffer.from(b.body), `purge-${i}`);
    ids.garbage = await insert('tests', 'junit', Buffer.from('not a report'), 'purge-garbage');
    ids.minimised = await insert('incidents', 'json', Buffer.from('{"minimised":true,"incidents":[{"id":"I9"}]}'), 'purge-min');
  });
  afterAll(async () => {
    if (local) {
      await pool.query('DELETE FROM raw_uploads WHERE team_id = $1', [T]);
      await pool.query('DELETE FROM teams WHERE id = $1', [T]);
    }
    await pool.end();
  });

  it('PURGE-001 a dry run counts and writes nothing', async () => {
    if (!local) return;
    const before = await stored(ids['commits-json']);
    const client = await pool.connect();
    try {
      const counts = await purgeRawPayloads(client, { apply: false, sql: SQL, teamId: T });
      expect(counts.commits).toEqual({ rows: 2, alreadyMinimised: 0, rewritten: 2, cleared: 0 });
      expect(counts.tests).toEqual({ rows: 2, alreadyMinimised: 0, rewritten: 1, cleared: 1 });
      expect(counts.incidents).toEqual({ rows: 2, alreadyMinimised: 1, rewritten: 1, cleared: 0 });
    } finally { client.release(); }
    expect(await stored(ids['commits-json'])).toBe(before);
  });

  it('PURGE-002 applied: minimised copies, nothing that names a person, unreadable bodies cleared', async () => {
    if (!local) return;
    const client = await pool.connect();
    try {
      await purgeRawPayloads(client, { apply: true, sql: SQL, teamId: T });
      for (const b of BODIES) {
        const text = await stored(ids[`${b.kind}-${b.format}`]);
        expect({ kind: b.kind, minimised: text?.startsWith('{"minimised":true') }).toEqual({ kind: b.kind, minimised: true });
        for (const s of SECRETS) expect({ kind: b.kind, has: text!.includes(s) ? s : null }).toEqual({ kind: b.kind, has: null });
      }
      expect(await stored(ids['commits-json'])).toContain(`"authorHash":"${authorHash(company, 'dev.one@acme.example')}"`);
      expect(await stored(ids['coverage-lcov'])).toContain('"path":"~/src/a.ts"');
      expect(await stored(ids.garbage)).toBeNull();
      expect((await pool.query('SELECT stored_bytes FROM raw_uploads WHERE id = $1', [ids.garbage])).rows[0].stored_bytes).toBeNull();
      expect(await stored(ids.minimised)).toBe('{"minimised":true,"incidents":[{"id":"I9"}]}');
      const again = await purgeRawPayloads(client, { apply: true, sql: SQL, teamId: T });
      expect(Object.values(again).reduce((n, c) => n + c.rewritten + c.cleared, 0)).toBe(0);
    } finally { client.release(); }
  });
});
