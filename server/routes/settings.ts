import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken } from '../middleware/auth';
import { runIntervalSync, runHourlySync, runDailySync, runWeeklySync, runMonthlySync } from '../jobs/intervalSync';

const router = express.Router();

// Default metric intervals configuration
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
    const { role, companyId } = req.user;

    // Only admin and manager can view
    if (role !== 'super_admin' && role !== 'manager') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

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
    if (role !== 'super_admin' && role !== 'manager') {
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
    if (role !== 'super_admin' && role !== 'manager') {
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
    if (role !== 'super_admin' && role !== 'manager') {
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

// Manually trigger metric sync
router.post('/sync-metrics', authenticateToken, async (req: any, res) => {
  try {
    const { role } = req.user;
    const { frequency } = req.body; // 'hourly' | 'daily' | 'weekly' | 'monthly' | 'all'

    // Only admin can trigger manual sync
    if (role !== 'super_admin') {
      return res.status(403).json({ error: 'Only super admin can trigger manual sync' });
    }

    // Run specific sync based on frequency
    const syncFunctions: Record<string, () => Promise<void>> = {
      hourly: runHourlySync,
      daily: runDailySync,
      weekly: runWeeklySync,
      monthly: runMonthlySync,
      all: runIntervalSync,
    };

    const syncFn = syncFunctions[frequency || 'all'];
    if (!syncFn) {
      return res.status(400).json({ error: 'Invalid frequency. Use: hourly, daily, weekly, monthly, or all' });
    }

    // Run sync in background
    syncFn().catch(err => console.error('Manual sync error:', err));

    res.json({ success: true, message: `${frequency || 'all'} metric sync triggered` });
  } catch (error) {
    console.error('Error triggering metric sync:', error);
    res.status(500).json({ error: 'Failed to trigger metric sync' });
  }
});

// Get sync status for metrics
router.get('/sync-status', authenticateToken, async (req: any, res) => {
  try {
    const { role, companyId } = req.user;

    // Only admin and manager can view
    if (role !== 'super_admin' && role !== 'manager') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Get last update times for all metrics across company teams
    const lastUpdates = await query<any>(
      `SELECT mlu.metric_key, mlu.team_id, t.name as team_name, 
              mlu.last_updated_at, mlu.next_update_at
       FROM metric_last_updated mlu
       JOIN teams t ON mlu.team_id = t.id
       WHERE mlu.company_id = ?
       ORDER BY mlu.next_update_at ASC`,
      [companyId]
    );

    // Group by metric
    const statusByMetric: Record<string, any[]> = {};
    for (const update of lastUpdates) {
      if (!statusByMetric[update.metric_key]) {
        statusByMetric[update.metric_key] = [];
      }
      statusByMetric[update.metric_key].push({
        teamId: update.team_id,
        teamName: update.team_name,
        lastUpdatedAt: update.last_updated_at,
        nextUpdateAt: update.next_update_at,
        isDue: new Date() >= new Date(update.next_update_at)
      });
    }

    res.json({ status: statusByMetric });
  } catch (error) {
    console.error('Error fetching sync status:', error);
    res.status(500).json({ error: 'Failed to fetch sync status' });
  }
});

export default router;
