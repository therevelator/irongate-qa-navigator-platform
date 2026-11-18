import React, { useMemo, useState } from 'react';
import { CalendarDays, ChevronRight, MonitorPlay } from 'lucide-react';
import Modal from './Modal';
import { cx } from './ui';
import { getMetricStatus, KPI_TRACK_RULE_TEXT, type KpiTargetCheck, type KpiTrackBucket } from '../config/metricsConfig';
import { qaStatusFromScore } from '../../server/lib/metricFormulas';

/**
 * Dashboard "Teams vs KPI targets" breakdown. The list comes from the company summary
 * (kpiStatusTeams), computed by the same teamKpiTrack rule as the counts, so a tab's length
 * always equals its count.
 */

export interface KpiStatusTeam {
  teamId: string;
  name: string;
  department: string | null;
  qaScore: number | null;
  snapshotDate: string | null;
  bucket: KpiTrackBucket;
  checks: KpiTargetCheck[];
  met: number;
  recorded: number;
}

export type KpiTab = Exclude<KpiTrackBucket, 'noData'>;

const TABS: { id: KpiTab; label: string; dot: string }[] = [
  { id: 'onTrack', label: 'On track', dot: 'bg-green-600 dark:bg-green-500' },
  { id: 'atRisk', label: 'At risk', dot: 'bg-amber-500 dark:bg-amber-400' },
  { id: 'offTrack', label: 'Off track', dot: 'bg-red-600 dark:bg-red-500' },
];

const STATUS_DOT = { good: 'bg-green-600 dark:bg-green-500', warning: 'bg-amber-500 dark:bg-amber-400', critical: 'bg-red-600 dark:bg-red-500' } as const;
const QA_TEXT = { good: 'text-green-700 dark:text-green-400', warning: 'text-amber-700 dark:text-amber-400', critical: 'text-red-700 dark:text-red-400' } as const;

const fmtDay = (d: string | null) => {
  if (!d) return null;
  const t = new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t.getTime()) ? null : t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

const totalGap = (t: KpiStatusTeam) => t.checks.reduce((s, c) => s + (c.gap ?? 0), 0);
/** Worst first: lowest share of targets met, then the largest total gap, then the lowest QA score. */
const worstFirst = (a: KpiStatusTeam, b: KpiStatusTeam) =>
  a.met / Math.max(1, a.recorded) - b.met / Math.max(1, b.recorded) ||
  totalGap(b) - totalGap(a) ||
  (a.qaScore ?? 101) - (b.qaScore ?? 101) ||
  a.name.localeCompare(b.name);

const CheckRow: React.FC<{ c: KpiTargetCheck }> = ({ c }) => {
  if (c.value == null) {
    return (
      <li className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <span aria-hidden className="h-2 w-2 flex-shrink-0 rounded-full bg-slate-300 dark:bg-slate-600" />
        {c.label} · not recorded (not counted)
      </li>
    );
  }
  const st = getMetricStatus(c.value, c.key);
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-slate-700 dark:text-slate-200">
      <span aria-hidden className={cx('h-2 w-2 flex-shrink-0 rounded-full', STATUS_DOT[st])} />
      <span className="font-medium">{c.label}</span>
      <span className="tabular-nums">{c.value.toFixed(1)}%</span>
      <span className="text-slate-500 dark:text-slate-400">· target {c.lowerIsBetter ? '≤' : '≥'} {c.target}%</span>
      {c.met ? (
        <span className="text-green-700 dark:text-green-400">· met</span>
      ) : (
        <span className="text-red-700 dark:text-red-400">
          · not met, {c.gap!.toFixed(1)} pts {c.lowerIsBetter ? 'above' : 'below'} target
        </span>
      )}
    </li>
  );
};

const KpiStatusModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  initialTab: KpiTab;
  teams: KpiStatusTeam[];
  onOpenTeam: (teamId: string) => void;
  /** present only for teams the viewer may open in TV mode */
  onOpenTv?: (teamId: string) => void;
  canOpenTv: (teamId: string) => boolean;
}> = ({ isOpen, onClose, initialTab, teams, onOpenTeam, onOpenTv, canOpenTv }) => {
  const [tab, setTab] = useState<KpiTab>(initialTab);
  const [lastInitial, setLastInitial] = useState(initialTab);
  if (initialTab !== lastInitial) { setLastInitial(initialTab); setTab(initialTab); }

  const byTab = useMemo(() => {
    const m: Record<KpiTab, KpiStatusTeam[]> = { onTrack: [], atRisk: [], offTrack: [] };
    for (const t of teams) if (t.bucket !== 'noData') m[t.bucket].push(t);
    for (const k of Object.keys(m) as KpiTab[]) m[k].sort(worstFirst);
    return m;
  }, [teams]);
  const unclassified = teams.filter((t) => t.bucket === 'noData').length;
  const list = byTab[tab];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Teams vs KPI targets" subtitle={KPI_TRACK_RULE_TEXT} size="lg" scrollBody>
      <div data-testid="kpi-status-modal">
        <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Status">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              data-testid={`kpi-tab-${t.id}`}
              {...(tab === t.id ? { 'data-autofocus': true } : {})}
              className={cx(
                'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                tab === t.id
                  ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
              )}
            >
              <span aria-hidden className={cx('h-2 w-2 rounded-full', t.dot)} />
              {t.label}
              <span className="tabular-nums">{byTab[t.id].length}</span>
            </button>
          ))}
          {unclassified > 0 && (
            <span className="text-xs text-slate-500 dark:text-slate-400">{unclassified} not classified (fewer than 2 KPIs recorded)</span>
          )}
        </div>

        {list.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            No team is {TABS.find((t) => t.id === tab)!.label.toLowerCase()}.
          </p>
        ) : (
          <ul className="space-y-3" data-testid="kpi-status-list">
            {list.map((t) => {
              const qaSt = qaStatusFromScore(t.qaScore);
              const failing = t.checks.filter((c) => c.met === false).sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0));
              const passing = t.checks.filter((c) => c.met === true);
              const missing = t.checks.filter((c) => c.met === null);
              const asOf = fmtDay(t.snapshotDate);
              return (
                <li key={t.teamId} className="rounded-lg border border-slate-200 dark:border-slate-800" data-testid="kpi-status-team">
                  <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-start sm:justify-between dark:border-slate-800">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onOpenTeam(t.teamId)}
                        className="group inline-flex max-w-full items-center gap-1 text-left text-sm font-semibold text-slate-900 hover:underline dark:text-white"
                      >
                        <span className="truncate">{t.name}</span>
                        <ChevronRight size={15} className="flex-shrink-0 text-slate-400" aria-hidden />
                      </button>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
                        <span>{t.department ?? 'No department'}</span>
                        <span aria-hidden>·</span>
                        <span className="inline-flex items-center gap-1"><CalendarDays size={12} aria-hidden /> {asOf ? `As of ${asOf}` : 'No snapshot date'}</span>
                        <span aria-hidden>·</span>
                        <span>{t.met} of {t.recorded} targets met</span>
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-3">
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <span className="text-slate-500 dark:text-slate-400">QA</span>
                        {qaSt && <span aria-hidden className={cx('h-2 w-2 rounded-full', STATUS_DOT[qaSt])} />}
                        <span className={cx('font-semibold tabular-nums', qaSt ? QA_TEXT[qaSt] : 'text-slate-400')}>{t.qaScore == null ? '—' : Math.round(t.qaScore)}</span>
                        {qaSt && <span className="sr-only">{qaSt}</span>}
                      </span>
                      {onOpenTv && canOpenTv(t.teamId) && (
                        <button
                          type="button"
                          onClick={() => onOpenTv(t.teamId)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-slate-800"
                        >
                          <MonitorPlay size={13} aria-hidden /> TV mode
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2 px-4 py-3">
                    {failing.length > 0 ? (
                      <ul className="space-y-1.5" aria-label="Targets not met">
                        {failing.map((c) => <CheckRow key={c.key} c={c} />)}
                      </ul>
                    ) : (
                      <p className="text-sm text-green-700 dark:text-green-400">Every recorded target met.</p>
                    )}
                    {missing.length > 0 && (
                      <ul className="space-y-1.5">{missing.map((c) => <CheckRow key={c.key} c={c} />)}</ul>
                    )}
                    {passing.length > 0 && (
                      <details className="group">
                        <summary className="cursor-pointer select-none text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
                          {passing.length} on target
                        </summary>
                        <ul className="mt-1.5 space-y-1.5">{passing.map((c) => <CheckRow key={c.key} c={c} />)}</ul>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
};

export default KpiStatusModal;
