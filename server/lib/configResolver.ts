import { query, queryOne } from '../../src/lib/db';

/**
 * The one config-inheritance rule, used by every reader of the `configs` table:
 * team value, else department value, else company value. The department is always the
 * team's own department (looked up here), never a value the client sends alongside.
 */
export interface ResolvedConfig {
  value: string;
  scope: 'team' | 'department' | 'company';
  updatedAt: string | null;
}

/** Keys whose values are credentials. They are never returned to the browser. */
export const SECRET_CONFIG_KEY = /(password|token|secret|api_key|apikey)/i;
export const isSecretConfigKey = (key: string) => SECRET_CONFIG_KEY.test(key);

export async function resolveConfigs(
  companyId: string,
  scope: { teamId?: string | null; departmentId?: string | null } = {}
): Promise<Record<string, ResolvedConfig>> {
  let teamId: string | null = scope.teamId && scope.teamId !== 'all' ? scope.teamId : null;
  let departmentId: string | null = scope.departmentId && scope.departmentId !== 'all' ? scope.departmentId : null;

  if (teamId) {
    const team = await queryOne<{ department_id: string | null }>(
      'SELECT department_id FROM teams WHERE id = ? AND company_id = ?',
      [teamId, companyId]
    );
    if (!team) {
      teamId = null; // unknown / other tenant: fall back to company settings only
      departmentId = null;
    } else {
      departmentId = team.department_id;
    }
  }

  const rows = await query<any[]>(
    `SELECT config_key, config_value, department_id, team_id, updated_at
       FROM configs
      WHERE company_id = ?
        AND (
          (department_id IS NULL AND team_id IS NULL)
          OR (CAST(? AS TEXT) IS NOT NULL AND department_id = ? AND team_id IS NULL)
          OR (CAST(? AS TEXT) IS NOT NULL AND team_id = ?)
        )`,
    [companyId, departmentId, departmentId, teamId, teamId]
  );

  const rank = (r: any) => (r.team_id ? 2 : r.department_id ? 1 : 0);
  rows.sort((a, b) => rank(a) - rank(b));

  const merged: Record<string, ResolvedConfig> = {};
  for (const r of rows) {
    merged[r.config_key] = {
      value: r.config_value,
      scope: r.team_id ? 'team' : r.department_id ? 'department' : 'company',
      updatedAt: r.updated_at ?? null,
    };
  }
  return merged;
}
