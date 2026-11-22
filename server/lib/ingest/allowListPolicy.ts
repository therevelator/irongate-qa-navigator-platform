/**
 * The field allow-list (fieldAllowList.ts: plain data and a pure minimise(), vendored byte for byte into
 * the QE Navigator Collector by collector/scripts/sync-allow-list.mjs) as the server applies it to the records it
 * builds itself: file uploads (CSV rows, vendor JSON) and the copy of API requests kept in raw_uploads.
 * Here only what the server adds around it: the salt (the company id), the company setting "Store issue
 * and incident titles", and the preview's wording of what was dropped.
 */
import {
  ALWAYS_DROPPED, FIELD_ALLOW_LIST, formulaSafe, hashPerson, minimise, storedFieldNames, usefulLabel, type MinimiseKind,
} from './fieldAllowList';

export { ALWAYS_DROPPED, FIELD_ALLOW_LIST, formulaSafe, hashPerson, minimise, storedFieldNames, usefulLabel };
export type AllowKind = Exclude<MinimiseKind, 'sprint'>;

const PEOPLE = new Set(['assignee', 'assigneeEmail', 'assignee_email', 'assignedTo', 'reporter', 'reporterEmail', 'reporter_email', 'creator', 'createdBy', 'author',
  'responder', 'resolvedBy', 'acknowledgedBy', 'owner']);

/** minimise with the server's options, and the dropped input fields worded for the preview. */
export function minimiseRecord(kind: AllowKind, rec: Record<string, unknown>, opts: { salt: string; storeTitles: boolean }): { record: Record<string, unknown>; dropped: string[] } {
  const m = minimise(kind, rec, { storeTitles: opts.storeTitles, salt: opts.salt });
  const record = Object.fromEntries(Object.entries(m.record).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)));
  const dropped = m.dropped
    .filter((k) => { const v = rec[k]; return v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length); })
    .map((k) => (PEOPLE.has(k) ? `${k} (stored as a salted hash only)` : k));
  if (Array.isArray(rec.labels) && (rec.labels as unknown[]).length > ((record.labels as unknown[] | undefined)?.length ?? 0)) dropped.push('labels that name neither an environment nor a type');
  return { record, dropped };
}

/** A sprint on its own (sprints template, sprints listed without issues). */
export function minimiseSprint(rec: Record<string, unknown>): Record<string, unknown> | null {
  const r = minimise('sprint', rec).record;
  return Object.keys(r).length ? Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== undefined)) : null;
}

/** The fields a minimised record of this kind may carry (the preview's "fields that will be stored"). */
export const allowedFields = (kind: MinimiseKind, storeTitles: boolean) => storedFieldNames(kind, { storeTitles, salt: 'server' });
