import React, { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import { Badge, cx } from './ui';
import { describeFieldSource } from './FormulaNote';
import type { FieldSource } from './FormulaNote';
import { DIRECTION_LABEL, KIND_LABEL, getMetricCatalogEntry } from '../data/metricCatalog';
import type { MetricCatalogEntry, MetricCatalogKey } from '../data/metricCatalog';

export type FieldSources = Record<string, FieldSource | null | undefined>;

export interface MetricInfoModalProps {
  open: boolean;
  onClose: () => void;
  metricKey: MetricCatalogKey;
  /** The value as shown on the card, e.g. "78.4 %". */
  currentValue?: React.ReactNode;
  /** kpi_snapshots.field_sources of the team's latest snapshot (GET /api/teams → kpiFieldSources). */
  sources?: FieldSources;
  snapshotDate?: string | null;
  /** Used in the ingestion example instead of "<team id>". */
  teamId?: string;
  /** Who / what the value belongs to, e.g. the team or developer name. */
  context?: string;
}

const sectionHeading = 'mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';
const body = 'text-sm leading-relaxed text-slate-700 dark:text-slate-300';
const muted = 'text-slate-500 dark:text-slate-400';
const codeBlock =
  'overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-slate-800 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200';

const Code: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <code className="break-words rounded bg-slate-100 px-1 py-px font-mono text-[12px] text-slate-800 dark:bg-slate-800 dark:text-slate-200">{children}</code>
);

/** Render `backtick` spans as inline code. */
const withCode = (text: string): React.ReactNode =>
  text.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith('`') && part.endsWith('`') && part.length > 1 ? <Code key={i}>{part.slice(1, -1)}</Code> : <React.Fragment key={i}>{part}</React.Fragment>,
  );

/** One clause per line: split on "; " and on sentence ends. */
const formulaLines = (formula: string): string[] =>
  formula.split(/;\s+(?=[A-Z])|(?<=\.)\s+(?=[A-Z])/).map((l) => l.trim()).filter(Boolean);

const Section: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({ title, children, className }) => (
  <section className={cx('border-t border-slate-100 pt-4 first:border-t-0 first:pt-0 dark:border-slate-800', className)}>
    <h3 className={sectionHeading}>{title}</h3>
    {children}
  </section>
);

const Rows: React.FC<{ rows: Array<[string, React.ReactNode] | null | false> }> = ({ rows }) => (
  <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
    {rows.filter((r): r is [string, React.ReactNode] => Boolean(r)).map(([label, value]) => (
      <React.Fragment key={label}>
        <dt className={cx('text-xs leading-5', muted)}>{label}</dt>
        <dd className="min-w-0 break-words text-slate-800 dark:text-slate-200">{value}</dd>
      </React.Fragment>
    ))}
  </dl>
);

const KIND_TONE = { measured: 'neutral', computed: 'brand', derived: 'warn', container: 'neutral' } as const;

const MetricInfoModal: React.FC<MetricInfoModalProps> = ({ open, onClose, metricKey, currentValue, sources, snapshotDate, teamId, context }) => {
  // Related entries open in place; the card's value only applies to the entry it was opened from.
  const [activeKey, setActiveKey] = useState<MetricCatalogKey>(metricKey);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) setActiveKey(metricKey);
  }, [open, metricKey]);
  useEffect(() => {
    contentRef.current?.parentElement?.scrollTo({ top: 0 });
  }, [activeKey]);

  const entry: MetricCatalogEntry | null = getMetricCatalogEntry(activeKey);
  if (!entry) return null;
  const isOrigin = activeKey === metricKey;

  const sourceText = (col: string) => describeFieldSource(sources?.[col] ?? null, snapshotDate);

  const unitText = entry.unit ? `Unit: ${entry.unit}` : null;
  const subtitle = [entry.kind === 'container' ? null : DIRECTION_LABEL[entry.direction], unitText, isOrigin ? context : null]
    .filter(Boolean)
    .join(' · ');

  const send = entry.howToSendIt;
  const example = send.example && teamId ? send.example.replace('<team id>', teamId) : send.example;

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={entry.title}
      titleAside={<Badge tone={KIND_TONE[entry.kind]}>{KIND_LABEL[entry.kind]}</Badge>}
      subtitle={subtitle || undefined}
      size="prose"
      scrollBody
    >
      <div ref={contentRef} className="space-y-4" data-testid="metric-info-modal" data-metric-key={entry.key}>
        {!isOrigin && (
          <button
            type="button"
            onClick={() => setActiveKey(metricKey)}
            className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
          >
            ← Back to {getMetricCatalogEntry(metricKey)?.title}
          </button>
        )}

        <Section title="Why it matters">
          <p className={body}>{entry.whyItMatters}</p>
        </Section>

        <Section title="How it's calculated">
          <pre className={codeBlock}>{formulaLines(entry.howCalculated).join('\n')}</pre>
          {!!entry.calculationNotes?.length && (
            <ul className="mt-2 space-y-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              {entry.calculationNotes.map((n, i) => (
                <li key={i} className="flex gap-2"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-400 dark:bg-slate-500" aria-hidden />{n}</li>
              ))}
            </ul>
          )}
          {entry.thresholds && (
            <div className="mt-3">
              <Rows
                rows={[
                  entry.thresholds.target ? ['Target', <span className="font-medium">{entry.thresholds.target}</span>] : null,
                  ['Thresholds', entry.thresholds.text],
                  ['Defined in', <span className={cx('text-xs', muted)}>{entry.thresholds.source}</span>],
                ]}
              />
            </div>
          )}
        </Section>

        <Section title="Current value & source">
          <Rows
            rows={[
              isOrigin && currentValue !== undefined
                ? ['Shown on card', <span className="font-semibold tabular-nums">{currentValue === null || currentValue === '' ? '—' : currentValue}</span>]
                : null,
              entry.sourceColumn ? ['Source', sourceText(entry.sourceColumn)] : null,
              entry.inputColumns?.length
                ? ['Input sources', (
                    <ul className="space-y-0.5">
                      {entry.inputColumns.map((c) => {
                        const title = getMetricCatalogEntry(c)?.title ?? c;
                        return <li key={c}><span className="font-medium">{title}</span> <span className={muted}>· {sourceText(c)}</span></li>;
                      })}
                    </ul>
                  )]
                : null,
              !entry.sourceColumn && !entry.inputColumns?.length
                ? ['Source', <span className={muted}>Not tracked per value: provenance (field_sources) is recorded only for team KPIs in kpi_snapshots.</span>]
                : null,
              ['Stored in', (
                <span className="flex flex-wrap gap-1">
                  {entry.storedIn.map((s) => <Code key={s}>{s}</Code>)}
                </span>
              )],
            ]}
          />
        </Section>

        <Section title="Where to find it in the app">
          <ul className={cx('space-y-1', body)}>
            {entry.whereToFindIt.map((w) => (
              <li key={w} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400 dark:bg-slate-500" aria-hidden />{w}</li>
            ))}
          </ul>
        </Section>

        <Section title="Where it comes from in production">
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
            {entry.productionSources.map((p) => (
              <li key={p.system} className="px-3 py-2">
                <p className="text-sm font-medium text-slate-900 dark:text-white">{p.system}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">{withCode(p.detail)}</p>
              </li>
            ))}
          </ul>
          <p className={cx('mt-2 text-xs', muted)}>IronGate has no built-in connectors: these systems, or a small job reading them, push values through the ingestion API.</p>
        </Section>

        <Section title="How to send it">
          {send.kind === 'ingest' && example ? (
            <>
              <p className={cx('mb-2', body)}>
                Push it with the KPI ingestion API, metric key <Code>{send.metricKey}</Code>. Use a company API key from Admin console → API keys.
              </p>
              <pre className={codeBlock}>{`POST /api/ingest/kpis\nAuthorization: Bearer igk_…\nContent-Type: application/json\n\n${example}`}</pre>
              {send.manual && <p className={cx('mt-2 text-xs', muted)}>Or by hand: {send.manual}.</p>}
            </>
          ) : (
            <div className={cx('space-y-1.5', body)}>
              {send.manual && <p>{send.manual}</p>}
              {send.note && <p className={send.manual ? cx('text-xs', muted) : undefined}>{send.note}</p>}
            </div>
          )}
        </Section>

        {!!entry.related?.length && (
          <Section title="Related">
            <div className="flex flex-wrap gap-1.5">
              {entry.related.map((r) => {
                const rel = getMetricCatalogEntry(r);
                if (!rel) return null;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setActiveKey(r)}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-brand-300 hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-brand-700 dark:hover:text-brand-200"
                  >
                    {rel.title}
                  </button>
                );
              })}
            </div>
          </Section>
        )}
      </div>
    </Modal>
  );
};

export default MetricInfoModal;
