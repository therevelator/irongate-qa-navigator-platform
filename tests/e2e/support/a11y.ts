import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';

/**
 * Accessibility smoke check (axe-core, WCAG 2.1 A/AA rules). Serious and critical violations fail
 * the test, except the rule ids listed in `known` for this page: those are tracked in
 * docs/testing/E2E_FLOWS.md ("Known accessibility issues") and reported as annotations, so they
 * stay visible in the report instead of being silently ignored. A known id that no longer occurs
 * fails too, so the list is kept up to date.
 */
export async function checkA11y(page: Page, testInfo: TestInfo, opts: { known?: string[]; include?: string; exclude?: string[] } = {}): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (opts.include) builder = builder.include(opts.include);
  for (const sel of opts.exclude ?? []) builder = builder.exclude(sel);
  const results = await builder.analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const known = new Set(opts.known ?? []);
  const unexpected = serious.filter((v) => !known.has(v.id));
  for (const v of serious.filter((x) => known.has(x.id))) {
    testInfo.annotations.push({ type: 'known a11y issue', description: `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} element(s)` });
  }
  const summary = unexpected.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n  ')}`);
  expect(summary, 'serious or critical accessibility violations').toEqual([]);
  const stillThere = new Set(serious.map((v) => v.id));
  const fixed = [...known].filter((id) => !stillThere.has(id));
  expect(fixed, 'known accessibility issues that are fixed now: remove them from the known list and the inventory').toEqual([]);
}
