import express from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { getOwnedTeam, policyActor, type OwnedTeam } from '../middleware/access';
import { canCompareTeams } from '../lib/userPolicy';
import {
  buildComparison, comparisonCsvColumns, comparisonCsvRows, COMPARE_DAYS, COMPARE_MAX_TEAMS, COMPARE_MIN_TEAMS,
} from '../lib/compare';
import { csvFileName, toCsv } from '../../src/lib/csv';

/**
 * Team comparison (server/lib/compare.ts, src/components/CompareTeams.tsx).
 *
 * GET /api/compare/teams?ids=a,b[,c,d]&days=30        → JSON
 * GET /api/compare/teams.csv?ids=a,b[,c,d]&days=30    → CSV (one row per team and metric)
 *
 * Scope: every team must be in the caller's analytics scope (canCompareTeams → canViewTeamAnalytics
 * in server/lib/userPolicy.ts): super_admin any team of the company, qa_manager the teams of the
 * departments they manage, team_lead / qa_engineer / viewer the teams they are assigned to. A team
 * of another company, an unknown id and an out-of-scope team all get the same 403. The payload is
 * team aggregates only: no members, no individual developer data.
 */

const router = express.Router();
const DENIED = 'Access denied. One or more teams are outside your analytics scope.';

async function resolve(req: AuthRequest, res: express.Response): Promise<{ teams: OwnedTeam[]; days: number } | null> {
  const raw = typeof req.query.ids === 'string' ? req.query.ids : Array.isArray(req.query.ids) ? req.query.ids.join(',') : '';
  const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
  if (ids.length < COMPARE_MIN_TEAMS || ids.length > COMPARE_MAX_TEAMS) {
    res.status(400).json({ error: `Choose ${COMPARE_MIN_TEAMS} to ${COMPARE_MAX_TEAMS} different teams to compare.` });
    return null;
  }
  const d = req.query.days === undefined ? COMPARE_DAYS.default : Number(req.query.days);
  if (!Number.isInteger(d) || d < COMPARE_DAYS.min || d > COMPARE_DAYS.max) {
    res.status(400).json({ error: `days must be a whole number from ${COMPARE_DAYS.min} to ${COMPARE_DAYS.max}.` });
    return null;
  }
  const teams: OwnedTeam[] = [];
  for (const id of ids) {
    const t = await getOwnedTeam(req, id);
    if (!t) { res.status(403).json({ error: DENIED }); return null; }
    teams.push(t);
  }
  if (!canCompareTeams(policyActor(req), teams)) {
    res.status(403).json({ error: DENIED });
    return null;
  }
  return { teams, days: d };
}

router.get('/teams', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const r = await resolve(req, res);
    if (!r) return;
    res.json(await buildComparison(req.companyId as string, r.teams.map((t) => t.id), r.days));
  } catch (error) {
    console.error('Team comparison error:', error);
    res.status(500).json({ error: 'Failed to compare the teams' });
  }
});

router.get('/teams.csv', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const r = await resolve(req, res);
    if (!r) return;
    const c = await buildComparison(req.companyId as string, r.teams.map((t) => t.id), r.days);
    const csv = toCsv(comparisonCsvColumns(c.days), comparisonCsvRows(c));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${csvFileName('team-comparison')}"`);
    res.setHeader('Cache-Control', 'no-store');
    // UTF-8 byte order mark: spreadsheet apps then read ≥ / ≤ and accented names correctly.
    res.send('﻿' + csv);
  } catch (error) {
    console.error('Team comparison CSV error:', error);
    res.status(500).json({ error: 'Failed to export the comparison' });
  }
});

export default router;
