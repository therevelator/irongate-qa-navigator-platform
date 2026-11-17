import React, { useCallback, useEffect, useState } from 'react';
import API_URL from '../config/api';
import { formatAsOf } from '../data/advancedFeatures';
import { Badge, Card, CardHeader, EmptyState, buttonClass, cx, inputClass } from './ui';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  createdBy: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/**
 * Admin console section: per-company API keys for POST /api/ingest/kpis.
 * The plaintext key is shown once, right after creation.
 */
const ApiKeysPanel: React.FC = () => {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<{ name: string; value: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/admin/api-keys`, { credentials: 'include' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed to load API keys');
      const data = await r.json();
      setKeys(data.keys || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const r = await fetch(`${API_URL}/admin/api-keys`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Failed to create API key');
      setNewKey({ name: data.key?.name ?? name.trim(), value: data.plaintextKey });
      setCopied(false);
      setName('');
      setError(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      const r = await fetch(`${API_URL}/admin/api-keys/${encodeURIComponent(id)}/revoke`, { method: 'POST', credentials: 'include' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed to revoke API key');
      setConfirmRevokeId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke API key');
    }
  };

  const copy = async () => {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey.value);
      setCopied(true);
    } catch { /* clipboard unavailable: the key stays selectable */ }
  };

  const fmtTime = (t: string | null) => (t ? formatAsOf(t) ?? '—' : '—');

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="px-5 pt-5">
        <CardHeader
          title="API keys"
          subtitle={<>Keys let external systems (CI, issue tracker, code analysis) send team KPIs to <code className="font-mono">POST /api/ingest/kpis</code>. A key can write any team in this company. Only a hash is stored; the key is shown once.</>}
        />
        <form onSubmit={create} className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor="api-key-name" className="sr-only">Key name</label>
          <input
            id="api-key-name"
            className={cx(inputClass, 'sm:w-72')}
            placeholder="Key name, e.g. Jenkins production"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className={buttonClass.primary} disabled={creating || !name.trim()}>
            {creating ? 'Creating…' : 'Create key'}
          </button>
        </form>

        {newKey && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40" data-testid="api-key-created">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              Copy the key for “{newKey.name}” now. It will not be shown again.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="block flex-1 select-all break-all rounded bg-white px-2 py-1.5 font-mono text-xs text-slate-900 ring-1 ring-inset ring-amber-200 dark:bg-slate-900 dark:text-slate-100 dark:ring-amber-900">
                {newKey.value}
              </code>
              <div className="flex gap-2">
                <button type="button" className={buttonClass.secondary} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
                <button type="button" className={buttonClass.secondary} onClick={() => setNewKey(null)}>Done</button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>
        )}
      </div>

      {loading ? (
        <p className="px-5 pb-5 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : keys.length === 0 ? (
        <EmptyState title="No API keys" description="Create a key to let an external system send KPIs." />
      ) : (
        <div className="overflow-x-auto border-t border-slate-200 dark:border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="px-5 py-2.5">Name</th>
                <th className="px-5 py-2.5">Key</th>
                <th className="px-5 py-2.5">Created</th>
                <th className="px-5 py-2.5">Last used</th>
                <th className="px-5 py-2.5">Status</th>
                <th className="px-5 py-2.5 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {keys.map((k) => (
                <tr key={k.id} className="text-slate-700 dark:text-slate-300">
                  <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{k.name}</td>
                  <td className="px-5 py-3 font-mono text-xs">{k.keyPrefix}…</td>
                  <td className="px-5 py-3">
                    {fmtTime(k.createdAt)}
                    {k.createdBy && <span className="block text-xs text-slate-500 dark:text-slate-400">by {k.createdBy}</span>}
                  </td>
                  <td className="px-5 py-3">{k.lastUsedAt ? fmtTime(k.lastUsedAt) : 'Never'}</td>
                  <td className="px-5 py-3">
                    {k.revokedAt ? <Badge tone="bad">Revoked {fmtTime(k.revokedAt)}</Badge> : <Badge tone="good">Active</Badge>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {!k.revokedAt && (confirmRevokeId === k.id ? (
                      <span className="inline-flex gap-2">
                        <button type="button" className={cx(buttonClass.secondary, 'text-red-700 dark:text-red-400')} onClick={() => revoke(k.id)}>
                          Confirm revoke
                        </button>
                        <button type="button" className={buttonClass.secondary} onClick={() => setConfirmRevokeId(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button type="button" className={buttonClass.secondary} onClick={() => setConfirmRevokeId(k.id)}>Revoke</button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};

export default ApiKeysPanel;
