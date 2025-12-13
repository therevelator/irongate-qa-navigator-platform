import { useState, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
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
import DeveloperProductivity from './components/DeveloperProductivity';
import TestExecutionTimeline from './components/TestExecutionTimeline';
import TeamGamification from './components/TeamGamification';
import TeamManagement from './components/TeamManagement';
import AdminPanel from './components/AdminPanel';
import PDFReportGenerator from './components/PDFReportGenerator';
import UsersView from './components/UsersView';
import TeamsView from './components/TeamsView';
import DepartmentsView from './components/DepartmentsView';
import Layout from './components/Layout';
import NewDashboard from './components/NewDashboard';
import ManualMetricsInput from './components/ManualMetricsInput';
import MetricIntervalsConfig from './components/MetricIntervalsConfig';
import ParametersConfiguration from './components/ParametersConfiguration';

// Map views to URL paths
const VIEW_TO_PATH: Record<string, string> = {
  'dashboard': '/',
  'users': '/users',
  'teams': '/teams',
  'departments': '/departments',
  'features': '/analytics',
  'manage-teams': '/manage-teams',
  'admin-panel': '/admin-panel',
  'manual-metrics': '/manual-metrics',
  'metric-intervals': '/metric-intervals',
  'parameters-config': '/parameters-config',
  'flaky-test-intelligence': '/analytics/flaky-tests',
  'technical-debt': '/analytics/technical-debt',
  'pipeline-visualization': '/analytics/pipeline',
  'business-impact': '/analytics/business-impact',
  'performance-metrics': '/analytics/performance',
  'developer-productivity': '/analytics/productivity',
  'test-execution-timeline': '/analytics/timeline',
  'team-gamification': '/analytics/gamification',
  'pdf-report-generator': '/analytics/reports'
};

const PATH_TO_VIEW = Object.entries(VIEW_TO_PATH).reduce((acc, [view, path]) => {
  acc[path] = view;
  return acc;
}, {} as Record<string, string>);

function App() {
  const { user, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState('all');
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [currentView, setCurrentView] = useState<'dashboard' | 'features' | 'manage-teams' | 'admin-panel' | string>('dashboard');
  const [teams, setTeams] = useState<Team[]>([]);
  const [gridColumns, setGridColumns] = useState<1 | 2 | 3>(1);
  const [userTeams, setUserTeams] = useState<any[]>([]);
  const [analyticsTeamId, setAnalyticsTeamId] = useState<string | undefined>(undefined);
  const [is3DMode, setIs3DMode] = useState(true);

  // Handle URL routing on mount and popstate
  useEffect(() => {
    const handleLocationChange = () => {
      const path = window.location.pathname;
      // Find exact match or best match
      const view = PATH_TO_VIEW[path] || 'dashboard';

      // Check permissions before setting view
      if (hasPermission(view)) {
        setCurrentView(view);
      } else {
        // Redirect to dashboard if not authorized
        window.history.replaceState(null, '', '/');
        setCurrentView('dashboard');
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
      window.history.pushState(null, '', path);
    }
    setCurrentView(view);
  };

  // Permission check function
  const hasPermission = (view: string): boolean => {
    if (!user) return view === 'dashboard'; // Guest only sees dashboard (or login)

    const role = user.role;

    switch (view) {
      case 'dashboard':
        return true;
      case 'users':
      case 'teams':
        return ['super_admin', 'qa_manager', 'team_lead'].includes(role);
      case 'departments':
        return role === 'super_admin';
      case 'features':
      case 'flaky-test-intelligence':
      case 'technical-debt':
      case 'pipeline-visualization':
      case 'business-impact':
      case 'performance-metrics':
      case 'developer-productivity':
      case 'test-execution-timeline':
      case 'team-gamification':
      case 'pdf-report-generator':
        return !['qa_engineer', 'viewer'].includes(role);
      case 'admin-panel':
      case 'metric-intervals':
      case 'parameters-config':
        return ['super_admin', 'qa_manager'].includes(role);
      case 'manual-metrics':
        return role === 'super_admin';
      default:
        return true;
    }
  };

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
        }
      } catch (error) {
        console.error('Error fetching teams:', error);
      }
    } catch (error) {
      console.error('Error fetching departments and teams:', error);
    }
  };

  // Use API teams if available, otherwise fall back to mock teams
  const apiTeams = userTeams.length > 0 ? userTeams : teams;

  // Filter teams based only on active tab (department), not role.
  // Everyone sees all teams by default; selecting a department tab just narrows by department.
  let filteredTeams = apiTeams;

  if (activeTab !== 'all') {
    filteredTeams = apiTeams.filter((t: any) => t.department_id === activeTab);
  }

  const handleFeatureSelect = (featureId: string, teamId?: string) => {
    setAnalyticsTeamId(teamId);
    handleViewChange(featureId);
  };

  // Enforce permissions on render
  if (!hasPermission(currentView) && !isLoading) {
    // If somehow we are in a restricted view, redirect to dashboard
    // This handles cases where permission changes or initial state is wrong
    setTimeout(() => handleViewChange('dashboard'), 0);
    return null; // Or loading spinner
  }

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
      >
        <TeamDetailView team={selectedTeam} onBack={() => setSelectedTeam(null)} />
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
    >
      {content}
    </Layout>
  );

  // Views
  if (currentView === 'users') return renderLayout(<UsersView is3DMode={is3DMode} />);
  if (currentView === 'teams') return renderLayout(<TeamsView />);
  if (currentView === 'departments') return renderLayout(<DepartmentsView />);

  if (currentView === 'features') {
    return renderLayout(
      <FeaturesMenu onBack={() => handleViewChange('dashboard')} onSelectFeature={handleFeatureSelect} />
    );
  }

  if (currentView === 'flaky-test-intelligence') return renderLayout(<FlakyTestIntelligence onBack={() => handleViewChange('features')} />);
  if (currentView === 'technical-debt') return renderLayout(<TechnicalDebtTracker onBack={() => handleViewChange('features')} />);
  if (currentView === 'pipeline-visualization') return renderLayout(<PipelineVisualization onBack={() => handleViewChange('features')} teamId={analyticsTeamId} />);
  if (currentView === 'business-impact') return renderLayout(<BusinessImpactAnalysisV2 onBack={() => handleViewChange('features')} teamId={analyticsTeamId} />);
  if (currentView === 'performance-metrics') return renderLayout(<PerformanceTesting onBack={() => handleViewChange('features')} />);
  if (currentView === 'developer-productivity') return renderLayout(<DeveloperProductivity onBack={() => handleViewChange('features')} teamId={analyticsTeamId} />);
  if (currentView === 'test-execution-timeline') return renderLayout(<TestExecutionTimeline onBack={() => handleViewChange('features')} />);
  if (currentView === 'team-gamification') return renderLayout(<TeamGamification onBack={() => handleViewChange('features')} />);
  if (currentView === 'pdf-report-generator') return renderLayout(<PDFReportGenerator onBack={() => handleViewChange('features')} />);

  if (currentView === 'manage-teams') {
    return renderLayout(
      <TeamManagement teams={teams} onBack={() => handleViewChange('dashboard')} onUpdateTeams={setTeams} />
    );
  }

  if (currentView === 'admin-panel') return renderLayout(<AdminPanel />);
  if (currentView === 'manual-metrics') return renderLayout(<ManualMetricsInput onBack={() => handleViewChange('dashboard')} />);
  if (currentView === 'metric-intervals') return renderLayout(<MetricIntervalsConfig onBack={() => handleViewChange('dashboard')} />);
  if (currentView === 'parameters-config') return renderLayout(<ParametersConfiguration onBack={() => handleViewChange('admin-panel')} />);

  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: '#333',
            color: '#fff',
          },
          success: {
            iconTheme: {
              primary: '#10b981',
              secondary: '#fff',
            },
          },
          error: {
            iconTheme: {
              primary: '#ef4444',
              secondary: '#fff',
            },
          },
        }}
      />
      <Layout
        currentView={currentView}
        onViewChange={handleViewChange}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        gridColumns={gridColumns}
        onGridChange={setGridColumns}
        is3DMode={is3DMode}
        on3DModeChange={setIs3DMode}
      >
        <NewDashboard teams={filteredTeams} onTeamClick={setSelectedTeam} gridColumns={gridColumns} is3DMode={is3DMode} />
      </Layout>
    </>
  );
}

export default App;
