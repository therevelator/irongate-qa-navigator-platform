import React, { useEffect, useState } from 'react';
import BrandMark from './BrandMark';
import { Mail, Lock, Eye, EyeOff, AlertCircle, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import API_URL from '../config/api';
import { goTo, FORGOT_PATH } from '../lib/passwordResetPaths';

interface LoginProps {
  onSwitchToRegister: () => void;
}

/** GET /api/auth/providers: which sign-in options this server offers. */
interface Providers {
  sso: Array<{ id: 'google' | 'microsoft'; label: string; startUrl: string }>;
  demoMode: boolean;
  demoAccounts?: Array<{ role: string; email: string }>;
  demoPassword?: string;
}

/** Provider marks (flat brand marks, as the providers' sign-in guidelines require). */
const ProviderIcon: React.FC<{ id: string }> = ({ id }) =>
  id === 'microsoft' ? (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="1" y="1" width="6.5" height="6.5" fill="#f25022" /><rect x="8.5" y="1" width="6.5" height="6.5" fill="#7fba00" />
      <rect x="1" y="8.5" width="6.5" height="6.5" fill="#00a4ef" /><rect x="8.5" y="8.5" width="6.5" height="6.5" fill="#ffb900" />
    </svg>
  ) : (
    <svg viewBox="0 0 48 48" width="16" height="16" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );

const Login: React.FC<LoginProps> = ({ onSwitchToRegister }) => {
  const { login, isLoading, sessionNotice } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [providers, setProviders] = useState<Providers | null>(null);

  // Sign-in options (SSO buttons only when configured; demo chips only in DEMO_MODE) and an
  // error coming back from a single sign-on attempt (?sso_error=…&sso_message=…).
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/auth/providers`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { if (!cancelled && p) setProviders(p); })
      .catch(() => undefined);
    const params = new URLSearchParams(window.location.search);
    if (params.get('sso_error')) {
      setError(params.get('sso_message') || 'Single sign-on failed. Please try again.');
      params.delete('sso_error');
      params.delete('sso_message');
      const qs = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    }
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email || !password) {
      setError('Enter your email address and password.');
      return;
    }
    try {
      await login({ email, password, rememberMe });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
    }
  };

  const fillDemo = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword(providers?.demoPassword ?? '');
    setError('');
  };
  const ssoProviders = providers?.sso ?? [];
  const demoAccounts = providers?.demoMode ? providers.demoAccounts ?? [] : [];

  const inputClass =
    'w-full h-11 pl-10 pr-3 rounded-md border border-slate-300 bg-white text-sm text-slate-900 placeholder-slate-400 ' +
    'focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-600 disabled:bg-slate-50 ' +
    'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800';

  return (
    <div className="ig-app-bg min-h-screen grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] bg-white dark:bg-slate-950">
      {/* Brand panel */}
      <aside className="ig-brand-panel hidden lg:flex flex-col justify-between bg-brand-900 text-white p-12">
        <div className="flex items-center gap-3">
          <BrandMark height={64} className="drop-shadow-[0_6px_14px_rgba(0,0,0,0.45)]" />
              <div className="leading-tight">
                <p className="text-base font-semibold">QE Navigator</p>
                <p className="text-xs text-brand-200">by IronGate Software</p>
              </div>
        </div>

        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Quality engineering intelligence for delivery teams.
          </h2>
          <p className="mt-4 text-brand-200 leading-relaxed">
            One view of test health, delivery performance and engineering risk across every team in your
            organisation.
          </p>
          <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-white/10 pt-8">
            <div>
              <dt className="text-xs uppercase tracking-wider text-brand-300">Quality</dt>
              <dd className="mt-1 text-sm text-brand-100">Coverage, flakiness, defect escape</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-brand-300">Delivery</dt>
              <dd className="mt-1 text-sm text-brand-100">DORA metrics and pipeline health</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-brand-300">Impact</dt>
              <dd className="mt-1 text-sm text-brand-100">Quality linked to business KPIs</dd>
            </div>
          </dl>
        </div>

        <p className="text-xs text-brand-300">© {new Date().getFullYear()} IronGate Software Ltd.</p>
      </aside>

      {/* Form panel */}
      <main className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-10 flex items-center gap-3">
            <BrandMark height={48} />
              <div className="leading-tight">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">QE Navigator</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">by IronGate Software</p>
              </div>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Sign in</h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">Use your work account to continue.</p>

          {sessionNotice && !error && (
            <div role="status" data-testid="session-notice" className="mt-6 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{sessionNotice}</span>
            </div>
          )}

          {error && (
            <div role="alert" className="mt-6 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {ssoProviders.length > 0 && (
            <div className="mt-6 space-y-2" data-testid="sso-buttons">
              {ssoProviders.map((p) => (
                <a
                  key={p.id}
                  href={`${API_URL}${p.startUrl}${rememberMe ? `${p.startUrl.includes('?') ? '&' : '?'}remember=1` : ''}`}
                  className="w-full h-11 inline-flex items-center justify-center gap-2.5 rounded-md border border-slate-300 bg-white text-sm font-medium text-slate-800 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 transition-colors"
                  data-testid={`sso-${p.id}`}
                >
                  <ProviderIcon id={p.id} /> Continue with {p.label}
                </a>
              ))}
              <div className="flex items-center gap-3 pt-2" aria-hidden="true">
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                <span className="text-xs text-slate-500 dark:text-slate-400">or with your password</span>
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  id="email" type="email" autoComplete="email" value={email}
                  onChange={(e) => setEmail(e.target.value)} className={inputClass}
                  placeholder="name@company.com" disabled={isLoading}
                />
              </div>
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Password</label>
                <a
                  href={FORGOT_PATH} onClick={(e) => { e.preventDefault(); goTo(FORGOT_PATH); }} data-testid="forgot-password-link"
                  className="text-sm font-medium text-brand-700 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200"
                >
                  Forgot password?
                </a>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  className={`${inputClass} pr-10`} placeholder="Password" disabled={isLoading}
                />
                <button
                  type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500" disabled={isLoading}
                  aria-describedby="remember-hint"
                />
                Keep me signed in
              </label>
              <p id="remember-hint" className="mt-1 pl-6 text-xs text-slate-500 dark:text-slate-400">
                Unticked, you are signed out when you close the browser.
              </p>
            </div>

            <button
              type="submit" disabled={isLoading}
              className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-md bg-brand-700 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? 'Signing in…' : (<>Sign in <ArrowRight size={16} /></>)}
            </button>
          </form>

          <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
            New organisation?{' '}
            <button onClick={onSwitchToRegister} className="font-medium text-brand-700 hover:text-brand-800 dark:text-brand-300">
              Create an account
            </button>
          </p>

          {demoAccounts.length > 0 && (
          <div className="mt-10 border-t border-slate-200 pt-6 dark:border-slate-800" data-testid="demo-accounts">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Demo accounts</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Select a role to fill in its credentials.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {demoAccounts.map((a) => (
                <button
                  key={a.email} type="button" onClick={() => fillDemo(a.email)}
                  className={`px-2.5 py-1 rounded-md border text-xs transition-colors ${
                    email === a.email
                      ? 'border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-200'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {a.role}
                </button>
              ))}
            </div>
          </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Login;
