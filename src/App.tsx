import { useState } from 'react';
import { LayoutDashboard, Smartphone, ShoppingCart, Server, CreditCard, Sparkles, Settings, LogOut } from 'lucide-react';
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

function App() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('all');
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [currentView, setCurrentView] = useState<'dashboard' | 'features' | 'manage-teams' | string>('dashboard');
  const [teams, setTeams] = useState<Team[]>(generateMockData());

  // Calculate overall stats
  const avgScore = Math.round(teams.reduce((acc, t) => acc + t.qaScore, 0) / teams.length);
  
  const filteredTeams = activeTab === 'all' 
    ? teams 
    : teams.filter(t => t.department.toLowerCase() === activeTab);

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

  if (currentView === 'manage-teams') {
    return <TeamManagement teams={teams} onBack={() => setCurrentView('dashboard')} onUpdateTeams={setTeams} />;
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
        
        <nav className="flex-1 px-4 space-y-2">
          <button 
            onClick={() => setActiveTab('all')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'all' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
          >
            <LayoutDashboard size={20} />
            <span>All Teams</span>
          </button>
          
          <div className="pt-4 pb-2 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Departments
          </div>

          <button 
            onClick={() => setActiveTab('e-commerce')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'e-commerce' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
          >
            <ShoppingCart size={20} />
            <span>E-Commerce</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('platform')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'platform' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
          >
            <Server size={20} />
            <span>Platform</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('frontend')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'frontend' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
          >
            <Smartphone size={20} />
            <span>Frontend</span>
          </button>

           <button 
            onClick={() => setActiveTab('fintech')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'fintech' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
          >
            <CreditCard size={20} />
            <span>FinTech</span>
          </button>

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
          
          <button
            onClick={() => setCurrentView('manage-teams')}
            className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-400 hover:bg-slate-800 transition-colors mt-auto"
          >
            <Settings size={20} />
            <span>Manage Teams</span>
          </button>
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
      <main className="flex-1 overflow-y-auto">
        <header className="bg-white shadow-sm border-b px-8 py-6 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {activeTab === 'all' ? 'Organization Overview' : `${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Teams`}
            </h2>
            <p className="text-sm text-gray-500 mt-1">Real-time quality metrics across {filteredTeams.length} active teams</p>
          </div>
          
          <div className="flex items-center space-x-6">
            <div className="text-right">
              <p className="text-sm text-gray-500">Overall QA Score</p>
              <div className="text-3xl font-bold text-gray-900">{avgScore}/100</div>
            </div>
            <div className="h-12 w-12 rounded-full border-4 border-green-500 flex items-center justify-center font-bold text-green-600">
              {avgScore}
            </div>
          </div>
        </header>

        <div className="p-8">
          <div className="space-y-6">
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
