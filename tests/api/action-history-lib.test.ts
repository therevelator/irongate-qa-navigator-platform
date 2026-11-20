import fs from 'fs';
import path from 'path';
import { byText, formatChangeTime, ordinal, statusLine, type ActionHistoryEntry } from '../../src/lib/actionHistory';
import { MERIDIAN_ACTION_HISTORY_SQL, sampleActionHistorySql } from '../../server/seeds/actionHistory';

/**
 * Pure parts of the action status history (no backend):
 *   AHL-001  the date reads "20th Nov 2026, 10:11 PM" in the given time zone (ordinal day, short month, 12-hour)
 *   AHL-002  the line: created / changed / automatically; nothing for no history or a history that does not
 *            lead to the current status
 *   AHL-003  the Meridian showcase copy of the sample history SQL is the generator's output
 */

const e = (over: Partial<ActionHistoryEntry>): ActionHistoryEntry => ({
  id: 'x', fromStatus: 'open', toStatus: 'dropped', changedBy: { id: 'u1', name: 'Aisha Rahman' }, automatic: false, changedAt: '2026-11-20T22:11:00.000Z', ...over,
});

describe('Action status history (pure)', () => {
  it('AHL-001: ordinal day, short month, year, 12-hour time in the viewer time zone', () => {
    expect(formatChangeTime('2026-11-20T22:11:00Z', 'UTC')).toBe('20th Nov 2026, 10:11 PM');
    expect(formatChangeTime('2026-11-20T22:11:00Z', 'Asia/Tokyo')).toBe('21st Nov 2026, 7:11 AM');
    expect(formatChangeTime('2026-03-02T09:05:00Z', 'UTC')).toBe('2nd Mar 2026, 9:05 AM');
    expect(formatChangeTime('2026-03-23T12:00:00Z', 'UTC')).toBe('23rd Mar 2026, 12:00 PM');
    expect(formatChangeTime('2026-01-11T00:30:00Z', 'UTC')).toBe('11th Jan 2026, 12:30 AM');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st']);
    expect(formatChangeTime('not a date')).toBe('');
  });

  it('AHL-002: created, changed, automatic, removed user; nothing when unknown', () => {
    expect(statusLine({ status: 'dropped', history: [e({})] })).toEqual({ kind: 'changed', status: 'dropped', by: 'Aisha Rahman', automatic: false, at: '2026-11-20T22:11:00.000Z' });
    expect(statusLine({ status: 'open', history: [e({ fromStatus: null, toStatus: 'open' })] })?.kind).toBe('created');
    expect(statusLine({ status: 'done', history: [e({ toStatus: 'done', changedBy: null, automatic: true })] })).toMatchObject({ by: null, automatic: true });
    expect(statusLine({ status: 'done', history: [] })).toBeNull();
    expect(statusLine({ status: 'done' })).toBeNull();
    expect(statusLine({ status: 'done', history: [e({ toStatus: 'in_progress' })] })).toBeNull();
    expect(byText(e({ changedBy: null }))).toBe('by a removed user');
    expect(byText(e({ changedBy: null, automatic: true }))).toBe('automatically');
  });

  it('AHL-003: the showcase SQL carries the generator output; ids fit the column', () => {
    const file = fs.readFileSync(path.join(__dirname, '../../scripts/reseed/showcase-content.sql'), 'utf8');
    expect(file).toContain(MERIDIAN_ACTION_HISTORY_SQL);
    expect(() => sampleActionHistorySql({ where: 'true', idPrefix: 'way-too-long-prefix-' })).toThrow();
  });
});
