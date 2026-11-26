import React, { useEffect, useMemo, useState } from 'react';
import BrandMark from './BrandMark';
import { AlertCircle, ArrowRight, Check, Eye, EyeOff, Lock, Mail, User as UserIcon, X } from 'lucide-react';
import API_URL from '../config/api';
import { useAuth } from '../contexts/AuthContext';
import { passwordChecks } from '../lib/passwordPolicy';
import { cx } from './ui';

/**
 * /accept-invite?token=… — the invited person sets their name and password (or continues with
 * Google / Microsoft when enabled) and gets exactly the invited role assignment. Tokens are
 * single-use and expire (the server says why a link no longer works).
 */

interface InvitationInfo {
  status: 'open';
  email: string;
  role: string;
  roleName: string;
  scopeType: 'company' | 'department' | 'team';
  scopeName: string | null;
  /** Every assignment the invitation gives; more than one for people who work with several teams. */
  access?: string[];
  companyName: string;
  invitedBy: string | null;
  expiresAt: string;
  sso: Array<{ id: string; label: string }>;
}

const inputClass =
  'w-full h-11 pl-10 pr-3 rounded-md border border-slate-300 bg-white text-sm text-slate-900 placeholder-slate-400 ' +
  'focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-600 disabled:bg-slate-50 disabled:text-slate-500 ' +
  'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-400';

const goTo = (path: string) => {
  window.history.replaceState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="ig-app-bg min-h-screen bg-slate-50 dark:bg-slate-950 flex items-start sm:items-center justify-center px-4 py-10">
    <main className="w-full max-w-md">
      <div className="mb-8 flex items-center gap-3">
        <BrandMark height={36} />
              <div className="leading-tight">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">QE Navigator</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">by IronGate Software</p>
              </div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-6 sm:p-8 dark:border-slate-800 dark:bg-slate-900">{children}</div>
    </main>
  </div>
);

const AcceptInvite: React.FC = () => {
  const { user, isAuthenticated, logout, reloadUser } = useAuth();
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') ?? '', []);
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(() => new URLSearchParams(window.location.search).get('sso_message'));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setLoadError('This invitation link is incomplete. Open the link from your email again.');
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`${API_URL}/auth/invitations/${encodeURIComponent(token)}`, { credentials: 'include' });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setLoadError(body.error || 'This invitation link is not valid.');
        else setInfo(body);
      } catch {
        if (!cancelled) setLoadError('The server could not be reached. Try again in a moment.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const checks = passwordChecks(password, info?.email);
  const strong = checks.every((c) => c.ok);
  const matches = password.length > 0 && password === confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!firstName.trim() || !lastName.trim()) return setError('Enter your first and last name.');
    if (!strong) return setError('Choose a stronger password (see the rules below).');
    if (!matches) return setError('The two passwords do not match.');
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/auth/invitations/accept`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, firstName: firstName.trim(), lastName: lastName.trim(), password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || 'The invitation could not be accepted.');
        return;
      }
      goTo('/');
      await reloadUser();
    } catch {
      setError('The server could not be reached. Try again in a moment.');
    } finally {
      setSubmitting(false);
    }
  };

  if (isAuthenticated && user) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">You are already signed in</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          You are signed in as {user.email}. To accept this invitation for another account, sign out first.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" onClick={() => logout()} className="h-10 px-4 rounded-md bg-brand-700 text-sm font-medium text-white hover:bg-brand-800">Sign out</button>
          <button type="button" onClick={() => goTo('/')} className="h-10 px-4 rounded-md border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Go to the dashboard</button>
        </div>
      </Shell>
    );
  }

  if (loading) {
    return <Shell><p className="text-sm text-slate-500 dark:text-slate-400" role="status">Checking your invitation…</p></Shell>;
  }

  if (loadError || !info) {
    return (
      <Shell>
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">This invitation cannot be used</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300" data-testid="invite-error">{loadError}</p>
          </div>
        </div>
        <button type="button" onClick={() => goTo('/')} className="mt-6 inline-flex items-center gap-2 h-10 px-4 rounded-md border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
          Go to sign in <ArrowRight size={16} aria-hidden="true" />
        </button>
      </Shell>
    );
  }

  const scope = info.scopeType === 'company' ? info.companyName : info.scopeName;
  return (
    <Shell>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">Join {info.companyName}</h1>
      <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">
        {info.invitedBy ? `${info.invitedBy} invited you` : 'You are invited'} as <span className="font-medium text-slate-900 dark:text-white">{info.roleName}</span>
        {scope ? <> of <span className="font-medium text-slate-900 dark:text-white">{scope}</span></> : null}.
      </p>
      {info.access && info.access.length > 1 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-slate-600 dark:text-slate-300" data-testid="invite-access">
          {info.access.map((a) => <li key={a}>{a}</li>)}
        </ul>
      )}
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">The link works once and expires on {new Date(info.expiresAt).toLocaleString()}.</p>

      {error && (
        <div role="alert" className="mt-5 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span data-testid="accept-error">{error}</span>
        </div>
      )}

      {info.sso.length > 0 && (
        <div className="mt-6 space-y-2">
          {info.sso.map((p) => (
            <a
              key={p.id}
              href={`${API_URL}/auth/sso/${p.id}/start?invite=${encodeURIComponent(token)}`}
              className="w-full h-11 inline-flex items-center justify-center rounded-md border border-slate-300 bg-white text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Continue with {p.label}
            </a>
          ))}
          <p className="text-xs text-slate-500 dark:text-slate-400">Use the account of {info.email}. Or set a password below.</p>
        </div>
      )}

      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        <div>
          <label htmlFor="invite-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email address</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} aria-hidden="true" />
            <input id="invite-email" type="email" value={info.email} disabled className={inputClass} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {([['invite-first', 'First name', firstName, setFirstName, 'given-name'], ['invite-last', 'Last name', lastName, setLastName, 'family-name']] as const).map(([id, label, value, set, ac]) => (
            <div key={id}>
              <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">{label}</label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} aria-hidden="true" />
                <input id={id} value={value} onChange={(e) => set(e.target.value)} autoComplete={ac} maxLength={100} required className={inputClass} />
              </div>
            </div>
          ))}
        </div>
        <div>
          <label htmlFor="invite-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} aria-hidden="true" />
            <input
              id="invite-password" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password" aria-describedby="invite-password-rules" className={`${inputClass} pr-10`}
            />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <ul id="invite-password-rules" className="mt-2 space-y-1" aria-live="polite">
            {checks.map((c) => (
              <li key={c.key} className={cx('flex items-center gap-1.5 text-xs', c.ok ? 'text-green-700 dark:text-green-400' : 'text-slate-500 dark:text-slate-400')}>
                {c.ok ? <Check size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />}
                <span>{c.label}</span><span className="sr-only">{c.ok ? '(met)' : '(not met)'}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <label htmlFor="invite-confirm" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Repeat the password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} aria-hidden="true" />
            <input id="invite-confirm" type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" className={inputClass} />
          </div>
          {confirm.length > 0 && !matches && <p className="mt-1.5 text-xs text-red-700 dark:text-red-400">The passwords do not match.</p>}
        </div>
        <button type="submit" disabled={submitting}
          className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-md bg-brand-700 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
          {submitting ? 'Creating your account…' : (<>Accept and sign in <ArrowRight size={16} aria-hidden="true" /></>)}
        </button>
      </form>
    </Shell>
  );
};

export default AcceptInvite;
