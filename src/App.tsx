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

function App() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('all');
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [currentView, setCurrentView] = useState<'dashboard' | 'features' | 'manage-teams' | 'admin-panel' | string>('dashboard');
  const [teams, setTeams] = useState<Team[]>([]);
  const [gridColumns, setGridColumns] = useState<1 | 2 | 3>(1);
  const [userTeams, setUserTeams] = useState<any[]>([]);
  const [analyticsTeamId, setAnalyticsTeamId] = useState<string | undefined>(undefined);
  const [is3DMode, setIs3DMode] = useState(true); // Default to 3D mode

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
      
      // Fetch teams with metrics from database
      try {
        const teamsResponse = await fetch(`${API_URL}/teams`, { 
          headers,
          credentials: 'include' // Use cookies for auth
        });
        if (teamsResponse.ok) {
          const { teams: teamsData } = await teamsResponse.json();
          
          // Teams are already transformed by the API
          setTeams(teamsData);
          setUserTeams(teamsData);
          console.log('Fetched teams from database:', teamsData);
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
  
  // Filter teams based on active tab and user permissions
  let filteredTeams = apiTeams;
  
  if (activeTab !== 'all') {
    // Filter by department ID from API teams
    filteredTeams = apiTeams.filter((t: any) => t.department_id === activeTab);
  }
  
  // Apply role-based filtering
  if (user?.role === 'qa_engineer') {
    // QA engineers see only their team on dashboard
    filteredTeams = filteredTeams.filter((t: any) => t.id === user?.primaryTeamId);
  } else if (user?.role === 'qa_manager') {
    // QA managers see teams in their department
    if (activeTab === 'all') {
      filteredTeams = filteredTeams.filter((t: any) => t.department_id === user?.departmentId);
    }
  }
  // Team leads see all teams on dashboard (no filtering needed)
  
  // Handle feature navigation with optional team context
  const handleFeatureSelect = (featureId: string, teamId?: string) => {
    setAnalyticsTeamId(teamId);
    setCurrentView(featureId);
  };

  // If a team is selected, show detail view (sidebar hidden, top bar visible)
  if (selectedTeam) {
    return (
      <Layout 
        currentView={currentView} 
        onViewChange={(view) => {
          setSelectedTeam(null); // Clear selected team when navigating
          setCurrentView(view);
        }} 
        activeTab={activeTab} 
        onTabChange={setActiveTab}
        hideSidebar
      >
        <TeamDetailView team={selectedTeam} onBack={() => setSelectedTeam(null)} />
      </Layout>
    );
  }

  // Users View
  if (currentView === 'users') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <UsersView />
      </Layout>
    );
  }

  // Teams View
  if (currentView === 'teams') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <TeamsView />
      </Layout>
    );
  }

  // Departments View
  if (currentView === 'departments') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <DepartmentsView />
      </Layout>
    );
  }

  // If features menu is open (Analytics)
  if (currentView === 'features') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <FeaturesMenu onBack={() => setCurrentView('dashboard')} onSelectFeature={handleFeatureSelect} />
      </Layout>
    );
  }

  // If a specific feature is selected
  if (currentView === 'flaky-test-intelligence') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <FlakyTestIntelligence onBack={() => setCurrentView('features')} />
      </Layout>
    );
  }

  if (currentView === 'technical-debt') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <TechnicalDebtTracker onBack={() => setCurrentView('features')} />
      </Layout>
    );
  }

  if (currentView === 'pipeline-visualization') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <PipelineVisualization onBack={() => setCurrentView('features')} teamId={analyticsTeamId} />
      </Layout>
    );
  }

  if (currentView === 'business-impact') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <BusinessImpactAnalysisV2 onBack={() => setCurrentView('features')} teamId={analyticsTeamId} />
      </Layout>
    );
  }

  if (currentView === 'performance-metrics') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <PerformanceTesting onBack={() => setCurrentView('features')} />
      </Layout>
    );
  }

  if (currentView === 'developer-productivity') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <DeveloperProductivity onBack={() => setCurrentView('features')} teamId={analyticsTeamId} />
      </Layout>
    );
  }

  if (currentView === 'test-execution-timeline') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <TestExecutionTimeline onBack={() => setCurrentView('features')} />
      </Layout>
    );
  }

  if (currentView === 'team-gamification') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <TeamGamification onBack={() => setCurrentView('features')} />
      </Layout>
    );
  }

  if (currentView === 'pdf-report-generator') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <PDFReportGenerator onBack={() => setCurrentView('features')} />
      </Layout>
    );
  }

  if (currentView === 'manage-teams') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <TeamManagement teams={teams} onBack={() => setCurrentView('dashboard')} onUpdateTeams={setTeams} />
      </Layout>
    );
  }

  if (currentView === 'admin-panel') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <AdminPanel />
      </Layout>
    );
  }

  if (currentView === 'manual-metrics') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <ManualMetricsInput onBack={() => setCurrentView('dashboard')} />
      </Layout>
    );
  }

  if (currentView === 'metric-intervals') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <MetricIntervalsConfig onBack={() => setCurrentView('dashboard')} />
      </Layout>
    );
  }

  if (currentView === 'parameters-config') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <ParametersConfiguration onBack={() => setCurrentView('admin-panel')} />
      </Layout>
    );
  }

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
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab} gridColumns={gridColumns} onGridChange={setGridColumns} is3DMode={is3DMode} on3DModeChange={setIs3DMode}>
        <NewDashboard teams={filteredTeams} onTeamClick={setSelectedTeam} gridColumns={gridColumns} is3DMode={is3DMode} />
      </Layout>
    </>
  );
}

export default App;
