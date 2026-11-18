import React, { useState, useEffect } from 'react';
import { Save, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { API_URL } from '../config/api';
import { Page, PageIntro, Card, CardHeader, buttonClass, inputClass, cx } from './ui';
import KpiTargetsConfig from './KpiTargetsConfig';
import AlertSettings from './AlertSettings';

interface ParametersConfigurationProps {
  onBack?: () => void;
}

interface Department { id: string; name: string }
interface Team { id: string; name: string; department_id: string }

interface Field { key: string; label: string; placeholder: string; hint: string; usedBy: string }

/**
 * Only settings that something reads are offered here. Each field names its consumer.
 * Integration credentials (Jenkins, Jira, external databases, AI keys) were removed:
 * nothing used them. Metric data arrives through the KPI ingestion API.
 */
const CONFIG_SECTIONS: { id: string; title: string; description: string; fields: Field[] }[] = [
  {
    id: 'sla',
    title: 'Performance SLA',
    description: 'Thresholds used to mark endpoints as within or breaching SLA on the Performance page.',
    fields: [
      { key: 'sla_response_time_ms', label: 'P95 response time (ms)', placeholder: '500', hint: 'An endpoint is in breach when its p95 is above this.', usedBy: 'Performance' },
      { key: 'sla_error_rate_percent', label: 'Error rate threshold (%)', placeholder: '1', hint: 'An endpoint is in breach when its error rate is above this.', usedBy: 'Performance' },
    ],
  },
  {
    id: 'financial',
    title: 'Financial and ROI settings',
    description: 'Costs used for the technical-debt ROI estimates. Defaults are used, and labelled as such, where nothing is set.',
    fields: [
      { key: 'developer_hourly_rate', label: 'Developer hourly rate ($)', placeholder: '75', hint: 'Fully loaded cost per developer hour.', usedBy: 'Technical debt' },
      { key: 'support_ticket_cost', label: 'Support ticket cost ($)', placeholder: '25', hint: 'Average cost to handle one support ticket.', usedBy: 'Technical debt' },
      { key: 'revenue_per_user_monthly', label: 'Revenue per user per month ($)', placeholder: '50', hint: 'Average monthly revenue per active user.', usedBy: 'Technical debt' },
      { key: 'downtime_cost_per_minute', label: 'Downtime cost per minute ($)', placeholder: '100', hint: 'Revenue lost per minute of downtime.', usedBy: 'Technical debt' },
      { key: 'sla_breach_penalty', label: 'SLA breach penalty ($)', placeholder: '1000', hint: 'Penalty cost per SLA violation.', usedBy: 'Technical debt' },
    ],
  },
];

const FIELD_KEYS = CONFIG_SECTIONS.flatMap(s => s.fields.map(f => f.key));

const ParametersConfiguration: React.FC<ParametersConfigurationProps> = () => {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [configs, setConfigs] = useState<Record<string, string>>({});
  // Company-wide: saving also replaces department and team values, so the company settings apply everywhere.
  const [applyToAll, setApplyToAll] = useState(true);
  const companyScope = selectedDepartment === 'all';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [deptRes, teamsRes] = await Promise.all([
          fetch(`${API_URL}/admin/departments`, { credentials: 'include' }),
          fetch(`${API_URL}/teams`, { credentials: 'include' }),
        ]);
        if (deptRes.ok) { const data = await deptRes.json(); setDepartments(Array.isArray(data) ? data : []); }
        if (teamsRes.ok) { const { teams: t } = await teamsRes.json(); setTeams(t || []); }
      } catch (error) {
        console.error('Error fetching departments/teams:', error);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (selectedDepartment !== 'all') params.append('departmentId', selectedDepartment);
        if (selectedTeam !== 'all') params.append('teamId', selectedTeam);
        const response = await fetch(`${API_URL}/admin/configs/raw?${params}`, { credentials: 'include' });
        if (response.ok) {
          const { configs: data } = await response.json();
          // Only the keys this page manages; other stored keys are left untouched.
          const own: Record<string, string> = {};
          for (const k of FIELD_KEYS) if (data?.[k] != null) own[k] = data[k];
          setConfigs(own);
        }
      } catch (error) {
        console.error('Error fetching configs:', error);
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedDepartment, selectedTeam]);

  const filteredTeams = selectedDepartment === 'all' ? teams : teams.filter(t => t.department_id === selectedDepartment);

  const scopeLabel = (() => {
    if (selectedTeam !== 'all') return `Team: ${teams.find(t => t.id === selectedTeam)?.name ?? 'Unknown'}`;
    if (selectedDepartment !== 'all') return `Department: ${departments.find(d => d.id === selectedDepartment)?.name ?? 'Unknown'}`;
    return 'Company-wide';
  })();

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      for (const k of FIELD_KEYS) payload[k] = configs[k] ?? '';
      const response = await fetch(`${API_URL}/admin/configs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ departmentId: selectedDepartment, teamId: selectedTeam, configs: payload, ...(companyScope && applyToAll ? { applyToAll: true } : {}) }),
      });
      if (!response.ok) throw new Error();
      window.dispatchEvent(new CustomEvent('slaConfigUpdated'));
      const body = await response.json().catch(() => ({}));
      toast.success(companyScope && applyToAll
        ? `Configuration saved and applied to every department and team${body?.replaced ? ` (${body.replaced} department/team value${body.replaced === 1 ? '' : 's'} replaced)` : ''}`
        : `Configuration saved (${scopeLabel})`);
    } catch {
      toast.error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page>
      <PageIntro
        title="System configuration"
        description="Team settings override department settings, which override company-wide settings. Empty fields inherit from the level above."
        actions={
          <button onClick={handleSave} disabled={saving || loading} className={buttonClass.primary}>
            <Save size={15} /> {saving ? 'Saving…' : companyScope && applyToAll ? 'Save for all departments' : 'Save configuration'}
          </button>
        }
      />

      <div className="space-y-4">
        <Card>
          <CardHeader title="Scope" subtitle={`Currently editing: ${scopeLabel}`} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Department</span>
              <select
                value={selectedDepartment}
                onChange={(e) => { setSelectedDepartment(e.target.value); setSelectedTeam('all'); }}
                className={cx(inputClass, 'w-full pr-8')}
              >
                <option value="all">All departments (company-wide)</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Team</span>
              <select
                value={selectedTeam}
                onChange={(e) => setSelectedTeam(e.target.value)}
                disabled={selectedDepartment === 'all'}
                className={cx(inputClass, 'w-full pr-8 disabled:opacity-50')}
              >
                <option value="all">{selectedDepartment !== 'all' ? 'All teams in department' : 'All teams'}</option>
                {filteredTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          </div>
          {companyScope && (
            <label className="mt-4 flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={applyToAll}
                onChange={(e) => setApplyToAll(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-900"
                data-testid="apply-to-all"
              />
              <span>
                <span className="font-medium text-slate-900 dark:text-white">Apply to every department and team</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  Saving the configuration or the KPI targets replaces the values departments and teams set for themselves, so these company-wide values apply everywhere. Each change is recorded in Activity.
                </span>
              </span>
            </label>
          )}
        </Card>

        {loading ? (
          <Card><p className="text-sm text-slate-500 dark:text-slate-400">Loading configuration…</p></Card>
        ) : (
          CONFIG_SECTIONS.map(section => (
            <Card key={section.id}>
              <CardHeader title={section.title} subtitle={section.description} />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {section.fields.map(field => (
                  <label key={field.key} className="block">
                    <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{field.label}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder={`Not set (default ${field.placeholder})`}
                      value={configs[field.key] ?? ''}
                      onChange={(e) => setConfigs(prev => ({ ...prev, [field.key]: e.target.value }))}
                      className={cx(inputClass, 'w-full')}
                    />
                    <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{field.hint} Used by: {field.usedBy}.</span>
                  </label>
                ))}
              </div>
            </Card>
          ))
        )}

        <KpiTargetsConfig
          scopeType={selectedTeam !== 'all' ? 'team' : selectedDepartment !== 'all' ? 'department' : 'company'}
          scopeId={selectedTeam !== 'all' ? selectedTeam : selectedDepartment !== 'all' ? selectedDepartment : null}
          scopeLabel={scopeLabel}
          applyToAll={companyScope && applyToAll}
        />

        <AlertSettings
          scopeType={selectedTeam !== 'all' ? 'team' : selectedDepartment !== 'all' ? 'department' : 'company'}
          scopeId={selectedTeam !== 'all' ? selectedTeam : selectedDepartment !== 'all' ? selectedDepartment : null}
          scopeLabel={scopeLabel}
        />

        <Card>
          <div className="flex items-start gap-3">
            <Info size={16} className="mt-0.5 shrink-0 text-slate-400" />
            <div className="text-sm text-slate-600 dark:text-slate-300">
              <p className="font-medium text-slate-900 dark:text-white">Metric data sources</p>
              <p className="mt-1">
                Built-in connectors for Jenkins, Jira or external databases are not available yet, so their settings are no longer offered here.
                To feed metrics from your own tools, send them to the KPI ingestion API (<code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">POST /api/ingest/kpis</code>) with an API key created under Admin console, API keys. Values can also be entered under Manual metrics.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </Page>
  );
};

export default ParametersConfiguration;
