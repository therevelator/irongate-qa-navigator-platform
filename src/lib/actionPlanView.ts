/**
 * Team detail → Action plan: how the tracked actions are grouped and which groups are open.
 * Groups in the order Open, In progress, Done, Dropped; Open and In progress are expanded by
 * default, Done and Dropped collapsed. The section and group state is remembered per person in
 * this browser (localStorage key per user id).
 */

export type ActionStatus = 'open' | 'in_progress' | 'done' | 'dropped';
export const ACTION_GROUP_ORDER: ActionStatus[] = ['open', 'in_progress', 'done', 'dropped'];

export interface ActionPlanViewState {
  /** The whole section is expanded. */
  section: boolean;
  groups: Record<ActionStatus, boolean>;
}

export const DEFAULT_ACTION_PLAN_VIEW: ActionPlanViewState = {
  section: true,
  groups: { open: true, in_progress: true, done: false, dropped: false },
};

export const actionPlanViewKey = (userId: string | number | null | undefined) => `irongate_action_plan_view:${userId ?? 'anonymous'}`;

/** A stored value as a view state; unknown or missing parts take the defaults. */
export function parseActionPlanView(raw: string | null | undefined): ActionPlanViewState {
  const d = DEFAULT_ACTION_PLAN_VIEW;
  if (!raw) return { section: d.section, groups: { ...d.groups } };
  try {
    const v = JSON.parse(raw);
    const bool = (x: unknown, fallback: boolean) => (typeof x === 'boolean' ? x : fallback);
    const groups = { ...d.groups };
    for (const s of ACTION_GROUP_ORDER) groups[s] = bool(v?.groups?.[s], d.groups[s]);
    return { section: bool(v?.section, d.section), groups };
  } catch {
    return { section: d.section, groups: { ...d.groups } };
  }
}

/** Items per status in the group order (every group present, possibly empty); order kept. */
export function groupByStatus<T extends { status: string }>(items: readonly T[]): Array<{ status: ActionStatus; items: T[] }> {
  return ACTION_GROUP_ORDER.map((status) => ({ status, items: items.filter((a) => a.status === status) }));
}
