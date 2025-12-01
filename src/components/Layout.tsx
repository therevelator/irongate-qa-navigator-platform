import React, { useState, useEffect } from 'react';
import { LayoutDashboard, BarChart3, LogOut, Shield, Users as UsersIcon, Users as TeamsIcon, Building2, Menu, X, Palette, Calculator, Clock, SlidersHorizontal } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { getRoleBadgeColor } from '../types/auth';
import ThemeToggle from './ThemeToggle';

interface Department {
  id: string;
  name: string;
  company_id: string;
}

interface LayoutProps {
  children: React.ReactNode;
  currentView: string;
  onViewChange: (view: string) => void;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  hideSidebar?: boolean;
  gridColumns?: 1 | 2 | 3;
  onGridChange?: (cols: 1 | 2 | 3) => void;
}

import API_URL from '../config/api';

const Layout: React.FC<LayoutProps> = ({ children, currentView, onViewChange, activeTab = 'all', onTabChange, hideSidebar, gridColumns = 3, onGridChange }) => {
  const { user, logout } = useAuth();
  const { isDark } = useTheme();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(false);

  useEffect(() => {
    if (user?.id) {
      fetchDepartments();
    }
  }, [user?.id]);

  // Scroll to top when view changes
  useEffect(() => {
    setTimeout(() => {
      const scrollContainer = document.querySelector('.flex-1.overflow-auto') as HTMLElement;
      if (scrollContainer) {
        scrollContainer.scrollTop = 0;
      }
    }, 0);
  }, [currentView]);

  const fetchDepartments = async () => {
    try {
      const token = localStorage.getItem('irongate_token');
      if (!token) return;

      const response = await fetch(`${API_URL}/admin/departments`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setDepartments(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error fetching departments:', error);
    }
  };

  const handleDepartmentClick = (deptId: string) => {
    if (onTabChange) {
      onTabChange(deptId);
    }
    onViewChange('dashboard');
  };

  const handleAllClick = () => {
    if (onTabChange) {
      onTabChange('all');
    }
    onViewChange('dashboard');
    setIsMobileMenuOpen(false);
  };

  const handleNavClick = (view: string) => {
    onViewChange(view);
    setIsMobileMenuOpen(false);
  };

  // Background classes - Glassmorphism style
  const mainBgClass = 'glass-container';
  const sidebarBgClass = 'glass-sidebar';

  const sidebarHidden = hideSidebar || !sidebarVisible;

  return (
    <div className="glass-container h-screen w-screen">
      {/* Main App Container - Full screen glass panel */}
      <div className="glass-panel w-full h-full flex overflow-hidden">
        {/* Menu Overlay - Mobile only */}
        {isMobileMenuOpen && (
          <div 
            className="fixed inset-0 z-40 bg-black bg-opacity-50 lg:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar Navigation - Always visible on desktop, slide-in on mobile */}
        <aside className={`
          fixed lg:relative inset-y-0 left-0 z-50 lg:z-auto
          w-64 lg:w-72 flex flex-col glass-sidebar
          transform transition-transform duration-300 ease-in-out
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}>
        {/* Logo - Centered */}
        <div className="px-6 py-6 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <img
              src="/irongate-logo.png"
              alt="IronGate"
              className="h-9 w-auto object-contain brightness-0 invert opacity-90"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
            <h2 className="text-xs font-medium glass-text-secondary">
              Welcome, {user?.firstName}
            </h2>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="lg:hidden absolute right-4 p-2 rounded-md hover:bg-white/20"
          >
            <X size={20} className="glass-text" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-4 overflow-y-auto">
          <div className="space-y-1">
            {/* Dashboard */}
            <button
              onClick={handleAllClick}
              className={`glass-nav-item w-full flex items-center gap-3 px-4 py-3 text-sm font-medium ${
                currentView === 'dashboard' ? 'active' : ''
              }`}
            >
              <LayoutDashboard size={18} />
              <span>Home</span>
            </button>

            {/* Users - Super Admin, Manager, Team Lead only */}
            {(user?.role === 'super_admin' || user?.role === 'manager' || user?.role === 'team_lead') && (
              <button
                onClick={() => handleNavClick('users')}
                className={`glass-nav-item w-full flex items-center gap-3 px-4 py-3 text-sm font-medium ${
                  currentView === 'users' ? 'active' : ''
                }`}
              >
                <UsersIcon size={18} />
                <span>Users</span>
              </button>
            )}

            {/* Teams - Super Admin, Manager, Team Lead only */}
            {(user?.role === 'super_admin' || user?.role === 'manager' || user?.role === 'team_lead') && (
              <button
                onClick={() => handleNavClick('teams')}
                className={`glass-nav-item w-full flex items-center gap-3 px-4 py-3 text-sm font-medium ${
                  currentView === 'teams' ? 'active' : ''
                }`}
              >
                <TeamsIcon size={18} />
                <span>Teams</span>
              </button>
            )}

            {/* Departments - Super Admin only */}
            {user?.role === 'super_admin' && (
              <button
                onClick={() => handleNavClick('departments')}
                className={`glass-nav-item w-full flex items-center gap-3 px-4 py-3 text-sm font-medium ${
                  currentView === 'departments' ? 'active' : ''
                }`}
              >
                <Building2 size={18} />
                <span>Departments</span>
              </button>
            )}

            {/* Analytics */}
            <button
              onClick={() => handleNavClick('features')}
              className={`glass-nav-item w-full flex items-center gap-3 px-4 py-3 text-sm font-medium ${
                currentView === 'features' ? 'active' : ''
              }`}
            >
              <BarChart3 size={18} />
              <span>Analytics</span>
            </button>

            {/* Admin Panel - Admin only */}
            {(user?.role === 'super_admin' || user?.role === 'manager') && (
              <button
                onClick={() => handleNavClick('admin-panel')}
                className={`glass-nav-item w-full flex items-center gap-3 px-4 py-3 text-sm font-medium ${
                  currentView === 'admin-panel' ? 'active' : ''
                }`}
              >
                <Shield size={18} />
                <span>Admin</span>
              </button>
            )}

            {/* Manual Metrics - Super Admin only */}
            {user?.role === 'super_admin' && (
              <button
                onClick={() => handleNavClick('manual-metrics')}
                className={`glass-nav-item w-full flex items-center gap-3 px-4 py-3 text-sm font-medium ${
                  currentView === 'manual-metrics' ? 'active' : ''
                }`}
              >
                <Calculator size={18} />
                <span>Manual Metrics</span>
              </button>
            )}

            {/* Metric Intervals - Admin and Manager only */}
            {(user?.role === 'super_admin' || user?.role === 'manager') && (
              <button
                onClick={() => handleNavClick('metric-intervals')}
                className={`glass-nav-item w-full flex items-center gap-3 px-4 py-3 text-sm font-medium ${
                  currentView === 'metric-intervals' ? 'active' : ''
                }`}
              >
                <Clock size={18} />
                <span>Metric Intervals</span>
              </button>
            )}

            {/* Parameters Configuration */}
            {(user?.role === 'super_admin' || user?.role === 'manager') && (
              <button
                onClick={() => handleNavClick('parameters-config')}
                className={`glass-nav-item w-full flex items-center gap-3 px-4 py-3 text-sm font-medium ${
                  currentView === 'parameters-config' ? 'active' : ''
                }`}
              >
                <SlidersHorizontal size={18} />
                <span>Parameters Config</span>
              </button>
            )}
          </div>
        </nav>

        {/* User Profile */}
        <div className="p-4">
          <div className="glass-profile p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
              {user?.avatar ? (
                <img src={user.avatar} alt={user.firstName} className="w-full h-full object-cover" />
              ) : (
                <span className="text-sm font-semibold glass-text">
                  {user?.firstName?.[0]}{user?.lastName?.[0]}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium glass-text truncate">{user?.firstName} {user?.lastName}</h3>
              <p className="text-xs glass-text-secondary truncate capitalize">{user?.role?.replace('_', ' ')}</p>
            </div>
            <button
              onClick={logout}
              className="p-2 rounded-lg hover:bg-white/20 transition-colors"
              title="Sign Out"
            >
              <LogOut size={16} className="glass-text-secondary" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar with Theme Toggle */}
        <div className="glass-topbar px-4 sm:px-6 py-3 flex items-center">
          {/* Menu Button - Mobile only */}
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="glass-btn p-2 lg:hidden mr-4"
          >
            <Menu size={20} className="glass-text" />
          </button>

          {/* Spacer to push controls to the right */}
          <div className="flex-1"></div>

          {/* Controls on the right */}
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Grid Selector */}
            {currentView === 'dashboard' && onGridChange && (
              <div className="flex items-center gap-1 glass-panel rounded-lg p-1">
                <span className="text-[10px] font-semibold glass-text-secondary uppercase tracking-wide px-1.5">Grid</span>
                {([1, 2, 3] as const).map((cols) => (
                  <button
                    key={cols}
                    onClick={() => onGridChange(cols)}
                    className={`w-7 h-7 text-xs font-semibold rounded-md transition-all ${
                      gridColumns === cols
                        ? 'glass-btn-primary shadow'
                        : 'glass-text-secondary hover:bg-white/20'
                    }`}
                    title={`${cols} column${cols > 1 ? 's' : ''}`}
                  >
                    {cols}
                  </button>
                ))}
              </div>
            )}
            {/* Dark/Light Mode Toggle */}
            <ThemeToggle compact />
          </div>
        </div>

        {/* Page Content */}
        <div className="flex-1 overflow-auto flex flex-col">
          <div className="flex-1">
            {children}
          </div>
          
          {/* Footer */}
          <footer className="glass-footer px-4 sm:px-6 py-4 mt-auto">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs sm:text-sm glass-text-secondary">
              <div className="flex items-center gap-2">
                <span>© 2025 IronGate QA Navigator</span>
                <span className="hidden sm:inline">•</span>
                <span className="hidden sm:inline">Built with passion</span>
                <span className="hidden sm:inline">•</span>
                <span className="hidden sm:inline">All rights reserved</span>
              </div>
              <div className="flex items-center gap-4">
                <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
                <span>•</span>
                <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
                <span>•</span>
                <a href="#" className="hover:text-white transition-colors">Support</a>
              </div>
            </div>
          </footer>
        </div>
      </div>
      </div>
    </div>
  );
};

export default Layout;
