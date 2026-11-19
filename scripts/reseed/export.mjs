#!/usr/bin/env node
/**
 * Export the application data of a LOCAL database as standalone SQL files for a SQL console
 * (scripts/reseed/README.md): INSERT statements only (no COPY, no psql meta-commands, no
 * transaction needed), tables in foreign-key order, files of at most --max-bytes (default 1.5 MB)
 * named 001.sql, 002.sql, … in --out. Columns of a foreign-key cycle (users.primary_team_id ↔
 * teams.lead_id, …) are inserted as NULL and set by UPDATEs in the last file, followed by setval
 * for identity columns.
 *
 * users.password_hash is replaced by a placeholder per role (__HASH_SUPER_ADMIN__,
 * __HASH_MANAGER__, __HASH_TEAM_LEAD__, __HASH_ENGINEER__, __HASH_VIEWER__) unless --keep-hashes.
 * Skipped tables (tokens, sessions, platform support, logs): see SKIP.
 *
 * Usage: DATABASE_URL=postgres://…@127.0.0.1/db node scripts/reseed/export.mjs --out dir [--max-bytes n] [--keep-hashes]
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const out = arg('--out');
const maxBytes = Number(arg('--max-bytes', 1_500_000));
const keepHashes = process.argv.includes('--keep-hashes');
if (!out) { console.error('--out <dir> is required'); process.exit(2); }
const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) { console.error('DATABASE_URL must be a local database'); process.exit(2); }

const SKIP = new Set([
  'platform_operators', 'platform_operator_sessions', 'platform_access_log', // platform support (operator.sql)
  'password_resets', 'pulse_links', 'user_identities',                       // tokens and sign-in links
  'server_errors', 'job_runs', 'notification_deliveries',                    // operational logs
]);
const HASH_PLACEHOLDER = {
  super_admin: '__HASH_SUPER_ADMIN__', qa_manager: '__HASH_MANAGER__', team_lead: '__HASH_TEAM_LEAD__',
  qa_engineer: '__HASH_ENGINEER__', viewer: '__HASH_VIEWER__',
};

const client = new pg.Client({ connectionString: url });
await client.connect();
const q = async (sql, params) => (await client.query(sql, params)).rows;

const tables = (await q(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)).map((r) => r.tablename).filter((t) => !SKIP.has(t));
const fks = await q(`
  SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent, a.attname AS col
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
   WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND array_length(c.conkey, 1) = 1`);
const strip = (t) => t.replace(/^public\./, '');
const edges = fks.map((f) => ({ child: strip(f.child), parent: strip(f.parent), col: f.col })).filter((e) => tables.includes(e.child) && tables.includes(e.parent));

// Topological order; an edge that closes a cycle (or a self reference) is deferred: NULL on insert, UPDATE at the end.
const deferred = new Map(); // table -> Set(col)
const order = [];
const state = new Map();
function visit(t, stack) {
  if (state.get(t) === 'done') return;
  state.set(t, 'active');
  for (const e of edges.filter((x) => x.child === t)) {
    if (e.parent === t || state.get(e.parent) === 'active') {
      if (!deferred.has(t)) deferred.set(t, new Set());
      deferred.get(t).add(e.col);
      continue;
    }
    visit(e.parent, [...stack, t]);
  }
  state.set(t, 'done');
  order.push(t);
}
for (const t of tables) visit(t, []);

fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (/^\d{3}\.sql$/.test(f) && f !== '000_wipe.sql') fs.rmSync(path.join(out, f));
const files = [];
let buf = '';
const header = (n) => `-- IronGate QA Navigator data, part ${n}. Run the parts in order after 000_wipe.sql. INSERTs only.\n`;
const flush = () => { if (!buf) return; files.push(buf); buf = ''; };
const emit = (sql) => {
  if (buf && buf.length + sql.length > maxBytes) flush();
  if (!buf) buf = header(files.length + 1);
  buf += sql + '\n';
};

const counts = {};
const updates = [];
for (const t of order) {
  const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER' ORDER BY ordinal_position`, [t])).map((r) => r.column_name);
  const later = deferred.get(t) ?? new Set();
  const pk = (await q(`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = $1::regclass AND i.indisprimary`, [`public.${t}`])).map((r) => r.attname);
  const lit = (c) => {
    if (t === 'users' && c === 'password_hash' && !keepHashes) {
      return `quote_literal(CASE role ${Object.entries(HASH_PLACEHOLDER).map(([r, h]) => `WHEN '${r}' THEN '${h}'`).join(' ')} ELSE '__HASH_VIEWER__' END)`;
    }
    return later.has(c) ? `'NULL'` : `COALESCE(quote_literal(${JSON.stringify(c)}::text), 'NULL')`;
  };
  const rows = await q(`SELECT '(' || ${cols.map(lit).join(` || ', ' || `)} || ')' AS v FROM public.${JSON.stringify(t)} ORDER BY ${pk.length ? pk.map((c) => JSON.stringify(c)).join(', ') : '1'}`);
  counts[t] = rows.length;
  const colList = cols.map((c) => JSON.stringify(c)).join(', ');
  for (let i = 0; i < rows.length; i += 200) {
    emit(`INSERT INTO public.${JSON.stringify(t)} (${colList}) VALUES\n${rows.slice(i, i + 200).map((r) => r.v).join(',\n')};`);
  }
  if (later.size && pk.length) {
    for (const c of later) {
      const pairs = await q(`SELECT ${pk.map((k) => `quote_literal(${JSON.stringify(k)}::text) AS ${JSON.stringify('k_' + k)}`).join(', ')}, quote_literal(${JSON.stringify(c)}::text) AS v FROM public.${JSON.stringify(t)} WHERE ${JSON.stringify(c)} IS NOT NULL`);
      for (const p of pairs) updates.push(`UPDATE public.${JSON.stringify(t)} SET ${JSON.stringify(c)} = ${p.v} WHERE ${pk.map((k) => `${JSON.stringify(k)} = ${p['k_' + k]}`).join(' AND ')};`);
    }
  }
}
for (const u of updates) emit(u);
// Identity / serial columns continue after the inserted ids.
const seqs = await q(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND (is_identity = 'YES' OR column_default LIKE 'nextval%')`);
for (const s of seqs) if (!SKIP.has(s.table_name)) emit(`SELECT setval(pg_get_serial_sequence('public.${s.table_name}', '${s.column_name}'), COALESCE((SELECT max(${JSON.stringify(s.column_name)}) FROM public.${JSON.stringify(s.table_name)}), 0) + 1, false);`);
flush();
files.forEach((f, i) => fs.writeFileSync(path.join(out, `${String(i + 1).padStart(3, '0')}.sql`), f));
await client.end();
console.log(JSON.stringify({ files: files.map((f, i) => ({ file: `${String(i + 1).padStart(3, '0')}.sql`, bytes: Buffer.byteLength(f) })), deferred: Object.fromEntries([...deferred].map(([k, v]) => [k, [...v]])), counts }, null, 1));
