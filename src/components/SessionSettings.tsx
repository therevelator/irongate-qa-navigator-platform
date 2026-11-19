import React, { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, buttonClass, cx, inputClass } from './ui';
import { api } from './NotificationParts';
import { useAuth } from '../contexts/AuthContext';
import { policyActorOf } from '../lib/policyActor';
import { isCompanyAdmin } from '../../server/lib/userPolicy';

/**
 * Parameters → Sign-in (super admins only): how long a sign-in lasts (GET/PUT
 * /api/admin/session-settings). The server checks it on every request (server/lib/sessions.ts).
 */

interface SessionSettingsResponse { lifetimeHours: number; choices: number[]; defaultHours: number }

const lifetimeLabel = (h: number) => (h < 24 ? `${h} hour${h === 1 ? '' : 's'}` : `${h / 24} day${h === 24 ? '' : 's'}`);

const SessionSettings: React.FC = () => {
  const { user } = useAuth();
  const admin = !!user && isCompanyAdmin(policyActorOf(user));
  const [data, setData] = useState<SessionSettingsResponse | null>(null);
  const [value, setValue] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!admin) return;
    api<SessionSettingsResponse>('/admin/session-settings')
      .then((r) => { setData(r); setValue(r.lifetimeHours); })
      .catch(() => undefined);
  }, [admin]);

  if (!admin || !data || value === null) return null;

  const save = async () => {
    setSaving(true);
    try {
      const r = await api<SessionSettingsResponse>('/admin/session-settings', { method: 'PUT', json: { lifetimeHours: value } });
      setData(r);
      toast.success(`Sign-in now lasts ${lifetimeLabel(r.lifetimeHours)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Sign-in"
        subtitle="How long people stay signed in before they must sign in again. Applies to the whole organisation."
      />
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700 dark:text-slate-300">Sign-in lasts</span>
          <select
            value={value} onChange={(e) => setValue(Number(e.target.value))} data-testid="session-lifetime"
            className={cx(inputClass, 'w-48')}
          >
            {data.choices.map((h) => (
              <option key={h} value={h}>{lifetimeLabel(h)}{h === data.defaultHours ? ' (default)' : ''}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={save} disabled={saving || value === data.lifetimeHours} className={buttonClass.primary} data-testid="session-lifetime-save">
          <Save size={14} aria-hidden /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400" data-testid="session-lifetime-current">
        Current: {lifetimeLabel(data.lifetimeHours)}. Shortening it signs out anyone signed in for longer than the new limit.
        A longer value applies from the next sign-in.
      </p>
    </Card>
  );
};

export default SessionSettings;
