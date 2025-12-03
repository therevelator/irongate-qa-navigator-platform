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
    const checkAuth = async () => {
      try {
        // Try to get user from backend (checks cookie)
        const response = await fetch(`${API_URL}/auth/me`, {
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include' // Send cookies
        });

        if (response.ok) {
          const { user } = await response.json();
          
          // Map backend user to frontend User type (if needed, but structure matches closely)
          const mappedUser: User = {
            id: user.id,
            email: user.email,
            firstName: user.first_name || user.firstName,
            lastName: user.last_name || user.lastName,
            role: user.role,
            companyId: user.company_id || user.companyId,
            departmentId: user.department_id || user.departmentId,
            primaryTeamId: user.primary_team_id || user.primaryTeamId,
            assignedTeams: user.assignedTeams || [],
            createdAt: user.created_at || user.createdAt,
            lastLogin: user.last_login || user.lastLogin,
            isActive: user.is_active ?? user.isActive ?? true,
            emailVerified: user.email_verified ?? user.emailVerified ?? false
          };

          // Cache user info in localStorage for faster subsequent loads (optional, but keeps UI responsive)
          localStorage.setItem('irongate_user', JSON.stringify(mappedUser));

          setAuthState({
            user: mappedUser,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
        } else {
          // Session invalid or expired
          localStorage.removeItem('irongate_user');
          setAuthState(prev => ({ ...prev, isLoading: false, user: null, isAuthenticated: false }));
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        // Fallback to checking localStorage user if network fails? 
        // No, safer to assume logged out if we can't verify session.
        // But to prevent flashing logged out state on network glitch, maybe we could...
        // For now, assume logged out.
        localStorage.removeItem('irongate_user');
        setAuthState(prev => ({ ...prev, isLoading: false, user: null, isAuthenticated: false }));
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
        body: JSON.stringify(credentials),
        credentials: 'include' // Send/Receive cookies
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Login failed');
      }

      const { user: userData } = await response.json();

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
        assignedTeams: userData.assignedTeams || [],
        createdAt: userData.created_at,
        lastLogin: new Date().toISOString(),
        isActive: userData.is_active,
        emailVerified: userData.email_verified
      };

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
      const user: User = {
        id: apiUser.id,
        email: apiUser.email,
        firstName: apiUser.first_name,
        lastName: apiUser.last_name,
        role: apiUser.role,
        companyId: apiUser.company_id,
        departmentId: apiUser.department_id,
        primaryTeamId: apiUser.primary_team_id,
        assignedTeams: apiUser.assignedTeams || [apiUser.primary_team_id],
        createdAt: apiUser.created_at || new Date().toISOString(),
        isActive: apiUser.is_active ?? true,
        emailVerified: apiUser.email_verified ?? false,
      };
      
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
