import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  LayoutDashboard, BarChart3, LogOut, Shield, Users as UsersIcon, UsersRound, Building2, Menu, X,
  Calculator, Clock, SlidersHorizontal, Bug, Wrench, GitBranch, TrendingUp, Gauge, Activity, Inbox,
  CalendarClock, Trophy, FileText, Sun, Moon, ChevronRight, Pin, PinOff, PanelLeftClose, History, GitCompareArrows, HeartPulse,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Toaster } from 'react-hot-toast';
import { ANALYTICS_ROLES as POLICY_ANALYTICS_ROLES } from '../../server/lib/userPolicy';

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

// Same list as the server (server/lib/userPolicy.ts): every role may open the team-level
// Analytics modules; what each role sees inside them is limited by its analytics scope.
const ANALYTICS_ROLES = POLICY_ANALYTICS_ROLES as Role[];
const ADMIN_ROLES: Role[] = ['super_admin', 'qa_manager'];

const NAV_GROUPS: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { view: 'dashboard', label: 'Overview', icon: LayoutDashboard },
      { view: 'features', label: 'Analytics', icon: BarChart3, roles: ANALYTICS_ROLES },
      { view: 'compare', label: 'Compare teams', icon: GitCompareArrows, roles: ANALYTICS_ROLES },
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
      { view: 'team-pulse', label: 'Wellbeing pulse', icon: HeartPulse, roles: ANALYTICS_ROLES },
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
      { view: 'activity', label: 'Activity', icon: History, roles: ADMIN_ROLES },
    ],
  },
  {
    title: 'Administration',
    items: [
      { view: 'admin-panel', label: 'Admin console', icon: Shield, roles: ADMIN_ROLES },
      { view: 'manual-metrics', label: 'Manual metrics', icon: Calculator, roles: ['super_admin', 'qa_manager', 'team_lead'] },
      { view: 'metric-intervals', label: 'Update frequency', icon: Clock, roles: ADMIN_ROLES },
      { view: 'parameters-config', label: 'Parameters', icon: SlidersHorizontal, roles: ADMIN_ROLES },
      { view: 'ingestion-log', label: 'Ingestion log', icon: Inbox, roles: ADMIN_ROLES },
    ],
  },
];

// Page title + breadcrumb parent for the top bar
const PAGE_META: Record<string, { title: string; parent?: string }> = {
  dashboard: { title: 'Overview' },
  features: { title: 'Analytics' },
  compare: { title: 'Compare teams' },
  'flaky-test-intelligence': { title: 'Flaky tests', parent: 'Quality' },
  'test-execution-timeline': { title: 'Test execution', parent: 'Quality' },
  'technical-debt': { title: 'Technical debt', parent: 'Quality' },
  'performance-metrics': { title: 'Performance', parent: 'Quality' },
  'pipeline-visualization': { title: 'CI/CD pipeline', parent: 'Delivery' },
  'developer-productivity': { title: 'Developer productivity', parent: 'Delivery' },
  'team-pulse': { title: 'Wellbeing pulse', parent: 'Delivery' },
  'business-impact': { title: 'Business impact', parent: 'Delivery' },
  'team-gamification': { title: 'Team rankings', parent: 'Delivery' },
  'pdf-report-generator': { title: 'Reports', parent: 'Delivery' },
  users: { title: 'Users', parent: 'Organisation' },
  teams: { title: 'Teams', parent: 'Organisation' },
  departments: { title: 'Departments', parent: 'Organisation' },
  activity: { title: 'Activity', parent: 'Organisation' },
  'admin-panel': { title: 'Admin console', parent: 'Administration' },
  'manual-metrics': { title: 'Manual metrics', parent: 'Administration' },
  'metric-intervals': { title: 'Expected update frequency', parent: 'Administration' },
  'parameters-config': { title: 'Parameters', parent: 'Administration' },
  'ingestion-log': { title: 'Ingestion log', parent: 'Administration' },
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Administrator',
  qa_manager: 'QA manager',
  team_lead: 'Team lead',
  qa_engineer: 'QA engineer',
  viewer: 'Viewer',
};

const PIN_KEY = 'irongate_nav_pinned';
const WIDE_QUERY = '(min-width: 1280px)';

const readPinned = () => {
  try { return localStorage.getItem(PIN_KEY) === 'true'; } catch { return false; }
};

const useMediaQuery = (q: string) => {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false));
  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia(q);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, [q]);
  return matches;
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const Layout: React.FC<LayoutProps> = ({ children, currentView, onViewChange, onTabChange }) => {
  const { user, logout } = useAuth();
  const { isDark, toggleMode } = useTheme();
  // Navigation lives in a drawer behind the burger button. On wide screens it can be pinned
  // (docked beside the content); the pin is the only preference remembered.
  const [navOpen, setNavOpen] = useState(false);
  const [pinned, setPinned] = useState<boolean>(readPinned);
  const isWide = useMediaQuery(WIDE_QUERY);
  const docked = pinned && isWide;
  const navVisible = docked || navOpen;
  const drawerRef = useRef<HTMLElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const [jobNotification, setJobNotification] = useState<{ message: string; timestamp?: string } | null>(null);

  useEffect(() => {
    try { localStorage.setItem(PIN_KEY, pinned ? 'true' : 'false'); } catch { /* storage unavailable */ }
  }, [pinned]);

  // Scroll to top when view changes
  useEffect(() => {
    document.getElementById('main-scroll')?.scrollTo({ top: 0 });
  }, [currentView]);

  const closeNav = useCallback((restoreFocus = true) => {
    setNavOpen(false);
    if (restoreFocus) requestAnimationFrame(() => burgerRef.current?.focus());
  }, []);

  // Overlay drawer: focus the active item on open, trap Tab inside, close on Escape.
  useEffect(() => {
    if (!navOpen || docked) return;
    const drawer = drawerRef.current;
    const first = drawer?.querySelector<HTMLElement>('[aria-current="page"]') ?? drawer?.querySelector<HTMLElement>(FOCUSABLE);
    const t = window.setTimeout(() => first?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeNav(); return; }
      if (e.key !== 'Tab' || !drawer) return;
      const items = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const firstEl = items[0], lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { window.clearTimeout(t); document.removeEventListener('keydown', onKey); };
  }, [navOpen, docked, closeNav]);

  // Docking (pin on a wide screen) replaces the overlay.
  useEffect(() => { if (docked) setNavOpen(false); }, [docked]);

  // Background job notifications pushed over the WebSocket (long-running server only)
  useEffect(() => {
    // Netlify Functions have no WebSocket server; do not try to connect there.
    if (window.location.hostname.endsWith('.netlify.app') || import.meta.env.VITE_DISABLE_WEBSOCKET === 'true') return;
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
    if (!docked) closeNav(false);
  };

  const toggleNav = () => {
    if (docked) { setPinned(false); return; }
    setNavOpen((o) => !o);
  };

  const meta = PAGE_META[currentView] || { title: 'Overview' };
  const initials = `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.toUpperCase() || 'U';

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200">
      {/* Backdrop for the overlay drawer */}
      {!docked && (
        <div
          className={`fixed inset-0 z-40 bg-slate-900/40 dark:bg-slate-950/60 transition-opacity duration-200 motion-reduce:transition-none ${navOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
          onClick={() => closeNav()}
          aria-hidden="true"
          data-testid="nav-backdrop"
        />
      )}

      <aside
          id="app-navigation"
          ref={drawerRef}
          aria-label="Main navigation"
          {...(!docked ? { role: 'dialog', 'aria-modal': navOpen ? true : undefined } : {})}
          aria-hidden={!navVisible || undefined}
          className={`${docked ? 'static' : 'fixed inset-y-0 left-0 z-50 shadow-xl'} w-72 max-w-[85vw] flex-shrink-0 flex flex-col
            bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800
            transition-[transform,visibility] duration-200 ease-out motion-reduce:transition-none
            ${navVisible ? 'translate-x-0 visible' : '-translate-x-full invisible'}`}
        >
          {/* Brand */}
          <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
            <button onClick={() => go('dashboard')} className="flex items-center gap-3 text-left rounded-md">
              <div className="h-8 w-8 rounded-md bg-brand-700 dark:bg-brand-500 flex items-center justify-center">
                <span className="text-[13px] font-semibold tracking-tight text-white">IG</span>
              </div>
              <div className="leading-tight">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">IronGate</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">QE Navigator</p>
              </div>
            </button>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPinned((p) => !p)}
                className="hidden xl:inline-flex p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                aria-pressed={pinned}
                aria-label={pinned ? 'Unpin navigation' : 'Pin navigation open'}
                title={pinned ? 'Unpin navigation' : 'Keep navigation open'}
                data-testid="nav-pin"
              >
                {pinned ? <PinOff size={16} /> : <Pin size={16} />}
              </button>
              {!docked && (
                <button
                  onClick={() => closeNav()}
                  className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                  aria-label="Close navigation"
                >
                  <X size={18} />
                </button>
              )}
            </div>
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
                            aria-current={active ? 'page' : undefined}
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
        <header className="h-16 flex-shrink-0 px-4 sm:px-6 flex items-center justify-between gap-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <button
              ref={burgerRef}
              onClick={toggleNav}
              className="h-9 w-9 -ml-1 flex flex-shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              aria-label={docked ? 'Hide navigation' : navOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={navVisible}
              aria-controls="app-navigation"
              data-testid="nav-toggle"
            >
              {docked ? <PanelLeftClose size={19} /> : <Menu size={20} />}
            </button>
            {!docked && (
              <button onClick={() => go('dashboard')} className="hidden sm:flex flex-shrink-0 items-center gap-2.5 rounded-md pr-1" aria-label="IronGate QE Navigator, go to overview">
                <span className="h-7 w-7 rounded-md bg-brand-700 dark:bg-brand-500 flex items-center justify-center text-[12px] font-semibold tracking-tight text-white">IG</span>
                <span className="text-sm font-semibold text-slate-900 dark:text-white">IronGate</span>
              </button>
            )}
            {!docked && <span className="hidden sm:block h-6 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />}
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
            <span
              className="hidden sm:flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
              title={`${user?.firstName ?? ''} ${user?.lastName ?? ''} · ${ROLE_LABEL[role] ?? role}`.trim()}
              aria-hidden="true"
            >
              {initials}
            </span>
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
