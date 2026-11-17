import React, { useEffect, useMemo, useState } from 'react';
import { API_URL } from '../config/api';
import { Page, PageIntro, Card, Badge, EmptyState, SegmentedControl, cx } from './ui';
import type { Tone } from './ui';
import { getThreshold, statusFor, toNum } from '../data/detailedKPIs';
import type { KPIKey, KPIStatus } from '../data/detailedKPIs';
import { formatAsOf } from '../data/advancedFeatures';

/**
 * Team rankings — built only from real data returned by GET /api/teams.
 * Teams are ranked by their latest recorded QA score; teams without a score are
 * listed after the ranked ones. No points, badges or achievements are invented.
 */

interface TeamRankingsProps {
  onBack?: () => void;
}

interface RankedTeam {
  id: string;
  name: string;
  department: string;
  qaScore: number | null;
  coverage: number | null;
  flakiness: number | null;
  escapeRate: number | null;
  automation: number | null;
  asOf: string | null;
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

const TeamGamification: React.FC<TeamRankingsProps> = () => {
  const [teams, setTeams] = useState<RankedTeam[]>([]);
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
            qaScore: toNum(t.qaScore),
            coverage: toNum(k.testCoverage),
            flakiness: toNum(k.testFlakinessRate),
            escapeRate: toNum(k.defectEscapeRate),
            automation: toNum(k.automationCoverage),
            asOf: t.snapshotDate ?? t.asOf ?? k.snapshotDate ?? null,
          };
        });

        // The list endpoint may not carry the snapshot date; fall back to the team detail endpoint.
        const missing = rows.filter(r => !r.asOf);
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
  }, []);

  const column = COLUMNS.find(c => c.key === sortKey)!;
  const lowerIsBetter = getThreshold(column.metric, thresholds)?.lowerIsBetter ?? false;

  const ranked = useMemo(() => {
    const withValue = teams.filter(t => t[sortKey] != null);
    const without = teams.filter(t => t[sortKey] == null).sort((a, b) => a.name.localeCompare(b.name));
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
            Active teams ranked by their latest recorded KPI snapshot.
            {newest && <> Snapshots dated {oldest === newest ? newest : `${oldest} – ${newest}`}.</>}
            {' '}{scored} of {teams.length} teams have a QA score.
          </>
        }
        actions={
          <SegmentedControl
            value={sortKey}
            onChange={setSortKey}
            options={COLUMNS.map(c => ({ value: c.key, label: c.short }))}
          />
        }
      />

      <Card padded={false}>
        {loading ? (
          <p className="p-5 text-sm text-slate-500 dark:text-slate-400">Loading teams…</p>
        ) : error ? (
          <EmptyState title="Could not load teams" description={error} />
        ) : teams.length === 0 ? (
          <EmptyState title="No teams" description="No active teams are recorded for your company." />
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
                {ranked.map(({ team, rank }) => (
                  <tr key={team.id} className="text-slate-700 dark:text-slate-300">
                    <td className="px-5 py-3 tabular-nums font-medium text-slate-900 dark:text-white">{rank ?? '—'}</td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-slate-900 dark:text-white">{team.name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{team.department}</div>
                    </td>
                    {COLUMNS.map(c => {
                      const v = team[c.key];
                      const status = statusFor(v, getThreshold(c.metric, thresholds));
                      return (
                        <td key={c.key} className="px-3 py-3 text-right tabular-nums">
                          {v == null ? (
                            <span className="text-slate-400 dark:text-slate-500">—</span>
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        Ranking uses the selected column ({lowerIsBetter ? 'lower is better' : 'higher is better'}); teams with no recorded value are listed last without a rank.
        Colours use the platform thresholds in metrics configuration. Snapshots of different dates are not directly comparable.
      </p>
    </Page>
  );
};

export default TeamGamification;
