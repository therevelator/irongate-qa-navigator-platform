import { useState, useEffect } from 'react';
import { LayoutDashboard, Smartphone, ShoppingCart, Server, CreditCard, Sparkles, Settings, LogOut, Shield, Building2 } from 'lucide-react';
import { generateMockData } from './data/mockData';
import type { Team } from './data/mockData';
import { useAuth } from './contexts/AuthContext';
import { ROLE_PERMISSIONS, getRoleIcon, getRoleBadgeColor } from './types/auth';
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

interface Department {
  id: string;
  name: string;
  company_id: string;
}

function App() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('all');
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [currentView, setCurrentView] = useState<'dashboard' | 'features' | 'manage-teams' | 'admin-panel' | string>('dashboard');
  const [teams, setTeams] = useState<Team[]>(generateMockData());
  const [departments, setDepartments] = useState<Department[]>([]);
  const [userTeams, setUserTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch departments and teams based on user role
  useEffect(() => {
    if (user?.id) {
      fetchDepartmentsAndTeams();
    }
  }, [user?.id]);

  const fetchDepartmentsAndTeams = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('irongate_token');
      
      if (!token) {
        setLoading(false);
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
      } catch (err) {
        console.error('Error fetching teams:', err);
        // Continue even if teams fail
      }

      setLoading(false);
    } catch (error) {
      console.error('Error fetching departments and teams:', error);
      setLoading(false);
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
    return <TeamDetailView team={selectedTeam} onBack={() => setSelectedTeam(null)} />;
  }

  // If features menu is open
  if (currentView === 'features') {
    return <FeaturesMenu onBack={() => setCurrentView('dashboard')} onSelectFeature={handleFeatureSelect} />;
  }

  // If a specific feature is selected
  if (currentView === 'flaky-test-intelligence') {
    return <FlakyTestIntelligence onBack={() => setCurrentView('features')} />;
  }

  if (currentView === 'technical-debt') {
    return <TechnicalDebtTracker onBack={() => setCurrentView('features')} />;
  }

  if (currentView === 'pipeline-visualization') {
    return <PipelineVisualization onBack={() => setCurrentView('features')} />;
  }

  if (currentView === 'business-impact') {
    return <BusinessImpactAnalysis onBack={() => setCurrentView('features')} />;
  }

  if (currentView === 'performance-metrics') {
    return <PerformanceTesting onBack={() => setCurrentView('features')} />;
  }

  if (currentView === 'developer-productivity') {
    return <DeveloperProductivity onBack={() => setCurrentView('features')} />;
  }

  if (currentView === 'test-case-management') {
    return <TestCaseManagement onBack={() => setCurrentView('features')} />;
  }

  if (currentView === 'test-execution-timeline') {
    return <TestExecutionTimeline onBack={() => setCurrentView('features')} />;
  }

  if (currentView === 'team-gamification') {
    return <TeamGamification onBack={() => setCurrentView('features')} />;
  }

  if (currentView === 'pdf-report-generator') {
    return <PDFReportGenerator onBack={() => setCurrentView('features')} />;
  }

  if (currentView === 'manage-teams') {
    return <TeamManagement teams={teams} onBack={() => setCurrentView('dashboard')} onUpdateTeams={setTeams} />;
  }

  if (currentView === 'admin-panel') {
    return <AdminPanel onBack={() => setCurrentView('dashboard')} />;
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center space-x-3 mb-2">
            <img src="/irongate-logo.png" alt="IronGate" className="w-12 h-12 rounded-lg" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            <div>
              <h1 className="text-xl font-bold text-white">IronGate</h1>
              <p className="text-slate-400 text-xs">SOFTWARE LTD</p>
            </div>
          </div>
          <p className="text-slate-500 text-xs mt-2">QA Navigator Platform</p>
        </div>
        
        <nav className="flex-1 px-4 py-4 space-y-2 overflow-y-auto">
          <button 
            onClick={() => setActiveTab('all')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'all' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
          >
            <LayoutDashboard size={20} />
            <span>All Teams</span>
          </button>
          
          {departments.length > 0 && (
            <>
              <div className="pt-4 pb-2 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Departments
              </div>

              {departments.map((dept) => {
                const Icon = getDepartmentIcon(dept.name);
                return (
                  <button
                    key={dept.id}
                    onClick={() => setActiveTab(dept.id)}
                    className={`w-full flex items-center space-x-3 px-4 py-2.5 rounded-lg transition-colors ${
                      activeTab === dept.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <Icon size={18} className="flex-shrink-0" />
                    <span className="text-sm truncate">{dept.name}</span>
                  </button>
                );
              })}
            </>
          )}

          <div className="pt-4 pb-2 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Advanced
          </div>

          <button
            onClick={() => setCurrentView('features')}
            className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-400 hover:bg-slate-800 transition-colors"
          >
            <Sparkles size={20} />
            <span>Advanced Features</span>
          </button>
          
          {(user?.role === 'super_admin' || user?.role === 'qa_manager') && (
            <>
              <button
                onClick={() => setCurrentView('admin-panel')}
                className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-400 hover:bg-slate-800 transition-colors"
              >
                <Shield size={20} />
                <span>Admin Panel</span>
              </button>
              
              <button
                onClick={() => setCurrentView('manage-teams')}
                className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-400 hover:bg-slate-800 transition-colors"
              >
                <Settings size={20} />
                <span>Manage Teams</span>
              </button>
            </>
          )}
        </nav>
        
        <div className="p-4 border-t border-slate-800">
          <div className="mb-3">
            <div className="flex items-center space-x-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-bold text-white text-lg">
                {user?.firstName.charAt(0)}{user?.lastName.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-xs text-slate-400 truncate">{user?.email}</p>
              </div>
            </div>
            <div className={`inline-flex items-center px-2 py-1 rounded text-xs font-semibold border ${user ? getRoleBadgeColor(user.role) : ''}`}>
              <span className="mr-1">{user ? getRoleIcon(user.role) : ''}</span>
              {user ? ROLE_PERMISSIONS[user.role].name : ''}
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm font-medium"
          >
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto flex flex-col bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50">
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
        <footer className="bg-white border-t border-gray-200 px-8 py-6 mt-auto">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <div className="flex items-center space-x-2">
              <img src="/irongate-logo.png" alt="IronGate" className="w-6 h-6 rounded" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              <span className="font-semibold">IronGate Software LTD</span>
            </div>
            <div className="flex items-center space-x-6">
              <span>© {new Date().getFullYear()} IronGate Software LTD. All rights reserved.</span>
              <span className="text-gray-400">|</span>
              <span className="text-gray-500">QA Navigator Platform v1.0</span>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

export default App;
