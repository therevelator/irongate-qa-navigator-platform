import React, { useId } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cx, inputClass } from './ui';
import { PAGE_SIZES, pageNumbers, rangeText, type PageSlice } from '../lib/pagination';

/**
 * Shared pager for client-side lists (src/lib/pagination.ts): "Showing 6–10 of 24", a page-size
 * selector (5 / 10 / 20), previous / next and page numbers (the current one marked with
 * aria-current). Previous / next and the numbers only appear when there is more than one page.
 */
const Pagination: React.FC<{
  slice: Pick<PageSlice<unknown>, 'page' | 'pageCount' | 'from' | 'to' | 'total'>;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  /** What is paged, for the labels ("Done actions"). */
  label: string;
  sizes?: readonly number[];
  testId?: string;
  className?: string;
}> = ({ slice, pageSize, onPage, onPageSize, label, sizes = PAGE_SIZES, testId, className }) => {
  const sizeId = useId();
  const btn = 'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800';
  return (
    <div className={cx('flex flex-col gap-2 text-xs text-slate-600 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between', className)} data-testid={testId}>
      <div className="flex items-center gap-3">
        <span aria-live="polite" data-testid={testId ? `${testId}-range` : undefined}>{rangeText(slice)}</span>
        <label htmlFor={sizeId} className="flex items-center gap-1.5">
          Per page
          <select
            id={sizeId}
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className={cx(inputClass, 'h-8 w-16 px-2 text-xs')}
            data-testid={testId ? `${testId}-size` : undefined}
          >
            {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      {slice.pageCount > 1 && (
        <nav aria-label={`${label}, pages`} className="flex flex-wrap items-center gap-1">
          <button type="button" className={btn} onClick={() => onPage(slice.page - 1)} disabled={slice.page <= 1} aria-label="Previous page" data-testid={testId ? `${testId}-prev` : undefined}>
            <ChevronLeft size={14} aria-hidden /> Previous
          </button>
          {pageNumbers(slice.page, slice.pageCount).map((n, i) => (n === 'gap'
            ? <span key={`gap-${i}`} className="px-1 text-slate-500 dark:text-slate-400" aria-hidden>…</span>
            : (
              <button
                key={n}
                type="button"
                className={cx(btn, n === slice.page && 'bg-slate-900 text-white hover:bg-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-100')}
                aria-current={n === slice.page ? 'page' : undefined}
                aria-label={`Page ${n}`}
                onClick={() => onPage(n)}
              >
                {n}
              </button>
            )))}
          <button type="button" className={btn} onClick={() => onPage(slice.page + 1)} disabled={slice.page >= slice.pageCount} aria-label="Next page" data-testid={testId ? `${testId}-next` : undefined}>
            Next <ChevronRight size={14} aria-hidden />
          </button>
        </nav>
      )}
    </div>
  );
};

export default Pagination;
