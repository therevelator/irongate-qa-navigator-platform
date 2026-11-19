/**
 * Display names of the roles: the ONE place. Used by the UI, e-mails, CSV exports and every
 * server-written description (Activity, User activity, consequences in dialogs).
 *
 * The role KEYS stay as they are everywhere else (database, API, JWTs, integrations):
 * qa_manager and qa_engineer are only labelled "Manager" and "Software engineer". Quality is a
 * shared responsibility, so the names describe the person's job, not a QA silo.
 */
export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super admin',
  qa_manager: 'Manager',
  team_lead: 'Team lead',
  qa_engineer: 'Software engineer',
  viewer: 'Viewer',
};

/** Plural forms (lists of people). */
export const ROLE_LABELS_PLURAL: Record<string, string> = {
  super_admin: 'Super admins',
  qa_manager: 'Managers',
  team_lead: 'Team leads',
  qa_engineer: 'Software engineers',
  viewer: 'Viewers',
};

/** Where "Manager" alone is ambiguous (department pages, assignment dialogs). */
export const DEPARTMENT_MANAGER_LABEL = 'Department manager';

export const roleLabel = (role: string | null | undefined): string => (role ? ROLE_LABELS[role] ?? role : '');
