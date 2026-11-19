import React, { useState } from 'react';
import BrandMark from './BrandMark';
import { Eye, EyeOff, AlertCircle, ArrowRight, Check, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '../types/auth';
import { passwordChecks } from '../lib/passwordPolicy';
import { emailDomainOf, isPublicEmailDomain } from '../lib/emailDomains';

interface RegisterProps {
  onSwitchToLogin: () => void;
}

const validateName = (name: string) => /^[\p{L}\s'-]+$/u.test(name) && !/\d/.test(name);
const validateCompanyName = (name: string) => /^[\p{L}\d\s'&.-]+$/u.test(name);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputClass =
  'w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-sm text-slate-900 placeholder-slate-400 ' +
  'focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-600 disabled:opacity-60 ' +
  'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';
const labelClass = 'block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5';

const Register: React.FC<RegisterProps> = ({ onSwitchToLogin }) => {
  const { register, isLoading } = useAuth();
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', password: '', confirmPassword: '',
    companyName: '', departmentName: '', teamName: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  // The same password rules as accepting an invitation and resetting a password (src/lib/passwordPolicy.ts).
  const checks = passwordChecks(form.password, form.email);
  const strong = checks.every((c) => c.ok);
  const domain = emailDomainOf(form.email);
  const publicDomain = EMAIL_RE.test(form.email.trim()) && isPublicEmailDomain(domain);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.firstName || !form.lastName || !form.email || !form.password || !form.companyName || !form.departmentName || !form.teamName) {
      return setError('Please complete all fields.');
    }
    if (!validateName(form.firstName) || !validateName(form.lastName)) {
      return setError('Names may contain letters, spaces, hyphens and apostrophes only.');
    }
    if (!EMAIL_RE.test(form.email.trim())) return setError('Enter a valid e-mail address.');
    if (!validateCompanyName(form.companyName)) {
      return setError('Organisation name may contain letters, numbers, spaces and the characters - \' & .');
    }
    if (form.password !== form.confirmPassword) return setError('The passwords do not match.');
    if (!strong) return setError('Choose a stronger password (see the rules below the password).');

    try {
      await register({
        firstName: form.firstName, lastName: form.lastName, email: form.email, password: form.password,
        role: 'super_admin' as UserRole,
        companyName: form.companyName, departmentName: form.departmentName, teamName: form.teamName,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-xl">
        <div className="mb-8 flex items-center gap-3">
          <BrandMark height={36} />
              <div className="leading-tight">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">QE Navigator</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">by IronGate Software</p>
              </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 sm:p-8 dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Create your organisation</h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
            This creates a new organisation and you will be its administrator. To join an existing organisation, ask its administrator to create an account for you.
          </p>

          {error && (
            <div role="alert" className="mt-6 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-6" noValidate>
            <fieldset className="space-y-4">
              <legend className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">Your details</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="firstName" className={labelClass}>First name</label>
                  <input id="firstName" autoComplete="given-name" value={form.firstName} onChange={set('firstName')} className={inputClass} disabled={isLoading} />
                </div>
                <div>
                  <label htmlFor="lastName" className={labelClass}>Last name</label>
                  <input id="lastName" autoComplete="family-name" value={form.lastName} onChange={set('lastName')} className={inputClass} disabled={isLoading} />
                </div>
              </div>
              <div>
                <label htmlFor="email" className={labelClass}>Email</label>
                <input
                  id="email" type="email" autoComplete="email" value={form.email} onChange={set('email')} className={inputClass}
                  placeholder="name@company.com" disabled={isLoading} aria-describedby="email-hint"
                />
                <p id="email-hint" data-testid="email-domain-hint" className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  {publicDomain
                    ? `${domain} is a personal e-mail provider, so it is not linked to your organisation. You invite the people who join.`
                    : 'With a company address, yours is the only organisation for that e-mail domain. Personal addresses (gmail.com, outlook.com, …) work too.'}
                </p>
              </div>
            </fieldset>

            <fieldset className="space-y-4 border-t border-slate-200 pt-6 dark:border-slate-800">
              <legend className="sr-only">Organisation</legend>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Organisation</p>
              <div>
                <label htmlFor="companyName" className={labelClass}>Organisation name</label>
                <input id="companyName" autoComplete="organization" value={form.companyName} onChange={set('companyName')} className={inputClass} disabled={isLoading} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="departmentName" className={labelClass}>First department</label>
                  <input id="departmentName" value={form.departmentName} onChange={set('departmentName')} className={inputClass} placeholder="e.g. Engineering" disabled={isLoading} />
                </div>
                <div>
                  <label htmlFor="teamName" className={labelClass}>First team</label>
                  <input id="teamName" value={form.teamName} onChange={set('teamName')} className={inputClass} placeholder="e.g. Payments QA" disabled={isLoading} />
                </div>
              </div>
            </fieldset>

            <fieldset className="space-y-4 border-t border-slate-200 pt-6 dark:border-slate-800">
              <legend className="sr-only">Password</legend>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Password</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="password" className={labelClass}>Password</label>
                  <div className="relative">
                    <input
                      id="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password"
                      value={form.password} onChange={set('password')} className={`${inputClass} pr-10`} disabled={isLoading}
                      aria-describedby="password-rules"
                    />
                    <button
                      type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label htmlFor="confirmPassword" className={labelClass}>Confirm password</label>
                  <input
                    id="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password"
                    value={form.confirmPassword} onChange={set('confirmPassword')} className={inputClass} disabled={isLoading}
                  />
                </div>
              </div>
              <ul id="password-rules" data-testid="password-rules" className="space-y-1" aria-live="polite">
                {checks.map((c) => (
                  <li key={c.key} className={`flex items-center gap-1.5 text-xs ${c.ok ? 'text-green-700 dark:text-green-400' : 'text-slate-500 dark:text-slate-400'}`}>
                    {c.ok ? <Check size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />}
                    <span>{c.label}</span><span className="sr-only">{c.ok ? '(met)' : '(not met)'}</span>
                  </li>
                ))}
              </ul>
            </fieldset>

            <button
              type="submit" disabled={isLoading}
              className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-md bg-brand-700 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? 'Creating account…' : (<>Create account <ArrowRight size={16} /></>)}
            </button>
          </form>
        </div>

        <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
          Already have an account?{' '}
          <button onClick={onSwitchToLogin} className="font-medium text-brand-700 hover:text-brand-800 dark:text-brand-300">
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
};

export default Register;
