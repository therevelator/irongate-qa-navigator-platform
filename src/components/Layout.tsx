import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Sparkles, Settings, LogOut, Shield, Building2, Sun, Moon, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { getRoleBadgeColor } from '../types/auth';

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

const API_URL = 'http://localhost:3000/api';

const Layout: React.FC<LayoutProps> = ({ children, currentView, onViewChange, activeTab = 'all', onTabChange }) => {
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [departments, setDepartments] = useState<Department[]>([]);

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
  };

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-slate-950">
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-white dark:bg-slate-900 flex flex-col border-r border-gray-200 dark:border-slate-800 shadow-sm">
        {/* Logo */}
        <div className="p-6">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg">
              <Shield size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">Irongate QA</h1>
              <p className="text-xs text-gray-500 dark:text-slate-400">Navigator</p>
            </div>
          </div>
        </div>

        {/* User Info */}
        <div className="px-4 py-3 mx-3 mb-4 rounded-lg bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center">
              <User size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {user?.firstName} {user?.lastName}
              </p>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${getRoleBadgeColor(user?.role || 'viewer')}`}>
                  {user?.role?.replace('_', ' ')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2 px-3 space-y-1">
          {/* Dashboard - All Teams */}
          <button
            onClick={handleAllClick}
            className={`w-full flex items-center space-x-3 px-4 py-2.5 rounded-lg transition-all duration-200 ${
              activeTab === 'all' && currentView === 'dashboard'
                ? 'bg-blue-500 text-white shadow-md shadow-blue-500/30'
                : 'text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800'
            }`}
          >
            <LayoutDashboard size={19} />
            <span className="font-medium">All Teams</span>
          </button>

          {/* Departments */}
          {departments.length > 0 && (
            <div className="pt-4">
              <div className="px-4 py-2 text-xs font-semibold text-gray-500 dark:text-slate-500 uppercase tracking-wider">
                Departments
              </div>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {departments.map((dept) => (
                  <button
                    key={dept.id}
                    onClick={() => handleDepartmentClick(dept.id)}
                    className={`w-full flex items-center space-x-3 px-4 py-2.5 rounded-lg text-sm transition-all duration-200 ${
                      activeTab === dept.id && currentView === 'dashboard'
                        ? 'bg-blue-500 text-white shadow-md shadow-blue-500/30'
                        : 'text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Building2 size={18} />
                    <span className="truncate">{dept.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="pt-4 mt-4 border-t border-gray-200 dark:border-slate-800">
            <button
              onClick={() => onViewChange('features')}
              className={`w-full flex items-center space-x-3 px-4 py-2.5 rounded-lg transition-all duration-200 ${
                currentView === 'features'
                  ? 'bg-blue-500 text-white shadow-md shadow-blue-500/30'
                  : 'text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800'
              }`}
            >
              <Sparkles size={19} />
              <span className="font-medium">Advanced Features</span>
            </button>
          </div>

          {/* Admin Links */}
          <div className="pt-2 space-y-1">
            {(user?.role === 'super_admin' || user?.role === 'qa_manager') && (
              <button
                onClick={() => onViewChange('admin-panel')}
                className={`w-full flex items-center space-x-3 px-4 py-2.5 rounded-lg transition-all duration-200 ${
                  currentView === 'admin-panel'
                    ? 'bg-blue-500 text-white shadow-md shadow-blue-500/30'
                    : 'text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800'
                }`}
              >
                <Shield size={19} />
                <span className="font-medium">Admin Panel</span>
              </button>
            )}
            
            {(user?.role === 'super_admin' || user?.role === 'qa_manager' || user?.role === 'team_lead') && (
              <button
                onClick={() => onViewChange('manage-teams')}
                className={`w-full flex items-center space-x-3 px-4 py-2.5 rounded-lg transition-all duration-200 ${
                  currentView === 'manage-teams'
                    ? 'bg-blue-500 text-white shadow-md shadow-blue-500/30'
                    : 'text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800'
                }`}
              >
                <Settings size={19} />
                <span className="font-medium">Manage Teams</span>
              </button>
            )}
          </div>
        </nav>

        {/* Logout */}
        <div className="p-3 border-t border-gray-200 dark:border-slate-800">
          <button
            onClick={logout}
            className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white rounded-lg transition-all duration-200 text-sm font-medium shadow-md hover:shadow-lg"
          >
            <LogOut size={17} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar with Welcome and Theme Toggle */}
        <div className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 px-6 py-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center space-x-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Welcome, <span className="text-blue-500">{user?.firstName}</span>!
            </h2>
          </div>
          
          <button
            onClick={toggleTheme}
            className="p-2.5 rounded-lg bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 transition-all duration-200 border border-gray-200 dark:border-slate-700"
            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {isDark ? (
              <Sun size={20} className="text-yellow-500" />
            ) : (
              <Moon size={20} className="text-gray-600" />
            )}
          </button>
        </div>

        {/* Page Content */}
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </div>
    </div>
  );
};

export default Layout;
