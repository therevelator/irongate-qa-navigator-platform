import React, { useState, useEffect } from 'react';
import { LayoutDashboard, BarChart3, LogOut, Shield, Users as UsersIcon, Users as TeamsIcon, Building2, Menu, X, Palette } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme, themes } from '../contexts/ThemeContext';
import type { ThemeName } from '../contexts/ThemeContext';
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
}

import API_URL from '../config/api';

const Layout: React.FC<LayoutProps> = ({ children, currentView, onViewChange, activeTab = 'all', onTabChange }) => {
  const { user, logout } = useAuth();
  const { isDark, themeName, setThemeName, toggleTheme } = useTheme();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (user?.id) {
      fetchDepartments();
    }
  }, [user?.id]);

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

  // Theme-specific background classes
  const mainBgClass = themeName === 'aurora' 
    ? isDark 
      ? 'bg-gradient-to-br from-slate-950 via-emerald-950 to-slate-900' 
      : 'bg-gradient-to-br from-emerald-50 via-teal-50 to-lime-50'
    : 'bg-gray-50 dark:bg-slate-950';

  const sidebarBgClass = themeName === 'aurora'
    ? isDark
      ? 'bg-gradient-to-b from-slate-950 to-emerald-950 border-emerald-500/25'
      : 'bg-gradient-to-b from-white to-emerald-50 border-emerald-200'
    : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800';

  return (
    <div className={`flex h-screen ${mainBgClass}`}>
      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div 
          className={`fixed inset-0 z-40 lg:hidden ${
            themeName === 'aurora' ? 'bg-emerald-900/50 backdrop-blur-sm' : 'bg-black bg-opacity-50'
          }`}
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-64 flex flex-col border-r transform transition-all duration-300 ease-in-out ${sidebarBgClass} ${
        isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      }`}>
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
            className="lg:hidden p-2 rounded-md hover:bg-gray-100 dark:hover:bg-slate-800"
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
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar with Welcome and Theme Toggle */}
        <div className={`px-4 sm:px-6 py-3 flex items-center justify-between border-b transition-all ${
          themeName === 'aurora'
            ? isDark
              ? 'bg-slate-950/90 backdrop-blur-md border-emerald-500/25'
              : 'bg-white/85 backdrop-blur-md border-emerald-200'
            : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800'
        }`}>
          <div className="flex items-center space-x-3 sm:space-x-4">
            {/* Mobile Menu Button */}
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className={`lg:hidden p-2 rounded-md transition-colors ${
                themeName === 'aurora'
                  ? 'hover:bg-emerald-500/15'
                  : 'hover:bg-gray-100 dark:hover:bg-slate-800'
              }`}
            >
              <Menu size={20} className={themeName === 'aurora' && isDark ? 'text-emerald-300' : 'text-gray-600 dark:text-gray-400'} />
            </button>
            
            <h2 className={`text-xs sm:text-sm font-medium truncate ${
              themeName === 'aurora' && isDark ? 'text-emerald-100' : 'text-gray-600 dark:text-slate-400'
            }`}>
              Welcome, {user?.firstName}
            </h2>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Theme Selector - Hidden on mobile */}
            <div className={`hidden md:flex items-center gap-1 p-1 rounded-lg ${
              themeName === 'aurora'
                ? isDark ? 'bg-emerald-950/60' : 'bg-emerald-50'
                : 'bg-gray-100 dark:bg-slate-800'
            }`}>
              {(Object.keys(themes) as ThemeName[]).map((theme) => (
                <button
                  key={theme}
                  onClick={() => setThemeName(theme)}
                  className={`px-2 py-1 rounded text-xs font-medium transition-all ${
                    themeName === theme
                      ? theme === 'ocean'
                        ? 'bg-cyan-500 text-white shadow-sm'
                        : 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/30'
                      : themeName === 'aurora' && isDark
                        ? 'text-emerald-200 hover:text-emerald-100'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                  title={themes[theme].description}
                >
                  {themes[theme].name}
                </button>
              ))}
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
                <span>© {new Date().getFullYear()} IronGate QA Navigator</span>
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
