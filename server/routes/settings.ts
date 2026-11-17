import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

// Expected update frequency per metric. Metrics are pushed (KPI ingestion API, Manual
// metrics); these intervals do not schedule anything. Team detail uses them to flag a
// metric as stale when field_sources[metric].recorded_at is older than the interval.
const DEFAULT_METRIC_INTERVALS = [
  // Quality Metrics
  { metric_key: 'test_coverage', interval_value: 1, interval_unit: 'days', custom_label: 'Test Coverage' },
  { metric_key: 'test_flakiness_rate', interval_value: 1, interval_unit: 'days', custom_label: 'Test Flakiness Rate' },
  { metric_key: 'defect_density', interval_value: 1, interval_unit: 'weeks', custom_label: 'Defect Density' },
  { metric_key: 'defect_escape_rate', interval_value: 1, interval_unit: 'weeks', custom_label: 'Defect Escape Rate' },
  { metric_key: 'code_quality_score', interval_value: 1, interval_unit: 'days', custom_label: 'Code Quality Score' },
  
  // Speed & Efficiency
  { metric_key: 'avg_build_time_minutes', interval_value: 1, interval_unit: 'hours', custom_label: 'Avg Build Time' },
  { metric_key: 'test_execution_time_minutes', interval_value: 1, interval_unit: 'hours', custom_label: 'Test Execution Time' },
  { metric_key: 'deployment_frequency_per_week', interval_value: 1, interval_unit: 'weeks', custom_label: 'Deployment Frequency' },
  { metric_key: 'lead_time_days', interval_value: 1, interval_unit: 'days', custom_label: 'Lead Time' },
  { metric_key: 'mttr_hours', interval_value: 1, interval_unit: 'days', custom_label: 'MTTR' },
  { metric_key: 'parallel_test_efficiency', interval_value: 1, interval_unit: 'days', custom_label: 'Parallel Test Efficiency' },
  
  // Agile & Process
  { metric_key: 'sprint_velocity', interval_value: 2, interval_unit: 'weeks', custom_label: 'Sprint Velocity' },
  { metric_key: 'sprint_commitment_rate', interval_value: 2, interval_unit: 'weeks', custom_label: 'Sprint Commitment Rate' },
  { metric_key: 'sprint_carryover', interval_value: 2, interval_unit: 'weeks', custom_label: 'Sprint Carryover' },
  { metric_key: 'first_time_pass_rate', interval_value: 1, interval_unit: 'days', custom_label: 'First Time Pass Rate' },
  { metric_key: 'blocked_time_hours', interval_value: 1, interval_unit: 'days', custom_label: 'Blocked Time' },
  { metric_key: 'sizing_accuracy', interval_value: 2, interval_unit: 'weeks', custom_label: 'Sizing Accuracy' },
  
  // Automation
  { metric_key: 'automation_coverage', interval_value: 1, interval_unit: 'weeks', custom_label: 'Automation Coverage' },
  { metric_key: 'automation_roi', interval_value: 1, interval_unit: 'months', custom_label: 'Automation ROI' },
  
  // Reliability
  { metric_key: 'change_failure_rate', interval_value: 1, interval_unit: 'weeks', custom_label: 'Change Failure Rate' },
  { metric_key: 'mtbf_hours', interval_value: 1, interval_unit: 'weeks', custom_label: 'MTBF' },
  { metric_key: 'system_availability', interval_value: 1, interval_unit: 'days', custom_label: 'System Availability' },
  { metric_key: 'infrastructure_failures', interval_value: 1, interval_unit: 'weeks', custom_label: 'Infrastructure Failures' },
];

// Get all metric intervals for company
router.get('/metric-intervals', authenticateToken, async (req: any, res) => {
  try {
    // Readable by every role (Team detail shows staleness to everyone); editing is admin/manager.
    const { companyId } = req.user;

    // Get saved intervals
    const savedIntervals = await query<any>(
      'SELECT * FROM metric_update_intervals WHERE company_id = ?',
      [companyId]
    );

    // Merge with defaults (saved values override defaults)
    const savedMap = new Map(savedIntervals.map((i: any) => [i.metric_key, i]));
    
    const intervals = DEFAULT_METRIC_INTERVALS.map(defaultInterval => {
      const saved: any = savedMap.get(defaultInterval.metric_key);
      if (saved) {
        return {
          id: saved.id,
          metric_key: saved.metric_key,
          interval_value: saved.interval_value,
          interval_unit: saved.interval_unit,
          custom_label: saved.custom_label || defaultInterval.custom_label,
          updated_at: saved.updated_at,
          is_default: false
        };
      }
      return {
        ...defaultInterval,
        id: null,
        updated_at: null,
        is_default: true
      };
    });

    res.json({ intervals, defaults: DEFAULT_METRIC_INTERVALS });
  } catch (error) {
    console.error('Error fetching metric intervals:', error);
    res.status(500).json({ error: 'Failed to fetch metric intervals' });
  }
});

// Update a single metric interval
router.put('/metric-intervals/:metricKey', authenticateToken, async (req: any, res) => {
  try {
    const { role, companyId, id: userId } = req.user;
    const { metricKey } = req.params;
    const { interval_value, interval_unit, custom_label } = req.body;

    // Only admin and manager can update
    if (role !== 'super_admin' && role !== 'qa_manager') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Validate interval_unit
    const validUnits = ['minutes', 'hours', 'days', 'weeks', 'months'];
    if (!validUnits.includes(interval_unit)) {
      return res.status(400).json({ error: 'Invalid interval unit' });
    }

    // Validate interval_value
    if (!interval_value || interval_value < 1) {
      return res.status(400).json({ error: 'Interval value must be at least 1' });
    }

    // Check if exists
    const existing = await queryOne<any>(
      'SELECT id FROM metric_update_intervals WHERE company_id = ? AND metric_key = ?',
      [companyId, metricKey]
    );

    if (existing) {
      // Update
      await query(
        `UPDATE metric_update_intervals 
         SET interval_value = ?, interval_unit = ?, custom_label = ?, updated_by = ?
         WHERE id = ?`,
        [interval_value, interval_unit, custom_label, userId, existing.id]
      );
    } else {
      // Insert
      const id = `interval-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await query(
        `INSERT INTO metric_update_intervals (id, company_id, metric_key, interval_value, interval_unit, custom_label, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, companyId, metricKey, interval_value, interval_unit, custom_label, userId]
      );
    }

    const updated = await queryOne<any>(
      'SELECT * FROM metric_update_intervals WHERE company_id = ? AND metric_key = ?',
      [companyId, metricKey]
    );

    res.json(updated);
  } catch (error) {
    console.error('Error updating metric interval:', error);
    res.status(500).json({ error: 'Failed to update metric interval' });
  }
});

// Bulk update metric intervals
router.put('/metric-intervals', authenticateToken, async (req: any, res) => {
  try {
    const { role, companyId, id: userId } = req.user;
    const { intervals } = req.body;

    // Only admin and manager can update
    if (role !== 'super_admin' && role !== 'qa_manager') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    if (!Array.isArray(intervals)) {
      return res.status(400).json({ error: 'Invalid intervals format' });
    }

    const validUnits = ['minutes', 'hours', 'days', 'weeks', 'months'];

    for (const interval of intervals) {
      const { metric_key, interval_value, interval_unit, custom_label } = interval;

      if (!validUnits.includes(interval_unit)) continue;
      if (!interval_value || interval_value < 1) continue;

      const existing = await queryOne<any>(
        'SELECT id FROM metric_update_intervals WHERE company_id = ? AND metric_key = ?',
        [companyId, metric_key]
      );

      if (existing) {
        await query(
          `UPDATE metric_update_intervals 
           SET interval_value = ?, interval_unit = ?, custom_label = ?, updated_by = ?
           WHERE id = ?`,
          [interval_value, interval_unit, custom_label, userId, existing.id]
        );
      } else {
        const id = `interval-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await query(
          `INSERT INTO metric_update_intervals (id, company_id, metric_key, interval_value, interval_unit, custom_label, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, companyId, metric_key, interval_value, interval_unit, custom_label, userId]
        );
      }
    }

    // Return all intervals
    const savedIntervals = await query<any>(
      'SELECT * FROM metric_update_intervals WHERE company_id = ?',
      [companyId]
    );

    res.json({ intervals: savedIntervals });
  } catch (error) {
    console.error('Error bulk updating metric intervals:', error);
    res.status(500).json({ error: 'Failed to update metric intervals' });
  }
});

// Reset metric interval to default
router.delete('/metric-intervals/:metricKey', authenticateToken, async (req: any, res) => {
  try {
    const { role, companyId } = req.user;
    const { metricKey } = req.params;

    // Only admin and manager can delete
    if (role !== 'super_admin' && role !== 'qa_manager') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    await query(
      'DELETE FROM metric_update_intervals WHERE company_id = ? AND metric_key = ?',
      [companyId, metricKey]
    );

    res.json({ success: true, message: 'Reset to default' });
  } catch (error) {
    console.error('Error resetting metric interval:', error);
    res.status(500).json({ error: 'Failed to reset metric interval' });
  }
});

// The former /sync-metrics and /sync-status routes were removed: the first only ran the
// synthetic-data generators, and the second read a table nothing writes. Freshness is
// derived from kpi_snapshots.field_sources[metric].recorded_at instead.

export default router;
