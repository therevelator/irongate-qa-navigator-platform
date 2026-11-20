/**
 * Team detail → Action plan: the "who changed the status, and when" line of an action and its
 * history (src/components/ActionsPanel.tsx). Pure, so it is unit-tested (tests/api/action-history-lib.test.ts).
 *
 * The line comes from the action's latest history entry (GET /api/actions returns the history newest
 * first): "Changed to Dropped by Aisha Rahman on 20th Nov 2026, 10:11 PM", "Created by … on …" when
 * the status was never changed, "… automatically on …" for a change made by the system. Nothing when
 * unknown: no history (rows from before the history was kept), or the latest entry does not lead to
 * the current status. Dates in the viewer's local time zone: ordinal day, short month, year, 12-hour time.
 */

export type ActionStatusKey = 'open' | 'in_progress' | 'done' | 'dropped';

export interface ActionHistoryEntry {
  id: string;
  fromStatus: ActionStatusKey | null;
  toStatus: ActionStatusKey;
  changedBy: { id: string; name: string } | null;
  automatic: boolean;
  changedAt: string;
  note?: string | null;
}

export interface StatusLine {
  kind: 'created' | 'changed';
  status: ActionStatusKey;
  /** The person's name; null for an automatic change or a deleted user (see `automatic`). */
  by: string | null;
  automatic: boolean;
  at: string;
}

const ORDINAL: Record<string, string> = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
const rules = new Intl.PluralRules('en-GB', { type: 'ordinal' });
export const ordinal = (n: number) => `${n}${ORDINAL[rules.select(n)] ?? 'th'}`;

/** "20th Nov 2026, 10:11 PM" in the given time zone (default: the viewer's). */
export function formatChangeTime(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone })
      .formatToParts(d).map((p) => [p.type, p.value])
  ) as Record<string, string>;
  const month = (parts.month ?? '').replace('.', '').slice(0, 3);
  const period = (parts.dayPeriod ?? '').toUpperCase().replace(/\./g, '').replace(/\s/g, '');
  return `${ordinal(Number(parts.day))} ${month} ${parts.year}, ${Number(parts.hour)}:${parts.minute} ${period}`;
}

/** The line to show for an action, or null when the change is unknown. */
export function statusLine(action: { status: ActionStatusKey; history?: ActionHistoryEntry[] | null }): StatusLine | null {
  const last = action.history?.[0];
  if (!last || last.toStatus !== action.status) return null;
  return {
    kind: last.fromStatus === null ? 'created' : 'changed',
    status: last.toStatus,
    by: last.changedBy?.name ?? null,
    automatic: last.automatic,
    at: last.changedAt,
  };
}

/** Who made a change, as words: the name, "automatically", or "a removed user". */
export const byText = (e: { changedBy: { name: string } | null; automatic: boolean }) =>
  e.automatic ? 'automatically' : e.changedBy ? `by ${e.changedBy.name}` : 'by a removed user';
