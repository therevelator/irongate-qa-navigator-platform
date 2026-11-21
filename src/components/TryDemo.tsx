import React, { useEffect, useLayoutEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Check, Clock, Database, RotateCcw } from 'lucide-react';
import BrandMark from './BrandMark';
import API_URL from '../config/api';
import { applyTheme } from '../lib/appearance';

/**
 * /try: the self-serve demo (linked from irongate.ie/navigator as "Explore the live demo — no sign-up").
 * A short intro, a persona picker and "Start exploring", which signs the visitor in as that persona of
 * the sandbox company (POST /api/auth/sandbox; server/lib/sandbox.ts) and opens the overview. Public,
 * outside the signed-in app; never indexed (robots meta here, X-Robots-Tag from netlify.toml and the API).
 */

export const SANDBOX_VISIT_KEY = 'irongate_sandbox_visit';

interface Persona { key: string; label: string; name: string; title: string; description: string }
interface SandboxInfo {
  enabled: boolean; ready: boolean; company: string; sessionHours: number;
  bookDemoUrl: string; startPilotUrl: string; personas: Persona[];
}

const FALLBACK_LINKS = { bookDemoUrl: 'https://irongate.ie/navigator', startPilotUrl: 'https://irongate.ie/navigator/pilot' };

const TryDemo: React.FC = () => {
  const [info, setInfo] = useState<SandboxInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [persona, setPersona] = useState('cto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ended = new URLSearchParams(window.location.search).get('ended') === '1';

  // Signed-out pages use the classic light look (as the sign-in page).
  useLayoutEffect(() => { applyTheme(document.documentElement, 'light'); }, []);

  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Live demo · QE Navigator';
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => { document.title = prevTitle; meta.remove(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/sandbox`, { credentials: 'include' });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.status === 404) setLoadError('The live demo is not available at the moment.');
        else if (!res.ok) setLoadError(body?.error ?? 'The demo could not be loaded. Try again in a moment.');
        else setInfo(body);
      } catch {
        if (!cancelled) setLoadError('The server could not be reached. Check your connection and try again.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/auth/sandbox`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? 'The demo could not be started. Try again in a moment.');
        setBusy(false);
        return;
      }
      try {
        sessionStorage.setItem(SANDBOX_VISIT_KEY, '1');
        localStorage.removeItem('irongate_user');
      } catch { /* storage unavailable */ }
      window.location.assign(body?.redirect ?? '/');
    } catch {
      setError('The server could not be reached. Check your connection and try again.');
      setBusy(false);
    }
  };

  const links = info ?? FALLBACK_LINKS;
  const linkClass = 'font-medium text-brand-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 rounded-sm';

  return (
    <div className="ig-app-bg min-h-screen bg-slate-50 text-slate-900" data-testid="try-page">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <BrandMark height={32} />
            <span className="text-sm font-semibold">QE Navigator</span>
            <span className="hidden text-xs text-slate-500 sm:inline">by IronGate Software</span>
          </div>
          <a href={links.bookDemoUrl} className={`text-sm ${linkClass}`}>Book a demo</a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <section aria-labelledby="try-title">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Live demo · no sign-up</p>
            <h1 id="try-title" className="mt-2 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              Explore QE Navigator with a sample bank
            </h1>
            <p className="mt-4 leading-relaxed text-slate-700">
              You are about to open a working copy of QE Navigator for <strong className="font-semibold text-slate-900">{info?.company ?? 'Northwind Bank — demo'}</strong>:
              two departments, five teams and a year of quality data, with KPIs, evidence from CI, forecasts, recommendations and action plans.
              No sign-up and no password.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-slate-700">
              <li className="flex gap-3"><Database size={18} className="mt-0.5 flex-shrink-0 text-brand-700" aria-hidden="true" /><span><strong className="font-semibold text-slate-900">Sample data.</strong> Every person, team and number is made up.</span></li>
              <li className="flex gap-3"><RotateCcw size={18} className="mt-0.5 flex-shrink-0 text-brand-700" aria-hidden="true" /><span><strong className="font-semibold text-slate-900">Resets every night.</strong> Try anything the role allows: what you change is wiped overnight.</span></li>
              <li className="flex gap-3"><Clock size={18} className="mt-0.5 flex-shrink-0 text-brand-700" aria-hidden="true" /><span><strong className="font-semibold text-slate-900">Up to {info?.sessionHours ?? 2} hours.</strong> Come back here to start again or switch role.</span></li>
            </ul>
          </section>

          <section aria-labelledby="persona-title" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            {ended && (
              <p role="status" className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="try-ended">
                Your demo session ended. Start a new one below.
              </p>
            )}
            <h2 id="persona-title" className="text-base font-semibold">Choose who you are</h2>
            <p className="mt-1 text-sm text-slate-600">Each role sees what that person would see in their own company.</p>
            {loadError ? (
              <p role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" /> {loadError}
              </p>
            ) : (
              <fieldset className="mt-4" disabled={!info || busy}>
                <legend className="sr-only">Role</legend>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {(info?.personas ?? []).map((p) => {
                    const selected = persona === p.key;
                    return (
                      <label
                        key={p.key}
                        className={`relative flex cursor-pointer flex-col rounded-lg border p-3.5 text-sm transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-500 ${selected ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
                        data-testid={`try-persona-${p.key}`}
                      >
                        <input type="radio" name="persona" value={p.key} checked={selected} onChange={() => setPersona(p.key)} className="sr-only" />
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900">{p.label}</span>
                          {selected && <Check size={16} className="text-brand-700" aria-hidden="true" />}
                        </span>
                        <span className="mt-0.5 text-xs text-slate-600">{p.name} · {p.title}</span>
                        <span className="mt-2 text-xs leading-relaxed text-slate-700">{p.description}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
            {info && !info.ready && (
              <p role="status" className="mt-4 text-sm text-slate-700" data-testid="try-preparing">The demo is being refreshed. It is ready again in a few minutes.</p>
            )}
            {error && (
              <p role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="try-error">
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" /> {error}
              </p>
            )}
            <button
              type="button"
              onClick={start}
              disabled={!info || busy || !!loadError}
              className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="try-start"
            >
              {busy ? 'Opening the demo…' : 'Start exploring'} {!busy && <ArrowRight size={16} aria-hidden="true" />}
            </button>
            <p className="mt-4 text-center text-xs text-slate-600">
              Want it with your own data? <a href={links.bookDemoUrl} className={linkClass}>Book a demo</a> or{' '}
              <a href={links.startPilotUrl} className={linkClass}>start a pilot</a>.
            </p>
          </section>
        </div>
      </main>
      <footer className="mx-auto max-w-5xl px-4 pb-8 text-xs text-slate-500 sm:px-6">
        © {new Date().getFullYear()} IronGate Software Ltd. The demo company and its people are fictional.
      </footer>
    </div>
  );
};

export default TryDemo;
