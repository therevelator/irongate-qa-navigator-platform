import { test, expect, TAG } from '../support/fixtures';
import { checkA11y } from '../support/a11y';
import { DEMO } from '../support/roles';
import type { Page } from '@playwright/test';

/**
 * Appearance menu in the top bar (src/components/HeaderParts.tsx AppearanceMenu,
 * src/contexts/ThemeContext.tsx, src/lib/appearance.ts): the theme (Light, Dark, Graphite,
 * Porcelain, Match system) and the score display (Battery or Gauge, src/components/ScoreVisual.tsx).
 * Both are kept in the browser and applied before the first paint (index.html).
 */

const htmlState = (page: Page) => page.evaluate(() => ({
  theme: document.documentElement.getAttribute('data-theme'),
  dark: document.documentElement.classList.contains('dark'),
  display: document.documentElement.getAttribute('data-score-display'),
}));

async function openTeam(page: Page) {
  await page.getByLabel('Search teams').fill(DEMO.leadTeam.name);
  await page.getByTestId('team-card').filter({ hasText: DEMO.leadTeam.name }).first().click();
  await expect(page.getByTestId('team-detail')).toBeVisible();
}

test.describe('Appearance', { tag: [TAG.area('ux')] }, () => {
  test('APR-01 keyboard: open the menu, choose Graphite and Gauge; the choice survives a reload; the sign-in screen stays classic and the choice returns after signing in again', { tag: [TAG.smoke] }, async ({ signInAs, page, app }) => {
    await signInAs('viewer');
    expect(await htmlState(page)).toEqual({ theme: 'light', dark: false, display: 'battery' });

    await app.appearanceButton.focus();
    await page.keyboard.press('Enter');
    await expect(app.appearanceMenu).toBeVisible();
    await expect(app.appearanceButton).toHaveAttribute('aria-expanded', 'true');
    // Focus starts on the current theme (Light); two steps down is Graphite.
    await expect(app.appearanceMenu.getByRole('menuitemradio', { name: /^Light/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(app.appearanceMenu.getByRole('menuitemradio', { name: /^Graphite/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => htmlState(page)).toEqual({ theme: 'graphite', dark: true, display: 'battery' });
    await expect(app.appearanceMenu.getByRole('menuitemradio', { name: /^Graphite/ })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('End');
    await expect(app.appearanceMenu.getByRole('menuitemradio', { name: 'Gauge' })).toBeFocused();
    await page.keyboard.press('Space');
    await expect.poll(() => htmlState(page)).toEqual({ theme: 'graphite', dark: true, display: 'gauge' });
    await page.keyboard.press('Escape');
    await expect(app.appearanceMenu).toHaveCount(0);
    await expect(app.appearanceButton).toBeFocused();

    // Scores are gauges now, with the same text alternative and colour band as the battery.
    const gauge = page.getByTestId('score-gauge').first();
    await expect(gauge).toHaveAttribute('role', 'img');
    await expect(gauge).toHaveAttribute('aria-label', /: (\d+ of 100|no data)$/);
    await expect(gauge).toHaveAttribute('data-battery-band', /.+/);

    // Applied before the first paint: already on <html> when the document is parsed.
    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(await htmlState(page)).toEqual({ theme: 'graphite', dark: true, display: 'gauge' });
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await expect(page.getByTestId('score-gauge').first()).toBeVisible();

    // Signed out: the sign-in screen keeps the classic Light look (the choice is kept, not lost).
    await app.signOut();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect.poll(() => htmlState(page)).toMatchObject({ theme: 'light', dark: false });
    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(await htmlState(page)).toMatchObject({ theme: 'light', dark: false });
    expect(await page.evaluate(() => localStorage.getItem('irongate_theme_mode'))).toBe('graphite');
    // Signed in again: Graphite is back.
    await signInAs('viewer');
    await expect.poll(() => htmlState(page)).toEqual({ theme: 'graphite', dark: true, display: 'gauge' });
    await page.evaluate(() => { localStorage.removeItem('irongate_theme_mode'); localStorage.removeItem('irongate_score_display'); });
  });

  test('APR-02 every theme from the menu; Porcelain is light, the menu closes on a click outside', async ({ signInAs, page, app }) => {
    await signInAs('viewer');
    for (const [label, theme, dark] of [['Dark', 'dark', true], ['Porcelain', 'porcelain', false], ['Graphite', 'graphite', true], ['Light', 'light', false]] as const) {
      await app.setTheme(label);
      await expect.poll(() => htmlState(page)).toMatchObject({ theme, dark });
    }
    await app.openAppearance();
    await page.getByTestId('dashboard').click({ position: { x: 5, y: 5 } });
    await expect(app.appearanceMenu).toHaveCount(0);
  });

  test('APR-03 "Match system" follows the device setting once signed in; the sign-in screen stays Light', async ({ browser, signInAs, page }) => {
    for (const scheme of ['dark', 'light'] as const) {
      const ctx = await browser.newContext({ colorScheme: scheme });
      await ctx.addInitScript(() => localStorage.setItem('irongate_theme_mode', 'system'));
      const p = await ctx.newPage();
      await p.goto('/');
      await expect(p.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      expect(await htmlState(p)).toMatchObject({ theme: 'light', dark: false });
      await ctx.close();
    }
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(() => { try { if (!sessionStorage.getItem('apr03')) { localStorage.setItem('irongate_theme_mode', 'system'); sessionStorage.setItem('apr03', '1'); } } catch { /* ignore */ } });
    await signInAs('viewer');
    await expect.poll(() => htmlState(page)).toMatchObject({ theme: 'dark', dark: true });
    await page.evaluate(() => localStorage.removeItem('irongate_theme_mode'));
  });

  test('APR-04 the score display applies to team cards and Team detail too (Battery back again)', async ({ signInAs, page, app }) => {
    await signInAs('viewer');
    await app.setScoreDisplay('Gauge');
    const card = page.getByTestId('team-card').filter({ hasText: DEMO.leadTeam.name }).first();
    await expect(card.getByTestId('score-gauge')).toHaveAttribute('aria-label', new RegExp(`^${DEMO.leadTeam.name} QA score: `));
    await openTeam(page);
    const qa = page.getByTestId('team-qa-card').getByRole('img', { name: /^QA score:/ });
    await expect(qa).toHaveAttribute('data-score-visual', 'gauge');
    await app.setScoreDisplay('Battery');
    await expect(page.getByTestId('team-qa-card').getByTestId('score-gauge')).toHaveCount(0);
    await expect(page.getByTestId('team-qa-card').getByRole('img', { name: /^QA score:/ })).toBeVisible();
  });

  test('APR-05 TV mode keeps its light/dark switch inside the glass family and gives the app theme back on exit', async ({ signInAs, page, app }) => {
    await signInAs('viewer');
    await app.setTheme('Graphite');
    await page.goto(`/tv?team=${encodeURIComponent(DEMO.leadTeam.id)}&theme=dark`);
    await expect(page.getByTestId('tv-mode')).toBeVisible();
    await expect.poll(() => htmlState(page)).toMatchObject({ theme: 'graphite', dark: true });
    await page.mouse.move(400, 400);
    await page.getByTestId('tv-theme').click();
    await expect.poll(() => htmlState(page)).toMatchObject({ theme: 'porcelain', dark: false });
    await page.mouse.move(420, 420);
    await page.getByTestId('tv-exit').click();
    await expect(page.getByTestId('tv-mode')).toHaveCount(0);
    await expect.poll(() => htmlState(page)).toMatchObject({ theme: 'graphite', dark: true });
  });
});

test.describe('Appearance accessibility', { tag: [TAG.a11y, TAG.area('ux')] }, () => {
  const cases = [
    { id: 'A11Y-20', theme: 'Light', display: 'Gauge' },
    { id: 'A11Y-21', theme: 'Dark', display: 'Gauge' },
    { id: 'A11Y-22', theme: 'Graphite', display: 'Battery' },
    { id: 'A11Y-23', theme: 'Porcelain', display: 'Gauge' },
  ] as const;
  for (const c of cases) {
    test(`${c.id} ${c.theme} theme (${c.display}): overview and team detail have no serious violations`, async ({ signInAs, page, app }, testInfo) => {
      await signInAs('admin');
      await app.setTheme(c.theme);
      await app.setScoreDisplay(c.display);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await checkA11y(page, testInfo, { known: [] });
      await openTeam(page);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await checkA11y(page, testInfo, { known: [] });
    });
  }

  test('A11Y-24 with Graphite or Porcelain chosen, the sign-in screen keeps the classic Light look and passes', async ({ browser }, testInfo) => {
    for (const theme of ['graphite', 'porcelain']) {
      const ctx = await browser.newContext();
      await ctx.addInitScript((t) => localStorage.setItem('irongate_theme_mode', t), theme);
      const page = await ctx.newPage();
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      expect(await htmlState(page)).toMatchObject({ theme: 'light', dark: false });
      await checkA11y(page, testInfo, { known: [] });
      await ctx.close();
    }
  });
});
