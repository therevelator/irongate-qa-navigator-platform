import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { User, AuthState, LoginCredentials, RegisterData } from '../types/auth';
import API_URL from '../config/api';

interface AuthContextType extends AuthState {
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  updateUser: (user: Partial<User>) => void;
  /** Reload the signed-in user from the server (after accepting an invitation, or a role change). */
  reloadUser: () => Promise<void>;
}

/** Map the API user (snake_case) to the app's User, including the role assignments. */
export function mapApiUser(u: any): User {
  return {
    id: u.id,
    email: u.email,
    firstName: u.first_name || u.firstName,
    lastName: u.last_name || u.lastName,
    role: u.role,
    companyId: u.company_id || u.companyId,
    departmentId: u.department_id || u.departmentId,
    primaryTeamId: u.primary_team_id || u.primaryTeamId,
    assignedTeams: u.assignedTeams || [],
    assignments: Array.isArray(u.assignments) ? u.assignments : [],
    createdAt: u.created_at || u.createdAt,
    lastLogin: u.last_login || u.lastLogin,
    isActive: u.is_active ?? u.isActive ?? true,
    emailVerified: u.email_verified ?? u.emailVerified ?? false,
  };
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

  // Check for existing session on mount (and on reloadUser).
  const checkAuth = async () => {
    try {
      // Try to get user from backend (checks cookie)
      const response = await fetch(`${API_URL}/auth/me`, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include' // Send cookies
      });

      if (response.ok) {
        const { user } = await response.json();
        const mappedUser = mapApiUser(user);
        // Cache user info in localStorage for faster subsequent loads
        localStorage.setItem('irongate_user', JSON.stringify(mappedUser));
        setAuthState({ user: mappedUser, isAuthenticated: true, isLoading: false, error: null });
      } else {
        // Session invalid or expired
        localStorage.removeItem('irongate_user');
        setAuthState(prev => ({ ...prev, isLoading: false, user: null, isAuthenticated: false }));
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      // Safer to assume logged out if the session cannot be verified.
      localStorage.removeItem('irongate_user');
      setAuthState(prev => ({ ...prev, isLoading: false, user: null, isAuthenticated: false }));
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const login = async (credentials: LoginCredentials): Promise<void> => {
    setAuthState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Real API authentication
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
        credentials: 'include' // Send/Receive cookies
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Login failed');
      }

      const { user: userData } = await response.json();

      // Map backend user to frontend User type
      const user: User = { ...mapApiUser(userData), lastLogin: new Date().toISOString() };

      // Store user info (but NOT token)
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
     // Mock implementation removed for brevity/security
     // Force real login
     return login(credentials);
  };

  const register = async (data: RegisterData): Promise<void> => {
    setAuthState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Call real API for registration
      const response = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include' // Send/Receive cookies
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Registration failed');
      }

      const { user: apiUser } = await response.json();
      
      // Map API response to User type
      const user: User = { ...mapApiUser(apiUser), assignedTeams: apiUser.assignedTeams || [apiUser.primary_team_id] };
      
      localStorage.setItem('irongate_user', JSON.stringify(user));
      // No token storage in localStorage
      
      setAuthState({
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
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

  const logout = async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem('irongate_user');
      localStorage.removeItem('irongate_remember');
      
      setAuthState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      });
    }
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
        reloadUser: checkAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
