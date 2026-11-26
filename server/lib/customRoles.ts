/**
 * Custom roles (table custom_roles): a company's own roles.
 *
 * A custom role starts from one of the access levels (base_role) and adds or removes permissions from the level's
 * recommended set (CAPABILITIES / LEVEL_CAPABILITIES in server/lib/userPolicy.ts). The level decides what is not a
 * permission: on what the role is assigned (a department or a team), its rank, and who it may invite and manage.
 * ROLE_TEMPLATES are our recommended starting points; creating a role from one copies its permissions, which can
 * then be changed freely within what the level allows. Archiving a role leaves its people on the base level.
 */
import { query, queryOne } from '../../src/lib/db';
import { capabilitiesOf, editableCapabilities, isCapability, LEVEL_CAPABILITIES, type Capability } from './userPolicy';

export const CUSTOM_BASE_ROLES = ['qa_manager', 'team_lead', 'qa_engineer', 'viewer'] as const;
export type CustomBaseRole = (typeof CUSTOM_BASE_ROLES)[number];

export interface RoleTemplate { key: string; name: string; baseRole: CustomBaseRole; description: string; added: Capability[]; removed: Capability[] }

/** Recommended roles: a starting point, not a limit. */
export const ROLE_TEMPLATES: RoleTemplate[] = [
  { key: 'scrum_master', name: 'Scrum Master', baseRole: 'qa_engineer',
    description: 'Runs the team’s improvement loop: owns the action plan, acknowledges alerts and sends the wellbeing survey. Does not see individual developer metrics.',
    added: ['write_team_data', 'run_pulse', 'view_wellbeing_comments'], removed: [] },
  { key: 'product_owner', name: 'Product Owner', baseRole: 'viewer',
    description: 'Reads the team’s quality and delivery, and what quality costs in money. Changes nothing.',
    added: ['view_money'], removed: [] },
  { key: 'quality_lead', name: 'Quality Lead', baseRole: 'team_lead',
    description: 'Leads quality for the team: everything a team lead sees and does.',
    added: [], removed: [] },
  { key: 'devops_engineer', name: 'DevOps / Platform Engineer', baseRole: 'qa_engineer',
    description: 'Keeps the data flowing: uploads files, sets how often data is collected, acknowledges pipeline alerts and owns actions.',
    added: ['write_team_data'], removed: [] },
  { key: 'engineering_manager', name: 'Engineering Manager', baseRole: 'qa_manager',
    description: 'Looks after a department: its teams, people, targets and money.',
    added: [], removed: [] },
  { key: 'delivery_manager', name: 'Delivery Manager', baseRole: 'qa_manager',
    description: 'Follows delivery across a department without personal data: no individual developer metrics, no survey comments.',
    added: [], removed: ['view_individuals', 'view_wellbeing_comments'] },
  { key: 'executive_sponsor', name: 'Executive Sponsor', baseRole: 'viewer',
    description: 'Reads the teams they sponsor, with the money view. Give it on every team they should see.',
    added: ['view_money'], removed: [] },
];

export class RoleError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface RoleInput { name: string; description: string | null; baseRole: CustomBaseRole; added: Capability[]; removed: Capability[]; templateKey: string | null }

/** Validate a role sent by the form. Permissions outside what the level may change are refused, not dropped. */
export function cleanRole(body: any, existingBase?: string): RoleInput {
  const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > 60) throw new RoleError(400, 'The role needs a name of 2 to 60 characters');
  const description = typeof body?.description === 'string' && body.description.trim() ? body.description.trim().slice(0, 300) : null;
  const baseRole = (existingBase ?? body?.baseRole) as CustomBaseRole;
  if (!(CUSTOM_BASE_ROLES as readonly string[]).includes(baseRole)) throw new RoleError(400, `baseRole must be one of ${CUSTOM_BASE_ROLES.join(', ')}`);
  const list = (v: unknown, field: string): Capability[] => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) throw new RoleError(400, `${field} must be a list of permissions`);
    for (const c of v) if (!isCapability(c)) throw new RoleError(400, `Unknown permission "${String(c)}"`);
    return [...new Set(v as Capability[])];
  };
  const level = LEVEL_CAPABILITIES[baseRole] ?? [];
  const editable = editableCapabilities(baseRole);
  const added = list(body?.added, 'added').filter((c) => !level.includes(c));
  const removed = list(body?.removed, 'removed').filter((c) => level.includes(c));
  const outside = [...added, ...removed].filter((c) => !editable.includes(c));
  if (outside.length) throw new RoleError(400, `A role on this level cannot hold: ${outside.join(', ')} (it is for roles assigned on a department)`);
  return { name, description, baseRole, added, removed, templateKey: typeof body?.templateKey === 'string' ? body.templateKey.slice(0, 40) : null };
}

export interface RoleJson {
  id: string; name: string; description: string | null; baseRole: string; added: string[]; removed: string[];
  capabilities: Capability[]; templateKey: string | null; people: number; createdAt: string; updatedAt: string;
}

const json = (r: any): RoleJson => ({
  id: r.id, name: r.name, description: r.description ?? null, baseRole: r.base_role, added: r.added ?? [], removed: r.removed ?? [],
  capabilities: capabilitiesOf(r.base_role, r.added, r.removed), templateKey: r.template_key ?? null, people: Number(r.people ?? 0),
  createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
});

const ROLE_SELECT = `SELECT cr.*, (SELECT COUNT(DISTINCT ra.user_id) FROM role_assignments ra WHERE ra.custom_role_id = cr.id AND ra.revoked_at IS NULL) AS people FROM custom_roles cr`;

export async function listRoles(companyId: string): Promise<RoleJson[]> {
  const ok = await queryOne<any>(`SELECT to_regclass('public.custom_roles') IS NOT NULL AS ok`);
  if (!ok?.ok) return [];
  return (await query<any[]>(`${ROLE_SELECT} WHERE cr.company_id = ? AND cr.archived_at IS NULL ORDER BY lower(cr.name)`, [companyId])).map(json);
}

export async function getRole(companyId: string, id: string): Promise<RoleJson | null> {
  const r = await queryOne<any>(`${ROLE_SELECT} WHERE cr.company_id = ? AND cr.id = ? AND cr.archived_at IS NULL`, [companyId, id]);
  return r ? json(r) : null;
}

export async function createRole(companyId: string, actorId: string | null, input: RoleInput): Promise<RoleJson> {
  try {
    const r = await queryOne<any>(
      `INSERT INTO custom_roles (company_id, name, description, base_role, added, removed, template_key, created_by)
       VALUES (?, ?, ?, ?, ?::text[], ?::text[], ?, ?) RETURNING id`,
      [companyId, input.name, input.description, input.baseRole, input.added, input.removed, input.templateKey, actorId]);
    return (await getRole(companyId, r!.id))!;
  } catch (e: any) {
    if (e?.code === '23505') throw new RoleError(409, `A role named "${input.name}" already exists`);
    throw e;
  }
}

export async function updateRole(companyId: string, id: string, input: RoleInput): Promise<RoleJson> {
  try {
    await query(`UPDATE custom_roles SET name = ?, description = ?, added = ?::text[], removed = ?::text[], updated_at = now() WHERE id = ? AND company_id = ? AND archived_at IS NULL`,
      [input.name, input.description, input.added, input.removed, id, companyId]);
    return (await getRole(companyId, id))!;
  } catch (e: any) {
    if (e?.code === '23505') throw new RoleError(409, `A role named "${input.name}" already exists`);
    throw e;
  }
}

/** Archive: the role disappears from the lists; its people keep their assignments on the base level. */
export async function archiveRole(companyId: string, id: string): Promise<void> {
  await query(`UPDATE custom_roles SET archived_at = now(), updated_at = now() WHERE id = ? AND company_id = ? AND archived_at IS NULL`, [id, companyId]);
}
