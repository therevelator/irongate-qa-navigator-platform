import { useState, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import type { Team } from './data/mockData';
import { useAuth } from './contexts/AuthContext';
import TeamDetailView from './components/TeamDetailView';
import FeaturesMenu from './components/FeaturesMenu';
import FlakyTestIntelligence from './components/FlakyTestIntelligence';
import TechnicalDebtTracker from './components/TechnicalDebtTracker';
import PipelineVisualization from './components/PipelineVisualization';
import BusinessImpactAnalysis from './components/BusinessImpactAnalysis';
import PerformanceTesting from './components/PerformanceTesting';
import DeveloperProductivity from './components/DeveloperProductivity';
import TestCaseManagement from './components/TestCaseManagement';
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

function App() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('all');
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [currentView, setCurrentView] = useState<'dashboard' | 'features' | 'manage-teams' | 'admin-panel' | string>('dashboard');
  const [teams, setTeams] = useState<Team[]>([]);
  const [userTeams, setUserTeams] = useState<any[]>([]);

  // Fetch departments and teams based on user role
  useEffect(() => {
    if (user?.id) {
      fetchDepartmentsAndTeams();
    }
  }, [user?.id]);

  const fetchDepartmentsAndTeams = async () => {
    try {
      const token = localStorage.getItem('irongate_token');
      
      if (!token) {
        return;
      }
      
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };

      // Fetch teams with metrics from database
      try {
        const teamsResponse = await fetch('http://localhost:3000/api/teams', { headers });
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
  if (user?.role === 'team_lead' || user?.role === 'qa_engineer') {
    // Team leads and QA engineers see only their team
    filteredTeams = filteredTeams.filter((t: any) => t.id === user?.primaryTeamId);
  } else if (user?.role === 'manager') {
    // QA managers see teams in their department
    if (activeTab === 'all') {
      filteredTeams = filteredTeams.filter((t: any) => t.department_id === user?.departmentId);
    }
  }
  
  // Handle feature navigation
  const handleFeatureSelect = (featureId: string) => {
    setCurrentView(featureId);
  };

  // If a team is selected, show detail view
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

  if (currentView === 'technical-debt-tracker') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <TechnicalDebtTracker onBack={() => setCurrentView('features')} />
      </Layout>
    );
  }

  if (currentView === 'pipeline-visualization') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <PipelineVisualization onBack={() => setCurrentView('features')} />
      </Layout>
    );
  }

  if (currentView === 'business-impact') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <BusinessImpactAnalysis onBack={() => setCurrentView('features')} />
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
        <DeveloperProductivity onBack={() => setCurrentView('features')} />
      </Layout>
    );
  }

  if (currentView === 'test-case-management') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <TestCaseManagement onBack={() => setCurrentView('features')} />
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
      <Layout currentView={currentView} onViewChange={setCurrentView} activeTab={activeTab} onTabChange={setActiveTab}>
        <NewDashboard teams={filteredTeams} onTeamClick={setSelectedTeam} />
      </Layout>
    </>
  );
}

export default App;
