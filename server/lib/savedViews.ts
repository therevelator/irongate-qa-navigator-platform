/**
 * Saved views (table saved_views): a named set of choices for the dashboard, an analytics module
 * or the team comparison, per user, optionally shared with the company by a super_admin.
 *
 * A view stores CHOICES only (filters, scope, sort, grid density, compared teams), never data:
 * opening a view re-runs the normal, scope-checked requests, so a shared view never shows anyone
 * more than their own scope (teams outside it are left out when the view is applied, and the API
 * refuses them anyway). The state is validated here against a whitelist per kind; anything else
 * is rejected with 400.
 *
 * Who may do what: server/lib/userPolicy.ts (canSeeSavedView, canEditSavedView,
 * canDeleteSavedView, canShareSavedView, canUnshareSavedView).
 */

export const SAVED_VIEW_KINDS = ['dashboard', 'analytics', 'compare'] as const;
export type SavedViewKind = (typeof SAVED_VIEW_KINDS)[number];

/** Analytics modules a view can be saved for (App.tsx view ids). */
export const ANALYTICS_MODULES = [
  'features', 'flaky-test-intelligence', 'technical-debt', 'pipeline-visualization', 'business-impact', 'performance-metrics',
  'developer-productivity', 'test-execution-timeline', 'team-gamification', 'pdf-report-generator',
] as const;

export const MAX_VIEWS_PER_KIND = 50;
export const MAX_NAME = 80;
const MAX_STATE_BYTES = 2048;

const DASHBOARD_FILTERS = ['all', 'high', 'attention'];
const DASHBOARD_SORTS = ['qa', 'name', 'department', 'coverage', 'flakiness', 'escapeRate', 'automation', 'deploys'];

export class SavedViewError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number, field: string): string => {
  if (typeof v !== 'string' || v.length > max) throw new SavedViewError(400, `${field} must be text of at most ${max} characters`);
  return v;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], field: string): T => {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw new SavedViewError(400, `${field} must be one of ${allowed.join(', ')}`);
  return v as T;
};
const id = (v: unknown, field: string) => str(v, 64, field);

export function validateName(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) throw new SavedViewError(400, 'Give the view a name');
  const name = v.trim().replace(/\s+/g, ' ');
  if (name.length > MAX_NAME) throw new SavedViewError(400, `The name can be at most ${MAX_NAME} characters`);
  return name;
}

export function validateKind(v: unknown): SavedViewKind {
  return oneOf(v, SAVED_VIEW_KINDS, 'kind');
}

export function validateModule(kind: SavedViewKind, v: unknown): string | null {
  if (kind !== 'analytics') {
    if (v !== undefined && v !== null && v !== '') throw new SavedViewError(400, 'module is only used by analytics views');
    return null;
  }
  return oneOf(v, ANALYTICS_MODULES, 'module');
}

/**
 * The state of a view, reduced to the known fields of its kind. Team ids it holds are returned
 * separately so the caller can check them against the analytics scope.
 */
export function validateState(kind: SavedViewKind, v: unknown): { state: Record<string, unknown>; teamIds: string[] } {
  if (!isObj(v)) throw new SavedViewError(400, 'state must be an object');
  if (JSON.stringify(v).length > MAX_STATE_BYTES) throw new SavedViewError(400, 'state is too large');
  const out: Record<string, unknown> = {};
  const teamIds: string[] = [];
  const allowed: Record<SavedViewKind, string[]> = {
    dashboard: ['filter', 'search', 'department', 'sort', 'view', 'columns'],
    analytics: ['departmentId', 'teamId'],
    compare: ['teamIds', 'days', 'onlyDifferences'],
  };
  for (const k of Object.keys(v)) {
    if (!allowed[kind].includes(k)) throw new SavedViewError(400, `Unknown field in state: ${k.slice(0, 40)}`);
  }
  if (kind === 'dashboard') {
    if (v.filter !== undefined) out.filter = oneOf(v.filter, DASHBOARD_FILTERS, 'filter');
    if (v.search !== undefined) out.search = str(v.search, 80, 'search');
    if (v.department !== undefined) out.department = str(v.department, 120, 'department');
    if (v.sort !== undefined) {
      if (!isObj(v.sort)) throw new SavedViewError(400, 'sort must be { key, dir }');
      out.sort = { key: oneOf(v.sort.key, DASHBOARD_SORTS, 'sort.key'), dir: oneOf(v.sort.dir, ['asc', 'desc'], 'sort.dir') };
    }
    if (v.view !== undefined) out.view = oneOf(v.view, ['grid', 'list'], 'view');
    if (v.columns !== undefined) {
      if (![1, 2, 3].includes(v.columns as number)) throw new SavedViewError(400, 'columns must be 1, 2 or 3');
      out.columns = v.columns;
    }
  } else if (kind === 'analytics') {
    if (v.departmentId !== undefined && v.departmentId !== null) out.departmentId = id(v.departmentId, 'departmentId');
    if (v.teamId === undefined || v.teamId === null) throw new SavedViewError(400, 'An analytics view needs a team');
    out.teamId = id(v.teamId, 'teamId');
    teamIds.push(out.teamId as string);
  } else {
    if (!Array.isArray(v.teamIds)) throw new SavedViewError(400, 'teamIds must be a list');
    const ids = [...new Set(v.teamIds.map((x, i) => id(x, `teamIds[${i}]`)))];
    if (ids.length < 2 || ids.length > 4) throw new SavedViewError(400, 'A comparison view holds 2 to 4 teams');
    out.teamIds = ids;
    teamIds.push(...ids);
    if (v.days !== undefined) {
      if (!Number.isInteger(v.days) || (v.days as number) < 7 || (v.days as number) > 90) throw new SavedViewError(400, 'days must be 7 to 90');
      out.days = v.days;
    }
    if (v.onlyDifferences !== undefined) {
      if (typeof v.onlyDifferences !== 'boolean') throw new SavedViewError(400, 'onlyDifferences must be true or false');
      out.onlyDifferences = v.onlyDifferences;
    }
  }
  return { state: out, teamIds };
}
