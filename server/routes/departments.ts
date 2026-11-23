import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { teamMemberCountSql, teamLeadNameSql } from '../lib/teamMembership';
import { policyActor } from '../middleware/access';
import { analyticsTeamsInScope, canManageDepartment, type PolicyActor } from '../lib/userPolicy';

const router = express.Router();

/**
 * The departments a person may see here (docs/ROLE_ACCESS.md, scope rule): every department for a
 * super admin, the departments a manager manages, and the departments of the teams in the
 * person's analytics scope. Other departments (and their managers) are not shown.
 */
async function departmentIdsInScope(actor: PolicyActor, companyId: string): Promise<Set<string>> {
  const teams = await query<any[]>(
    'SELECT id, department_id FROM teams WHERE company_id = ? AND is_active = true AND department_id IS NOT NULL',
    [companyId]
  );
  const ids = new Set<string>(analyticsTeamsInScope(actor, teams).map((t: any) => String(t.department_id)));
  const depts = await query<any[]>('SELECT id FROM departments WHERE company_id = ?', [companyId]);
  for (const d of depts) if (canManageDepartment(actor, d.id)) ids.add(String(d.id));
  return ids;
}

// Get the departments in the caller's scope
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const inScope = await departmentIdsInScope(policyActor(req), req.companyId!);
    const all = await query<any[]>(
      `SELECT d.*, 
              (u.first_name || ' ' || u.last_name) as manager_name,
              (SELECT COUNT(*) FROM teams WHERE department_id = d.id AND is_active = true) as team_count
       FROM departments d
       LEFT JOIN users u ON d.manager_id = u.id
       WHERE d.company_id = ? AND d.is_active = true
       ORDER BY d.name`,
      [req.companyId]
    );
    const departments = all.filter((d: any) => inScope.has(String(d.id)));

    res.json({ departments });
  } catch (error) {
    console.error('Get departments error:', error);
    res.status(500).json({ error: 'Failed to get departments' });
  }
});

// Get department by ID
router.get('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const department = await queryOne<any>(
      `SELECT d.*, 
              (u.first_name || ' ' || u.last_name) as manager_name
       FROM departments d
       LEFT JOIN users u ON d.manager_id = u.id
       WHERE d.id = ? AND d.company_id = ?`,
      [req.params.id, req.companyId]
    );

    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }
    if (!(await departmentIdsInScope(policyActor(req), req.companyId!)).has(String(department.id))) {
      return res.status(403).json({ error: 'You do not have access to this department' });
    }

    // Get teams in this department
    const teams = await query<any[]>(
      `SELECT t.*, 
              ${teamLeadNameSql('t')} as team_lead_name,
              ${teamMemberCountSql('t')} as member_count
       FROM teams t
       WHERE t.department_id = ? AND t.company_id = ? AND t.is_active = true
       ORDER BY t.name`,
      [req.params.id, req.companyId]
    );

    // Only the teams of the caller's analytics scope (as the overview).
    department.teams = analyticsTeamsInScope(policyActor(req), teams);

    res.json({ department });
  } catch (error) {
    console.error('Get department error:', error);
    res.status(500).json({ error: 'Failed to get department' });
  }
});

export default router;
