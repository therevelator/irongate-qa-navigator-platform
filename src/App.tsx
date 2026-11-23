import { useState, useEffect } from 'react';
import type { Team } from './data/mockData';
import { useAuth } from './contexts/AuthContext';
import API_URL from './config/api';
import TeamDetailView from './components/TeamDetailView';
import FeaturesMenu from './components/FeaturesMenu';
import FlakyTestIntelligence from './components/FlakyTestIntelligence';
import TechnicalDebtTracker from './components/TechnicalDebtTracker';
import PipelineVisualization from './components/PipelineVisualization';
import BusinessImpactAnalysisV2 from './components/BusinessImpactAnalysisV2';
import PerformanceTesting from './components/PerformanceTesting';
import PulseSurvey from './components/PulseSurvey';
import DeveloperProductivity from './components/DeveloperProductivity';
import TestExecutionTimeline from './components/TestExecutionTimeline';
import TeamGamification from './components/TeamGamification';
import AdminPanel from './components/AdminPanel';
import PDFReportGenerator from './components/PDFReportGenerator';
import UsersView from './components/UsersView';
import TeamsView from './components/TeamsView';
import DepartmentsView from './components/DepartmentsView';
import ActivityLog from './components/ActivityLog';
import UserActivity from './components/UserActivity';
import { trackScreen } from './lib/activityTracker';
import IngestionLog from './components/IngestionLog';
import NotificationsCenter from './components/NotificationsCenter';
import Layout, { PAGE_META } from './components/Layout';
import AccessDeniedNotice from './components/AccessDeniedNotice';
import NewDashboard from './components/NewDashboard';
import ManualMetricsInput from './components/ManualMetricsInput';
import MetricIntervalsConfig from './components/MetricIntervalsConfig';
import ParametersConfiguration from './components/ParametersConfiguration';
import TeamTvView from './components/TeamTvView';
import CompareTeams from './components/CompareTeams';
import ExecutiveSummary from './components/ExecutiveSummary';
import TimeLost from './components/navigator/TimeLost';
import Findings from './components/navigator/Findings';
import Outcomes from './components/navigator/Outcomes';
import DataReadiness from './components/navigator/DataReadiness';
import UploadFiles from './components/UploadFiles';
import { openTvMode, METRICS_UPDATED_EVENT } from './components/tv/tvNavigation';
import { AnalyticsScopeGate } from './components/AnalyticsScopeBar';
import { useAnalyticsScope, URL_TEAM_PARAM } from './contexts/AnalyticsScopeContext';
import { canOpenView } from './lib/viewAccess';
import { policyActorOf } from './lib/policyActor';
import { loadErrorMessage, NETWORK_ERROR } from './lib/loadError';

// Map views to URL paths
const VIEW_TO_PATH: Record<string, string> = {
  'dashboard': '/',
  'users': '/users',
  'teams': '/teams',
  'departments': '/departments',
  'activity': '/activity',
  'user-activity': '/user-activity',
  'ingestion-log': '/ingestion-log',
  'features': '/analytics',
  'admin-panel': '/admin-panel',
  'manual-metrics': '/manual-metrics',
  'metric-intervals': '/metric-intervals',
  'parameters-config': '/parameters-config',
  'upload-files': '/upload-files',
  'flaky-test-intelligence': '/analytics/flaky-tests',
  'technical-debt': '/analytics/technical-debt',
  'pipeline-visualization': '/analytics/pipeline',
  'business-impact': '/analytics/business-impact',
  'performance-metrics': '/analytics/performance',
  'developer-productivity': '/analytics/productivity',
  'team-pulse': '/analytics/pulse',
  'test-execution-timeline': '/analytics/timeline',
  'team-gamification': '/analytics/gamification',
  'pdf-report-generator': '/analytics/reports',
  'notifications': '/notifications',
  'tv': '/tv',
  'summary': '/summary',
  'compare': '/compare',
  'time-lost': '/time-lost',
  'findings': '/findings',
  'outcomes': '/outcomes',
  'data-readiness': '/data-readiness'
};

const PATH_TO_VIEW = Object.entries(VIEW_TO_PATH).reduce((acc, [view, path]) => {
  acc[path] = view;
  return acc;
}, {} as Record<string, string>);

function App() {
  const { user, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState('all');
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [currentView, setCurrentView] = useState<'dashboard' | 'features' | 'admin-panel' | string>('dashboard');
  const [teams, setTeams] = useState<Team[]>([]);
  const [gridColumns, setGridColumns] = useState<1 | 2 | 3>(1);
  const [userTeams, setUserTeams] = useState<any[]>([]);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const analyticsScope = useAnalyticsScope();
  const [is3DMode, setIs3DMode] = useState(false);
  // A page this role may not open (typed address, old link, rights changed): the overview opens
  // with a message naming that page, instead of a silent redirect. Cleared on the next page change.
  const [deniedPage, setDeniedPage] = useState<string | null>(null);
  const denyAccess = (view: string) => {
    window.history.replaceState(null, '', '/');
    setCurrentView('dashboard');
    setSelectedTeam(null);
    setDeniedPage(PAGE_META[view]?.title ?? 'this page');
  };

  // Handle URL routing on mount and popstate
  useEffect(() => {
    const handleLocationChange = () => {
      // Signed out: keep the address (e.g. an e-mailed TV mode link) so it opens after sign-in.
      if (!user) return;
      const path = window.location.pathname;

      // Find exact match or best match. The analytics team (?team=) is read by
      // AnalyticsScopeContext, which validates it against the user's scope.
      const view = PATH_TO_VIEW[path] || 'dashboard';

      // Check permissions before setting view
      if (hasPermission(view)) {
        setCurrentView(view);
        if (view !== 'dashboard') setDeniedPage(null);
      } else {
        // Not for this role: the overview, with a message naming the page.
        denyAccess(view);
      }
    };

    // Initial check
    if (!isLoading) {
      handleLocationChange();
    }

    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, [isLoading, user]); // Re-run when user loads to enforce permissions

  // Update URL when view changes
  const handleViewChange = (view: string) => {
    const path = VIEW_TO_PATH[view];
    if (path) {
      // Analytics views carry the selected team in the URL (?team=), so links and reloads keep it.
      const teamId = path.startsWith('/analytics') ? analyticsScope.teamId : null;
      const url = teamId ? `${path}?${URL_TEAM_PARAM}=${encodeURIComponent(teamId)}` : path;
      window.history.pushState(null, '', url);
    }
    setDeniedPage(null);
    setCurrentView(view);
  };

  // Permission check: the one rule shared with the navigation and the Analytics hub
  // (src/lib/viewAccess.ts, built on server/lib/userPolicy.ts, which the API enforces too).
  const hasPermission = (view: string): boolean => (user ? canOpenView(policyActorOf(user), view) : view === 'dashboard');


  // not recorded there (its access goes to the platform log and the company's Activity log).
  useEffect(() => {
    if (!user?.id || isLoading) return;
    if (selectedTeam) trackScreen('team-detail', selectedTeam.id);
    else trackScreen(currentView, VIEW_TO_PATH[currentView]?.startsWith('/analytics') ? analyticsScope.teamId : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one event per screen / team change (the team object itself refreshes)
  }, [user?.id, isLoading, currentView, selectedTeam?.id, analyticsScope.teamId]);

  // Fetch departments and teams based on user role
  useEffect(() => {
    if (user?.id) {
      fetchDepartmentsAndTeams();
    }
  }, [user?.id]);

  const fetchDepartmentsAndTeams = async () => {
    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json'
      };

      try {
        const teamsResponse = await fetch(`${API_URL}/teams`, {
          headers,
          credentials: 'include'
        });
        if (teamsResponse.ok) {
          const { teams: teamsData } = await teamsResponse.json();
          setTeams(teamsData);
          setUserTeams(teamsData);
          setTeamsError(null);
        } else {
          setTeamsError(await loadErrorMessage(teamsResponse, 'the teams'));
        }
      } catch (error) {
        console.error('Error fetching teams:', error);
        setTeamsError(NETWORK_ERROR('the teams'));
      }
    } catch (error) {
      console.error('Error fetching departments and teams:', error);
    }
  };

  // Live refresh: when team KPIs change (manual entry or API ingestion) the server
  // broadcasts JOB_NOTIFICATION with source 'metrics' over /ws; refetch the teams so
  // open dashboards (and an open team detail view) show the new scores.
  useEffect(() => {
    if (!user?.id) return;
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsHost = isLocal ? 'localhost:3000' : window.location.host;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      ws = new WebSocket(`${protocol}://${wsHost}/ws`);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'JOB_NOTIFICATION' && data.source === 'metrics') {
            clearTimeout(timer);
            timer = setTimeout(() => { fetchDepartmentsAndTeams(); }, 500);
            window.dispatchEvent(new Event(METRICS_UPDATED_EVENT)); // TV mode refreshes too
          }
        } catch { /* ignore malformed messages */ }
      };
      ws.onerror = () => { /* no live channel (e.g. serverless) — ignore */ };
    } catch { /* WebSocket unsupported in this deployment */ }
    return () => { clearTimeout(timer); ws?.close(); };
  }, [user?.id]);

  // Open a team's wellbeing pulse (the pending-survey banner): the team becomes the analytics scope.
  const openPulse = (teamId: string) => {
    analyticsScope.setTeamId(teamId);
    window.history.pushState(null, '', `${VIEW_TO_PATH['team-pulse']}?${URL_TEAM_PARAM}=${encodeURIComponent(teamId)}`);
    setSelectedTeam(null);
    setCurrentView('team-pulse');
  };

  // Open a team's detail view by id (Departments page). The list may be stale after a team
  // moved department, so a miss refetches it once.
  const openTeamById = async (teamId: string) => {
    let team = teams.find((t) => t.id === teamId);
    if (!team) {
      try {
        const res = await fetch(`${API_URL}/teams`, { credentials: 'include' });
        if (res.ok) {
          const { teams: list } = await res.json();
          setTeams(list);
          setUserTeams(list);
          team = (list as Team[]).find((t) => t.id === teamId);
        }
      } catch { /* handled below */ }
    }
    if (team) setSelectedTeam(team);
  };

  // Keep an open team detail view in sync with refreshed team data.
  useEffect(() => {
    setSelectedTeam(prev => (prev ? (teams.find(t => t.id === prev.id) ?? prev) : prev));
  }, [teams]);

  // Use API teams if available, otherwise fall back to mock teams
  const apiTeams = userTeams.length > 0 ? userTeams : teams;

  // GET /api/teams lists only the teams of the caller's analytics scope (the server decides);
  // selecting a department tab just narrows that list by department.
  let filteredTeams = apiTeams;

  if (activeTab !== 'all') {
    filteredTeams = apiTeams.filter((t: any) => t.department_id === activeTab);
  }

  const handleFeatureSelect = (featureId: string) => {
    handleViewChange(featureId);
  };

  // Enforce permissions on render
  if (!hasPermission(currentView) && !isLoading) {
    // A restricted view (rights changed while open, or a wrong initial state): the overview, with
    // the same message as a typed address.
    const view = currentView;
    setTimeout(() => denyAccess(view), 0);
    return null; // Or loading spinner
  }

  // Team TV / meeting mode: full screen, no app chrome. Exit returns to where it was opened.
  if (currentView === 'tv') return <TeamTvView />;

  // If a team is selected, show detail view (sidebar hidden, top bar visible)
  if (selectedTeam) {
    return (
      <Layout
        currentView={currentView}
        onViewChange={(view) => {
          setSelectedTeam(null);
          handleViewChange(view);
        }}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        hideSidebar
        onOpenPulse={openPulse}
      >
        <TeamDetailView
          team={selectedTeam}
          onBack={() => setSelectedTeam(null)}
          onOpenTv={openTvMode}
          onOpenPulse={(teamId) => {
            // Wellbeing pulse of this team (Analytics module, the team becomes the analytics scope).
            analyticsScope.setTeamId(teamId);
            window.history.pushState(null, '', `${VIEW_TO_PATH['team-pulse']}?${URL_TEAM_PARAM}=${encodeURIComponent(teamId)}`);
            setSelectedTeam(null);
            setCurrentView('team-pulse');
          }}
        />
      </Layout>
    );
  }

  // Helper to render layout
  const renderLayout = (content: React.ReactNode) => (
    <Layout
      currentView={currentView}
      onViewChange={handleViewChange}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      gridColumns={gridColumns}
      onGridChange={setGridColumns}
      is3DMode={is3DMode}
      on3DModeChange={setIs3DMode}
      onOpenPulse={openPulse}
    >
      {content}
    </Layout>
  );

  // Views
  if (currentView === 'users') return renderLayout(<UsersView is3DMode={is3DMode} />);
  if (currentView === 'teams') return renderLayout(<TeamsView is3DMode={is3DMode} />);
  if (currentView === 'departments') {
    return renderLayout(
      <DepartmentsView
        onOpenTeam={openTeamById}
        onTeamsChanged={() => { fetchDepartmentsAndTeams(); analyticsScope.reload(); }}
      />
    );
  }

  if (currentView === 'features') {
    return renderLayout(
      <FeaturesMenu onBack={() => handleViewChange('dashboard')} onSelectFeature={handleFeatureSelect} />
    );
  }

  // Analytics modules: the shared scope bar on top, each module for exactly one team.
  const toHub = () => handleViewChange('features');
  const analytics = (render: (teamId: string) => React.ReactNode, note?: React.ReactNode) =>
    renderLayout(<AnalyticsScopeGate note={note}>{(team) => render(team.id)}</AnalyticsScopeGate>);
  const individualsNote = analyticsScope.canViewIndividuals
    ? 'Individual developer metrics: team members who opted in. Team figures need at least 3 of them.'
    : 'Individual developer metrics: only your own. Team figures are averages of at least 3 developers who opted in.';

  if (currentView === 'flaky-test-intelligence') return analytics((id) => <FlakyTestIntelligence onBack={toHub} teamId={id} />);
  if (currentView === 'technical-debt') return analytics((id) => <TechnicalDebtTracker onBack={toHub} teamId={id} />);
  if (currentView === 'pipeline-visualization') return analytics((id) => <PipelineVisualization onBack={toHub} teamId={id} />);
  if (currentView === 'business-impact') return analytics((id) => <BusinessImpactAnalysisV2 onBack={toHub} teamId={id} />);
  if (currentView === 'performance-metrics') return analytics((id) => <PerformanceTesting onBack={toHub} teamId={id} />);
  if (currentView === 'developer-productivity') return analytics((id) => <DeveloperProductivity onBack={toHub} teamId={id} />, individualsNote);
  if (currentView === 'team-pulse') return analytics((id) => <PulseSurvey teamId={id} />, 'Survey answers are anonymous; results are team averages with at least 3 responses.');
  if (currentView === 'test-execution-timeline') return analytics((id) => <TestExecutionTimeline onBack={toHub} teamId={id} />);
  if (currentView === 'team-gamification') return analytics((id) => <TeamGamification onBack={toHub} teamId={id} />, 'Rankings compare the teams of the selected department; the selected team is highlighted.');
  if (currentView === 'pdf-report-generator') return analytics((id) => <PDFReportGenerator onBack={toHub} teamId={id} />, 'The report covers the selected team.');

  if (currentView === 'compare') return renderLayout(<CompareTeams />);
  if (currentView === 'summary') return renderLayout(<ExecutiveSummary />);
  if (currentView === 'time-lost') return renderLayout(<TimeLost onNavigate={handleViewChange} />);
  if (currentView === 'findings') return renderLayout(<Findings />);
  if (currentView === 'outcomes') return renderLayout(<Outcomes onNavigate={handleViewChange} />);
  if (currentView === 'data-readiness') return renderLayout(<DataReadiness />);
  if (currentView === 'activity') return renderLayout(<ActivityLog />);
  if (currentView === 'user-activity') return renderLayout(<UserActivity />);
  if (currentView === 'ingestion-log') return renderLayout(<IngestionLog />);
  if (currentView === 'upload-files') return renderLayout(<UploadFiles />);
  if (currentView === 'notifications') return renderLayout(<NotificationsCenter />);
  if (currentView === 'admin-panel') return renderLayout(<AdminPanel />);
  if (currentView === 'manual-metrics') return renderLayout(<ManualMetricsInput onBack={() => handleViewChange('dashboard')} />);
  if (currentView === 'metric-intervals') return renderLayout(<MetricIntervalsConfig onBack={() => handleViewChange('dashboard')} />);
  if (currentView === 'parameters-config') return renderLayout(<ParametersConfiguration onBack={() => handleViewChange('admin-panel')} />);

  return (
    <>
      <Layout
        currentView={currentView}
        onViewChange={handleViewChange}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        gridColumns={gridColumns}
        onGridChange={setGridColumns}
        is3DMode={is3DMode}
        on3DModeChange={setIs3DMode}
        onOpenPulse={openPulse}
      >
        {deniedPage && <AccessDeniedNotice page={deniedPage} onDismiss={() => setDeniedPage(null)} />}
        <NewDashboard teams={filteredTeams} teamsError={teamsError} onTeamClick={setSelectedTeam} gridColumns={gridColumns} is3DMode={is3DMode} />
      </Layout>
    </>
  );
}

export default App;
