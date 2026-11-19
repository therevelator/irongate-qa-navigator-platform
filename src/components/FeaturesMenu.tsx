import React from 'react';
import { Bug, CalendarClock, Wrench, Gauge, GitBranch, Activity, TrendingUp, Trophy, FileText, ChevronRight, HeartPulse } from 'lucide-react';
import { useAnalyticsScope } from '../contexts/AnalyticsScopeContext';
import { AnalyticsScopeBar, AnalyticsNoTeam } from './AnalyticsScopeBar';
import { Page, PageIntro } from './ui';
import { useAuth } from '../contexts/AuthContext';
import { policyActorOf } from '../lib/policyActor';
import { canOpenView } from '../lib/viewAccess';

interface FeaturesMenuProps {
  onBack: () => void;
  /** Opens a module; it shows the team selected in the shared analytics scope. */
  onSelectFeature: (featureId: string) => void;
}

const MODULES: { group: string; items: { id: string; title: string; description: string; icon: React.ComponentType<{ size?: number }> }[] }[] = [
  {
    group: 'Quality',
    items: [
      { id: 'flaky-test-intelligence', title: 'Flaky tests', description: 'Unstable tests, failure patterns and suggested remediation.', icon: Bug },
      { id: 'test-execution-timeline', title: 'Test execution', description: 'Execution timeline, durations and bottlenecks per suite.', icon: CalendarClock },
      { id: 'technical-debt', title: 'Technical debt', description: 'Debt inventory prioritised by effort, impact and cost of delay.', icon: Wrench },
      { id: 'performance-metrics', title: 'Performance', description: 'Latency percentiles, throughput and error rates by endpoint.', icon: Gauge },
    ],
  },
  {
    group: 'Delivery',
    items: [
      { id: 'pipeline-visualization', title: 'CI/CD pipeline', description: 'Stage durations, success rates, cost and bottlenecks.', icon: GitBranch },
      { id: 'developer-productivity', title: 'Developer productivity', description: 'Review and merge times, focus time, meetings and workload balance (derived).', icon: Activity },
      { id: 'team-pulse', title: 'Wellbeing pulse', description: 'Anonymous five-question team survey and its wellbeing trend.', icon: HeartPulse },
      { id: 'business-impact', title: 'Business impact', description: 'Statistical correlation between quality metrics and business KPIs.', icon: TrendingUp },
      { id: 'team-gamification', title: 'Team rankings', description: 'Comparative team standings across quality measures.', icon: Trophy },
      { id: 'pdf-report-generator', title: 'Reports', description: 'Export a PDF quality report for stakeholders.', icon: FileText },
    ],
  },
];

const FeaturesMenu: React.FC<FeaturesMenuProps> = ({ onSelectFeature }) => {
  const scope = useAnalyticsScope();
  const { user } = useAuth();
  const actor = policyActorOf(user);
  const teamName = scope.team?.name;

  return (
    <Page>
      <div data-testid="features-menu">
      <div className="mb-6">
        <AnalyticsScopeBar />
      </div>
      <PageIntro
        title="Analytics"
        description={
          teamName
            ? `Every module opens for ${teamName}. Team rankings compare the teams of ${scope.team?.department_name || 'its department'} and highlight ${teamName}; Reports are generated for ${teamName}.`
            : 'Analytics modules show metrics for one team at a time.'
        }
      />

      {!scope.loading && !scope.team ? (
        <AnalyticsNoTeam error={scope.error} />
      ) : (
      <div className="space-y-8">
        {MODULES.map((g) => ({ ...g, items: g.items.filter((m) => canOpenView(actor, m.id)) })).filter((g) => g.items.length > 0).map((g) => (
          <section key={g.group}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{g.group}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {g.items.map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    onClick={() => onSelectFeature(m.id)}
                    data-testid={`feature-${m.id}`}
                    className="group flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-4 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-800/50"
                  >
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-700 dark:bg-slate-800 dark:text-brand-300">
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{m.title}</p>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{m.description}</p>
                    </div>
                    <ChevronRight size={16} className="mt-1 text-slate-300 group-hover:text-slate-500" />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      )}
      </div>
    </Page>
  );
};

export default FeaturesMenu;
