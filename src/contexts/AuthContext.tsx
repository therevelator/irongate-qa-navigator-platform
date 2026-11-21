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
  /** Why the session ended (expired, or signed out everywhere): shown on the sign-in screen. */
  sessionNotice: string | null;
  /** True only until the first session check has answered (the full-screen loader). A sign-in or
   *  registration in progress sets isLoading, not this, so their forms stay mounted and can show errors. */
  isInitializing: boolean;
}

/** fetch for the sign-in and registration forms: a network failure or an unreadable answer becomes a
 *  message a person can act on (never "Failed to fetch" or a JSON parse error). */
async function authRequest(url: string, body: unknown, fallback: string): Promise<any> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include', // Send/Receive cookies
    });
  } catch {
    throw new Error('The server could not be reached. Check your connection and try again.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const ref = data?.requestId ? ` Reference: ${data.requestId}.` : '';
    if (response.status >= 500) throw new Error(`${fallback}: the server had a problem. Try again in a moment.${ref}`);
    throw new Error(data?.error || fallback);
  }
  return data;
}

/** Header of a 401 for a session that ended, or a 403 of a suspended organisation (server/lib/sessions.ts). */
const SESSION_ENDED_HEADER = 'X-Session-Ended';
const NOTICE: Record<string, string> = {
  session_ended: 'Your session has ended. Please sign in again.',
  session_expired: 'Your sign-in has expired. Please sign in again.',
  company_suspended: "Your organisation's access is suspended. Contact your administrator.",
};

/**
 * Why the session ended, kept for this browser tab (sessionStorage): the first refused request
 * clears the cookie, so after a reload the server can no longer say why; the sign-in screen still
 * shows the message. Removed by the next successful sign-in (or session check) and by signing out.
 */
const NOTICE_KEY = 'irongate_session_notice';
const storedNotice = (): string | null => {
  try {
    const code = sessionStorage.getItem(NOTICE_KEY);
    return code ? NOTICE[code] ?? NOTICE.session_ended : null;
  } catch { return null; }
};
const keepNotice = (code: string) => { try { sessionStorage.setItem(NOTICE_KEY, NOTICE[code] ? code : 'session_ended'); } catch { /* storage blocked */ } };
const dropNotice = () => { try { sessionStorage.removeItem(NOTICE_KEY); } catch { /* storage blocked */ } };

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
    hideSampleNotice: !!(u.hide_sample_notice ?? u.hideSampleNotice),
    sandbox: u.sandbox ?? null,
  };
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** True when the signed-in user's company hides the sample-data notices. Safe outside the provider. */
export const useHideSampleNotice = (): boolean => !!useContext(AuthContext)?.user?.hideSampleNotice;

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
  const [sessionNotice, setSessionNotice] = useState<string | null>(storedNotice);
  const [isInitializing, setIsInitializing] = useState(true);

  // A session ended by the server (expired, or signed out everywhere) on ANY API call: back to the
  // sign-in screen with a clear message. The address is kept, so a deep link opens after sign-in.
  useEffect(() => {
    const original = window.fetch;
    const wrapped: typeof fetch = async (...args) => {
      const res = await original(...args);
      const ended = res.status === 401 || res.status === 403 ? res.headers.get(SESSION_ENDED_HEADER) : null;
      if (ended) {
        localStorage.removeItem('irongate_user');
        keepNotice(ended);
        setSessionNotice(NOTICE[ended] ?? NOTICE.session_ended);
        setAuthState({ user: null, isAuthenticated: false, isLoading: false, error: null });
      }
      return res;
    };
    window.fetch = wrapped;
    return () => { if (window.fetch === wrapped) window.fetch = original; };
  }, []);

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
        dropNotice();
        setSessionNotice(null);
        setAuthState({ user: mappedUser, isAuthenticated: true, isLoading: false, error: null });
      } else {
        const ended = response.headers.get(SESSION_ENDED_HEADER);
        // This browser was signed in (the cached user is removed only by signing out) but the
        // cookie is gone: the server ended the session on a request whose answer the page never
        // read (for example one cut off by a reload), or the browser dropped the cookie. Say so
        // instead of showing the plain sign-in screen.
        const hadSession = localStorage.getItem('irongate_user') !== null;
        // A reason another request of this page already stored (it may have answered first and
        // cleared the cookie, e.g. company_suspended) is kept.
        let kept: string | null = null;
        try { kept = sessionStorage.getItem(NOTICE_KEY); } catch { /* storage blocked */ }
        const code = ended ?? kept ?? (hadSession ? 'session_ended' : null);
        if (code) { keepNotice(code); setSessionNotice(NOTICE[code] ?? NOTICE.session_ended); }
        // Session invalid or expired
        localStorage.removeItem('irongate_user');
        setAuthState(prev => ({ ...prev, isLoading: false, user: null, isAuthenticated: false }));
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      // Safer to assume logged out if the session cannot be verified.
      localStorage.removeItem('irongate_user');
      setAuthState(prev => ({ ...prev, isLoading: false, user: null, isAuthenticated: false }));
    } finally {
      setIsInitializing(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const login = async (credentials: LoginCredentials): Promise<void> => {
    setAuthState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Real API authentication
      const { user: userData } = await authRequest(`${API_URL}/auth/login`, credentials, 'Sign-in failed');

      // Map backend user to frontend User type
      const user: User = { ...mapApiUser(userData), lastLogin: new Date().toISOString() };

      // Store user info (but NOT token)
      localStorage.setItem('irongate_user', JSON.stringify(user));
      dropNotice();
      setSessionNotice(null);

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
      const { user: apiUser } = await authRequest(`${API_URL}/auth/register`, data, 'Registration failed');
      
      // Map API response to User type
      const user: User = { ...mapApiUser(apiUser), assignedTeams: apiUser.assignedTeams || [apiUser.primary_team_id] };
      
      localStorage.setItem('irongate_user', JSON.stringify(user));
      dropNotice();
      setSessionNotice(null);
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
    // A demo sandbox session goes back to /try (to start again or switch role).
    const sandbox = !!authState.user?.sandbox;
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
      localStorage.removeItem('irongate_signed_in'); // the sign-in screen is classic Light again (AuthWrapper)
      // The executive summary's offline copies (ExecutiveSummary.tsx) do not outlive the session.
      for (const k of Object.keys(localStorage)) if (k.startsWith('irongate_summary_cache:')) localStorage.removeItem(k);
      dropNotice();
      setSessionNotice(null);
      
      setAuthState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      });
      if (sandbox) {
        try { sessionStorage.removeItem('irongate_sandbox_visit'); } catch { /* storage unavailable */ }
        window.location.assign('/try');
      }
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
        sessionNotice,
        isInitializing,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
