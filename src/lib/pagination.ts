/**
 * Client-side pagination (src/components/Pagination.tsx): clamp the page, slice the items and
 * describe the range ("Showing 6–10 of 24"). Pages are 1-based.
 */

export const PAGE_SIZES = [5, 10, 20] as const;
export const DEFAULT_PAGE_SIZE = 5;

export interface PageSlice<T> {
  items: T[];
  page: number;
  pageCount: number;
  /** 1-based index of the first item shown (0 when there are none). */
  from: number;
  /** 1-based index of the last item shown (0 when there are none). */
  to: number;
  total: number;
}

export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, size)));
}

export function paginate<T>(items: readonly T[], page: number, size: number): PageSlice<T> {
  const total = items.length;
  const count = pageCount(total, size);
  const p = Math.min(Math.max(1, Math.floor(page) || 1), count);
  const start = (p - 1) * size;
  const slice = items.slice(start, start + size);
  return { items: slice, page: p, pageCount: count, from: total ? start + 1 : 0, to: total ? start + slice.length : 0, total };
}

export function rangeText(s: Pick<PageSlice<unknown>, 'from' | 'to' | 'total'>): string {
  return s.total === 0 ? 'Showing 0 of 0' : `Showing ${s.from}–${s.to} of ${s.total}`;
}

/** Page numbers to offer: all of them up to 7 pages, else first, last and the current ±1 with gaps. */
export function pageNumbers(current: number, count: number): Array<number | 'gap'> {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const keep = new Set([1, count, current - 1, current, current + 1].filter((n) => n >= 1 && n <= count));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push('gap');
    out.push(n);
  });
  return out;
}
