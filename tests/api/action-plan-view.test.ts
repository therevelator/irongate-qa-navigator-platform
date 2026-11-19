import { pageCount, pageNumbers, paginate, rangeText, DEFAULT_PAGE_SIZE, PAGE_SIZES } from '../../src/lib/pagination';
import { actionPlanViewKey, groupByStatus, parseActionPlanView, DEFAULT_ACTION_PLAN_VIEW } from '../../src/lib/actionPlanView';

/**
 * Team detail → Action plan: grouping by status, default expanded groups, the remembered view
 * (src/lib/actionPlanView.ts) and the shared pagination (src/lib/pagination.ts). Pure functions.
 */
describe('action plan view', () => {
  it('APV-001: groups in the order Open, In progress, Done, Dropped, each present even when empty', () => {
    const items = [{ id: 1, status: 'done' }, { id: 2, status: 'open' }, { id: 3, status: 'dropped' }, { id: 4, status: 'done' }];
    const g = groupByStatus(items);
    expect(g.map((x) => [x.status, x.items.map((i) => i.id)])).toEqual([['open', [2]], ['in_progress', []], ['done', [1, 4]], ['dropped', [3]]]);
  });

  it('APV-002: Open and In progress expanded, Done and Dropped collapsed, the section expanded by default', () => {
    expect(DEFAULT_ACTION_PLAN_VIEW).toEqual({ section: true, groups: { open: true, in_progress: true, done: false, dropped: false } });
    expect(parseActionPlanView(null)).toEqual(DEFAULT_ACTION_PLAN_VIEW);
    expect(parseActionPlanView('not json')).toEqual(DEFAULT_ACTION_PLAN_VIEW);
  });

  it('APV-003: a stored view is read back; unknown or wrong-typed parts keep the defaults', () => {
    expect(parseActionPlanView(JSON.stringify({ section: false, groups: { done: true, open: 'yes' } })))
      .toEqual({ section: false, groups: { open: true, in_progress: true, done: true, dropped: false } });
  });

  it('APV-004: the view is remembered per person', () => {
    expect(actionPlanViewKey('u1')).not.toBe(actionPlanViewKey('u2'));
  });
});

describe('pagination', () => {
  const items = Array.from({ length: 24 }, (_, i) => i + 1);

  it('PAG-001: page sizes 5 / 10 / 20, default 5', () => {
    expect([...PAGE_SIZES]).toEqual([5, 10, 20]);
    expect(DEFAULT_PAGE_SIZE).toBe(5);
  });

  it('PAG-002: slices a page and describes its range ("Showing 6–10 of 24")', () => {
    const s = paginate(items, 2, 5);
    expect(s.items).toEqual([6, 7, 8, 9, 10]);
    expect(rangeText(s)).toBe('Showing 6–10 of 24');
    expect(rangeText(paginate(items, 5, 5))).toBe('Showing 21–24 of 24');
    expect(rangeText(paginate([], 1, 5))).toBe('Showing 0 of 0');
  });

  it('PAG-003: pages are clamped (a list that shrank shows its last page)', () => {
    expect(paginate(items, 99, 10).page).toBe(3);
    expect(paginate(items, 0, 10).page).toBe(1);
    expect(pageCount(0, 5)).toBe(1);
    expect(pageCount(24, 20)).toBe(2);
  });

  it('PAG-004: page numbers: all up to 7 pages, else first, last and the neighbours with gaps', () => {
    expect(pageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageNumbers(6, 12)).toEqual([1, 'gap', 5, 6, 7, 'gap', 12]);
    expect(pageNumbers(1, 12)).toEqual([1, 2, 'gap', 12]);
  });
});
