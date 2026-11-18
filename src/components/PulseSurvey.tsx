import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { Card, CardHeader, EmptyState, Page, PageIntro } from './ui';
import { PulseResults, useTeamPulse } from './PulseSurveyResults';
import { PulseCadenceControl, PulseSurveyForm } from './PulseSurveyForm';

/**
 * Wellbeing pulse (Analytics module, one team from the analytics scope): answer the team's
 * anonymous survey and see its results (aggregates of closed periods with at least 3 responses).
 */
const PulseSurvey: React.FC<{ teamId: string }> = ({ teamId }) => {
  const { data, status, reload } = useTeamPulse(teamId);

  return (
    <Page className="space-y-6">
      <PageIntro
        title="Wellbeing pulse"
        description={data
          ? `A five-question anonymous survey for ${data.team.name}. "Wellbeing (survey)" is the team's wellbeing signal; workload balance on Developer productivity is a separate, derived workload signal.`
          : 'A five-question anonymous survey per team.'}
        actions={data ? <PulseCadenceControl data={data} onChanged={reload} /> : undefined}
      />
      {status === 'loading' && !data ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : status === 'forbidden' ? (
        <Card><EmptyState title="Not available" description="This team is outside your scope." /></Card>
      ) : !data ? (
        <Card><EmptyState title="The survey could not be loaded" description="Try again in a minute." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="space-y-6">
            <PulseSurveyForm data={data} onSubmitted={reload} />
            <Card>
              <CardHeader title="How your answers are protected" />
              <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-300" data-testid="pulse-privacy">
                <li className="flex gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />Answers are stored without your name, user id or the time you answered. Only the period is kept.</li>
                <li className="flex gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />A separate list records that you answered this period, only so you cannot answer twice. It cannot be matched to an answer.</li>
                <li className="flex gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />Results are averages, shown only after a period ends and only when at least {data.threshold} people answered.</li>
                <li className="flex gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />Comments are shown to the team lead, QA managers and admins with the period’s results, in alphabetical order.</li>
              </ul>
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{data.formula}</p>
            </Card>
          </div>
          <PulseResults data={data} />
        </div>
      )}
    </Page>
  );
};

export default PulseSurvey;
