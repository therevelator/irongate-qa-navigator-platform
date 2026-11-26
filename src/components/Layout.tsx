import { downloadPagePdf } from '../lib/pagePdf';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import BrandMark from './BrandMark';
import {
  LayoutDashboard, BarChart3, LogOut, MonitorSmartphone, Shield, Users as UsersIcon, UsersRound, Building2, Menu, X,
  Calculator, Clock, MonitorPlay, SlidersHorizontal, Bug, Wrench, GitBranch, TrendingUp, Gauge, Activity, Inbox,
  CalendarClock, Trophy, FileText, ChevronRight, Smartphone, Pin, PinOff, PanelLeftClose, History, GitCompareArrows, HeartPulse, Footprints,
  FileUp,
  Hourglass, SearchCheck, ClipboardCheck, PlugZap, FileDown,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import API_URL from '../config/api';
import toast, { Toaster } from 'react-hot-toast';
import {
  ANALYTICS_ROLES as POLICY_ANALYTICS_ROLES, canManageCompanyConfig, canOpenUserAdmin, canViewActivity, canViewIngestionLog, canUploadFiles, canViewUserActivity, canWriteSomeTeamData, isCompanyAdmin,
  type PolicyActor,
} from '../../server/lib/userPolicy';
import { policyActorOf, ROLE_LABELS } from '../lib/policyActor';
import PulsePendingBanner from './PulsePendingBanner';
import SandboxBanner from './SandboxBanner';
import NotificationsBell from './NotificationsBell';
import { AccessHelp, AccountMenu, AppearanceMenu, CompanyBadge } from './HeaderParts';
import { accessSummary } from '../lib/accessSummary';
import { canOpenView, showSummaryInNav } from '../lib/viewAccess';
import { NOTIFICATIONS_TAB_EVENT, NOTIFICATIONS_TAB_KEY } from './NotificationsCenter';

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
  /** Open the wellbeing pulse of a team (the pending-survey banner). */
  onOpenPulse?: (teamId: string) => void;
}

type Role = 'super_admin' | 'qa_manager' | 'team_lead' | 'qa_engineer' | 'viewer';

interface NavItem {
  view: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  roles?: Role[]; // undefined = everyone
  /** Shared policy rule (server/lib/userPolicy.ts), the same one the server and App.tsx use; wins over roles. */
  can?: (actor: PolicyActor) => boolean;
}

// Same list as the server (server/lib/userPolicy.ts): every role may open the team-level
// Analytics modules; what each role sees inside them is limited by its analytics scope.
const ANALYTICS_ROLES = POLICY_ANALYTICS_ROLES as Role[];

const NAV_GROUPS: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { view: 'dashboard', label: 'Overview', icon: LayoutDashboard },
      { view: 'summary', label: 'Executive summary', icon: Smartphone, can: showSummaryInNav },
      { view: 'features', label: 'Analytics', icon: BarChart3, roles: ANALYTICS_ROLES },
      { view: 'compare', label: 'Compare teams', icon: GitCompareArrows, roles: ANALYTICS_ROLES },
      { view: 'tv', label: 'TV mode', icon: MonitorPlay },
    ],
  },
  {
    title: 'Next move',
    items: [
      { view: 'time-lost', label: 'Time lost', icon: Hourglass, roles: ANALYTICS_ROLES },
      { view: 'findings', label: 'Findings', icon: SearchCheck, roles: ANALYTICS_ROLES },
      { view: 'outcomes', label: 'Outcomes', icon: ClipboardCheck, roles: ANALYTICS_ROLES },
      { view: 'data-readiness', label: 'Data readiness', icon: PlugZap, roles: ANALYTICS_ROLES },
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
      { view: 'users', label: 'Users', icon: UsersIcon, can: canOpenUserAdmin },
      { view: 'teams', label: 'Teams', icon: UsersRound, can: canOpenUserAdmin },
      { view: 'departments', label: 'Departments', icon: Building2, can: isCompanyAdmin },
      { view: 'activity', label: 'Activity', icon: History, can: canViewActivity },
      { view: 'user-activity', label: 'User activity', icon: Footprints, can: canViewUserActivity },
    ],
  },
  {
    title: 'Administration',
    items: [
      { view: 'admin-panel', label: 'Admin console', icon: Shield, can: canManageCompanyConfig },
      { view: 'manual-metrics', label: 'Manual metrics', icon: Calculator, can: canWriteSomeTeamData },
      { view: 'upload-files', label: 'Upload files', icon: FileUp, can: canUploadFiles },
      { view: 'metric-intervals', label: 'Update frequency', icon: Clock, can: canManageCompanyConfig },
      { view: 'parameters-config', label: 'Parameters', icon: SlidersHorizontal, can: canManageCompanyConfig },
      { view: 'ingestion-log', label: 'Ingestion log', icon: Inbox, can: canViewIngestionLog },
    ],
  },
  {
    title: 'Platform',
    items: [
    ],
  },
];

// Page title + breadcrumb parent for the top bar
export const PAGE_META: Record<string, { title: string; parent?: string }> = {
  dashboard: { title: 'Overview' },
  features: { title: 'Analytics' },
  compare: { title: 'Compare teams' },
  tv: { title: 'TV mode' },
  summary: { title: 'Summary' }, // short: the phone top bar has little room
  'time-lost': { title: 'Time lost', parent: 'Next move' },
  findings: { title: 'Findings', parent: 'Next move' },
  outcomes: { title: 'Outcomes', parent: 'Next move' },
  'data-readiness': { title: 'Data readiness', parent: 'Next move' },
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
  'user-activity': { title: 'User activity', parent: 'Organisation' },
  'admin-panel': { title: 'Admin console', parent: 'Administration' },
  'manual-metrics': { title: 'Manual metrics', parent: 'Administration' },
  'upload-files': { title: 'Upload files', parent: 'Administration' },
  'metric-intervals': { title: 'Expected update frequency', parent: 'Administration' },
  'parameters-config': { title: 'Parameters', parent: 'Administration' },
  'ingestion-log': { title: 'Ingestion log', parent: 'Administration' },
  notifications: { title: 'Notifications' },
};

const ROLE_LABEL = ROLE_LABELS;

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

const Layout: React.FC<LayoutProps> = ({ children, currentView, onViewChange, onTabChange, onOpenPulse }) => {
  const { user, logout } = useAuth();
  // "Sign out my other devices": every other session ends; this one gets a new cookie and stays.
  const signOutOthers = async () => {
    if (!window.confirm('Sign out on all your other devices and browsers? This one stays signed in.')) return;
    try {
      const res = await fetch(`${API_URL}/auth/sessions/sign-out-others`, { method: 'POST', credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) toast.success(body.message || 'Signed out on all other devices.');
      else toast.error(body.error || 'Could not sign out the other devices.');
    } catch {
      toast.error('The server could not be reached.');
    }
  };
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
  const actor = policyActorOf(user);
  // Only the pages this person may open at all (the same rule as the router: src/lib/viewAccess.ts).
  const canSee = (item: NavItem) => !!user && canOpenView(actor, item.view) && (item.can ? item.can(actor) : !item.roles || item.roles.includes(role));
  // Job title and company name for the top bar (GET /api/users/:id, the person's own profile).
  const [profile, setProfile] = useState<{ jobTitle: string | null; companyName: string | null } | null>(null);
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    fetch(`${API_URL}/users/${encodeURIComponent(String(user.id))}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.user) setProfile({ jobTitle: d.user.job_title ?? null, companyName: d.user.company_name ?? null }); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [user?.id]);
  const fullName = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || user?.email || '';
  // Job title when recorded, else the role label (server/lib/roleLabels.ts).
  const personTitle = profile?.jobTitle || (ROLE_LABEL[role] ?? role);
  const help = React.useMemo(
    () => accessSummary(actor, (user?.assignments ?? []).map((a: any) => ({ role: a.role, scopeType: a.scopeType, scopeId: a.scopeId, scopeName: a.scopeName })), profile?.companyName),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed when the assignments or the company name change
    [user?.assignments, profile?.companyName],
  );

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
    <div className="ig-app-bg flex h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200">
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
              <BrandMark height={36} />
              <div className="leading-tight">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">QE Navigator</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">by IronGate Software</p>
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
                    <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
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
                            <Icon size={17} className={active ? 'text-brand-700 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400'} />
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
              {!user?.sandbox && <button
                onClick={signOutOthers}
                title="Sign out my other devices"
                aria-label="Sign out my other devices"
                data-testid="sign-out-others"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-800"
              >
                <MonitorSmartphone size={16} />
                <span className="sr-only">Sign out my other devices</span>
              </button>}
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
        <header className="h-16 flex-shrink-0 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
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
              <button onClick={() => go('dashboard')} className="flex flex-shrink-0 items-center gap-2 rounded-md pr-1" aria-label="QE Navigator, go to overview" data-testid="brand-home">
                <BrandMark height={32} />
                <span className="hidden whitespace-nowrap text-sm font-semibold text-slate-900 dark:text-white sm:inline">QE Navigator</span>
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
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
            {profile?.companyName && <CompanyBadge name={profile.companyName} />}
            <div className="hidden min-w-0 max-w-[15rem] leading-tight lg:block" data-testid="header-person">
              <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{fullName}</p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400" data-testid="header-person-title">{personTitle}</p>
            </div>
            <span className="hidden h-6 w-px bg-slate-200 dark:bg-slate-700 lg:block" aria-hidden="true" />
            <button type="button" onClick={() => downloadPagePdf(meta.title, profile?.companyName ?? null)} title="Download this page as a PDF, with every section expanded"
              aria-label="Download this page as a PDF" data-testid="download-page-pdf"
              className="hidden h-9 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 sm:inline-flex">
              <FileDown size={16} aria-hidden /> <span className="hidden xl:inline">Download PDF</span>
            </button>
            <AccessHelp summary={help} />
            <NotificationsBell
              onOpenAll={(tab = 'alerts') => {
                try { sessionStorage.setItem(NOTIFICATIONS_TAB_KEY, tab); } catch { /* storage unavailable */ }
                window.dispatchEvent(new CustomEvent(NOTIFICATIONS_TAB_EVENT, { detail: tab }));
                go('notifications');
              }}
            />
            <AppearanceMenu />
            <AccountMenu name={fullName} title={personTitle} companyName={profile?.companyName} onSignOutOthers={user?.sandbox ? undefined : signOutOthers} onSignOut={logout} />
          </div>
        </header>

        <SandboxBanner />
        {onOpenPulse && <PulsePendingBanner userId={user?.id ? String(user.id) : null} onOpen={onOpenPulse} />}
        <main id="main-scroll" className="flex-1 overflow-auto flex flex-col">
          <div className="print-only px-4 pt-2 sm:px-8" data-testid="print-header">
            <div className="flex items-center justify-between border-b border-slate-300 pb-3">
              <span className="flex items-center gap-3"><BrandMark height={36} /><span className="text-base font-semibold text-slate-900">QE Navigator · {meta.title}</span></span>
              <span className="text-xs text-slate-600">{profile?.companyName ? `${profile.companyName} · ` : ''}{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
            </div>
          </div>
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
            background: 'var(--toast-bg)',
            color: 'var(--toast-fg)',
            border: '1px solid var(--toast-border)',
            boxShadow: 'var(--toast-shadow)',
            backdropFilter: 'var(--toast-blur)',
            fontSize: '14px',
          },
        }}
      />
    </div>
  );
};

export default Layout;
