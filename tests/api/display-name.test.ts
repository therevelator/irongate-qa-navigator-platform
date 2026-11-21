/**
 * Output escaping and name validation (stored XSS through names, see SECURITY.md "Input handling").
 * Pure unit tests: no backend, no database.
 *
 *   DN-001 escapeHtml escapes & < > " ' and leaves everything else alone
 *   DN-002 an escaped payload cannot open a tag or break out of a quoted attribute
 *   DN-003 validateDisplayName accepts real names (apostrophes, hyphens, &, accents, other scripts)
 *   DN-004 validateDisplayName trims and enforces 1–100 characters
 *   DN-005 validateDisplayName refuses < and > (HTML payloads)
 *   DN-006 validateDisplayName refuses control characters and line separators
 *   DN-007 normaliseDisplayName (SSO) strips markup characters and control characters instead of refusing
 *   DN-008 escapeSlack escapes the Slack mrkdwn control characters (& < >)
 *   DN-009 every name the "Demo Data" generator can produce passes validateDisplayName
 */
import { escapeHtml } from '../../src/lib/escapeHtml';
import { validateDisplayName, normaliseDisplayName, DISPLAY_NAME_MAX } from '../../server/lib/displayName';
import { escapeSlack } from '../../server/lib/notifications';
import { planOrg, DEPARTMENTS, SIZE_LIMITS } from '../../server/seeds/demoOrg';

const PAYLOADS = [
  '<img src=x onerror="window.__xss=1">',
  '<script>window.__xss=1</script>',
  '"><svg onload=alert(1)>',
  "'><iframe src=javascript:alert(1)>",
  '<b>Bold</b>',
];

describe('escapeHtml', () => {
  test('DN-001 escapes & < > " \' and leaves everything else alone', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
    expect(escapeHtml("O'Brien & Zoë 李")).toBe('O&#39;Brien &amp; Zoë 李');
    expect(escapeHtml('plain text 123')).toBe('plain text 123');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
    // Already-escaped text is escaped again (shown literally), never decoded.
    expect(escapeHtml('&lt;b&gt;')).toBe('&amp;lt;b&amp;gt;');
  });

  test('DN-002 an escaped payload cannot open a tag or break out of a quoted attribute', () => {
    for (const p of PAYLOADS) {
      const out = escapeHtml(p);
      expect(out).not.toMatch(/[<>"']/);
      expect(`<strong>${out}</strong>`.match(/</g)).toHaveLength(2);
    }
  });
});

describe('validateDisplayName', () => {
  test('DN-003 accepts real names', () => {
    for (const n of ["O'Brien", 'Anne-Marie', 'R&D', 'José Álvarez', 'Zoë', '李小龍', 'Ленин', 'Nguyễn', 'Quality Cowboys', 'Payments (EU)', 'Team #1', 'A']) {
      expect(validateDisplayName(n)).toEqual({ ok: true, value: n });
    }
  });

  test('DN-004 trims and enforces 1–100 characters', () => {
    expect(validateDisplayName('  Ada  ')).toEqual({ ok: true, value: 'Ada' });
    expect(validateDisplayName('')).toEqual({ ok: false, error: 'Name is required' });
    expect(validateDisplayName('   ', 'First name')).toEqual({ ok: false, error: 'First name is required' });
    expect(validateDisplayName(undefined, 'Team name')).toEqual({ ok: false, error: 'Team name is required' });
    expect(validateDisplayName(123 as unknown)).toMatchObject({ ok: false });
    expect(validateDisplayName({ toString: () => 'x' } as unknown)).toMatchObject({ ok: false });
    expect(validateDisplayName('a'.repeat(DISPLAY_NAME_MAX))).toMatchObject({ ok: true });
    expect(validateDisplayName('a'.repeat(DISPLAY_NAME_MAX + 1), 'Last name')).toEqual({ ok: false, error: 'Last name must be at most 100 characters' });
    expect(validateDisplayName('a'.repeat(120), 'Job title', 120)).toMatchObject({ ok: true });
  });

  test('DN-005 refuses < and >', () => {
    for (const p of [...PAYLOADS, 'a < b', 'a > b', '<', '>']) {
      expect(validateDisplayName(p, 'First name')).toEqual({ ok: false, error: 'First name cannot contain < or >' });
    }
  });

  test('DN-006 refuses control characters and line separators', () => {
    for (const c of ['\u0000', '\u0007', '\n', '\r', '\t', '\u001b', '\u007f', '\u0085', '\u009f', ' ', ' ']) {
      expect(validateDisplayName(`Ada${c}Lovelace`)).toEqual({ ok: false, error: 'Name cannot contain control characters or line breaks' });
    }
  });
});

describe('normaliseDisplayName (names from an identity provider)', () => {
  test('DN-007 strips markup and control characters instead of refusing', () => {
    expect(normaliseDisplayName('<img src=x onerror=alert(1)>Ada')).toBe('img src=x onerror=alert(1)Ada');
    expect(normaliseDisplayName('Ada\n\tLovelace\u0007')).toBe('Ada Lovelace');
    expect(normaliseDisplayName('  José  ')).toBe('José');
    expect(normaliseDisplayName('<>')).toBe('');
    expect(normaliseDisplayName(null)).toBe('');
    expect(normaliseDisplayName('x'.repeat(300))).toHaveLength(100);
    for (const p of PAYLOADS) expect(validateDisplayName(normaliseDisplayName(p)).ok).toBe(true);
  });
});

describe('escapeSlack', () => {
  test('DN-008 escapes & < > for Slack mrkdwn', () => {
    expect(escapeSlack('<!channel> R&D <https://evil.example|Click>')).toBe('&lt;!channel&gt; R&amp;D &lt;https://evil.example|Click&gt;');
    expect(escapeSlack('Checkout *critical*')).toBe('Checkout *critical*');
    expect(escapeSlack(undefined)).toBe('');
  });
});

describe('Demo data names', () => {
  test('DN-009 every name the Demo Data generator can produce passes validateDisplayName', () => {
    for (const d of DEPARTMENTS) {
      expect(validateDisplayName(d.name)).toMatchObject({ ok: true });
      for (const [team] of d.teams) expect(validateDisplayName(team)).toMatchObject({ ok: true });
    }
    let n = 0;
    const plan = planOrg(
      { departments: SIZE_LIMITS.departments[1], teamsPerDepartment: SIZE_LIMITS.teamsPerDepartment[1], membersPerTeam: SIZE_LIMITS.membersPerTeam[1] },
      { domain: 'dn.test', takenDepts: new Set(), takenTeams: new Set(), takenEmails: new Set(), newId: () => `id-${n++}` },
    );
    const names = [...plan.departments.map((d) => d.name), ...plan.teams.map((t) => t.name), ...plan.people.flatMap((p) => [p.first, p.last])];
    expect(names.length).toBeGreaterThan(100);
    const bad = names.filter((x) => !validateDisplayName(x).ok);
    expect(bad).toEqual([]);
  });
});
