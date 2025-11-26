import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { User, AuthState, LoginCredentials, RegisterData } from '../types/auth';
import API_URL from '../config/api';

interface AuthContextType extends AuthState {
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  updateUser: (user: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,
  });

  // Check for existing session on mount
  useEffect(() => {
    const checkAuth = () => {
      const storedUser = localStorage.getItem('irongate_user');
      const storedToken = localStorage.getItem('irongate_token');
      
      if (storedUser && storedToken) {
        try {
          const user = JSON.parse(storedUser);
          setAuthState({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
        } catch (error) {
          console.error('Failed to parse stored user:', error);
          localStorage.removeItem('irongate_user');
          localStorage.removeItem('irongate_token');
          setAuthState(prev => ({ ...prev, isLoading: false }));
        }
      } else {
        setAuthState(prev => ({ ...prev, isLoading: false }));
      }
    };

    checkAuth();
  }, []);

  const login = async (credentials: LoginCredentials): Promise<void> => {
    setAuthState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Real API authentication
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Login failed');
      }

      const { user: userData, token } = await response.json();

      // Map backend user to frontend User type
      const user: User = {
        id: userData.id,
        email: userData.email,
        firstName: userData.first_name,
        lastName: userData.last_name,
        role: userData.role,
        companyId: userData.company_id,
        departmentId: userData.department_id,
        primaryTeamId: userData.primary_team_id,
        assignedTeams: [],
        createdAt: userData.created_at,
        lastLogin: new Date().toISOString(),
        isActive: userData.is_active,
        emailVerified: userData.email_verified
      };

      // Store token and user
      localStorage.setItem('irongate_token', token);
      localStorage.setItem('irongate_user', JSON.stringify(user));

      setAuthState({
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (error: any) {
      console.error('Login error:', error);
      setAuthState(prev => ({
        ...prev,
        isLoading: false,
        error: error.message || 'Login failed. Please check your credentials.',
      }));
      throw error;
    }
  };

  // FALLBACK: Mock authentication (kept for reference)
  const loginMock = async (credentials: LoginCredentials): Promise<void> => {
    setAuthState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const mockUsers: Record<string, User> = {
        'admin@irongate.com': {
          id: 'user-1',
          email: 'admin@irongate.com',
          firstName: 'Admin',
          lastName: 'User',
          role: 'super_admin',
          companyId: 'company-mastercard',
          departmentId: 'dept-decision-mgmt',
          primaryTeamId: 'team-quasars',
          assignedTeams: [],
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString(),
          isActive: true,
          emailVerified: true,
        },
        'manager@irongate.com': {
          id: 'user-2',
          email: 'manager@irongate.com',
          firstName: 'QA',
          lastName: 'Manager',
          role: 'manager' as const,
          companyId: 'company-mastercard',
          departmentId: 'dept-decision-mgmt',
          primaryTeamId: 'team-pulsars',
          assignedTeams: [],
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString(),
          isActive: true,
          emailVerified: true,
        },
        'lead@irongate.com': {
          id: 'user-3',
          email: 'lead@irongate.com',
          firstName: 'Team',
          lastName: 'Lead',
          role: 'team_lead',
          companyId: 'company-mastercard',
          departmentId: 'dept-decision-mgmt',
          primaryTeamId: 'team-watchmen',
          assignedTeams: ['team-watchmen', 'team-astronauts'],
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString(),
          isActive: true,
          emailVerified: true,
        },
        'engineer@irongate.com': {
          id: 'user-4',
          email: 'engineer@irongate.com',
          firstName: 'QA',
          lastName: 'Engineer',
          role: 'qa_engineer',
          companyId: 'company-mastercard',
          departmentId: 'dept-decision-mgmt',
          primaryTeamId: 'team-quasars',
          assignedTeams: ['team-quasars'],
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString(),
          isActive: true,
          emailVerified: true,
        },
        'viewer@irongate.com': {
          id: 'user-5',
          email: 'viewer@irongate.com',
          firstName: 'Guest',
          lastName: 'Viewer',
          role: 'viewer',
          companyId: 'company-mastercard',
          departmentId: 'dept-decision-mgmt',
          primaryTeamId: 'team-grid',
          assignedTeams: ['team-grid'],
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString(),
          isActive: true,
          emailVerified: true,
        },
      };

      const user = mockUsers[credentials.email.toLowerCase()];

      if (!user || credentials.password !== 'demo123') {
        throw new Error('Invalid email or password');
      }

      // Store in localStorage
      const token = btoa(`${user.id}:${Date.now()}`); // Mock token
      localStorage.setItem('irongate_user', JSON.stringify(user));
      localStorage.setItem('irongate_token', token);

      if (credentials.rememberMe) {
        localStorage.setItem('irongate_remember', 'true');
      }

      setAuthState({
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });

      /* PRODUCTION MODE - Replace mock with real API:
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Login failed');
      }

      const { user, token } = await response.json();
      
      localStorage.setItem('irongate_user', JSON.stringify(user));
      localStorage.setItem('irongate_token', token);
      
      setAuthState({
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
      */
    } catch (error) {
      setAuthState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Login failed',
      });
      throw error;
    }
  };

  const register = async (data: RegisterData): Promise<void> => {
    setAuthState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // DEMO MODE: Mock registration
      await new Promise(resolve => setTimeout(resolve, 1000));

      const newUser: User = {
        id: `user-${Date.now()}`,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role || 'qa_engineer', // Default role
        companyId: data.companyId,
        departmentId: data.departmentId,
        primaryTeamId: data.teamId,
        assignedTeams: [data.teamId],
        createdAt: new Date().toISOString(),
        isActive: true,
        emailVerified: false,
      };

      // In demo mode, auto-login after registration
      const token = btoa(`${newUser.id}:${Date.now()}`);
      localStorage.setItem('irongate_user', JSON.stringify(newUser));
      localStorage.setItem('irongate_token', token);

      setAuthState({
        user: newUser,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });

      /* PRODUCTION MODE:
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Registration failed');
      }

      const { user, token } = await response.json();
      
      localStorage.setItem('irongate_user', JSON.stringify(user));
      localStorage.setItem('irongate_token', token);
      
      setAuthState({
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
      */
    } catch (error) {
      setAuthState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Registration failed',
      });
      throw error;
    }
  };

  const logout = () => {
    localStorage.removeItem('irongate_user');
    localStorage.removeItem('irongate_token');
    localStorage.removeItem('irongate_remember');
    
    setAuthState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });

    /* PRODUCTION MODE:
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('irongate_token')}`,
      },
    }).finally(() => {
      localStorage.removeItem('irongate_user');
      localStorage.removeItem('irongate_token');
      setAuthState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      });
    });
    */
  };

  const updateUser = (updates: Partial<User>) => {
    if (authState.user) {
      const updatedUser = { ...authState.user, ...updates };
      localStorage.setItem('irongate_user', JSON.stringify(updatedUser));
      setAuthState(prev => ({
        ...prev,
        user: updatedUser,
      }));
    }
  };

  return (
    <AuthContext.Provider
      value={{
        ...authState,
        login,
        register,
        logout,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
