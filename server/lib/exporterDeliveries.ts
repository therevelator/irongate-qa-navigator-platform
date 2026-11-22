/**
 * Operator log of Exporter deliveries (table exporter_deliveries, migration 20261205000000): one row per request to
 * POST /api/ingest/exporter/batch, accepted or rejected (a bad key too, with the key's prefix only), for the
 * platform operator panel (Operator → Exporter deliveries). Companies never read this table; they see their own
 * batches in their ingestion log.
 *
 * What is kept: when, the company / department / team (as validated, and as claimed when they differ), the API key's
 * name and prefix (never the key), the Exporter's version and host label, the source tool, the kind, the item count,
 * the date range of the records, the size (as received and uncompressed), the Idempotency-Key, dry run or not, the
 * result with a reason code, the records stored, and a sanitised preview: the first 20 items after the field
 * allow-list, with file contents reduced to name, size and hash, people and links dropped, at most 64 KB.
 * Kept 30 days (cleanupOperationalLogs, server/lib/opsLog.ts). Writing a row never fails a request.
 */
import { createHash } from 'crypto';
import { query } from '../../src/lib/db';
import { minimise } from './ingest/fieldAllowList';

export const DELIVERY_RETENTION_DAYS = 30;
export const PREVIEW_ITEMS = 20;
export const PREVIEW_MAX_BYTES = 64 * 1024;

export type DeliveryResult = 'accepted' | 'duplicate' | 'partial' | 'rejected';

export interface DeliveryRow {
  companyId: string | null;
  departmentId?: string | null;
  teamId?: string | null;
  claimed?: { companyId?: unknown; departmentId?: unknown; teamId?: unknown } | null;
  apiKeyId?: string | null;
  apiKeyName?: string | null;
  apiKeyPrefix?: string | null;
  exporterVersion?: string | null;
  hostLabel?: string | null;
  source?: string | null;
  kind?: string | null;
  items?: unknown[] | null;
  bytesReceived?: number | null;
  bytesRaw?: number | null;
  idempotencyKey?: string | null;
  dryRun: boolean;
  result: DeliveryResult;
  reasonCode?: string | null;
  reason?: string | null;
  httpStatus: number;
  recordsStored?: number;
}

const s = (v: unknown, max: number) => (typeof v === 'string' && v ? v.slice(0, max) : null);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SECRET_KEY = /(token|secret|password|passwd|api_?key|apikey|authorization|cookie|credential|salt)/i;
const DROP_KEY = /^(url|link|links|web_?url|html_?url|author|authorName|authorEmail|committer|email|user|creator|assignee|reporter|actor|message|description|body|comment|comments|notes)$/i;
const TIME_KEYS = ['startedAt', 'finishedAt', 'createdAt', 'openedAt', 'resolvedAt', 'updatedAt', 'authoredAt', 'committedAt', 'at'];

/** A value with no credential, no e-mail address, no link and no person in it; strings capped. */
function clean(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return v.replace(EMAIL, '[email]').slice(0, 300);
  if (v === null || typeof v !== 'object') return v;
  if (depth > 5) return '[…]';
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => clean(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (SECRET_KEY.test(k) || DROP_KEY.test(k)) continue;
    out[k] = clean(x, depth + 1);
  }
  return out;
}

/** One item as the preview shows it: report files as name, size and hash; issues and incidents after the field allow-list. */
export function previewItem(kind: string | null | undefined, item: unknown): unknown {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const o = item as Record<string, unknown>;
  if (kind === 'test-report' || kind === 'coverage' || kind === 'sarif') {
    const files = Array.isArray(o.files) ? o.files : [];
    const { files: _f, diff, changedLines, ...rest } = o;
    return {
      ...(clean(rest) as object),
      files: files.slice(0, 50).map((f: any) => ({
        name: typeof f?.name === 'string' ? f.name.slice(0, 255) : null,
        bytes: typeof f?.content === 'string' ? Buffer.byteLength(f.content) : 0,
        sha256: typeof f?.content === 'string' ? createHash('sha256').update(f.content).digest('hex').slice(0, 16) : null,
      })),
      ...(diff !== undefined ? { diffBytes: typeof diff === 'string' ? Buffer.byteLength(diff) : 0 } : {}),
      ...(changedLines !== undefined ? { changedLinesBytes: typeof changedLines === 'string' ? Buffer.byteLength(changedLines) : 0 } : {}),
    };
  }
  if (kind === 'issues') return clean(minimise('issue', o, { storeTitles: false, salt: null }).record);
  if (kind === 'incidents') return clean(minimise('incident', o, { storeTitles: false, salt: null }).record);
  return clean(o);
}

/** The first PREVIEW_ITEMS items, sanitised, within PREVIEW_MAX_BYTES. */
export function sanitisedPreview(kind: string | null | undefined, items: unknown[] | null | undefined): { items: unknown[]; shown: number; total: number } | null {
  if (!Array.isArray(items) || !items.length) return null;
  const list = items.slice(0, PREVIEW_ITEMS).map((x) => previewItem(kind, x));
  while (list.length > 1 && Buffer.byteLength(JSON.stringify(list)) > PREVIEW_MAX_BYTES) list.pop();
  if (Buffer.byteLength(JSON.stringify(list)) > PREVIEW_MAX_BYTES) return { items: [], shown: 0, total: items.length };
  return { items: list, shown: list.length, total: items.length };
}

/** The earliest and latest record time in the items (the usual time fields, one level down for files too). */
export function dateRange(items: unknown[] | null | undefined): { from: string | null; to: string | null } {
  let lo = Infinity;
  let hi = -Infinity;
  const look = (o: unknown, depth: number) => {
    if (!o || typeof o !== 'object' || depth > 2) return;
    if (Array.isArray(o)) { for (const x of o.slice(0, 200)) look(x, depth + 1); return; }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (TIME_KEYS.includes(k) && typeof v === 'string') {
        const t = Date.parse(v);
        if (!Number.isNaN(t)) { lo = Math.min(lo, t); hi = Math.max(hi, t); }
      } else if (k === 'commits' || k === 'stages' || k === 'transitions') look(v, depth + 1);
    }
  };
  if (Array.isArray(items)) for (const it of items.slice(0, 5000)) look(it, 0);
  return { from: Number.isFinite(lo) ? new Date(lo).toISOString() : null, to: Number.isFinite(hi) ? new Date(hi).toISOString() : null };
}

/** qe-exporter/<version> (or qe-collector/<version>) from a User-Agent. */
export const exporterVersionOf = (ua: string | null | undefined) => /^(?:qe-exporter|qe-collector|qe-agent)\/(\d+\.\d+\.\d+[0-9A-Za-z.+-]{0,20})/.exec(String(ua ?? ''))?.[1] ?? null;
/** The host label the Exporter sends (X-Exporter-Host): letters, digits, ".", "-", "_" only, at most 100. */
export const hostLabelOf = (h: unknown) => (typeof h === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(h.trim()) ? h.trim() : null);
/** The prefix of a presented key (the first 12 characters, as Admin console → API keys shows it); never more. */
export const keyPrefixOf = (token: string | null | undefined) => (token ? token.slice(0, 12) : null);

export async function recordDelivery(r: DeliveryRow): Promise<void> {
  try {
    const range = dateRange(r.items);
    const preview = sanitisedPreview(r.kind, r.items);
    const claim = r.claimed ?? {};
    const differs = (v: unknown, actual: string | null | undefined) => (typeof v === 'string' && v !== actual ? v.slice(0, 36) : null);
    await query(
      `INSERT INTO exporter_deliveries (company_id, department_id, team_id, claimed_company_id, claimed_department_id, claimed_team_id,
          api_key_id, api_key_name, api_key_prefix, exporter_version, host_label, source, kind, item_count, records_from, records_to,
          bytes_received, bytes_raw, idempotency_key, dry_run, result, reason_code, reason, http_status, records_stored, preview)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)`,
      [r.companyId, r.departmentId ?? null, r.teamId ?? null,
        differs(claim.companyId, r.companyId), differs(claim.departmentId, r.departmentId), differs(claim.teamId, r.teamId),
        r.apiKeyId ?? null, s(r.apiKeyName, 255), s(r.apiKeyPrefix, 16), s(r.exporterVersion, 40), s(r.hostLabel, 100), s(r.source, 50), s(r.kind, 30),
        Array.isArray(r.items) ? r.items.length : 0, range.from, range.to, r.bytesReceived ?? null, r.bytesRaw ?? null, s(r.idempotencyKey, 200),
        r.dryRun, r.result, s(r.reasonCode, 40), s(r.reason, 500), r.httpStatus, r.recordsStored ?? 0, preview ? JSON.stringify(preview) : null]);
  } catch (e) {
    console.error('exporter_deliveries write failed:', (e as Error)?.message ?? e);
  }
}

/** Retention: rows older than DELIVERY_RETENTION_DAYS are deleted (0 when the table does not exist yet). */
export async function cleanupDeliveries(days = DELIVERY_RETENTION_DAYS): Promise<number> {
  try {
    const r = await query<any[]>(`WITH d AS (DELETE FROM exporter_deliveries WHERE received_at < now() - make_interval(days => ?) RETURNING 1) SELECT COUNT(*)::int AS n FROM d`, [days]);
    return r[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

/** The records a handler's answer says were stored (new or changed). */
export function storedCount(body: any): number {
  if (!body || typeof body !== 'object') return 0;
  if (body.status === 'duplicate' || body.status === 'ignored' || body.status === 'dry-run') return 0;
  for (const k of ['events', 'runs', 'issues']) if (Array.isArray(body[k])) return body[k].filter((x: any) => x && x.status !== 'duplicate').length;
  if (Array.isArray(body.items) && body.items.some((x: any) => x?.status)) return body.items.filter((x: any) => x?.status === 'written').length;
  if (body.status === 'accepted') return 1;
  return 0;
}
