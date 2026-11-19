import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, Eye, EyeOff, Lock, Mail, X } from 'lucide-react';
import API_URL from '../config/api';
import { useAuth } from '../contexts/AuthContext';
import { passwordChecks } from '../lib/passwordPolicy';
import { cx } from './ui';
import { FORGOT_PATH, RESET_PATH, goTo } from '../lib/passwordResetPaths';

/**
 * Reset a forgotten password by e-mail (server/lib/passwordReset.ts):
 *   /forgot-password   asks for the e-mail address; the answer is always the same message, so the
 *                      page never says whether an account exists.
 *   /reset-password    ?token=… from the e-mail: choose a new password (the app's password rules).
 *                      The token is read once and removed from the address bar straight away, and
 *                      the page sends no Referer, so the token cannot leak to other sites or logs.
 * Neither page signs the person in: after a reset they sign in with the new password.
 */

const inputClass =
  'w-full h-11 pl-10 pr-3 rounded-md border border-slate-300 bg-white text-sm text-slate-900 placeholder-slate-400 ' +
  'focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-600 disabled:bg-slate-50 ' +
  'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800';

const primaryButton =
  'w-full h-11 inline-flex items-center justify-center gap-2 rounded-md bg-brand-700 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors';

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-start sm:items-center justify-center px-4 py-10">
    <main className="w-full max-w-md">
      <div className="mb-8 flex items-center gap-3">
        <div className="h-9 w-9 rounded-md bg-brand-800 flex items-center justify-center">
          <span className="text-sm font-semibold text-white">IG</span>
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">IronGate</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">QE Navigator</p>
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-6 sm:p-8 dark:border-slate-800 dark:bg-slate-900">{children}</div>
    </main>
  </div>
);

const ErrorBox: React.FC<{ children: React.ReactNode; testId?: string }> = ({ children, testId }) => (
  <div role="alert" className="mt-5 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
    <span data-testid={testId}>{children}</span>
  </div>
);

const BackToSignIn: React.FC<{ primary?: boolean }> = ({ primary }) => (
  <button
    type="button" onClick={() => goTo('/')} data-testid="back-to-sign-in"
    className={primary ? cx(primaryButton, 'mt-6') : 'mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200'}
  >
    {primary ? (<>Go to sign in <ArrowRight size={16} aria-hidden="true" /></>) : (<><ArrowLeft size={16} aria-hidden="true" /> Back to sign in</>)}
  </button>
);

/* ------------------------------------------------------------------------------------------
 * /forgot-password
 * ---------------------------------------------------------------------------------------- */

export const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter the e-mail address you sign in with.');
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error || 'The request could not be sent. Try again in a moment.');
      else setSent(body.message || "If an account exists for that e-mail, we've sent a link.");
    } catch {
      setError('The server could not be reached. Try again in a moment.');
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <Shell>
        <div className="flex items-start gap-3">
          <Mail className="mt-0.5 h-5 w-5 flex-shrink-0 text-brand-700 dark:text-brand-300" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Check your e-mail</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300" role="status" data-testid="forgot-sent">{sent}</p>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              The link works once and expires in 60 minutes. No e-mail after a few minutes? Check your spam folder, or ask your administrator.
            </p>
          </div>
        </div>
        <BackToSignIn />
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">Forgot your password?</h1>
      <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">Enter the e-mail address you sign in with. We will send you a link to choose a new password.</p>
      {error && <ErrorBox testId="forgot-error">{error}</ErrorBox>}
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        <div>
          <label htmlFor="forgot-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email address</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} aria-hidden="true" />
            <input
              id="forgot-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className={inputClass} placeholder="name@company.com" maxLength={255} autoFocus
            />
          </div>
        </div>
        <button type="submit" disabled={submitting} className={primaryButton} data-testid="forgot-submit">
          {submitting ? 'Sending…' : (<>Send reset link <ArrowRight size={16} aria-hidden="true" /></>)}
        </button>
      </form>
      <BackToSignIn />
    </Shell>
  );
};

/* ------------------------------------------------------------------------------------------
 * /reset-password
 * ---------------------------------------------------------------------------------------- */

// Read once per page load and then removed from the address bar (StrictMode renders twice).
let takenToken: string | null = null;
function takeToken(): string {
  if (takenToken === null) {
    const params = new URLSearchParams(window.location.search);
    takenToken = params.get('token') ?? '';
    if (params.has('token')) window.history.replaceState(null, '', RESET_PATH);
  }
  return takenToken;
}

/** No Referer while the page is open (the token was in its address). Netlify also sends Referrer-Policy for the route. */
function useNoReferrer() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);
}

export const ResetPassword: React.FC = () => {
  useNoReferrer();
  const { isAuthenticated, logout } = useAuth();
  const [token] = useState(takeToken);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(token ? null : 'This reset link is incomplete. Open the link from your e-mail again, or ask for a new one.');
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const checks = passwordChecks(password);
  const strong = checks.filter((c) => c.key !== 'email').every((c) => c.ok);
  const matches = password.length > 0 && password === confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!strong) return setError('Choose a stronger password (see the rules below).');
    if (!matches) return setError('The two passwords do not match.');
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/auth/reset-password`, {
        method: 'POST', credentials: 'include', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setDone(true);
        takenToken = '';
        // Never signed in by a reset: a session of this browser (another account, or the old one) ends too.
        if (isAuthenticated) logout();
      } else if (body.code === 'password') setError(body.error || 'Choose a stronger password.');
      else if (res.status === 429) setError(body.error || 'Too many attempts. Try again later.');
      else setLinkError(body.error || 'This reset link is not valid. Ask for a new one.');
    } catch {
      setError('The server could not be reached. Try again in a moment.');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <Shell>
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600 dark:text-green-400" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Password changed</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300" role="status" data-testid="reset-done">
              Your password was changed. Sign in with your new password.
            </p>
          </div>
        </div>
        <BackToSignIn primary />
      </Shell>
    );
  }

  if (linkError) {
    return (
      <Shell>
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">This link cannot be used</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300" data-testid="reset-link-error">{linkError}</p>
          </div>
        </div>
        <button type="button" onClick={() => goTo(FORGOT_PATH)} className={cx(primaryButton, 'mt-6')}>Ask for a new link</button>
        <BackToSignIn />
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">Choose a new password</h1>
      <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">The link works once. After the change, sign in with the new password.</p>
      {error && <ErrorBox testId="reset-error">{error}</ErrorBox>}
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        <div>
          <label htmlFor="reset-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">New password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} aria-hidden="true" />
            <input
              id="reset-password" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password" aria-describedby="reset-password-rules" className={`${inputClass} pr-10`} autoFocus
            />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <ul id="reset-password-rules" className="mt-2 space-y-1" aria-live="polite">
            {checks.map((c) => {
              // The e-mail rule is checked by the server (this page does not know the address).
              const ok = c.key === 'email' ? null : c.ok;
              return (
                <li key={c.key} className={cx('flex items-center gap-1.5 text-xs', ok ? 'text-green-700 dark:text-green-400' : 'text-slate-500 dark:text-slate-400')}>
                  {ok ? <Check size={13} aria-hidden="true" /> : ok === null ? <span className="inline-block w-[13px]" aria-hidden="true">·</span> : <X size={13} aria-hidden="true" />}
                  <span>{c.label}</span>{ok !== null && <span className="sr-only">{ok ? '(met)' : '(not met)'}</span>}
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <label htmlFor="reset-confirm" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Repeat the new password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} aria-hidden="true" />
            <input id="reset-confirm" type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" className={inputClass} />
          </div>
          {confirm.length > 0 && !matches && <p className="mt-1.5 text-xs text-red-700 dark:text-red-400">The passwords do not match.</p>}
        </div>
        <button type="submit" disabled={submitting} className={primaryButton} data-testid="reset-submit">
          {submitting ? 'Saving…' : (<>Change password <ArrowRight size={16} aria-hidden="true" /></>)}
        </button>
      </form>
      <BackToSignIn />
    </Shell>
  );
};
