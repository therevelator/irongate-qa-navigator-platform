import React, { useState } from 'react';
import { Mail, Lock, Eye, EyeOff, AlertCircle, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface LoginProps {
  onSwitchToRegister: () => void;
}

const DEMO_ACCOUNTS = [
  { role: 'Administrator', email: 'admin@irongate.com' },
  { role: 'QA manager', email: 'manager@irongate.com' },
  { role: 'Team lead', email: 'lead@irongate.com' },
  { role: 'QA engineer', email: 'engineer@irongate.com' },
  { role: 'Viewer', email: 'viewer@irongate.com' },
];
const DEMO_PASSWORD = 'demo123';

const Login: React.FC<LoginProps> = ({ onSwitchToRegister }) => {
  const { login, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

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
    setPassword(DEMO_PASSWORD);
    setError('');
  };

  const inputClass =
    'w-full h-11 pl-10 pr-3 rounded-md border border-slate-300 bg-white text-sm text-slate-900 placeholder-slate-400 ' +
    'focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-600 disabled:bg-slate-50 ' +
    'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800';

  return (
    <div className="min-h-screen grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] bg-white dark:bg-slate-950">
      {/* Brand panel */}
      <aside className="hidden lg:flex flex-col justify-between bg-brand-900 text-white p-12">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-md bg-white/10 border border-white/15 flex items-center justify-center">
            <span className="text-sm font-semibold tracking-tight">IG</span>
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">IronGate</p>
            <p className="text-xs text-brand-200">QE Navigator</p>
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
            <div className="h-9 w-9 rounded-md bg-brand-800 flex items-center justify-center">
              <span className="text-sm font-semibold text-white">IG</span>
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">IronGate</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">QE Navigator</p>
            </div>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Sign in</h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">Use your work account to continue.</p>

          {error && (
            <div role="alert" className="mt-6 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
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
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Password</label>
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

            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500" disabled={isLoading}
              />
              Keep me signed in
            </label>

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

          <div className="mt-10 border-t border-slate-200 pt-6 dark:border-slate-800">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Demo accounts</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Select a role to fill in its credentials.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {DEMO_ACCOUNTS.map((a) => (
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
        </div>
      </main>
    </div>
  );
};

export default Login;
