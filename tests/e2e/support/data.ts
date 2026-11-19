import { request as pwRequest, expect } from '@playwright/test';
import { API_URL, assertLocal } from './env';
import { withDb } from './db';
import { uid } from './ids';
import { DEMO } from './roles';

/** A strong password that meets the invitation / reset rules (10+ chars, 3 classes, no e-mail name). */
export const STRONG_PASSWORD = 'Ui-Tests-Passw0rd!';

export interface FreshCompany {
  id: string; name: string; email: string; password: string; firstName: string; lastName: string;
  departmentId: string; departmentName: string; teamId: string; teamName: string;
}

/**
 * A brand-new organisation, registered through the API like the Create an account screen does. Its
 * first user is its super admin. For flows that change company-wide settings (apply to all, Slack,
 * sign-in lifetime, onboarding, users, departments, activity) without touching the shared demo data.
 * Remove it with deleteCompany (every company table cascades).
 */
export async function registerCompany(label = 'co'): Promise<FreshCompany> {
  assertLocal('Registering a company');
  const id = uid(`uit-${label}`);
  const word = id.replace(/[^a-z0-9]/gi, ' ');
  // A domain of its own: one organisation per e-mail domain.
  const body = {
    firstName: 'Uitest', lastName: 'Owner', email: `owner@${id}.uitest.example`, password: STRONG_PASSWORD,
    companyName: `UI Test ${word}`, departmentName: 'Engineering', teamName: 'Core Team',
  };
  const ctx = await pwRequest.newContext();
  try {
    const res = await ctx.post(`${API_URL}/auth/register`, { data: body });
    expect(res.status(), await res.text()).toBeLessThan(300);
    const { user } = await res.json();
    return {
      id: user.company_id, name: body.companyName, email: body.email, password: body.password,
      firstName: body.firstName, lastName: body.lastName, departmentId: user.department_id, departmentName: body.departmentName,
      teamId: user.primary_team_id, teamName: body.teamName,
    };
  } finally {
    await ctx.dispose();
  }
}

export async function deleteCompany(companyId: string): Promise<void> {
  if (!companyId || companyId === DEMO.companyId) throw new Error(`Refusing to delete company ${companyId}`);
  await withDb(async (c) => {
    await c.query('DELETE FROM companies WHERE id = $1', [companyId]);
  });
}

export interface FixtureTeam { id: string; name: string; departmentId: string; memberIds: string[]; memberEmails: string[]; leadId?: string; leadEmail?: string }

/**
 * A team of its own in the demo company (NovaTech), in the given department (default: the manager's
 * department, so manager@ and admin@ have it in scope), with `members` software engineers and
 * optionally a team lead. Every user's password is demo123.
 */
export async function createFixtureTeam(opts: { members?: number; lead?: boolean; departmentId?: string; name?: string } = {}): Promise<FixtureTeam> {
  const id = uid('uit-team');
  const name = opts.name ?? `UI Team ${id.slice(-6)}`;
  const departmentId = opts.departmentId ?? DEMO.managerDepartment.id;
  const memberIds: string[] = [];
  let leadId: string | undefined;
  await withDb(async (c) => {
    const ref = (await c.query(`SELECT password_hash FROM users WHERE email = 'engineer@irongate.com'`)).rows[0];
    await c.query(
      `INSERT INTO teams (id, company_id, department_id, name, is_active, ai_enabled, exclude_from_auto_sync) VALUES ($1, $2, $3, $4, TRUE, FALSE, TRUE)`,
      [id, DEMO.companyId, departmentId, name]);
    const addUser = async (userId: string, role: 'qa_engineer' | 'team_lead', first: string, last: string) => {
      await c.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, is_active, email_verified)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, TRUE)`,
        [userId, `${userId}@uitest.example`, ref.password_hash, first, last, role, DEMO.companyId, departmentId, id]);
      await c.query(`INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id) VALUES ($1, $2, $3, $4, 'team', $5)`,
        [`${userId}-ra`, DEMO.companyId, userId, role, id]);
      await c.query(`INSERT INTO team_members (user_id, team_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [userId, id, role === 'team_lead' ? 'lead' : 'member']).catch(() => undefined);
    };
    if (opts.lead) {
      leadId = `${id}-lead`;
      await addUser(leadId, 'team_lead', 'Fixture', 'Lead');
      await c.query('UPDATE teams SET lead_id = $2 WHERE id = $1', [id, leadId]);
    }
    for (let i = 0; i < (opts.members ?? 0); i++) {
      const userId = `${id}-m${i + 1}`;
      memberIds.push(userId);
      await addUser(userId, 'qa_engineer', 'Fixture', `Member${i + 1}`);
    }
  });
  return { id, name, departmentId, memberIds, memberEmails: memberIds.map((m) => `${m}@uitest.example`), leadId, leadEmail: leadId ? `${leadId}@uitest.example` : undefined };
}

export async function deleteFixtureTeam(team: FixtureTeam | undefined): Promise<void> {
  if (!team) return;
  const users = [...team.memberIds, ...(team.leadId ? [team.leadId] : [])];
  await withDb(async (c) => {
    await c.query('DELETE FROM role_assignments WHERE scope_id = $1 OR user_id = ANY($2)', [team.id, users]);
    await c.query('DELETE FROM teams WHERE id = $1', [team.id]);
    await c.query('DELETE FROM users WHERE id = ANY($1)', [users]);
  });
}

/** A single software engineer in the demo company on the engineer's team (for session and password flows). */
export async function createFixtureUser(opts: { role?: 'qa_engineer' | 'team_lead' | 'viewer'; teamId?: string; active?: boolean } = {}): Promise<{ id: string; email: string; password: string }> {
  const id = uid('uit-user');
  const email = `${id}@uitest.example`;
  await withDb(async (c) => {
    const eng = (await c.query(`SELECT company_id, department_id, primary_team_id, password_hash FROM users WHERE email = 'engineer@irongate.com'`)).rows[0];
    const teamId = opts.teamId ?? eng.primary_team_id;
    const role = opts.role ?? 'qa_engineer';
    await c.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, is_active, email_verified)
       VALUES ($1, $2, $3, 'Fixture', 'Person', $4, $5, $6, $7, $8, TRUE)`,
      [id, email, eng.password_hash, role, eng.company_id, eng.department_id, teamId, opts.active ?? true]);
    await c.query(`INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id) VALUES ($1, $2, $3, $4, 'team', $5)`,
      [`${id}-ra`, eng.company_id, id, role, teamId]);
  });
  return { id, email, password: 'demo123' };
}

export async function deleteFixtureUser(id: string | undefined): Promise<void> {
  if (!id) return;
  await withDb(async (c) => {
    await c.query('DELETE FROM role_assignments WHERE user_id = $1', [id]);
    await c.query('DELETE FROM users WHERE id = $1', [id]);
  });
}
