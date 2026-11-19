import React, { useState, useEffect } from 'react';
import { RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import API_URL from '../config/api';
import { Page, PageIntro, Card, CardHeader, Badge, EmptyState, buttonClass, inputClass, cx } from './ui';

interface MetricInterval {
  id: string | null;
  metric_key: string;
  interval_value: number;
  interval_unit: 'minutes' | 'hours' | 'days' | 'weeks' | 'months';
  custom_label: string;
  updated_at: string | null;
  is_default: boolean;
}

interface MetricIntervalsConfigProps {
  onBack?: () => void;
}

const METRIC_CATEGORIES = {
  quality: {
    label: 'Quality',
    metrics: ['test_coverage', 'test_flakiness_rate', 'defect_density', 'defect_escape_rate', 'code_quality_score'],
  },
  speed: {
    label: 'Speed and efficiency',
    metrics: ['avg_build_time_minutes', 'test_execution_time_minutes', 'deployment_frequency_per_week', 'lead_time_days', 'mttr_hours', 'parallel_test_efficiency'],
  },
  agile: {
    label: 'Agile and process',
    metrics: ['sprint_velocity', 'sprint_commitment_rate', 'sprint_carryover', 'first_time_pass_rate', 'blocked_time_hours', 'sizing_accuracy'],
  },
  automation: {
    label: 'Automation',
    metrics: ['automation_coverage', 'automation_roi'],
  },
  reliability: {
    label: 'Reliability',
    metrics: ['change_failure_rate', 'mtbf_hours', 'system_availability', 'infrastructure_failures'],
  },
};

const INTERVAL_UNITS = [
  { value: 'hours', label: 'hours' },
  { value: 'days', label: 'days' },
  { value: 'weeks', label: 'weeks' },
  { value: 'months', label: 'months' },
];

/**
 * Expected update frequency per metric. Metrics are pushed in (KPI ingestion API or Manual
 * metrics); nothing is fetched on this schedule. The setting is used to flag a metric as
 * stale on Team detail when its last recorded value is older than the expected interval.
 */
const MetricIntervalsConfig: React.FC<MetricIntervalsConfigProps> = () => {
  const [intervals, setIntervals] = useState<MetricInterval[]>([]);
  const [original, setOriginal] = useState<MetricInterval[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const hasChanges = JSON.stringify(intervals) !== JSON.stringify(original);

  const fetchIntervals = async () => {
    try {
      const response = await fetch(`${API_URL}/settings/metric-intervals`, { credentials: 'include' });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      setIntervals(data.intervals);
      setOriginal(data.intervals);
      setState('ready');
    } catch {
      setState('error');
    }
  };

  useEffect(() => { fetchIntervals(); }, []);

  const change = (metricKey: string, field: 'interval_value' | 'interval_unit', value: number | string) =>
    setIntervals(prev => prev.map(i => (i.metric_key === metricKey ? { ...i, [field]: value, is_default: false } : i)));

  const saveAll = async () => {
    setSaving(true);
    try {
      const response = await fetch(`${API_URL}/settings/metric-intervals`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ intervals }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(response.status === 400 && err?.error ? `Could not save the update frequencies: ${err.error}.` : undefined);
      }
      toast.success('Expected update frequencies saved');
      await fetchIntervals();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Could not save the update frequencies');
    } finally {
      setSaving(false);
    }
  };

  const reset = async (metricKey: string) => {
    const response = await fetch(`${API_URL}/settings/metric-intervals/${metricKey}`, { method: 'DELETE', credentials: 'include' });
    if (response.ok) { toast.success('Reset to default'); fetchIntervals(); }
    else toast.error('Could not reset');
  };

  return (
    <Page>
      <PageIntro
        title="Expected update frequency"
        description="How often each metric is expected to receive a new value. Metrics arrive through the KPI ingestion API or Manual metrics; this setting does not fetch or generate data. A value older than its interval is shown as stale (greyed, with the time it became stale) and is left out of composite scores: QA score, KPI targets and company averages."
        actions={
          <>
            {hasChanges && <button className={buttonClass.secondary} onClick={() => setIntervals(original)}>Discard changes</button>}
            <button className={buttonClass.primary} onClick={saveAll} disabled={!hasChanges || saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </>
        }
      />

      {state === 'loading' && <Card><p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p></Card>}
      {state === 'error' && <Card><EmptyState title="Update frequencies unavailable" description="The settings could not be loaded." /></Card>}

      {state === 'ready' && (
        <div className="space-y-4">
          {Object.entries(METRIC_CATEGORIES).map(([key, category]) => (
            <Card key={key} padded={false}>
              <div className="px-5 pt-5"><CardHeader title={category.label} /></div>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
                {category.metrics.map(metricKey => {
                  const interval = intervals.find(i => i.metric_key === metricKey);
                  if (!interval) return null;
                  return (
                    <li key={metricKey} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-white">{interval.custom_label}</p>
                        <div className="mt-1">{interval.is_default ? <Badge>Default</Badge> : <Badge tone="brand">Custom</Badge>}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-500 dark:text-slate-400">Expected every</span>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          aria-label={`${interval.custom_label} interval`}
                          value={interval.interval_value}
                          onChange={(e) => change(metricKey, 'interval_value', Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                          className={cx(inputClass, 'w-20')}
                        />
                        <select
                          aria-label={`${interval.custom_label} unit`}
                          value={interval.interval_unit}
                          onChange={(e) => change(metricKey, 'interval_unit', e.target.value)}
                          className={cx(inputClass, 'pr-8')}
                        >
                          {INTERVAL_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                          {interval.interval_unit === 'minutes' && <option value="minutes">minutes</option>}
                        </select>
                        {!interval.is_default && (
                          <button onClick={() => reset(metricKey)} className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" title="Reset to default" aria-label="Reset to default">
                            <RotateCcw size={15} />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
};

export default MetricIntervalsConfig;
