import { test, expect, TAG } from '../support/fixtures';
import { checkA11y } from '../support/a11y';
import { DEMO } from '../support/roles';
import { API_URL } from '../support/env';
import type { Page } from '@playwright/test';

/**
 * Appearance menu in the top bar (src/components/HeaderParts.tsx AppearanceMenu,
 * src/contexts/ThemeContext.tsx, src/lib/appearance.ts): the theme (Light, Dark, Graphite,
 * Porcelain, Match system), the score display (Battery or Gauge, src/components/ScoreVisual.tsx) and
 * its depth (3D or flat 2D), and the battery style (Cell, the default: src/components/CellBattery.tsx;
 * Liquid: the original HeroBattery). All are kept in the browser and applied before the first paint
 * (index.html).
 */

const htmlState = (page: Page) => page.evaluate(() => ({
  theme: document.documentElement.getAttribute('data-theme'),
  dark: document.documentElement.classList.contains('dark'),
  display: document.documentElement.getAttribute('data-score-display'),
}));
const styleOnHtml = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-battery-style'));
const BAND = (v: number) => (v < 30 ? 'red' : v < 45 ? 'deepAmber' : v < 60 ? 'amber' : v < 75 ? 'yellow' : v < 90 ? 'lightGreen' : 'green');
/** Cell charge in % of the body's inside (src/lib/cellBattery.ts): 0–100 → 11–90. */
const cellCharge = (v: number) => 11 + (Math.max(0, Math.min(100, v)) / 100) * 79;
const depthOnHtml = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-score-depth'));

/**
 * Depth effects drawn by a score visual (battery or gauge) and everything inside it: CSS gradients
 * other than hard two-colour stops, box shadows, drop-shadow / SVG filters, SVG gradients, highlight
 * strokes in white. Empty for a flat (2D) visual.
 */
const depthEffects = (page: Page, selector: string) => page.locator(selector).first().evaluate((root) => {
  const found: string[] = [];
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    const cs = getComputedStyle(el);
    if (cs.boxShadow && cs.boxShadow !== 'none') found.push(`box-shadow on ${el.tagName}`);
    if (cs.filter && cs.filter !== 'none') found.push(`filter on ${el.tagName}`);
    const bg = cs.backgroundImage;
    if (bg && bg !== 'none') {
      // A flat fill is drawn as a gradient with hard stops between at most two colours.
      const colours = new Set((bg.match(/rgba?\([^)]*\)/g) ?? []).map((c) => c.replace(/\s/g, '')));
      if (colours.size > 2 || (bg.match(/linear-gradient/g) ?? []).length > 1) found.push(`gradient on ${el.tagName}`);
    }
    if (el.tagName.toLowerCase() === 'filter' || el.tagName.toLowerCase() === 'lineargradient' || el.tagName.toLowerCase() === 'radialgradient') found.push(el.tagName);
    if (el.getAttribute('filter')) found.push(`filter attr on ${el.tagName}`);
    if ((el.getAttribute('stroke') ?? '').toLowerCase() === '#ffffff') found.push('white highlight stroke');
    const st = el.getAttribute('stroke') ?? '';
    if (st.startsWith('url(')) found.push('gradient stroke');
  }
  return found;
});

/** The colour of the charge / value arc, so 3D and 2D can be compared (same band, same colour). */
const bandOf = (page: Page, selector: string) => page.locator(selector).first().getAttribute('data-battery-band');

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
    // End jumps to the last item (2D, in the Depth group); four up (past 3D, Cell, Liquid) is Gauge.
    await page.keyboard.press('End');
    await expect(app.appearanceMenu.getByRole('menuitemradio', { name: /^2D/ })).toBeFocused();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowUp');
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

test.describe('Appearance: 3D / 2D', { tag: [TAG.area('ux')] }, () => {
  test('APR-06 keyboard: the Depth group (3D / 2D) flattens the battery and the gauge everywhere, keeps the colours, and the choice survives a reload', { tag: [TAG.smoke] }, async ({ signInAs, page, app }) => {
    await signInAs('viewer');
    expect(await depthOnHtml(page)).toBe('3d');
    const hero = '[data-testid="dashboard"] [role="img"][data-score-depth]';
    await expect(page.locator(hero).first()).toHaveAttribute('data-score-depth', '3d');
    expect((await depthEffects(page, hero)).length).toBeGreaterThan(0);
    const band3d = await bandOf(page, hero);

    // The menu: a labelled group of two radios, 3D chosen; arrows and Space choose 2D.
    await app.openAppearance();
    const group = app.appearanceMenu.getByRole('group', { name: 'Depth' });
    await expect(group.getByRole('menuitemradio')).toHaveCount(2);
    await expect(group.getByRole('menuitemradio', { name: /^3D/ })).toHaveAttribute('aria-checked', 'true');
    await expect(group.getByRole('menuitemradio', { name: /^2D/ })).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('End');
    await expect(group.getByRole('menuitemradio', { name: /^2D/ })).toBeFocused();
    await page.keyboard.press('Space');
    await expect(group.getByRole('menuitemradio', { name: /^2D/ })).toHaveAttribute('aria-checked', 'true');
    await expect(group.getByRole('menuitemradio', { name: /^3D/ })).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');
    await expect(app.appearanceButton).toBeFocused();
    expect(await depthOnHtml(page)).toBe('2d');
    expect(await page.evaluate(() => localStorage.getItem('irongate_score_depth'))).toBe('2d');

    // Battery on the overview: flat, same band (colour) as in 3D; every score visual on the page is flat.
    await expect(page.locator(hero).first()).toHaveAttribute('data-score-depth', '2d');
    expect(await depthEffects(page, hero)).toEqual([]);
    expect(await bandOf(page, hero)).toBe(band3d);
    await expect(page.locator('[data-score-depth="3d"]')).toHaveCount(0);

    // Gauge: flat too (no gradient, highlight, bevel or shadow filter), the value arc in the band's flat colour.
    await app.setScoreDisplay('Gauge');
    const gauge = page.getByTestId('score-gauge').first();
    await expect(gauge).toHaveAttribute('data-score-depth', '2d');
    expect(await depthEffects(page, '[data-testid="score-gauge"]')).toEqual([]);
    const arc = gauge.getByTestId('score-gauge-value');
    if (await arc.count()) expect(await arc.getAttribute('stroke')).toBe(await arc.getAttribute('data-color'));

    // Applied before the first paint, and on Team detail.
    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(await depthOnHtml(page)).toBe('2d');
    await openTeam(page);
    await expect(page.getByTestId('team-qa-card').getByRole('img', { name: /^QA score:/ })).toHaveAttribute('data-score-depth', '2d');
    await app.setScoreDisplay('Battery');
    await expect(page.getByTestId('team-qa-card').getByRole('img', { name: /^QA score:/ })).toHaveAttribute('data-score-depth', '2d');
    expect(await depthEffects(page, '[data-testid="team-qa-card"] [role="img"][data-score-depth]')).toEqual([]);

    // Executive summary and TV mode follow it too.
    await page.goto('/summary');
    await expect(page.locator('[role="img"][data-score-depth]').first()).toHaveAttribute('data-score-depth', '2d');
    await page.goto(`/tv?team=${encodeURIComponent(DEMO.leadTeam.id)}&theme=light`);
    await expect(page.getByTestId('tv-battery').getByRole('img')).toHaveAttribute('data-score-depth', '2d');
    await page.keyboard.press('Escape');

    // Back to 3D: the effects return.
    await page.goto('/');
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await app.setScoreDepth('3D');
    expect(await depthOnHtml(page)).toBe('3d');
    await expect(page.locator(hero).first()).toHaveAttribute('data-score-depth', '3d');
    expect((await depthEffects(page, hero)).length).toBeGreaterThan(0);
    await page.evaluate(() => { localStorage.removeItem('irongate_score_depth'); localStorage.removeItem('irongate_score_display'); });
  });
});

test.describe('Appearance: battery style', { tag: [TAG.area('ux')] }, () => {
  test('APR-07 Cell is the default battery; Liquid, Cell and Gauge switch from the menu, with 3D / 2D, and survive a reload', { tag: [TAG.smoke] }, async ({ signInAs, page, app }) => {
    await signInAs('viewer');
    expect(await styleOnHtml(page)).toBe('cell');
    const hero = page.locator('[data-testid="dashboard"] [role="img"][data-battery-band]').first();
    await expect(hero).toHaveAttribute('data-battery-style', 'cell');
    await expect(hero).toHaveAttribute('aria-label', /: (\d+ of 100|no data)$/);
    // Capture the text alternatives only once the dashboard has finished loading: the hero reads
    // "no data" while the summary is still on its way, and team cards render as data arrives.
    await page.waitForLoadState('networkidle');
    const batteries = page.locator('[data-testid="dashboard"] [role="img"][data-battery-band]');
    const labels = await batteries.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    const label = labels[0];

    await app.openAppearance();
    const group = app.appearanceMenu.getByRole('group', { name: 'Battery style' });
    await expect(group.getByRole('menuitemradio')).toHaveCount(2);
    await expect(group.getByRole('menuitemradio', { name: /^Cell/ })).toHaveAttribute('aria-checked', 'true');
    await group.getByRole('menuitemradio', { name: /^Liquid/ }).click();
    await expect(group.getByRole('menuitemradio', { name: /^Liquid/ })).toHaveAttribute('aria-checked', 'true');
    await app.closeAppearance();
    expect(await styleOnHtml(page)).toBe('liquid');
    // Liquid: the original battery, same text alternative and band.
    await expect(hero).not.toHaveAttribute('data-battery-style', 'cell');
    await expect(page.locator('[data-battery-style="cell"]')).toHaveCount(0);
    await expect(hero).toHaveAttribute('aria-label', label!);
    expect(await batteries.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(labels);

    // 2D with Liquid, then reload: both kept.
    await app.setScoreDepth('2D');
    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(await page.evaluate(() => [document.documentElement.getAttribute('data-battery-style'), document.documentElement.getAttribute('data-score-depth')])).toEqual(['liquid', '2d']);
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await expect(hero).toHaveAttribute('data-score-depth', '2d');
    await expect(page.locator('[data-battery-style="cell"]')).toHaveCount(0);

    // Gauge stays its own choice; the battery style is kept for when Battery comes back.
    await app.setScoreDisplay('Gauge');
    await expect(page.getByTestId('score-gauge').first()).toHaveAttribute('data-score-depth', '2d');
    await app.setScoreDisplay('Battery');
    await app.setBatteryStyle('Cell');
    await expect(hero).toHaveAttribute('data-battery-style', 'cell');
    await expect(hero).toHaveAttribute('data-score-depth', '2d');
    await app.setScoreDepth('3D');
    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(await page.evaluate(() => [document.documentElement.getAttribute('data-battery-style'), document.documentElement.getAttribute('data-score-depth')])).toEqual(['cell', '3d']);
    await expect(hero).toHaveAttribute('data-score-depth', '3d');
    await page.evaluate(() => { localStorage.removeItem('irongate_battery_style'); localStorage.removeItem('irongate_score_depth'); localStorage.removeItem('irongate_score_display'); });
  });

  test('APR-08 Cell fill and colour follow the value (10, 45, 81, 100; band edges 29/30 and 89/90), in 3D and 2D, vertical and horizontal', async ({ signInAs, page, app }) => {
    const values = [10, 45, 81, 100, 29, 30, 89, 90];
    await page.route(`${API_URL}/teams`, async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      body.teams = body.teams.map((t: any, i: number) => (i < values.length ? { ...t, qaScore: values[i] } : t));
      await route.fulfill({ response: res, json: body });
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAs('admin');
    await expect(page.getByTestId('team-card').first()).toBeVisible();
    const measure = () => page.locator('[data-testid="team-card"] [data-battery-style="cell"]').evaluateAll((els) => els.map((el) => {
      const value = Number((el.getAttribute('aria-label') ?? '').match(/: (\d+) of 100$/)?.[1] ?? NaN);
      const body = el.querySelector('[data-testid="cell-body"]')!.getBoundingClientRect();
      const fill = el.querySelector('[data-testid="cell-fill"]')?.getBoundingClientRect();
      const vertical = body.height > body.width;
      const len = vertical ? body.height : body.width;
      const edge = Math.max(1, (2 * len) / 250);
      const end = !fill ? null : vertical ? body.bottom - fill.top : fill.right - body.left;
      return { value, band: el.getAttribute('data-battery-band'), vertical, at: end == null ? null : ((end - edge) / (len - 2 * edge)) * 100 };
    }));
    for (const depth of ['3D', '2D'] as const) {
      if (depth === '2D') await app.setScoreDepth('2D');
      const cells = await measure();
      for (const v of values) {
        const c = cells.find((x) => x.value === v);
        expect(c, `a team card with QA ${v}`).toBeTruthy();
        expect([v, c!.band]).toEqual([v, BAND(v)]);
        expect(c!.vertical).toBe(true);
        expect(Math.abs(c!.at! - cellCharge(v)), `fill end of ${v} (${depth}): ${c!.at} vs ${cellCharge(v)}`).toBeLessThan(1);
      }
    }
    // Horizontal on Team detail, same mapping.
    await page.getByLabel('Search teams').fill(DEMO.leadTeam.name);
    await page.getByTestId('team-card').filter({ hasText: DEMO.leadTeam.name }).first().click();
    const qa = page.getByTestId('team-qa-card').getByRole('img', { name: /^QA score:/ });
    await expect(qa).toHaveAttribute('data-battery-style', 'cell');
    const h = await qa.evaluate((el) => {
      const value = Number((el.getAttribute('aria-label') ?? '').match(/: (\d+) of 100$/)?.[1] ?? NaN);
      const body = el.querySelector('[data-testid="cell-body"]')!.getBoundingClientRect();
      const fill = el.querySelector('[data-testid="cell-fill"]')?.getBoundingClientRect();
      const edge = Math.max(1, (2 * body.width) / 250);
      return { value, wide: body.width > body.height, at: fill ? ((fill.right - body.left - edge) / (body.width - 2 * edge)) * 100 : null };
    });
    expect(h.wide).toBe(true);
    if (!Number.isNaN(h.value)) expect(Math.abs(h.at! - cellCharge(h.value))).toBeLessThan(1);
    await page.evaluate(() => localStorage.removeItem('irongate_score_depth'));
  });
});

/**
 * Top light on the Overview's Company status card (src/styles/top-light.css): a lit rim on the top
 * and side edges plus a haze, in the hero battery's band colour; no light without a score; the flat
 * 2D appearance keeps the rim only.
 */
test.describe('Appearance: top light', { tag: [TAG.area('ux')] }, () => {
  const BAND_RGB: Record<string, string> = { red: '224, 57, 47', deepAmber: '234, 108, 18', amber: '245, 160, 14', yellow: '236, 208, 34', lightGreen: '147, 209, 85', green: '39, 172, 79' };

  test('APR-09 the Company status card is lit in its battery band colour, follows the score (94, 52, 24), has no light without a score, and keeps only the rim in 2D', async ({ signInAs, page, app }) => {
    let score: number | null = 94;
    await page.route(`${API_URL}/analytics/company-summary*`, async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      const o = body.data && 'globalQaScore' in body.data ? body.data : body;
      o.globalQaScore = score;
      await route.fulfill({ response: res, json: body });
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAs('admin');
    const hero = page.getByTestId('company-hero');
    const light = () => hero.evaluate((el) => {
      const rim = getComputedStyle(el, '::after');
      const haze = getComputedStyle(el, '::before');
      return {
        band: el.getAttribute('data-top-light'),
        battery: el.querySelector('[data-battery-band]')?.getAttribute('data-battery-band') ?? null,
        rim: rim.content === 'none' ? null : rim.backgroundImage,
        rimEvents: rim.pointerEvents,
        haze: haze.content === 'none' ? null : haze.backgroundImage,
        hazeEvents: haze.pointerEvents,
        title: getComputedStyle(el.querySelector('[data-testid="hero-title"]')!).color,
      };
    });

    let titleColour = '';
    for (const [v, band] of [[94, 'green'], [52, 'amber'], [24, 'red']] as const) {
      score = v;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(hero).toHaveAttribute('data-top-light', band);
      const l = await light();
      expect(l.battery, `battery band at QA ${v}`).toBe(band);
      expect(l.rim, `rim at QA ${v}`).toContain(`rgba(${BAND_RGB[band]}`);
      expect(l.haze, `haze at QA ${v}`).toContain(`rgba(${BAND_RGB[band]}`);
      // The rim lights the top and fades out going down: no colour at the bottom of the card.
      expect(l.rim).toMatch(/transparent|rgba\(0, 0, 0, 0\)/);
      expect([l.rimEvents, l.hazeEvents]).toEqual(['none', 'none']);
      if (!titleColour) titleColour = l.title;
      expect(l.title, 'the light never tints the text').toBe(titleColour);
    }

    // No score: no light, like the battery's empty shell.
    score = null;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(hero.locator('[data-battery-band]').first()).toHaveAttribute('data-battery-band', 'none');
    await expect(hero).toHaveAttribute('data-top-light', 'none');
    const none = await light();
    expect([none.rim, none.haze]).toEqual([null, null]);
    expect(await hero.evaluate((el) => el.classList.contains('top-light'))).toBe(false);

    // Flat 2D: the rim stays (band colour), the haze goes.
    score = 52;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(hero).toHaveAttribute('data-top-light', 'amber');
    await app.setScoreDepth('2D');
    const flat = await light();
    expect(flat.rim).toContain(`rgba(${BAND_RGB.amber}`);
    expect(flat.haze).toBeNull();
    await app.setScoreDepth('3D');
    expect((await light()).haze).toContain(`rgba(${BAND_RGB.amber}`);
    await page.evaluate(() => localStorage.removeItem('irongate_score_depth'));
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

  const flatCases = [
    { id: 'A11Y-50', theme: 'Light', display: 'Battery' },
    { id: 'A11Y-51', theme: 'Dark', display: 'Gauge' },
    { id: 'A11Y-52', theme: 'Graphite', display: 'Gauge' },
    { id: 'A11Y-53', theme: 'Porcelain', display: 'Battery' },
  ] as const;
  for (const c of flatCases) {
    test(`${c.id} ${c.theme} theme, 2D ${c.display}: the Appearance menu, overview and team detail have no serious violations`, async ({ signInAs, page, app }, testInfo) => {
      await signInAs('admin');
      await app.setTheme(c.theme);
      await app.setScoreDisplay(c.display);
      await app.setScoreDepth('2D');
      await app.openAppearance();
      await checkA11y(page, testInfo, { known: [], include: '[data-testid="appearance-menu"]' });
      await app.closeAppearance();
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await checkA11y(page, testInfo, { known: [] });
      await openTeam(page);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await checkA11y(page, testInfo, { known: [] });
      await page.evaluate(() => { localStorage.removeItem('irongate_score_depth'); localStorage.removeItem('irongate_score_display'); localStorage.removeItem('irongate_theme_mode'); });
    });
  }

  const cellCases = [
    { id: 'A11Y-54', theme: 'Light', depth: '3D' },
    { id: 'A11Y-55', theme: 'Dark', depth: '2D' },
    { id: 'A11Y-56', theme: 'Graphite', depth: '3D' },
    { id: 'A11Y-57', theme: 'Porcelain', depth: '2D' },
  ] as const;
  for (const c of cellCases) {
    test(`${c.id} ${c.theme} theme, Cell battery (${c.depth}): the Appearance menu, overview, team detail and TV mode have no serious violations`, async ({ signInAs, page, app }, testInfo) => {
      await signInAs('admin');
      await app.setTheme(c.theme);
      await app.setBatteryStyle('Cell');
      await app.setScoreDepth(c.depth);
      await app.openAppearance();
      await checkA11y(page, testInfo, { known: [], include: '[data-testid="appearance-menu"]' });
      await app.closeAppearance();
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await checkA11y(page, testInfo, { known: [] });
      await openTeam(page);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await checkA11y(page, testInfo, { known: [] });
      await page.goto(`/tv?team=${encodeURIComponent(DEMO.leadTeam.id)}&theme=${c.theme.toLowerCase()}`);
      await expect(page.getByTestId('tv-battery').getByRole('img')).toHaveAttribute('data-battery-style', 'cell');
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await checkA11y(page, testInfo, { known: [] });
      await page.evaluate(() => { localStorage.removeItem('irongate_score_depth'); localStorage.removeItem('irongate_battery_style'); localStorage.removeItem('irongate_theme_mode'); localStorage.removeItem('irongate_tv_theme'); });
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
