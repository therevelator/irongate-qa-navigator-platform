import React, { useEffect, useMemo, useState } from 'react';
import { Bug, CalendarClock, Wrench, Gauge, GitBranch, Activity, TrendingUp, Trophy, FileText, ChevronRight } from 'lucide-react';
import API_URL from '../config/api';
import { useAuth } from '../contexts/AuthContext';
import { Page, PageIntro, inputClass, cx } from './ui';

interface Department { id: string; name: string }
interface Team { id: string; name: string; department_id?: string; department?: string }

interface FeaturesMenuProps {
  onBack: () => void;
  onSelectFeature: (featureId: string, teamId?: string) => void;
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
      { id: 'developer-productivity', title: 'Developer productivity', description: 'Review and merge times, focus time, meetings and workload balance.', icon: Activity },
      { id: 'business-impact', title: 'Business impact', description: 'Statistical correlation between quality metrics and business KPIs.', icon: TrendingUp },
      { id: 'team-gamification', title: 'Team rankings', description: 'Comparative team standings across quality measures.', icon: Trophy },
      { id: 'pdf-report-generator', title: 'Reports', description: 'Export a PDF quality report for stakeholders.', icon: FileText },
    ],
  },
];

const FeaturesMenu: React.FC<FeaturesMenuProps> = ({ onSelectFeature }) => {
  const { user } = useAuth();
  const isLead = user?.role === 'team_lead';
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [department, setDepartment] = useState('all');
  const [team, setTeam] = useState<string>(isLead ? (user?.primaryTeamId ?? 'all') : 'all');

  useEffect(() => {
    (async () => {
      try {
        const [d, t] = await Promise.all([
          fetch(`${API_URL}/admin/departments`, { credentials: 'include' }),
          fetch(`${API_URL}/teams`, { credentials: 'include' }),
        ]);
        if (d.ok) { const data = await d.json(); setDepartments(Array.isArray(data) ? data : data.departments || []); }
        if (t.ok) { const data = await t.json(); setTeams(data.teams || []); }
      } catch (e) {
        console.error('Error loading analytics scope', e);
      }
    })();
  }, []);

  const teamsInScope = useMemo(
    () => (department === 'all' ? teams : teams.filter((t) => String(t.department_id) === String(department))),
    [teams, department],
  );

  const selectedTeamName = teams.find((t) => t.id === team)?.name;
  const open = (id: string) => onSelectFeature(id, team !== 'all' ? team : undefined);

  return (
    <Page>
      <div data-testid="features-menu">
      <PageIntro
        title="Analytics"
        description={selectedTeamName ? `Modules open scoped to ${selectedTeamName}. Team rankings and Reports always cover all teams.` : 'Choose a team to scope the analytics modules. Without a team, modules show company-wide data.'}
        actions={
          isLead ? (
            <span className="text-sm text-slate-600 dark:text-slate-300" data-testid="team-static-label">
              Team: <span className="font-medium text-slate-900 dark:text-white">{selectedTeamName || 'Your team'}</span>
            </span>
          ) : (
            <>
              <select aria-label="Department" value={department} onChange={(e) => { setDepartment(e.target.value); setTeam('all'); }} className={cx(inputClass, 'pr-8')}>
                <option value="all">All departments</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select aria-label="Team" value={team} onChange={(e) => setTeam(e.target.value)} className={cx(inputClass, 'pr-8 min-w-[12rem]')}>
                <option value="all">All teams</option>
                {teamsInScope.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </>
          )
        }
      />

      <div className="space-y-8">
        {MODULES.map((g) => (
          <section key={g.group}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{g.group}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {g.items.map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    onClick={() => open(m.id)}
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
      </div>
    </Page>
  );
};

export default FeaturesMenu;
