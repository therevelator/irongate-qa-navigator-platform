/**
 * Test management connectors (TestRail, Xray, Zephyr Scale): what they send. A test case is its key, whether it is
 * automated, and its manual estimate when the tool has one; a test execution is its key, the case, whether the run
 * was automated, its result, when it ran and how long. No title, step, precondition, comment, attachment or person.
 * QE Navigator calculates automation coverage and automation ROI from them; nothing is calculated here.
 */
import type { CiRecord } from '../ci/common';

const iso = (t: number) => new Date(t).toISOString();

export function testCase(team: string, source: string, c: { key: string; automated: boolean; manualEstimateSeconds?: number | null; archived?: boolean; updatedAt?: number | null }): CiRecord {
  const est = c.manualEstimateSeconds;
  return { kind: 'test-management', team, id: `tm:${source}:case:${c.key}`, at: c.updatedAt ?? null, item: {
    type: 'case', key: c.key.slice(0, 200), automated: c.automated, ...(typeof est === 'number' && est > 0 ? { manualEstimateSeconds: Math.round(est) } : {}),
    ...(c.archived ? { archived: true } : {}), ...(c.updatedAt ? { updatedAt: iso(c.updatedAt) } : {}),
  } };
}

export function testExecution(team: string, source: string, e: { key: string; caseKey: string; automated: boolean; status?: string | null; executedAt: number; durationSeconds?: number | null }): CiRecord {
  const d = e.durationSeconds;
  return { kind: 'test-management', team, id: `tm:${source}:exec:${e.key}`, at: e.executedAt, item: {
    type: 'execution', key: e.key.slice(0, 200), case: e.caseKey.slice(0, 200), automated: e.automated, ...(e.status ? { status: String(e.status).toLowerCase().slice(0, 40) } : {}),
    executedAt: iso(e.executedAt), ...(typeof d === 'number' && d >= 0 ? { durationSeconds: Math.round(d) } : {}),
  } };
}

/** A time span such as "1h 30m", "45m", "1d 2h", "30s" (TestRail estimates and elapsed times; a day is 8 hours) in seconds, or null. */
export function spanSeconds(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v >= 0 ? v : null;
  if (typeof v !== 'string' || !v.trim()) return null;
  let total = 0;
  let any = false;
  for (const m of v.matchAll(/(\d+(?:\.\d+)?)\s*(w|d|h|m|s)[a-z]*/gi)) {
    any = true;
    total += Number(m[1]) * ({ w: 5 * 8 * 3600, d: 8 * 3600, h: 3600, m: 60, s: 1 } as Record<string, number>)[m[2].toLowerCase()];
  }
  return any ? Math.round(total) : null;
}
