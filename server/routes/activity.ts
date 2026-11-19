import express from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateToken, type AuthRequest } from '../middleware/auth';
import { policyActor } from '../middleware/access';
import { canViewUserActivity } from '../lib/userPolicy';
import { ctxOf } from '../lib/requestContext';
import { recordScreenViews, skipActivity } from '../lib/userActivity';
import { filtersFromQuery, listUserActivity, userActivityFacets } from '../lib/userActivityQuery';
import { toCsv, csvFileName, type CsvColumn } from '../../src/lib/csv';

/**
 * User activity (table user_activity, server/lib/userActivity.ts):
 *
 *   POST /api/activity/screen   { events: [{ screen, teamId?, kind? }] }  screen views sent by the
 *                               web app (any signed-in user; company and user come from the
 *                               session, never the body; at most 10 per request, 60 per minute)
 *   GET  /api/activity/log      ?userId&from&to&type&teamId&entityId&errors&requestId&before&limit
 *   GET  /api/activity/log/facets
 *   GET  /api/activity/log.csv  same filters, at most 10 000 rows (the export itself is recorded)
 *
 * The log is visible to the company's super admins only (canViewUserActivity).
 */
const router = express.Router();

const screenLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => `u:${req.user?.id ?? req.ip}`,
  message: { error: 'Too many screen events, please slow down.' },
});

router.post('/screen', authenticateToken, screenLimiter, async (req: AuthRequest, res) => {
  try {
    skipActivity(res);
    const body = req.body ?? {};
    const events = Array.isArray(body.events) ? body.events : [body];
    const recorded = await recordScreenViews(req, ctxOf(req), events);
    res.json({ recorded });
  } catch (error) {
    console.error('Screen view error:', error);
    res.status(500).json({ error: 'Failed to record the screen view' });
  }
});

const guard = (req: AuthRequest, res: express.Response) => {
  if (canViewUserActivity(policyActor(req))) return true;
  res.status(403).json({ error: 'The user activity log is available to super admins only' });
  return false;
};

router.get('/log', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!guard(req, res)) return;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);
    res.json(await listUserActivity(req.user!.companyId, filtersFromQuery(req.query), limit));
  } catch (error) {
    console.error('User activity error:', error);
    res.status(500).json({ error: 'Failed to load the user activity' });
  }
});

router.get('/log/facets', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!guard(req, res)) return;
    res.json(await userActivityFacets(req.user!.companyId));
  } catch (error) {
    console.error('User activity facets error:', error);
    res.status(500).json({ error: 'Failed to load the filters' });
  }
});

type Row = Awaited<ReturnType<typeof listUserActivity>>['entries'][number];
export const ACTIVITY_CSV_COLUMNS: CsvColumn<Row>[] = [
  { header: 'Time (UTC)', value: (r) => new Date(r.created_at).toISOString() },
  { header: 'Who', value: (r) => r.actor_display },
  { header: 'Type', value: (r) => r.categoryLabel },
  { header: 'What', value: (r) => r.label },
  { header: 'Route', value: (r) => (r.method ? `${r.method} ${r.route ?? ''}` : r.screen ? `screen ${r.screen}` : '') },
  { header: 'Team', value: (r) => r.team_name },
  { header: 'Status', value: (r) => r.status },
  { header: 'Duration (ms)', value: (r) => r.duration_ms },
  { header: 'IP', value: (r) => r.ip },
  { header: 'User agent', value: (r) => r.user_agent },
  { header: 'Request id', value: (r) => r.request_id },
];

router.get('/log.csv', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!guard(req, res)) return;
    const { entries } = await listUserActivity(req.user!.companyId, { ...filtersFromQuery(req.query), before: null }, 10_000);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${csvFileName('user-activity')}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send('﻿' + toCsv(ACTIVITY_CSV_COLUMNS, entries));
  } catch (error) {
    console.error('User activity CSV error:', error);
    res.status(500).json({ error: 'Failed to export the user activity' });
  }
});

export default router;
