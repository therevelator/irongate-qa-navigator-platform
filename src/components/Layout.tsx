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
  is3DMode?: boolean;
  on3DModeChange?: (is3D: boolean) => void;
}

import API_URL from '../config/api';

const Layout: React.FC<LayoutProps> = ({ children, currentView, onViewChange, activeTab = 'all', onTabChange, hideSidebar, gridColumns = 3, onGridChange, is3DMode = true, on3DModeChange }) => {
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

  // Background classes
  const mainBgClass = 'bg-gray-50 dark:bg-slate-950';
  const sidebarBgClass = 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800';

  const sidebarHidden = hideSidebar || !sidebarVisible;

  return (
    <div className={`flex h-screen ${mainBgClass}`}>
      {/* Menu Overlay - Mobile only */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black bg-opacity-50 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar Navigation - Push content on desktop, overlay on mobile */}
      <aside className={`
        fixed lg:relative inset-y-0 left-0 z-50 lg:z-auto
        w-64 flex-shrink-0 flex flex-col border-r
        transform transition-all duration-300 ease-in-out
        ${sidebarBgClass}
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        ${isMobileMenuOpen ? 'lg:w-64' : 'lg:w-0 lg:border-r-0'}
        overflow-hidden
      `}>
        {/* Logo */}
        <div className="px-6 py-6 sm:py-8 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/irongate-logo.png"
              alt="IronGate"
              className="h-8 w-auto object-contain"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
            <div>
              <h1 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">QA Navigator</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">IronGate Platform</p>
            </div>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-slate-800"
          >
            <X size={20} className="text-gray-600 dark:text-gray-400" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-6 px-4">
          <div className="space-y-0.5">
            {/* Dashboard */}
            <button
              onClick={handleAllClick}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-colors ${
                currentView === 'dashboard'
                  ? 'bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-white'
                  : 'text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800'
              }`}
            >
              <LayoutDashboard size={20} />
              <span>Dashboard</span>
            </button>

            {/* Users - Super Admin, Manager, Team Lead only */}
            {(user?.role === 'super_admin' || user?.role === 'manager' || user?.role === 'team_lead') && (
              <button
                onClick={() => handleNavClick('users')}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  currentView === 'users'
                    ? 'bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-white'
                    : 'text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800'
                }`}
              >
                <UsersIcon size={20} />
                <span>Users</span>
              </button>
            )}

            {/* Teams - Super Admin, Manager, Team Lead only */}
            {(user?.role === 'super_admin' || user?.role === 'manager' || user?.role === 'team_lead') && (
              <button
                onClick={() => handleNavClick('teams')}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  currentView === 'teams'
                    ? 'bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-white'
                    : 'text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800'
                }`}
              >
                <TeamsIcon size={20} />
                <span>Teams</span>
              </button>
            )}

            {/* Departments - Super Admin only */}
            {user?.role === 'super_admin' && (
              <button
                onClick={() => handleNavClick('departments')}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  currentView === 'departments'
                    ? 'bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-white'
                    : 'text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800'
                }`}
              >
                <Building2 size={20} />
                <span>Departments</span>
              </button>
            )}

            {/* Analytics */}
            <button
              onClick={() => handleNavClick('features')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-colors ${
                currentView === 'features'
                  ? 'bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-white'
                  : 'text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800/50 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <BarChart3 size={20} />
              <span>Analytics</span>
            </button>

            {/* Admin Panel - Admin only */}
            {(user?.role === 'super_admin' || user?.role === 'manager') && (
              <button
                onClick={() => handleNavClick('admin-panel')}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  currentView === 'admin-panel'
                    ? 'bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-white'
                    : 'text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800'
                }`}
              >
                <Shield size={20} />
                <span>Admin</span>
              </button>
            )}

            {/* Manual Metrics - Super Admin only */}
            {user?.role === 'super_admin' && (
              <button
                onClick={() => handleNavClick('manual-metrics')}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  currentView === 'manual-metrics'
                    ? 'bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-white'
                    : 'text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800'
                }`}
              >
                <Calculator size={20} />
                <span>Manual Metrics</span>
              </button>
            )}

            {/* Metric Intervals - Admin and Manager only */}
            {(user?.role === 'super_admin' || user?.role === 'manager') && (
              <button
                onClick={() => handleNavClick('metric-intervals')}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  currentView === 'metric-intervals'
                    ? 'bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-white'
                    : 'text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800'
                }`}
              >
                <Clock size={20} />
                <span>Metric Intervals</span>
              </button>
            )}

            {/* Parameters Configuration */}
            {(user?.role === 'super_admin' || user?.role === 'manager') && (
              <button
                onClick={() => handleNavClick('parameters-config')}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  currentView === 'parameters-config'
                    ? 'bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-white'
                    : 'text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800'
                }`}
              >
                <SlidersHorizontal size={20} />
                <span>Parameters Config</span>
              </button>
            )}
          </div>
        </nav>

        {/* Sign Out */}
        <div className="p-4 border-t border-gray-200 dark:border-slate-800">
          <button
            onClick={logout}
            className="w-full flex items-center space-x-3 px-3 py-2.5 rounded-md transition-colors text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800/50 hover:text-gray-900 dark:hover:text-white"
          >
            <LogOut size={20} />
            <span className="text-sm font-medium">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden transition-all duration-300 ease-in-out">
        {/* Top Bar with Welcome and Theme Toggle */}
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between border-b transition-all bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800">
          <div className="flex items-center space-x-3 sm:space-x-4">
            {/* Menu Button - Always visible */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 rounded-md transition-colors hover:bg-gray-100 dark:hover:bg-slate-800"
            >
              <Menu size={20} className="text-gray-600 dark:text-gray-400" />
            </button>
            
            <h2 className="text-xs sm:text-sm font-medium truncate text-gray-600 dark:text-slate-400">
              Welcome, {user?.firstName}
            </h2>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Grid Selector - Hidden on mobile */}
            {currentView === 'dashboard' && onGridChange && (
              <div className="hidden sm:flex items-center gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-1">
                <span className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide px-1.5">Grid</span>
                {([1, 2, 3] as const).map((cols) => (
                  <button
                    key={cols}
                    onClick={() => onGridChange(cols)}
                    className={`w-7 h-7 text-xs font-semibold rounded-md transition-all ${
                      gridColumns === cols
                        ? 'bg-cyan-600 text-white shadow'
                        : 'text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700'
                    }`}
                    title={`${cols} column${cols > 1 ? 's' : ''}`}
                  >
                    {cols}
                  </button>
                ))}
              </div>
            )}
            {/* 2D/3D Mode Toggle */}
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-1">
              <button
                onClick={() => on3DModeChange?.(false)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  !is3DMode
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700'
                }`}
                title="2D Mode - Clean and lightweight"
              >
                2D
              </button>
              <button
                onClick={() => on3DModeChange?.(true)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  is3DMode
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700'
                }`}
                title="3D Mode - Enhanced visual effects"
              >
                3D
              </button>
            </div>
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
          <footer className="bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-800 px-4 sm:px-6 py-4 mt-auto">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs sm:text-sm text-gray-500 dark:text-slate-400">
              <div className="flex items-center gap-2">
                <span>© 2025 IronGate QA Navigator</span>
                <span className="hidden sm:inline">•</span>
                <span className="hidden sm:inline">Driven By Experience</span>
                <span className="hidden sm:inline">•</span>
                <span className="hidden sm:inline">All rights reserved</span>
              </div>
              <div className="flex items-center gap-4">
                <a href="#" className="hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">Privacy Policy</a>
                <span>•</span>
                <a href="#" className="hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">Terms of Service</a>
                <span>•</span>
                <a href="#" className="hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">Support</a>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default Layout;
