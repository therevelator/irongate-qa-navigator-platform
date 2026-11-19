import { query } from '../../src/lib/db';
import { activityLabel, CATEGORY_LABELS } from './activityLabels';

/**
 * Reading the user activity log (one company): the customer screen (super admins) and the
 * platform operator panel use this same query, filters and labels.
 */

export interface ActivityFilters {
  userId?: string | null;
  from?: string | null;
  to?: string | null;
  /** sign_in (sign-ins), view (API views and screens), change, export, ingest, failed. */
  type?: string | null;
  teamId?: string | null;
  entityId?: string | null;
  errorsOnly?: boolean;
  requestId?: string | null;
  /** Cursor: the id of the last row of the previous page. */
  before?: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function filtersFromQuery(q: any): ActivityFilters {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const id = (v: unknown) => { const s = str(v); return s && ID.test(s) ? s : null; };
  const day = (v: unknown) => { const s = str(v); return s && DAY.test(s) ? s : null; };
  return {
    userId: id(q?.userId), from: day(q?.from), to: day(q?.to), type: str(q?.type),
    teamId: id(q?.teamId), entityId: id(q?.entityId), errorsOnly: q?.errors === 'true',
    requestId: str(q?.requestId) && /^[A-Za-z0-9._:-]{4,64}$/.test(String(q.requestId).trim()) ? String(q.requestId).trim() : null,
    before: id(q?.before),
  };
}

const TYPE_SQL: Record<string, string> = {
  sign_in: "a.category = 'sign_in'",
  view: "a.category IN ('view', 'screen')",
  change: "a.category = 'change'",
  export: "a.category = 'export'",
  ingest: "a.category = 'ingest'",
  failed: "(a.category = 'sign_in_failed' OR a.status >= 400)",
};
export const ACTIVITY_TYPES = Object.keys(TYPE_SQL);

export async function listUserActivity(companyId: string, f: ActivityFilters, limit: number) {
  const params: any[] = [companyId];
  let where = 'a.company_id = ?';
  if (f.userId) { where += ' AND a.user_id = ?'; params.push(f.userId); }
  if (f.from) { where += ' AND a.created_at >= ?::date'; params.push(f.from); }
  if (f.to) { where += " AND a.created_at < ?::date + interval '1 day'"; params.push(f.to); }
  if (f.type && TYPE_SQL[f.type]) where += ` AND ${TYPE_SQL[f.type]}`;
  if (f.teamId) { where += ' AND a.team_id = ?'; params.push(f.teamId); }
  if (f.entityId) { where += ' AND (a.entity_id = ? OR a.team_id = ?)'; params.push(f.entityId, f.entityId); }
  if (f.errorsOnly) where += ' AND a.status >= 400';
  if (f.requestId) { where += ' AND a.request_id = ?'; params.push(f.requestId); }
  if (f.before) {
    where += ' AND (a.created_at, a.id) < (SELECT created_at, id FROM user_activity WHERE id = ? AND company_id = ?)';
    params.push(f.before, companyId);
  }
  const n = Math.min(Math.max(limit, 1), 10_000);
  const rows = await query<any[]>(
    `SELECT a.id, a.created_at, a.user_id, a.api_key_id, a.actor_display, a.category, a.method, a.route, a.screen,
            a.team_id, t.name AS team_name, a.entity_type, a.entity_id, a.status, a.duration_ms, a.ip, a.user_agent, a.request_id
       FROM user_activity a
       LEFT JOIN teams t ON t.id = a.team_id AND t.company_id = a.company_id
      WHERE ${where}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${n + 1}`,
    params,
  );
  const page = rows.slice(0, n).map((r: any) => ({ ...r, label: activityLabel(r), categoryLabel: CATEGORY_LABELS[r.category] ?? r.category }));
  return { entries: page, nextBefore: rows.length > n ? page[page.length - 1].id : null };
}

export async function userActivityFacets(companyId: string) {
  const users = await query<any[]>(
    `SELECT u.id, NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS name, u.email
       FROM users u WHERE u.company_id = ? ORDER BY 2 NULLS LAST, u.email LIMIT 1000`,
    [companyId],
  );
  const teams = await query<any[]>('SELECT id, name FROM teams WHERE company_id = ? ORDER BY name LIMIT 1000', [companyId]);
  return { users, teams, types: ACTIVITY_TYPES.map((t) => ({ value: t, label: t === 'failed' ? 'Failed' : CATEGORY_LABELS[t] ?? t })) };
}
