import React, { useState, useEffect } from 'react';
import { ArrowLeft, Clock, Save, RotateCcw, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import API_URL from '../config/api';

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
  onBack: () => void;
}

const METRIC_CATEGORIES = {
  quality: {
    label: 'Quality Metrics',
    description: 'Code and test quality indicators',
    metrics: ['test_coverage', 'test_flakiness_rate', 'defect_density', 'defect_escape_rate', 'code_quality_score']
  },
  speed: {
    label: 'Speed & Efficiency',
    description: 'Build, deployment, and recovery times',
    metrics: ['avg_build_time_minutes', 'test_execution_time_minutes', 'deployment_frequency_per_week', 'lead_time_days', 'mttr_hours', 'parallel_test_efficiency']
  },
  agile: {
    label: 'Agile & Process',
    description: 'Sprint and workflow metrics',
    metrics: ['sprint_velocity', 'sprint_commitment_rate', 'sprint_carryover', 'first_time_pass_rate', 'blocked_time_hours']
  },
  automation: {
    label: 'Automation',
    description: 'Test automation progress and ROI',
    metrics: ['automation_coverage', 'automation_roi']
  },
  reliability: {
    label: 'Reliability',
    description: 'System stability and uptime',
    metrics: ['change_failure_rate', 'mtbf_hours', 'system_availability', 'infrastructure_failures']
  }
};

const INTERVAL_UNITS = [
  { value: 'minutes', label: 'Minutes' },
  { value: 'hours', label: 'Hours' },
  { value: 'days', label: 'Days' },
  { value: 'weeks', label: 'Weeks' },
  { value: 'months', label: 'Months' }
];

const MetricIntervalsConfig: React.FC<MetricIntervalsConfigProps> = ({ onBack }) => {
  const [intervals, setIntervals] = useState<MetricInterval[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalIntervals, setOriginalIntervals] = useState<MetricInterval[]>([]);

  const token = localStorage.getItem('irongate_token');

  useEffect(() => {
    fetchIntervals();
  }, []);

  const fetchIntervals = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/settings/metric-intervals`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setIntervals(data.intervals);
        setOriginalIntervals(JSON.parse(JSON.stringify(data.intervals)));
      } else {
        toast.error('Failed to load metric intervals');
      }
    } catch (error) {
      console.error('Error fetching intervals:', error);
      toast.error('Failed to load metric intervals');
    } finally {
      setLoading(false);
    }
  };

  const handleIntervalChange = (metricKey: string, field: 'interval_value' | 'interval_unit', value: number | string) => {
    setIntervals(prev => prev.map(interval => {
      if (interval.metric_key === metricKey) {
        return { ...interval, [field]: value, is_default: false };
      }
      return interval;
    }));
    setHasChanges(true);
  };

  const handleSaveAll = async () => {
    try {
      setSaving(true);
      const response = await fetch(`${API_URL}/settings/metric-intervals`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ intervals })
      });

      if (response.ok) {
        toast.success('Metric intervals saved successfully');
        setHasChanges(false);
        setOriginalIntervals(JSON.parse(JSON.stringify(intervals)));
      } else {
        toast.error('Failed to save metric intervals');
      }
    } catch (error) {
      console.error('Error saving intervals:', error);
      toast.error('Failed to save metric intervals');
    } finally {
      setSaving(false);
    }
  };

  const handleResetMetric = async (metricKey: string) => {
    try {
      const response = await fetch(`${API_URL}/settings/metric-intervals/${metricKey}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        toast.success('Reset to default');
        fetchIntervals();
      } else {
        toast.error('Failed to reset');
      }
    } catch (error) {
      console.error('Error resetting interval:', error);
      toast.error('Failed to reset');
    }
  };

  const handleDiscardChanges = () => {
    setIntervals(JSON.parse(JSON.stringify(originalIntervals)));
    setHasChanges(false);
  };

  const getIntervalByKey = (key: string) => {
    return intervals.find(i => i.metric_key === key);
  };

  const formatIntervalDisplay = (interval: MetricInterval) => {
    const value = interval.interval_value;
    const unit = interval.interval_unit;
    const unitLabel = value === 1 ? unit.slice(0, -1) : unit;
    return `Every ${value} ${unitLabel}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-slate-900 p-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500 dark:text-slate-400">Loading metric intervals...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-slate-400" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Clock className="w-7 h-7 text-cyan-500" />
                Metric Update Intervals
              </h1>
              <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                Configure how often each metric should be updated
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {hasChanges && (
              <button
                onClick={handleDiscardChanges}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors"
              >
                Discard Changes
              </button>
            )}
            <button
              onClick={handleSaveAll}
              disabled={!hasChanges || saving}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                hasChanges && !saving
                  ? 'bg-cyan-600 text-white hover:bg-cyan-700'
                  : 'bg-gray-200 dark:bg-slate-700 text-gray-400 dark:text-slate-500 cursor-not-allowed'
              }`}
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save All Changes'}
            </button>
          </div>
        </div>

        {/* Info Banner */}
        <div className="bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800 rounded-lg p-4">
          <p className="text-sm text-cyan-800 dark:text-cyan-200">
            <strong>Tip:</strong> Set intervals based on how frequently each metric naturally changes. 
            Sprint metrics should align with your sprint duration (e.g., 2 weeks), while build metrics 
            can be updated more frequently (hourly or daily).
          </p>
        </div>

        {/* Metric Categories */}
        {Object.entries(METRIC_CATEGORIES).map(([categoryKey, category]) => (
          <div key={categoryKey} className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{category.label}</h2>
              <p className="text-sm text-gray-500 dark:text-slate-400">{category.description}</p>
            </div>
            
            <div className="divide-y divide-gray-100 dark:divide-slate-700">
              {category.metrics.map(metricKey => {
                const interval = getIntervalByKey(metricKey);
                if (!interval) return null;

                return (
                  <div key={metricKey} className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex-1">
                      <h3 className="font-medium text-gray-900 dark:text-white">
                        {interval.custom_label}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-slate-400">
                        {interval.is_default ? (
                          <span className="text-gray-400 dark:text-slate-500">Using default</span>
                        ) : (
                          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle className="w-3 h-3" />
                            Custom interval
                          </span>
                        )}
                      </p>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500 dark:text-slate-400">Every</span>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={interval.interval_value}
                          onChange={(e) => handleIntervalChange(metricKey, 'interval_value', parseInt(e.target.value) || 1)}
                          className="w-16 px-2 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                        />
                        <select
                          value={interval.interval_unit}
                          onChange={(e) => handleIntervalChange(metricKey, 'interval_unit', e.target.value)}
                          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                        >
                          {INTERVAL_UNITS.map(unit => (
                            <option key={unit.value} value={unit.value}>{unit.label}</option>
                          ))}
                        </select>
                      </div>
                      
                      {!interval.is_default && (
                        <button
                          onClick={() => handleResetMetric(metricKey)}
                          className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
                          title="Reset to default"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Footer note */}
        <div className="text-center text-sm text-gray-500 dark:text-slate-400 py-4">
          Changes will affect how the system expects metrics to be updated. 
          This helps identify stale data and set appropriate expectations for data freshness.
        </div>
      </div>
    </div>
  );
};

export default MetricIntervalsConfig;
