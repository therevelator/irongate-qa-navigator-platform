import fs from 'fs';
import path from 'path';
import { ROLE_LABELS, ROLE_LABELS_PLURAL, roleLabel } from '../../server/lib/roleLabels';
import { ROLE_NAMES } from '../../server/lib/invitations';
import { ROLE_LABEL } from '../../server/lib/roleAssignment';
import { ROLES } from '../../server/lib/userPolicy';

/**
 * Role display names ("quality is a shared responsibility"): one map, server/lib/roleLabels.ts.
 * Keys stay qa_manager / qa_engineer; labels are Manager and Software engineer.
 *   LBL-001  the map covers every role with the agreed names; other maps are the same object
 *   LBL-002  no "QA engineer" / "QA manager" / "QA lead(er)" / "QA team" text left in the app or in
 *            server-written messages, outside comments (one documented exception below)
 */

describe('Role labels', () => {
  test('LBL-001 one map with the agreed names', () => {
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...ROLES].sort());
    expect(ROLE_LABELS).toEqual({ super_admin: 'Super admin', qa_manager: 'Manager', team_lead: 'Team lead', qa_engineer: 'Software engineer', viewer: 'Viewer' });
    expect(ROLE_LABELS_PLURAL.qa_engineer).toBe('Software engineers');
    expect(roleLabel('qa_manager')).toBe('Manager');
    expect(roleLabel('unknown_role')).toBe('unknown_role');
    expect(ROLE_NAMES).toBe(ROLE_LABELS);
    expect(ROLE_LABEL).toBe(ROLE_LABELS);
  });

  test('LBL-002 no QA-silo role wording outside comments in src/ and server/', () => {
    const root = path.resolve(__dirname, '../..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!['node_modules', 'seeds', 'migrations'].includes(e.name)) walk(p); }
        else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
      }
    };
    walk(path.join(root, 'src'));
    walk(path.join(root, 'server'));
    // Golden-tested text (tests/api/golden): the developer aggregate basis keeps its wording.
    const allowed = [/Team figures are means over the team’s developers \(QA engineers and team leads/];
    const bad: string[] = [];
    for (const f of files) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('{/*')) return;
        if (/\bQA (engineers?|managers?|leads?|leaders?|teams?)\b/i.test(line) && !allowed.some((a) => a.test(line))) bad.push(`${path.relative(root, f)}:${i + 1}: ${t.slice(0, 120)}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
