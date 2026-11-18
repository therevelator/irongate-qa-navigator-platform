import React, { useCallback, useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { HeartPulse } from 'lucide-react';
import API_URL from '../config/api';
import { useTheme } from '../contexts/ThemeContext';
import { chartTheme, formatAsOf } from '../data/advancedFeatures';
import { Badge, Card, CardHeader, EmptyState, ProgressBar, StatTile, buttonClass, cx, scoreTone } from './ui';
import { SuppressedNote } from './PrivacyNote';
import { WELLBEING_BANDS } from '../../server/lib/pulseRules';

/**
 * Wellbeing (survey) results of one team, from GET /api/pulse/teams/:teamId
 * (server/routes/pulse.ts). Only aggregates of CLOSED periods with at least 3 responses arrive;
 * suppressed periods have no values. Comments only for leads, managers and admins.
 */

export type PulseCadence = 'weekly' | 'biweekly';

export interface PulsePeriodResult {
  start: string;
  lastDay: string;
  end: string;
  suppressed: boolean;
  reason: string | null;
  responses: number | null;
  score: number | null;
  questions: Array<{ key: string; text: string; mean: number }> | null;
}

export interface TeamPulseData {
  team: { id: string; name: string; isActive: boolean };
  cadence: PulseCadence;
  pendingCadence: { cadence: PulseCadence; from: string } | null;
  currentPeriod: { start: string; end: string; lastDay: string; responded: boolean; responsesSoFar: number | null; responsesSoFarText: string };
  periods: PulsePeriodResult[];
  latest: PulsePeriodResult;
  comments: string[] | null;
  threshold: number;
  canRespond: boolean;
  canSetCadence: boolean;
  canViewComments: boolean;
  questions: Array<{ key: string; text: string }>;
  scale: { min: number; max: number; minLabel: string; maxLabel: string };
  commentMax: number;
  formula: string;
  privacy: string;
  suppressedText: string;
}

export const CADENCE_LABEL: Record<PulseCadence, string> = { weekly: 'Weekly', biweekly: 'Every two weeks' };

/** "16 Nov – 22 Nov 2026" */
export const periodLabel = (p: { start: string; lastDay: string }) => {
  const a = new Date(`${p.start}T00:00:00Z`), b = new Date(`${p.lastDay}T00:00:00Z`);
  const short = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${short(a)} – ${short(b)} ${b.getUTCFullYear()}`;
};

/** Load (and reload) a team's pulse data. status: 'forbidden' when the team is outside the caller's scope. */
export function useTeamPulse(teamId: string | null | undefined) {
  const [data, setData] = useState<TeamPulseData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'forbidden' | 'error'>('loading');
  const load = useCallback(async () => {
    if (!teamId) return;
    setStatus((s) => (s === 'ok' ? s : 'loading'));
    try {
      const r = await fetch(`${API_URL}/pulse/teams/${encodeURIComponent(teamId)}`, { credentials: 'include' });
      if (r.status === 403) { setData(null); setStatus('forbidden'); return; }
      if (!r.ok) throw new Error(String(r.status));
      setData(await r.json());
      setStatus('ok');
    } catch {
      setStatus('error');
    }
  }, [teamId]);
  useEffect(() => { setData(null); setStatus('loading'); load(); }, [load]);
  return { data, status, reload: load };
}

/** 0–100 wellbeing score tone (WELLBEING_BANDS: 70 on target, 50 watch). */
export const wellbeingTone = (score: number | null | undefined) => scoreTone(score, WELLBEING_BANDS.good, WELLBEING_BANDS.warning);

/** Trend of the closed periods (suppressed periods are gaps). */
export const PulseTrendChart: React.FC<{ periods: PulsePeriodResult[]; height?: number }> = ({ periods, height = 220 }) => {
  const { isDark } = useTheme();
  const ct = chartTheme(isDark);
  const rows = periods.map((p) => ({ label: formatAsOf(p.start)?.replace(/ \d{4}$/, '') ?? p.start, score: p.score, period: periodLabel(p), responses: p.responses }));
  return (
    <div style={{ height }} role="img" aria-label={`Wellbeing (survey) trend over ${periods.length} periods`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke={ct.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: ct.axis, fontSize: 11 }} axisLine={{ stroke: ct.grid }} tickLine={false} minTickGap={16} />
          <YAxis domain={[0, 100]} tick={{ fill: ct.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={ct.tooltip.contentStyle} labelStyle={ct.tooltip.labelStyle} itemStyle={ct.tooltip.itemStyle}
            labelFormatter={(_l, payload) => (payload?.[0]?.payload?.period as string) ?? ''}
            formatter={(v: any, _n, item: any) => [v == null ? 'Not shown (fewer than 3 responses)' : `${v}/100 · ${item?.payload?.responses} responses`, 'Wellbeing']}
          />
          <Line type="monotone" dataKey="score" name="Wellbeing (survey)" stroke={ct.series} strokeWidth={2} dot={{ r: 2.5 }} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

/** Latest closed period: score, per-question means, comments; trend of earlier periods. */
export const PulseResults: React.FC<{ data: TeamPulseData }> = ({ data }) => {
  const latest = data.latest;
  const shownPeriods = data.periods.filter((p) => !p.suppressed).length;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Latest results"
          subtitle={<>Period {periodLabel(latest)} · results are shown after a period ends, as averages only.</>}
          action={latest.suppressed || latest.score == null ? undefined : <Badge tone={wellbeingTone(latest.score)} className="whitespace-nowrap">{latest.responses} responses</Badge>}
        />
        {latest.suppressed ? (
          <div className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center dark:border-slate-700" data-testid="pulse-latest-suppressed">
            <SuppressedNote className="justify-center text-sm" text={`${data.suppressedText}. Results appear once at least ${data.threshold} people have answered for a period.`} />
          </div>
        ) : latest.score == null ? (
          <EmptyState title="No answers for this period" description={`Nobody answered the survey for ${periodLabel(latest)}.`} />
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" data-testid="pulse-latest">
            <StatTile label="Wellbeing (survey)" value={Math.round(latest.score)} unit="/100" tone={wellbeingTone(latest.score)} progress={latest.score}
              caption={`Mean answer ${((latest.score / 100) * 4 + 1).toFixed(1)} of 5`} />
            <ul className="space-y-3" aria-label="Average answer per question">
              {(latest.questions ?? []).map((q) => (
                <li key={q.key}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-slate-700 dark:text-slate-300">{q.text}</span>
                    <span className="shrink-0 font-medium tabular-nums text-slate-900 dark:text-white">{q.mean.toFixed(1)}<span className="text-xs font-normal text-slate-500 dark:text-slate-400"> / 5</span></span>
                  </div>
                  <ProgressBar value={q.mean - 1} max={4} tone={wellbeingTone(((q.mean - 1) / 4) * 100)} className="mt-1.5" />
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.canViewComments && !latest.suppressed && (
          <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
            <h4 className="text-xs font-medium text-slate-500 dark:text-slate-400">Comments ({data.comments?.length ?? 0}), in alphabetical order</h4>
            {data.comments?.length ? (
              <ul className="mt-2 space-y-1.5">
                {data.comments.map((c, i) => (
                  <li key={i} className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">{c}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No comments for this period.</p>
            )}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Trend" subtitle={`Wellbeing (survey) per closed period, 0–100. Periods with fewer than ${data.threshold} responses are left as gaps.`} />
        {data.periods.length === 0 ? (
          <EmptyState title="No closed periods with answers yet" description="The trend appears after the first period with answers ends." />
        ) : shownPeriods === 0 ? (
          <div className="py-8 text-center" data-testid="pulse-trend-suppressed">
            <SuppressedNote className="justify-center text-sm" text={`Not shown: no period of the last ${data.periods.length} reached ${data.threshold} responses`} />
          </div>
        ) : (
          <>
            <PulseTrendChart periods={data.periods} />
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {shownPeriods} of {data.periods.length} period{data.periods.length === 1 ? '' : 's'} with results shown.
            </p>
          </>
        )}
      </Card>
    </div>
  );
};

/**
 * Compact Wellbeing (survey) section for Team detail: the latest closed period, the trend, and
 * a link to the pulse page (answer / full results).
 */
export const PulseTeamSummary: React.FC<{ teamId: string; onOpen?: () => void }> = ({ teamId, onOpen }) => {
  const { data, status } = useTeamPulse(teamId);
  if (status === 'forbidden') return null;
  const latest = data?.latest;
  return (
    <Card>
      <CardHeader
        title="Wellbeing (survey)"
        subtitle="Anonymous team pulse survey: averages of closed periods only, never single answers. Workload balance (derived) above is a separate workload signal."
        action={onOpen && data ? (
          <button type="button" className={buttonClass.secondary} onClick={onOpen} data-testid="open-pulse">
            <HeartPulse size={15} aria-hidden /> {data.canRespond && !data.currentPeriod.responded ? 'Answer the survey' : 'Open pulse'}
          </button>
        ) : undefined}
      />
      {status === 'loading' || !data || !latest ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{status === 'error' ? 'The survey results could not be loaded.' : 'Loading…'}</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" data-testid="team-wellbeing">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Latest period · {periodLabel(latest)}</p>
            {latest.suppressed ? (
              <div className="mt-2"><SuppressedNote testId="team-wellbeing-suppressed" /></div>
            ) : latest.score == null ? (
              <p className="mt-2 text-2xl font-semibold text-slate-400 dark:text-slate-500">—<span className="ml-2 text-xs font-normal">No answers for this period</span></p>
            ) : (
              <p className="mt-2 flex items-baseline gap-1.5">
                <span className={cx('text-3xl font-semibold tabular-nums text-slate-900 dark:text-white')}>{Math.round(latest.score)}</span>
                <span className="text-sm text-slate-500 dark:text-slate-400">/100</span>
                <Badge tone={wellbeingTone(latest.score)} className="ml-2 whitespace-nowrap">{latest.responses} responses</Badge>
              </p>
            )}
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Asked {CADENCE_LABEL[data.cadence].toLowerCase()}
              {data.pendingCadence ? ` (${CADENCE_LABEL[data.pendingCadence.cadence].toLowerCase()} from ${formatAsOf(data.pendingCadence.from)})` : ''}.
              {' '}Current period: {data.currentPeriod.responsesSoFarText.toLowerCase()}.
            </p>
          </div>
          {data.periods.some((p) => !p.suppressed) ? <PulseTrendChart periods={data.periods} height={140} /> : (
            <p className="self-center text-sm text-slate-500 dark:text-slate-400">{data.periods.length ? `No trend: no period reached ${data.threshold} responses.` : "No closed periods with answers yet."}</p>
          )}
        </div>
      )}
    </Card>
  );
};
