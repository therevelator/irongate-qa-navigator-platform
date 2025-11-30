import React, { useState, useEffect } from 'react';
import { ArrowLeft, Save, Info, Shield, Database, Key, Gauge, Globe, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { API_URL } from '../config/api';
import Swal from 'sweetalert2';

interface ParametersConfigurationProps {
  onBack?: () => void;
}

interface Department {
  id: string;
  name: string;
}

interface Team {
  id: string;
  name: string;
  department_id: string;
}

// Config keys organized by section
const CONFIG_SECTIONS = {
  sla: {
    title: 'SLA (Service Level Agreement)',
    icon: Gauge,
    description: 'Define performance thresholds and uptime commitments',
    companyOnly: false,
    fields: [
      { key: 'sla_response_time_ms', label: 'P95 Response Time (ms)', type: 'number', placeholder: '500', hint: 'Target response time in milliseconds' },
      { key: 'sla_error_rate_percent', label: 'Error Rate Threshold (%)', type: 'number', placeholder: '1', hint: 'Maximum acceptable error percentage' },
      { key: 'sla_uptime_percent', label: 'Uptime Commitment (%)', type: 'number', placeholder: '99.9', hint: 'Target availability percentage' },
    ]
  },
  jenkins: {
    title: 'Jenkins Integration',
    icon: Shield,
    description: 'Connect to Jenkins for CI/CD pipeline data',
    companyOnly: true,
    fields: [
      { key: 'jenkins_url', label: 'Jenkins URL', type: 'url', placeholder: 'https://jenkins.company.com', hint: 'Base URL of your Jenkins instance' },
      { key: 'jenkins_username', label: 'Username', type: 'text', placeholder: 'api-user', hint: 'Jenkins API username' },
      { key: 'jenkins_api_token', label: 'API Token', type: 'password', placeholder: '••••••••', hint: 'Jenkins API token (not password)' },
    ]
  },
  jira: {
    title: 'Jira Integration',
    icon: Globe,
    description: 'Connect to Jira for issue tracking and test management',
    companyOnly: true,
    fields: [
      { key: 'jira_url', label: 'Jira URL', type: 'url', placeholder: 'https://company.atlassian.net', hint: 'Your Jira Cloud or Server URL' },
      { key: 'jira_email', label: 'Email', type: 'email', placeholder: 'user@company.com', hint: 'Jira account email' },
      { key: 'jira_api_token', label: 'API Token', type: 'password', placeholder: '••••••••', hint: 'Jira API token from Atlassian' },
      { key: 'jira_project_key', label: 'Default Project Key', type: 'text', placeholder: 'QA', hint: 'Default Jira project for linking' },
    ]
  },
  ai: {
    title: 'AI & LLM Services',
    icon: Key,
    description: 'Configure AI providers for intelligent analysis',
    companyOnly: true,
    fields: [
      { key: 'groq_api_key', label: 'Groq API Key', type: 'password', placeholder: 'gsk_...', hint: 'Groq Cloud API key for fast inference' },
      { key: 'openai_api_key', label: 'OpenAI API Key', type: 'password', placeholder: 'sk-...', hint: 'OpenAI API key (optional fallback)' },
      { key: 'ai_model', label: 'Preferred Model', type: 'text', placeholder: 'llama-3.1-70b-versatile', hint: 'Default model for analysis' },
    ]
  },
  database: {
    title: 'External Database',
    icon: Database,
    description: 'Connect to external test results databases',
    companyOnly: true,
    fields: [
      { key: 'ext_db_host', label: 'Host', type: 'text', placeholder: 'db.company.com', hint: 'Database hostname' },
      { key: 'ext_db_port', label: 'Port', type: 'number', placeholder: '3306', hint: 'Database port' },
      { key: 'ext_db_name', label: 'Database Name', type: 'text', placeholder: 'test_results', hint: 'Schema/database name' },
      { key: 'ext_db_user', label: 'Username', type: 'text', placeholder: 'readonly_user', hint: 'Database user' },
      { key: 'ext_db_password', label: 'Password', type: 'password', placeholder: '••••••••', hint: 'Database password' },
    ]
  },
};

const ParametersConfiguration: React.FC<ParametersConfigurationProps> = ({ onBack }) => {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [configs, setConfigs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ sla: true });

  // Fetch departments and teams
  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem('irongate_token');
        const headers = { 'Authorization': `Bearer ${token}` };

        const [deptRes, teamsRes] = await Promise.all([
          fetch(`${API_URL}/admin/departments`, { headers }),
          fetch(`${API_URL}/teams`, { headers })
        ]);

        if (deptRes.ok) {
          const data = await deptRes.json();
          setDepartments(Array.isArray(data) ? data : []);
        }
        if (teamsRes.ok) {
          const { teams: teamsData } = await teamsRes.json();
          setTeams(teamsData || []);
        }
      } catch (error) {
        console.error('Error fetching departments/teams:', error);
      }
    };
    fetchData();
  }, []);

  // Fetch configs when scope changes
  useEffect(() => {
    const fetchConfigs = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('irongate_token');
        const params = new URLSearchParams();
        if (selectedDepartment !== 'all') params.append('departmentId', selectedDepartment);
        if (selectedTeam !== 'all') params.append('teamId', selectedTeam);

        const response = await fetch(`${API_URL}/admin/configs/raw?${params}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
          const { configs: configData } = await response.json();
          setConfigs(configData || {});
        }
      } catch (error) {
        console.error('Error fetching configs:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchConfigs();
  }, [selectedDepartment, selectedTeam]);

  const handleConfigChange = (key: string, value: string) => {
    setConfigs(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('irongate_token');
      const response = await fetch(`${API_URL}/admin/configs`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          departmentId: selectedDepartment,
          teamId: selectedTeam,
          configs
        })
      });

      if (response.ok) {
        // Dispatch event for live updates
        window.dispatchEvent(new CustomEvent('slaConfigUpdated'));
        
        // Build summary of saved configs
        const savedEntries = Object.entries(configs).filter(([_, v]) => v);
        const summaryHtml = savedEntries.length > 0 
          ? `<div class="text-left mt-3 max-h-48 overflow-y-auto">
              <table class="w-full text-sm">
                <tbody>
                  ${savedEntries.map(([key, value]) => {
                    const displayValue = key.includes('password') || key.includes('token') || key.includes('api_key')
                      ? '••••••••'
                      : value;
                    return `<tr class="border-b border-gray-100 dark:border-gray-700">
                      <td class="py-1.5 pr-3 text-gray-500 dark:text-gray-400">${key.replace(/_/g, ' ')}</td>
                      <td class="py-1.5 font-medium text-gray-900 dark:text-white">${displayValue}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>`
          : '<p class="text-gray-500">No configuration values set</p>';

        await Swal.fire({
          icon: 'success',
          title: 'Configuration Saved',
          html: `
            <p class="text-gray-600 dark:text-gray-300">Saved for: <strong>${getScopeLabel()}</strong></p>
            ${summaryHtml}
          `,
          confirmButtonText: 'Done',
          confirmButtonColor: '#2563eb',
          customClass: {
            popup: 'dark:bg-slate-800 dark:text-white',
            htmlContainer: 'dark:text-gray-300'
          }
        });
      } else {
        throw new Error('Failed to save');
      }
    } catch (error) {
      console.error('Error saving configs:', error);
      await Swal.fire({
        icon: 'error',
        title: 'Save Failed',
        text: 'Failed to save configuration. Please try again.',
        confirmButtonColor: '#2563eb',
        customClass: {
          popup: 'dark:bg-slate-800 dark:text-white'
        }
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const filteredTeams = selectedDepartment === 'all' 
    ? teams 
    : teams.filter(t => t.department_id === selectedDepartment);

  const getScopeLabel = () => {
    if (selectedTeam !== 'all') {
      const team = teams.find(t => t.id === selectedTeam);
      return `Team: ${team?.name || 'Unknown'}`;
    }
    if (selectedDepartment !== 'all') {
      const dept = departments.find(d => d.id === selectedDepartment);
      return `Department: ${dept?.name || 'Unknown'}`;
    }
    return 'Company-wide (all teams)';
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800">
        <div className="px-6 py-5 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-slate-400">
              <span>Admin</span>
              <span>•</span>
              <span>Parameters Configuration</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">System Configuration</h1>
          </div>
          {onBack && (
            <button
              onClick={onBack}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-200 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800"
            >
              <ArrowLeft size={16} />
              Back to Admin
            </button>
          )}
        </div>
      </div>

      <div className="px-6 py-8 max-w-5xl mx-auto space-y-6">
        {/* Scope Selector */}
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Set Configuration For:</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">Department</label>
              <select
                value={selectedDepartment}
                onChange={(e) => {
                  setSelectedDepartment(e.target.value);
                  setSelectedTeam('all');
                }}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-white"
              >
                <option value="all">All Departments (Company-wide)</option>
                {departments.map(dept => (
                  <option key={dept.id} value={dept.id}>{dept.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">Team</label>
              <select
                value={selectedTeam}
                onChange={(e) => setSelectedTeam(e.target.value)}
                disabled={selectedDepartment === 'all'}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-white disabled:opacity-50"
              >
                <option value="all">All Teams{selectedDepartment !== 'all' ? ' in Department' : ''}</option>
                {filteredTeams.map(team => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-center gap-2">
              <Info size={16} className="text-blue-500" />
              <span className="text-sm text-blue-800 dark:text-blue-200">
                Currently editing: <strong>{getScopeLabel()}</strong>
              </span>
            </div>
            <p className="text-xs text-blue-600 dark:text-blue-300 mt-1">
              Team settings override department settings, which override company-wide defaults.
            </p>
          </div>
        </div>

        {/* Config Sections */}
        {loading ? (
          <div className="text-center py-12 text-gray-500 dark:text-slate-400">Loading configuration...</div>
        ) : (
          <div className="space-y-4">
            {Object.entries(CONFIG_SECTIONS).map(([sectionKey, section]) => {
              const Icon = section.icon;
              const isExpanded = expandedSections[sectionKey];
              const isCompanyScope = selectedDepartment === 'all' && selectedTeam === 'all';
              const isDisabled = section.companyOnly && !isCompanyScope;
              
              return (
                <div key={sectionKey} className={`bg-white dark:bg-slate-900 border rounded-xl shadow-sm overflow-hidden ${isDisabled ? 'border-amber-300 dark:border-amber-700 opacity-75' : 'border-gray-200 dark:border-slate-800'}`}>
                  <button
                    onClick={() => toggleSection(sectionKey)}
                    className="w-full flex items-center justify-between p-5 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isDisabled ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-blue-100 dark:bg-blue-900/30'}`}>
                        <Icon size={20} className={isDisabled ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'} />
                      </div>
                      <div className="text-left">
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-semibold text-gray-900 dark:text-white">{section.title}</h3>
                          {section.companyOnly && (
                            <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 rounded">Company-wide only</span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 dark:text-slate-400">{section.description}</p>
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp size={20} className="text-gray-400" /> : <ChevronDown size={20} className="text-gray-400" />}
                  </button>
                  
                  {isExpanded && (
                    <div className="px-5 pb-5 pt-2 border-t border-gray-100 dark:border-slate-800">
                      {isDisabled && (
                        <div className="mb-4 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start gap-3">
                          <AlertTriangle size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Company-wide configuration only</p>
                            <p className="text-xs text-amber-600 dark:text-amber-300 mt-0.5">
                              These settings contain sensitive credentials and can only be configured at the company level. Select "All Departments" and "All Teams" to edit.
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {section.fields.map(field => (
                          <div key={field.key}>
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">
                              {field.label}
                            </label>
                            <input
                              type={field.type}
                              placeholder={field.placeholder}
                              value={configs[field.key] || ''}
                              onChange={(e) => handleConfigChange(field.key, e.target.value)}
                              disabled={isDisabled}
                              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100 dark:disabled:bg-slate-900"
                            />
                            <p className="mt-1 text-xs text-gray-500 dark:text-slate-500">{field.hint}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Save Button */}
        <div className="flex items-center justify-end gap-3 pt-4">
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            <Save size={18} />
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ParametersConfiguration;
