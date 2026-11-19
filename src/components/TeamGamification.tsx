import React, { useEffect, useMemo, useState } from 'react';
import { API_URL } from '../config/api';
import ExportCsvButton from './ExportCsvButton';
import { Page, PageIntro, Card, Badge, EmptyState, SegmentedControl, cx } from './ui';
import type { Tone } from './ui';
import { getThreshold, statusFor, toNum } from '../data/detailedKPIs';
import type { KPIKey, KPIStatus } from '../data/detailedKPIs';
import { formatAsOf } from '../data/advancedFeatures';
import { useAnalyticsScope } from '../contexts/AnalyticsScopeContext';

/**
 * Team rankings — built only from real data returned by GET /api/teams.
 * Teams are ranked by their latest recorded QA score; teams without a score are
 * listed after the ranked ones. No points, badges or achievements are invented.
 * Rankings compare the teams of the selected team's DEPARTMENT (analytics scope) and
 * highlight the selected team. Team-level KPIs only; no individual data.
 */

interface TeamRankingsProps {
  onBack?: () => void;
  /** Selected team (analytics scope); its department's teams are ranked. */
  teamId: string;
}

interface RankedTeam {
  id: string;
  name: string;
  department: string;
  departmentId: string | null;
  qaScore: number | null;
  coverage: number | null;
  flakiness: number | null;
  escapeRate: number | null;
  automation: number | null;
  asOf: string | null;
  /** Columns whose latest value is stale (older than its expected update interval): staleSince or null. */
  stale: Partial<Record<SortKey, string | null>>;
  /** The team's targets valid at its values' dates (target history), from GET /api/teams kpiThresholds. */
  thresholds: Partial<Record<string, any>> | undefined;
}

type SortKey = 'qaScore' | 'coverage' | 'flakiness' | 'escapeRate' | 'automation';

const COLUMNS: { key: SortKey; label: string; short: string; metric: KPIKey; unit: string; digits: number }[] = [
  { key: 'qaScore', label: 'QA score', short: 'QA score', metric: 'qaScore', unit: '/100', digits: 0 },
  { key: 'coverage', label: 'Test coverage', short: 'Coverage', metric: 'testCoverage', unit: '%', digits: 1 },
  { key: 'flakiness', label: 'Flakiness', short: 'Flakiness', metric: 'testFlakinessRate', unit: '%', digits: 1 },
  { key: 'escapeRate', label: 'Defect escape rate', short: 'Escape rate', metric: 'defectEscapeRate', unit: '%', digits: 2 },
  { key: 'automation', label: 'Automation coverage', short: 'Automation', metric: 'automationCoverage', unit: '%', digits: 1 },
];

const toneFor = (s: KPIStatus): Tone => (s === 'good' ? 'good' : s === 'warning' ? 'warn' : s === 'critical' ? 'bad' : 'neutral');

const TeamGamification: React.FC<TeamRankingsProps> = ({ teamId }) => {
  const scope = useAnalyticsScope();
  const departmentId = scope.team?.id === teamId ? scope.team.department_id : null;
  const departmentName = scope.team?.department_name || 'the selected department';
  const selectedName = scope.team?.name || 'the selected team';
  const [allTeams, setTeams] = useState<RankedTeam[]>([]);
  const [thresholds, setThresholds] = useState<Partial<Record<string, any>> | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('qaScore');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/teams`, { credentials: 'include' });
        if (!res.ok) throw new Error(`Failed to load teams (${res.status})`);
        const data = await res.json();
        const rows: RankedTeam[] = (data.teams || []).map((t: any) => {
          const k = t.kpiData || {};
          return {
            id: String(t.id),
            name: t.name || 'Unnamed team',
            department: t.department || '—',
            departmentId: t.department_id != null ? String(t.department_id) : null,
            qaScore: toNum(t.qaScore),
            coverage: toNum(k.testCoverage),
            flakiness: toNum(k.testFlakinessRate),
            escapeRate: toNum(k.defectEscapeRate),
            automation: toNum(k.automationCoverage),
            asOf: t.snapshotDate ?? t.asOf ?? k.snapshotDate ?? null,
            stale: Object.fromEntries(COLUMNS.filter((c) => c.key !== 'qaScore' && t.kpiStaleness?.[c.metric]?.stale)
              .map((c) => [c.key, t.kpiStaleness[c.metric].staleSince ?? null])),
            thresholds: t.kpiThresholds ?? undefined,
          };
        });

        // The list endpoint may not carry the snapshot date; fall back to the team detail endpoint.
        const missing = rows.filter(r => !r.asOf && (departmentId == null || r.departmentId === departmentId));
        if (missing.length) {
          const dates = await Promise.all(
            missing.map(r =>
              fetch(`${API_URL}/teams/${r.id}`, { credentials: 'include' })
                .then(x => (x.ok ? x.json() : null))
                .then(d => d?.team?.kpiData?.snapshotDate ?? d?.team?.snapshotDate ?? null)
                .catch(() => null),
            ),
          );
          missing.forEach((r, i) => { r.asOf = dates[i]; });
        }
        if (!cancelled) {
          setTeams(rows);
          setThresholds(data.kpiThresholds);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load teams');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [departmentId]);

  // Only the teams of the selected team's department are compared.
  const teams = useMemo(
    () => allTeams.filter(t => (departmentId == null ? t.id === teamId : t.departmentId === departmentId) || t.id === teamId),
    [allTeams, departmentId, teamId],
  );

  const column = COLUMNS.find(c => c.key === sortKey)!;
  const lowerIsBetter = getThreshold(column.metric, thresholds)?.lowerIsBetter ?? false;

  // A stale value (older than its expected update interval) is shown greyed but not ranked; the
  // QA score from GET /api/teams already leaves stale inputs out.
  const rankable = (t: RankedTeam) => t[sortKey] != null && !(sortKey in t.stale);
  const ranked = useMemo(() => {
    const withValue = teams.filter(rankable);
    const without = teams.filter(t => !rankable(t)).sort((a, b) => a.name.localeCompare(b.name));
    withValue.sort((a, b) => {
      const d = (a[sortKey] as number) - (b[sortKey] as number);
      return (lowerIsBetter ? d : -d) || a.name.localeCompare(b.name);
    });
    // Competition ranking: equal values share a rank
    let lastVal: number | null = null;
    let lastRank = 0;
    const rankedRows = withValue.map((t, i) => {
      const v = t[sortKey] as number;
      const rank = lastVal !== null && v === lastVal ? lastRank : i + 1;
      lastVal = v; lastRank = rank;
      return { team: t, rank: rank as number | null };
    });
    return [...rankedRows, ...without.map(t => ({ team: t, rank: null as number | null }))];
  }, [teams, sortKey, lowerIsBetter]);

  const dates = teams.map(t => t.asOf).filter(Boolean).map(d => new Date(d as string).getTime()).filter(n => !Number.isNaN(n));
  const oldest = dates.length ? formatAsOf(new Date(Math.min(...dates)).toISOString()) : null;
  const newest = dates.length ? formatAsOf(new Date(Math.max(...dates)).toISOString()) : null;
  const scored = teams.filter(t => t.qaScore != null).length;

  return (
    <Page>
      <PageIntro
        title="Team rankings"
        description={
          <>
            Active teams of <span className="font-medium text-slate-700 dark:text-slate-200">{departmentName}</span> ranked by their latest recorded KPI snapshot; <span className="font-medium text-slate-700 dark:text-slate-200">{selectedName}</span> is highlighted.
            {newest && <> Snapshots dated {oldest === newest ? newest : `${oldest} – ${newest}`}.</>}
            {' '}{scored} of {teams.length} teams have a QA score.
          </>
        }
        actions={
          <>
          <SegmentedControl
            value={sortKey}
            onChange={setSortKey}
            options={COLUMNS.map(c => ({ value: c.key, label: c.short }))}
          />
          <ExportCsvButton
            what="Team rankings"
            rows={ranked}
            columns={[
              { header: 'Rank', value: (r) => r.rank },
              { header: 'Team', value: (r) => r.team.name },
              { header: 'Department', value: (r) => r.team.department },
              ...COLUMNS.map((c) => ({
                header: c.label,
                value: (r: (typeof ranked)[number]) => { const v = r.team[c.key]; return v == null ? '—' : `${v.toFixed(c.digits)}${c.unit}`; },
                raw: (r: (typeof ranked)[number]) => r.team[c.key],
              })),
              { header: 'As of', value: (r) => r.team.asOf ?? '' },
            ]}
          />
          </>
        }
      />

      <Card padded={false}>
        {loading ? (
          <p className="p-5 text-sm text-slate-500 dark:text-slate-400">Loading teams…</p>
        ) : error ? (
          <EmptyState title="Could not load teams" description={error} />
        ) : teams.length === 0 ? (
          <EmptyState title="No teams" description="No active teams are recorded for this department." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                <tr>
                  <th className="w-14 px-5 py-2.5">Rank</th>
                  <th className="px-3 py-2.5">Team</th>
                  {COLUMNS.map(c => (
                    <th key={c.key} className={cx('px-3 py-2.5 text-right', c.key === sortKey && 'text-slate-900 dark:text-white')}>
                      {c.label}
                    </th>
                  ))}
                  <th className="px-5 py-2.5 text-right">As of</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {ranked.map(({ team, rank }) => {
                  const isSelected = team.id === teamId;
                  return (
                  <tr
                    key={team.id}
                    data-testid={isSelected ? 'ranking-selected-team' : undefined}
                    aria-current={isSelected ? 'true' : undefined}
                    className={cx(
                      'text-slate-700 dark:text-slate-300',
                      isSelected && 'bg-brand-50 dark:bg-brand-950/40',
                    )}
                  >
                    <td className={cx('px-5 py-3 tabular-nums font-medium text-slate-900 dark:text-white border-l-2', isSelected ? 'border-brand-600 dark:border-brand-400' : 'border-transparent')}>{rank ?? '—'}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 font-medium text-slate-900 dark:text-white">
                        {team.name}
                        {isSelected && <Badge tone="brand">Selected</Badge>}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{team.department}</div>
                    </td>
                    {COLUMNS.map(c => {
                      const v = team[c.key];
                      const isStale = c.key in team.stale;
                      const status = statusFor(v, getThreshold(c.metric, team.thresholds ?? thresholds));
                      const staleSince = team.stale[c.key];
                      return (
                        <td key={c.key} className="px-3 py-3 text-right tabular-nums">
                          {v == null ? (
                            <span className="text-slate-500 dark:text-slate-400">—</span>
                          ) : isStale ? (
                            <span className="text-slate-500 dark:text-slate-400" title={`Stale${staleSince ? ` since ${formatAsOf(staleSince)}` : ''}: shown, not ranked or judged`} data-stale="true">
                              {v.toFixed(c.digits)}{c.unit}<span className="ml-1 text-[10px] uppercase">stale</span>
                            </span>
                          ) : c.key === 'qaScore' ? (
                            <Badge tone={toneFor(status)}>{v.toFixed(c.digits)}{c.unit}</Badge>
                          ) : (
                            <span className={cx(status === 'critical' && 'text-red-700 dark:text-red-400', status === 'warning' && 'text-amber-700 dark:text-amber-400')}>
                              {v.toFixed(c.digits)}{c.unit}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-5 py-3 text-right text-xs text-slate-500 dark:text-slate-400">
                      {formatAsOf(team.asOf) ?? '—'}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        Ranking uses the selected column ({lowerIsBetter ? 'lower is better' : 'higher is better'}); teams with no recorded value, or a stale one (older than its
        expected update interval), are listed last without a rank. Colours use each team’s targets valid at the value’s date (target history). The QA score
        leaves stale inputs out. Snapshots of different dates are not directly comparable.
      </p>
    </Page>
  );
};

export default TeamGamification;
