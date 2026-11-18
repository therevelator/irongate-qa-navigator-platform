import React, { useCallback, useEffect, useState } from 'react';
import API_URL from '../config/api';
import { Badge, Card, CardHeader, buttonClass } from './ui';

interface SampleStatus {
  enabled: boolean;
  message: string | null;
  seeded: boolean;
  companyName: string;
  teams: number;
  users: number;
  logins: Array<{ role: string; email: string; name: string }>;
  password: string;
  ownCompany: { teams: number; lacking: number } | null;
}

/**
 * Admin console section (super admin): load the sample (demo) dataset.
 * The server creates a separate sample company with its own users; nothing in the
 * current company is changed. Disabled unless the API runs with ENABLE_SYNTHETIC_DATA=true.
 */
const SampleDataPanel: React.FC = () => {
  const [status, setStatus] = useState<SampleStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/analytics/seed-data/status`, { credentials: 'include' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Failed to read sample data status');
      setStatus(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read sample data status');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const seed = async () => {
    setLoading(true);
    setResult(null);
    try {
      const r = await fetch(`${API_URL}/analytics/seed-data`, { method: 'POST', credentials: 'include' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Failed to load sample data');
      setResult(data.message);
      setError(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sample data');
    } finally {
      setLoading(false);
    }
  };

  const disabled = !status || !status.enabled || loading;

  return (
    <Card>
      <CardHeader
        title="Sample data"
        subtitle={status
          ? <>Creates the fictional company “{status.companyName}” ({status.teams} teams, {status.users} users) and fills your own company’s active teams that have no data yet{status.ownCompany ? <> ({status.ownCompany.lacking} of {status.ownCompany.teams} teams lack some data)</> : null}, with about 120 days of consistent sample history in every module. Existing values are never changed; sample rows can be removed with <code className="font-mono">npm run seed:demo:clear</code>. Values are generated, not measurements.</>
          : 'Load a fictional sample company for demos.'}
        action={<span className="flex gap-2"><Badge tone="warn">Sample data</Badge>{status?.seeded && <Badge tone="good">Loaded</Badge>}</span>}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          className={buttonClass.primary}
          onClick={seed}
          disabled={disabled}
          aria-describedby="sample-data-help"
          data-testid="load-sample-data"
        >
          {loading ? 'Loading sample data…' : status?.seeded ? 'Load sample data again (adds only missing rows)' : 'Load sample data'}
        </button>
        <p id="sample-data-help" className="text-xs text-slate-500 dark:text-slate-400">
          {!status
            ? 'Checking whether sample data is enabled…'
            : status.enabled
              ? 'Safe to run more than once: only missing rows are added.'
              : <>{status.message ?? 'Sample data is turned off on this server. Start the API with ENABLE_SYNTHETIC_DATA=true to enable it.'} It can also be loaded from a terminal with <code className="font-mono">npm run seed:demo</code>.</>}
        </p>
      </div>

      {result && (
        <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" role="status">{result}</p>
      )}
      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300" role="alert">{error}</p>
      )}

      {status?.seeded && (
        <div className="mt-4 text-sm text-slate-700 dark:text-slate-300">
          <p className="mb-1">Sign out and sign in to the sample company with password <code className="font-mono">{status.password}</code>:</p>
          <ul className="space-y-0.5">
            {status.logins.map((l) => (
              <li key={l.email}><span className="inline-block w-28 text-slate-500 dark:text-slate-400">{l.role.replace('_', ' ')}</span><code className="font-mono">{l.email}</code></li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
};

export default SampleDataPanel;
