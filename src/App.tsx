import { useState, useEffect } from 'react';
import { Smartphone, ShoppingCart, Server, CreditCard, Building2 } from 'lucide-react';
import type { Team } from './data/mockData';
import { useAuth } from './contexts/AuthContext';
import TeamRow from './components/TeamRow';
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
import Layout from './components/Layout';

interface Department {
  id: string;
  name: string;
  company_id: string;
}

function App() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('all');
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [currentView, setCurrentView] = useState<'dashboard' | 'features' | 'manage-teams' | 'admin-panel' | string>('dashboard');
  const [teams, setTeams] = useState<Team[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
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

      // Fetch departments
      try {
        const deptResponse = await fetch('http://localhost:3000/api/admin/departments', { headers });
        if (deptResponse.ok) {
          const deptData = await deptResponse.json();
          
          // Filter departments based on user role
          if (user?.role === 'super_admin') {
            setDepartments(deptData);
          } else if (user?.role === 'qa_manager') {
            // QA Manager sees their department
            const userDept = deptData.filter((d: Department) => d.id === user.departmentId);
            setDepartments(userDept);
          } else if (user?.role === 'team_lead' || user?.role === 'qa_engineer') {
            // Team Lead and QA Engineer see only their department
            const userDept = deptData.filter((d: Department) => d.id === user.departmentId);
            setDepartments(userDept);
          }
        }
      } catch (err) {
        console.error('Error fetching departments:', err);
        // Continue even if departments fail
      }

      // Fetch teams
      try {
        const teamsResponse = await fetch('http://localhost:3000/api/admin/teams', { headers });
        if (teamsResponse.ok) {
          const teamsData = await teamsResponse.json();
          setUserTeams(teamsData);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    } catch (error) {
      console.error('Error fetching departments and teams:', error);
    }
  };

  // Calculate overall stats
  const avgScore = teams.length > 0 ? Math.round(teams.reduce((acc, t) => acc + t.qaScore, 0) / teams.length) : 0;
  
  // Filter teams based on active tab and user permissions
  let filteredTeams = teams;
  
  if (activeTab !== 'all') {
    // Filter by department ID
    const selectedDept = departments.find(d => d.id === activeTab);
    if (selectedDept) {
      // For now, keep using mock data department names
      // In production, you'd filter userTeams by department_id
      filteredTeams = teams.filter(t => t.department.toLowerCase() === selectedDept.name.toLowerCase());
    }
  }
  
  // Apply role-based filtering
  if (user?.role === 'team_lead' || user?.role === 'qa_engineer') {
    // Team leads and QA engineers see only their team
    if (user.primaryTeamId) {
      const userTeamData = userTeams.find(t => t.id === user.primaryTeamId);
      if (userTeamData) {
        // Filter to show only user's team
        filteredTeams = filteredTeams.filter(t => t.name === userTeamData.name);
      }
    }
  }

  // Get icon for department
  const getDepartmentIcon = (deptName: string) => {
    const name = deptName.toLowerCase();
    if (name.includes('payment') || name.includes('fintech')) return CreditCard;
    if (name.includes('platform') || name.includes('backend')) return Server;
    if (name.includes('mobile') || name.includes('frontend') || name.includes('digital')) return Smartphone;
    if (name.includes('commerce')) return ShoppingCart;
    return Building2;
  };

  // Handle feature navigation
  const handleFeatureSelect = (featureId: string) => {
    setCurrentView(featureId);
  };

  // If a team is selected, show detail view
  if (selectedTeam) {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView}>
        <TeamDetailView team={selectedTeam} onBack={() => setSelectedTeam(null)} />
      </Layout>
    );
  }

  // If features menu is open
  if (currentView === 'features') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView}>
        <FeaturesMenu onBack={() => setCurrentView('dashboard')} onSelectFeature={handleFeatureSelect} />
      </Layout>
    );
  }

  // If a specific feature is selected
  if (currentView === 'flaky-test-intelligence') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView}>
        <FlakyTestIntelligence onBack={() => setCurrentView('features')} />
      </Layout>
    );
  }

  if (currentView === 'technical-debt-tracker') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView}>
        <TechnicalDebtTracker onBack={() => setCurrentView('features')} />
      </Layout>
    );
  }

  if (currentView === 'pipeline-visualization') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView}>
        <PipelineVisualization onBack={() => setCurrentView('features')} />
      </Layout>
    );
  }

  if (currentView === 'business-impact-analysis') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView}>
        <BusinessImpactAnalysis onBack={() => setCurrentView('features')} />
      </Layout>
    );
  }

  if (currentView === 'performance-testing') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView}>
        <PerformanceTesting onBack={() => setCurrentView('features')} />
      </Layout>
    );
  }

  if (currentView === 'developer-productivity') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView}>
        <DeveloperProductivity onBack={() => setCurrentView('features')} />
      </Layout>
    );
  }

  if (currentView === 'test-case-management') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView}>
        <TestCaseManagement onBack={() => setCurrentView('features')} />
      </Layout>
    );
  }

  if (currentView === 'test-execution-timeline') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView}>
        <TestExecutionTimeline onBack={() => setCurrentView('features')} />
      </Layout>
    );
  }

  if (currentView === 'team-gamification') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView}>
        <TeamGamification onBack={() => setCurrentView('features')} />
      </Layout>
    );
  }

  if (currentView === 'pdf-report-generator') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView}>
        <PDFReportGenerator onBack={() => setCurrentView('features')} />
      </Layout>
    );
  }

  if (currentView === 'manage-teams') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView}>
        <TeamManagement teams={teams} onBack={() => setCurrentView('dashboard')} onUpdateTeams={setTeams} />
      </Layout>
    );
  }

  if (currentView === 'admin-panel') {
    return (
      <Layout currentView={currentView} onViewChange={setCurrentView}>
        <AdminPanel onBack={() => setCurrentView('dashboard')} />
      </Layout>
    );
  }

  return (
    <Layout currentView={currentView} onViewChange={setCurrentView}>
      {/* Main Dashboard Content */}
      <div className="flex flex-col h-full">
        {/* Hero Header */}
        <header className="bg-white/80 backdrop-blur-sm border-b border-slate-200 px-8 py-8">
          <div className="max-w-7xl mx-auto">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-3xl font-bold text-slate-900 mb-2">
                  {activeTab === 'all' ? 'Organization Overview' : departments.find(d => d.id === activeTab)?.name || 'Teams'}
                </h1>
                <p className="text-slate-600 flex items-center gap-2">
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                    {filteredTeams.length} Active Teams
                  </span>
                  <span className="text-slate-400">•</span>
                  <span className="text-sm">Real-time quality metrics</span>
                </p>
              </div>
              
              {/* Score Card */}
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl shadow-lg p-6 min-w-[180px]">
                <p className="text-blue-100 text-sm font-medium mb-1">Overall QA Score</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-bold text-white">{avgScore}</span>
                  <span className="text-2xl text-blue-100">/100</span>
                </div>
                <div className="mt-3 h-2 bg-blue-400/30 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-white rounded-full transition-all duration-500"
                    style={{ width: `${avgScore}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <div className="flex-1 px-8 py-6">
          <div className="max-w-7xl mx-auto space-y-4">
             {filteredTeams.map(team => (
               <TeamRow key={team.id} team={team} onClick={() => setSelectedTeam(team)} />
             ))}
          </div>
        </div>

        {/* Footer */}
        <footer className="bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 px-8 py-6 mt-auto">
          <div className="flex items-center justify-between text-sm text-gray-600 dark:text-slate-400">
            <div className="flex items-center space-x-2">
              <img src="/irongate-logo.png" alt="IronGate" className="w-6 h-6 rounded" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              <span className="font-semibold">IronGate Software LTD</span>
            </div>
            <div className="flex items-center space-x-6">
              <span>© {new Date().getFullYear()} IronGate Software LTD. All rights reserved.</span>
              <span className="text-gray-400 dark:text-slate-600">|</span>
              <span className="text-gray-500 dark:text-slate-500">QA Navigator Platform v1.0</span>
            </div>
          </div>
        </footer>
      </div>
    </Layout>
  );
}

export default App;
