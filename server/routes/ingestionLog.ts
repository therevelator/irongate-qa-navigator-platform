import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken } from '../middleware/auth';
import { policyActor } from '../middleware/access';
import { canViewIngestionLog, canViewIngestionEntry, isCompanyAdmin, managedDepartmentIds, type PolicyActor } from '../lib/userPolicy';

/**
 * Ingestion log (Administration → Ingestion log): every KPI write request (ingestion API, Manual
 * metrics and file uploads: channel "upload", with the file in "upload"), with its status, per-item
 * summary and errors (server/lib/ingestionLog.ts).
 *
 * GET /api/ingestion-log            entries, newest first; filters: status, channel, source, teamId,
 *                                   from / to (YYYY-MM-DD), before (cursor), limit (≤ 200)
 * GET /api/ingestion-log/sources    per source: last received, last status, 7-day counts
 * GET /api/ingestion-log/:id        one entry with its items, errors and the response returned
 *
 * Policy: canViewIngestionLog (super_admin: the company; QA managers: entries that touch a team
 * of a department they manage); everyone else 403. Always limited to the caller's company.
 */
const router = express.Router();

const DENIED = 'The ingestion log is available to super admins and managers';

/** WHERE clause limiting entries to what the actor may see (canViewIngestionEntry, in SQL). */
function scopeWhere(actor: PolicyActor, params: any[]): string {
  if (isCompanyAdmin(actor)) return '';
  params.push(managedDepartmentIds(actor));
  return ' AND l.department_ids && ?::varchar[]';
}

const COLUMNS = `l.id, l.channel, l.source, l.received_at, l.status, l.idempotency_key, l.http_status, l.team_ids, l.department_ids,
  l.item_count, l.value_count, l.errors, l.items, l.api_key_id, k.name AS api_key_name, k.key_prefix AS api_key_prefix,
  l.actor_id, NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS actor_name, l.response -> 'upload' AS upload,
  l.response ->> 'client' AS client, l.response ->> 'calculation' AS calculation`;
const FROM = `FROM ingestion_log l LEFT JOIN api_keys k ON k.id = l.api_key_id LEFT JOIN users u ON u.id = l.actor_id`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get('/', authenticateToken, async (req: any, res) => {
  try {
    const actor = policyActor(req);
    if (!canViewIngestionLog(actor)) return res.status(403).json({ error: DENIED });
    const q = req.query ?? {};
    const params: any[] = [req.user.companyId];
    let where = 'l.company_id = ?' + scopeWhere(actor, params);
    if (['accepted', 'partial', 'rejected'].includes(q.status)) { where += ' AND l.status = ?'; params.push(q.status); }
    if (['api', 'manual', 'upload', 'exporter'].includes(q.channel)) { where += ' AND l.channel = ?'; params.push(q.channel); }
    if (typeof q.source === 'string' && q.source) { where += ' AND ? = ANY(string_to_array(l.source, \', \'))'; params.push(q.source); }
    if (typeof q.teamId === 'string' && q.teamId) { where += ' AND ? = ANY(l.team_ids)'; params.push(q.teamId); }
    if (typeof q.from === 'string' && DATE_RE.test(q.from)) { where += ' AND l.received_at >= ?::date'; params.push(q.from); }
    if (typeof q.to === 'string' && DATE_RE.test(q.to)) { where += " AND l.received_at < ?::date + interval '1 day'"; params.push(q.to); }
    if (typeof q.before === 'string' && q.before) {
      where += ' AND (l.received_at, l.id) < (SELECT received_at, id FROM ingestion_log WHERE id = ?)';
      params.push(q.before);
    }
    const limit = Math.min(Math.max(parseInt(String(q.limit ?? '50'), 10) || 50, 1), 200);
    const rows = await query<any[]>(`SELECT ${COLUMNS} ${FROM} WHERE ${where} ORDER BY l.received_at DESC, l.id DESC LIMIT ${limit + 1}`, params);
    const page = rows.slice(0, limit);
    const teamIds = Array.from(new Set(page.flatMap((r: any) => r.team_ids ?? [])));
    const teams = teamIds.length
      ? await query<any[]>('SELECT id, name FROM teams WHERE company_id = ? AND id = ANY(?::text[])', [req.user.companyId, teamIds])
      : [];
    const teamName = new Map(teams.map((t: any) => [t.id, t.name]));
    // Requests whose calculation was queued (server/lib/calc/queue.ts): still pending, failed, or done.
    const queuedTeams = Array.from(new Set(page.filter((r: any) => r.calculation === 'queued').flatMap((r: any) => r.team_ids ?? [])));
    const waiting = queuedTeams.length
      ? await query<any[]>(
        `SELECT team_id, status, enqueued_at FROM calc_queue WHERE company_id = ? AND team_id = ANY(?::text[])
            AND (status IN ('pending', 'running') OR (status = 'failed' AND updated_at > now() - interval '30 days'))`, [req.user.companyId, queuedTeams]).catch(() => [] as any[])
      : [];
    const calculationOf = (r: any): 'pending' | 'failed' | 'done' | null => {
      if (r.calculation !== 'queued') return null;
      const mine = waiting.filter((w: any) => (r.team_ids ?? []).includes(w.team_id) && new Date(w.enqueued_at).getTime() <= new Date(r.received_at).getTime() + 5 * 60_000);
      if (mine.some((w: any) => w.status === 'pending' || w.status === 'running')) return 'pending';
      return mine.some((w: any) => w.status === 'failed') ? 'failed' : 'done';
    };
    res.json({
      entries: page.map((r: any) => ({ ...r, calculation: calculationOf(r), teams: (r.team_ids ?? []).map((id: string) => ({ id, name: teamName.get(id) ?? id })) })),
      nextBefore: rows.length > limit ? page[page.length - 1].id : null,
    });
  } catch (error) {
    console.error('Ingestion log error:', error);
    res.status(500).json({ error: 'Failed to load the ingestion log' });
  }
});

router.get('/sources', authenticateToken, async (req: any, res) => {
  try {
    const actor = policyActor(req);
    if (!canViewIngestionLog(actor)) return res.status(403).json({ error: DENIED });
    const params: any[] = [req.user.companyId];
    const where = 'l.company_id = ?' + scopeWhere(actor, params);
    const rows = await query<any[]>(
      `WITH s AS (
         SELECT l.*, trim(src) AS one_source
           FROM ingestion_log l, unnest(string_to_array(COALESCE(l.source, 'unknown'), ',')) AS src
          WHERE ${where}
       )
       SELECT one_source AS source,
              max(received_at) AS last_received_at,
              max(received_at) FILTER (WHERE status <> 'rejected') AS last_accepted_at,
              (array_agg(status ORDER BY received_at DESC))[1] AS last_status,
              count(*) FILTER (WHERE received_at >= now() - interval '7 days' AND status = 'accepted')::int AS accepted_7d,
              count(*) FILTER (WHERE received_at >= now() - interval '7 days' AND status = 'partial')::int AS partial_7d,
              count(*) FILTER (WHERE received_at >= now() - interval '7 days' AND status = 'rejected')::int AS rejected_7d,
              COALESCE(sum(value_count) FILTER (WHERE received_at >= now() - interval '7 days'), 0)::int AS values_7d
         FROM s
        GROUP BY one_source
        ORDER BY max(received_at) DESC`,
      params
    );
    res.json({ sources: rows });
  } catch (error) {
    console.error('Ingestion sources error:', error);
    res.status(500).json({ error: 'Failed to load the ingestion sources' });
  }
});

router.get('/:id', authenticateToken, async (req: any, res) => {
  try {
    const actor = policyActor(req);
    if (!canViewIngestionLog(actor)) return res.status(403).json({ error: DENIED });
    const row = await queryOne<any>(`SELECT ${COLUMNS}, l.response ${FROM} WHERE l.id = ? AND l.company_id = ?`, [req.params.id, req.user.companyId]);
    if (!row || !canViewIngestionEntry(actor, row)) return res.status(404).json({ error: 'Entry not found' });
    res.json({ entry: row });
  } catch (error) {
    console.error('Ingestion entry error:', error);
    res.status(500).json({ error: 'Failed to load the entry' });
  }
});

export default router;
