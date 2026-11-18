import React, { useState } from 'react';
import { cx } from './ui';
import MetricInfoModal from './MetricInfoModal';
import type { FieldSources } from './MetricInfoModal';
import { getMetricCatalogEntry } from '../data/metricCatalog';
import type { MetricCatalogKey } from '../data/metricCatalog';

export interface MetricInfoTriggerProps {
  /** Usually the "Show formulas & data sources" switch (useShowFormulas) for an allowed role. */
  enabled: boolean;
  metricKey: MetricCatalogKey;
  children: React.ReactNode;
  currentValue?: React.ReactNode;
  sources?: FieldSources;
  snapshotDate?: string | null;
  teamId?: string;
  context?: string;
  /**
   * 'card' (default): the whole container is one button (Enter / Space), for tiles and cards.
   * 'section': for large containers with their own content (tables, lists). The container is
   * clickable with the mouse, and a real "Details" button in the corner is the keyboard and
   * screen-reader entry point, so the content keeps its own semantics.
   * 'chip': only the "Details" button opens the dialog (for containers that already do
   * something on click).
   */
  variant?: 'card' | 'section' | 'chip';
  /** Classes for the wrapper (e.g. grid placement). */
  className?: string;
}

const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [role="switch"], [role="tab"]';

/**
 * Makes a metric container open its MetricInfoModal while `enabled` is true. When disabled it
 * returns its child unchanged: no wrapper, no handlers.
 */
const MetricInfoTrigger: React.FC<MetricInfoTriggerProps> = ({
  enabled,
  metricKey,
  children,
  currentValue,
  sources,
  snapshotDate,
  teamId,
  context,
  variant = 'card',
  className,
}) => {
  const [open, setOpen] = useState(false);
  if (!enabled) return <>{children}</>;

  const title = getMetricCatalogEntry(metricKey)?.title ?? metricKey;
  const label = `${title}: how it is calculated and where the data comes from`;

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const interactive = target.closest(INTERACTIVE);
    if (interactive && interactive !== e.currentTarget) return;
    // A nested trigger (e.g. a card inside a section) handles its own click.
    if (target.closest('[data-metric-info]') !== e.currentTarget) return;
    // Let people select text without opening the dialog.
    if (window.getSelection()?.toString()) return;
    setOpen(true);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const chipClass =
    'absolute -top-2.5 right-3 z-10 inline-flex h-5 items-center gap-1 rounded-full border border-brand-200 bg-white px-2 text-[10px] font-semibold uppercase tracking-wide text-brand-700 ' +
    'dark:border-brand-800 dark:bg-slate-900 dark:text-brand-300';
  const chipContent = (
    <>
      <span className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-brand-700 font-serif text-[8px] font-bold normal-case italic text-white dark:bg-brand-400 dark:text-slate-900" aria-hidden="true">i</span>
      Details
    </>
  );

  const wrapperClass = cx(
    'group/metric-info relative rounded-lg outline-none transition-shadow [&>*:first-child]:h-full',
    variant !== 'chip' && 'cursor-pointer hover:ring-2 hover:ring-brand-300 dark:hover:ring-brand-700',
    className,
  );

  return (
    <>
      {variant === 'card' ? (
        <div
          role="button"
          tabIndex={0}
          aria-haspopup="dialog"
          aria-label={label}
          data-metric-info={metricKey}
          className={wrapperClass}
          onClick={onClick}
          onKeyDown={onKeyDown}
        >
          {children}
          <span className={cx(chipClass, 'pointer-events-none')} aria-hidden="true">{chipContent}</span>
        </div>
      ) : (
        <div data-metric-info={metricKey} className={wrapperClass} onClick={variant === 'section' ? onClick : undefined}>
          {children}
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label={label}
            onClick={(e) => { e.stopPropagation(); setOpen(true); }}
            className={cx(chipClass, 'cursor-pointer hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-slate-800')}
          >
            {chipContent}
          </button>
        </div>
      )}
      <MetricInfoModal
        open={open}
        onClose={() => setOpen(false)}
        metricKey={metricKey}
        currentValue={currentValue}
        sources={sources}
        snapshotDate={snapshotDate}
        teamId={teamId}
        context={context}
      />
    </>
  );
};

export default MetricInfoTrigger;
