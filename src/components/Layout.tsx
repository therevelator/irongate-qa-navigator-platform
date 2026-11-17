import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard, BarChart3, LogOut, Shield, Users as UsersIcon, UsersRound, Building2, Menu, X,
  Calculator, Clock, SlidersHorizontal, Bug, Wrench, GitBranch, TrendingUp, Gauge, Activity,
  CalendarClock, Trophy, FileText, Sun, Moon, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Toaster } from 'react-hot-toast';

interface LayoutProps {
  children: React.ReactNode;
  currentView: string;
  onViewChange: (view: string) => void;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  hideSidebar?: boolean;
  // Kept for API compatibility with callers; no longer rendered.
  gridColumns?: 1 | 2 | 3;
  onGridChange?: (cols: 1 | 2 | 3) => void;
  is3DMode?: boolean;
  on3DModeChange?: (is3D: boolean) => void;
}

type Role = 'super_admin' | 'qa_manager' | 'team_lead' | 'qa_engineer' | 'viewer';

interface NavItem {
  view: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  roles?: Role[]; // undefined = everyone
}

const ANALYTICS_ROLES: Role[] = ['super_admin', 'qa_manager', 'team_lead'];
const ADMIN_ROLES: Role[] = ['super_admin', 'qa_manager'];

const NAV_GROUPS: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { view: 'dashboard', label: 'Overview', icon: LayoutDashboard },
      { view: 'features', label: 'Analytics', icon: BarChart3, roles: ANALYTICS_ROLES },
    ],
  },
  {
    title: 'Quality',
    items: [
      { view: 'flaky-test-intelligence', label: 'Flaky tests', icon: Bug, roles: ANALYTICS_ROLES },
      { view: 'test-execution-timeline', label: 'Test execution', icon: CalendarClock, roles: ANALYTICS_ROLES },
      { view: 'technical-debt', label: 'Technical debt', icon: Wrench, roles: ANALYTICS_ROLES },
      { view: 'performance-metrics', label: 'Performance', icon: Gauge, roles: ANALYTICS_ROLES },
    ],
  },
  {
    title: 'Delivery',
    items: [
      { view: 'pipeline-visualization', label: 'CI/CD pipeline', icon: GitBranch, roles: ANALYTICS_ROLES },
      { view: 'developer-productivity', label: 'Developer productivity', icon: Activity, roles: ANALYTICS_ROLES },
      { view: 'business-impact', label: 'Business impact', icon: TrendingUp, roles: ANALYTICS_ROLES },
      { view: 'team-gamification', label: 'Team rankings', icon: Trophy, roles: ANALYTICS_ROLES },
      { view: 'pdf-report-generator', label: 'Reports', icon: FileText, roles: ANALYTICS_ROLES },
    ],
  },
  {
    title: 'Organisation',
    items: [
      { view: 'users', label: 'Users', icon: UsersIcon, roles: ['super_admin', 'qa_manager', 'team_lead'] },
      { view: 'teams', label: 'Teams', icon: UsersRound, roles: ['super_admin', 'qa_manager', 'team_lead'] },
      { view: 'departments', label: 'Departments', icon: Building2, roles: ['super_admin'] },
    ],
  },
  {
    title: 'Administration',
    items: [
      { view: 'admin-panel', label: 'Admin console', icon: Shield, roles: ADMIN_ROLES },
      { view: 'manual-metrics', label: 'Manual metrics', icon: Calculator, roles: ['super_admin'] },
      { view: 'metric-intervals', label: 'Metric intervals', icon: Clock, roles: ADMIN_ROLES },
      { view: 'parameters-config', label: 'Parameters', icon: SlidersHorizontal, roles: ADMIN_ROLES },
    ],
  },
];

// Page title + breadcrumb parent for the top bar
const PAGE_META: Record<string, { title: string; parent?: string }> = {
  dashboard: { title: 'Overview' },
  features: { title: 'Analytics' },
  'flaky-test-intelligence': { title: 'Flaky tests', parent: 'Quality' },
  'test-execution-timeline': { title: 'Test execution', parent: 'Quality' },
  'technical-debt': { title: 'Technical debt', parent: 'Quality' },
  'performance-metrics': { title: 'Performance', parent: 'Quality' },
  'pipeline-visualization': { title: 'CI/CD pipeline', parent: 'Delivery' },
  'developer-productivity': { title: 'Developer productivity', parent: 'Delivery' },
  'business-impact': { title: 'Business impact', parent: 'Delivery' },
  'team-gamification': { title: 'Team rankings', parent: 'Delivery' },
  'pdf-report-generator': { title: 'Reports', parent: 'Delivery' },
  users: { title: 'Users', parent: 'Organisation' },
  teams: { title: 'Teams', parent: 'Organisation' },
  departments: { title: 'Departments', parent: 'Organisation' },
  'manage-teams': { title: 'Manage teams', parent: 'Organisation' },
  'admin-panel': { title: 'Admin console', parent: 'Administration' },
  'manual-metrics': { title: 'Manual metrics', parent: 'Administration' },
  'metric-intervals': { title: 'Metric intervals', parent: 'Administration' },
  'parameters-config': { title: 'Parameters', parent: 'Administration' },
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Administrator',
  qa_manager: 'QA manager',
  team_lead: 'Team lead',
  qa_engineer: 'QA engineer',
  viewer: 'Viewer',
};

const Layout: React.FC<LayoutProps> = ({ children, currentView, onViewChange, onTabChange }) => {
  const { user, logout } = useAuth();
  const { isDark, toggleMode } = useTheme();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [jobNotification, setJobNotification] = useState<{ message: string; timestamp?: string } | null>(null);

  // Scroll to top when view changes
  useEffect(() => {
    document.getElementById('main-scroll')?.scrollTo({ top: 0 });
  }, [currentView]);

  // Background job notifications pushed over the WebSocket (long-running server only)
  useEffect(() => {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsHost = isLocal ? 'localhost:3000' : window.location.host;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(`${protocol}://${wsHost}/ws`);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'JOB_NOTIFICATION' && data.message) {
            setJobNotification({ message: data.message, timestamp: data.timestamp });
            setTimeout(() => setJobNotification(null), 5000);
          }
        } catch (error) {
          console.error('Error handling job notification message', error);
        }
      };
      ws.onerror = () => { /* no live channel available — ignore */ };
    } catch { /* WebSocket unsupported in this deployment */ }
    return () => { ws?.close(); };
  }, []);

  const role = (user?.role || 'viewer') as Role;
  const canSee = (item: NavItem) => !item.roles || item.roles.includes(role);

  const go = (view: string) => {
    if (view === 'dashboard') onTabChange?.('all');
    onViewChange(view);
    setIsMobileMenuOpen(false);
  };

  const meta = PAGE_META[currentView] || { title: 'Overview' };
  const initials = `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.toUpperCase() || 'U';

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200">
      {/* Mobile overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setIsMobileMenuOpen(false)} />
      )}

      <aside
          className={`fixed lg:static inset-y-0 left-0 z-50 w-64 flex-shrink-0 flex flex-col
            bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800
            transition-transform duration-200 ease-out
            ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
        >
          {/* Brand */}
          <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
            <button onClick={() => go('dashboard')} className="flex items-center gap-3 text-left">
              <div className="h-8 w-8 rounded-md bg-brand-700 dark:bg-brand-500 flex items-center justify-center">
                <span className="text-[13px] font-semibold tracking-tight text-white">IG</span>
              </div>
              <div className="leading-tight">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">IronGate</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">QE Navigator</p>
              </div>
            </button>
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="lg:hidden p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Close navigation"
            >
              <X size={18} />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto px-3 py-4" data-testid="sidebar-nav">
            {NAV_GROUPS.map((group, gi) => {
              const items = group.items.filter(canSee);
              if (items.length === 0) return null;
              return (
                <div key={gi} className={gi > 0 ? 'mt-5' : ''}>
                  {group.title && (
                    <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      {group.title}
                    </p>
                  )}
                  <ul className="space-y-0.5">
                    {items.map((item) => {
                      const active = currentView === item.view;
                      const Icon = item.icon;
                      return (
                        <li key={item.view}>
                          <button
                            onClick={() => go(item.view)}
                            data-testid={`nav-${item.view === 'features' ? 'analytics' : item.view === 'admin-panel' ? 'admin' : item.view}`}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                              active
                                ? 'bg-brand-50 text-brand-800 font-medium dark:bg-slate-800 dark:text-white'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-white'
                            }`}
                          >
                            <Icon size={17} className={active ? 'text-brand-700 dark:text-brand-300' : 'text-slate-400 dark:text-slate-500'} />
                            <span className="truncate">{item.label}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </nav>

          {/* Account */}
          <div className="p-3 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-3 px-2 py-2">
              <div className="h-8 w-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xs font-semibold text-slate-700 dark:text-slate-200">
                {initials}
              </div>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{ROLE_LABEL[role] ?? role}</p>
              </div>
              <button
                onClick={logout}
                title="Sign out"
                aria-label="Sign out"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-800"
              >
                <LogOut size={16} />
                <span className="sr-only">Sign out</span>
              </button>
            </div>
          </div>
        </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 flex-shrink-0 px-4 sm:px-8 flex items-center justify-between gap-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden p-1.5 -ml-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <div className="min-w-0">
              {meta.parent && (
                <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                  <span>{meta.parent}</span>
                  <ChevronRight size={12} />
                </div>
              )}
              <h1 className="text-base font-semibold text-slate-900 dark:text-white truncate">{meta.title}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleMode}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle colour theme"
              className="h-9 w-9 flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 hover:bg-slate-50 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800"
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>

        <main id="main-scroll" className="flex-1 overflow-auto flex flex-col">
          <div className="flex-1">{children}</div>
          <footer className="px-4 sm:px-8 py-4 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-2">
            <span>© {new Date().getFullYear()} IronGate Software Ltd. All rights reserved.</span>
            <span>QE Navigator</span>
          </footer>
        </main>
      </div>

      {jobNotification && (
        <div className="fixed top-20 right-6 z-50 flex items-center gap-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-lg px-4 py-3 rounded-lg animate-slide-in-right">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          <p className="text-sm text-slate-700 dark:text-slate-200">{jobNotification.message}</p>
        </div>
      )}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: isDark ? '#1e293b' : '#ffffff',
            color: isDark ? '#e2e8f0' : '#0f172a',
            border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
            boxShadow: '0 6px 16px -4px rgb(15 23 42 / 0.12)',
            fontSize: '14px',
          },
        }}
      />
    </div>
  );
};

export default Layout;
