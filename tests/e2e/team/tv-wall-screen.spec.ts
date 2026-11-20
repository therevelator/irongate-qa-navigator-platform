import { test, expect, TAG } from '../support/fixtures';
import { checkA11y } from '../support/a11y';
import { API_URL } from '../support/env';
import { DEMO } from '../support/roles';
import type { Page } from '@playwright/test';

/**
 * TV mode for a wall screen (src/components/TeamTvView.tsx): automatic rotation between the chosen
 * panels and then the teams in scope, the set-up dialog and its kiosk link, the alerts and wellbeing
 * panels, the four themes (with accessibility checks), recovery after a lost connection and the 4K
 * layout. The basic TV mode flows (open, exit, keys, scope, errors) are in team-detail-and-tv.spec.ts.
 */

const tv = (q: string) => `/tv?${q}`;
const panelShown = (page: Page) => page.locator('[data-testid^="tv-panel-"]').getAttribute('data-testid');

test.describe('TV mode on a wall screen', { tag: [TAG.area('tv')] }, () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('TVW-01 rotates through the chosen panels at the chosen interval, with a progress bar', { tag: [TAG.smoke, TAG.role('lead')] }, async ({ signInAs, page }) => {
    await signInAs('lead', tv(`team=${DEMO.leadTeam.id}&rotate=1&interval=5&panels=kpis,focus`));
    await expect(page.getByTestId('tv-panel-kpis')).toBeVisible();
    await expect(page.getByTestId('tv-rotation-progress')).toBeAttached();
    await expect(page.getByTestId('tv-refresh')).toContainText('panels rotate every 5 s');
    await expect(page.getByTestId('tv-panel-focus')).toBeVisible({ timeout: 9000 });
    await expect(page.getByTestId('tv-panel-kpis')).toBeVisible({ timeout: 9000 }); // Trends and Wellbeing are left out
    expect(await panelShown(page)).toBe('tv-panel-kpis');
  });

  test('TVW-02 rotates between the teams in scope after the last panel, loading the next team ahead', { tag: [TAG.role('admin')] }, async ({ signInAs, page }) => {
    await signInAs('admin', tv(`team=${DEMO.leadTeam.id}&rotate=1&interval=5&panels=kpis&teams=all`));
    const picker = (await (await page.request.get(`${API_URL}/tv/teams`)).json()).teams as { id: string; name: string }[];
    const i = picker.findIndex((t) => t.id === DEMO.leadTeam.id);
    const next = picker[(i + 1) % picker.length];
    await expect(page.getByTestId('tv-team-position')).toHaveText(`Team ${i + 1} of ${picker.length}`);
    await expect(page.getByTestId('tv-team-name')).toHaveText(next.name, { timeout: 9000 });
    await expect(page.getByTestId('tv-team-position')).toHaveText(`Team ${((i + 1) % picker.length) + 1} of ${picker.length}`);
    await expect(page).toHaveURL(new RegExp(`team=${next.id}`));
    await expect(page.getByTestId('tv-state-loading')).toHaveCount(0);
  });

  test('TVW-03 teams outside the scope in the link are ignored', { tag: [TAG.negative, TAG.role('engineer')] }, async ({ signInAs, page }) => {
    await signInAs('engineer', tv(`team=${DEMO.engineerTeam.id}&rotate=1&interval=5&teams=${DEMO.otherTeam.id},${DEMO.leadTeam.id},${DEMO.engineerTeam.id}`));
    await expect(page.getByTestId('tv-team-name')).toHaveText(DEMO.engineerTeam.name);
    await expect(page.getByTestId('tv-team-position')).toHaveCount(0);
    await page.waitForTimeout(6000);
    await expect(page.getByTestId('tv-team-name')).toHaveText(DEMO.engineerTeam.name);
  });

  test('TVW-04 "Set up the screen": interval, panels, teams and theme; the address and the copied link carry them', { tag: [TAG.role('manager')] }, async ({ signInAs, page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signInAs('manager', tv(`team=${DEMO.leadTeam.id}`));
    await expect(page.getByTestId('tv-team-name')).toHaveText(DEMO.leadTeam.name);
    await page.keyboard.press('s');
    const dialog = page.getByTestId('tv-settings-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('tv-settings-interval').selectOption('10');
    await dialog.getByTestId('tv-settings-panel-trends').uncheck();
    await dialog.getByTestId('tv-settings-teams-all').check();
    await dialog.getByLabel('Porcelain').check();
    await dialog.getByTestId('tv-settings-rotate').check();
    await dialog.getByTestId('tv-settings-copy').click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toContain('/tv?');
    expect(link).toMatch(/interval=10/);
    expect(link).toMatch(/panels=kpis%2Cfocus%2Cpulse/);
    expect(link).toMatch(/teams=all/);
    expect(link).toMatch(/theme=porcelain/);
    expect(link).toMatch(/rotate=1/);
    await dialog.getByTestId('tv-settings-apply').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('tv-mode')).toHaveAttribute('data-theme', 'porcelain');
    await expect(page.getByTestId('tv-refresh')).toContainText('panels rotate every 10 s');
    await expect(page).toHaveURL(/interval=10/);
    await expect(page).toHaveURL(/teams=all/);
    // Undo the remembered set-up for the other tests of this browser profile.
    await page.evaluate(() => { localStorage.removeItem('irongate_tv_settings'); localStorage.removeItem('irongate_tv_rotate'); localStorage.removeItem('irongate_tv_theme'); });
  });

  test('TVW-05 the set-up needs at least one panel; Esc closes it without changes', async ({ signInAs, page }) => {
    await signInAs('lead', tv(`team=${DEMO.leadTeam.id}`));
    await expect(page.getByTestId('tv-team-name')).toBeVisible();
    await page.keyboard.press('s');
    const dialog = page.getByTestId('tv-settings-dialog');
    for (const p of ['kpis', 'trends', 'focus', 'pulse']) await dialog.getByTestId(`tv-settings-panel-${p}`).uncheck();
    await expect(dialog.getByText('Choose at least one panel.')).toBeVisible();
    await expect(dialog.getByTestId('tv-settings-apply')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('tv-mode')).toBeVisible(); // Esc closed the dialog only
  });

  test('TVW-06 Alerts & actions and Wellbeing panels (keys 3 and 4) show the team aggregates only', async ({ signInAs, page }) => {
    await signInAs('lead', tv(`team=${DEMO.leadTeam.id}`));
    const api = await (await page.request.get(`${API_URL}/tv/teams/${DEMO.leadTeam.id}`)).json();
    await page.keyboard.press('3');
    await expect(page.getByTestId('tv-panel-focus')).toBeVisible();
    const open = api.alerts.counts.open + api.alerts.counts.acknowledged;
    if (open > 0) await expect(page.getByTestId('tv-alerts-total')).toHaveText(String(open));
    else await expect(page.getByTestId('tv-no-alerts')).toBeVisible();
    await page.keyboard.press('4');
    await expect(page.getByTestId('tv-pulse')).toBeVisible();
    if (api.pulse.latest.suppressed || api.pulse.latest.score === null) await expect(page.getByTestId('tv-pulse-suppressed')).toBeVisible();
    else await expect(page.getByTestId('tv-pulse-score')).toHaveText(String(Math.round(api.pulse.latest.score)));
    expect(JSON.stringify(api.pulse)).not.toMatch(/comment/i);
  });

  test('TVW-07 T cycles through Light, Dark, Graphite and Porcelain; the app theme comes back on exit', async ({ signInAs, page }) => {
    await signInAs('viewer', tv(`team=${DEMO.leadTeam.id}&theme=light`));
    const mode = page.getByTestId('tv-mode');
    for (const t of ['light', 'dark', 'graphite', 'porcelain', 'light']) {
      await expect(mode).toHaveAttribute('data-theme', t);
      await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(t);
      await page.keyboard.press('t');
    }
    await page.evaluate(() => localStorage.removeItem('irongate_tv_theme'));
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
  });

  test('TVW-08 a lost connection keeps the screen and recovers on its own when the network is back', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs('lead', tv(`team=${DEMO.leadTeam.id}&rotate=1&interval=5`));
    await expect(page.getByTestId('tv-refresh')).toContainText('Live');
    await page.route(`${API_URL}/tv/teams/**`, (r) => r.abort('internetdisconnected'));
    await page.evaluate(() => window.dispatchEvent(new Event('irongate:metrics-updated')));
    await expect(page.getByTestId('tv-refresh')).toContainText('Connection lost');
    await expect(page.getByTestId('tv-refresh')).toContainText('retrying every 15 s');
    await expect(page.getByTestId('tv-team-name')).toHaveText(DEMO.leadTeam.name);
    // Rotation goes on while offline.
    await expect(page.getByTestId('tv-panel-trends')).toBeVisible({ timeout: 9000 });
    await page.unroute(`${API_URL}/tv/teams/**`);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByTestId('tv-refresh')).toContainText('Live');
  });

  test('TVW-09 the cursor and the controls hide when idle; nothing needs a click once started', async ({ signInAs, page }) => {
    await signInAs('lead', tv(`team=${DEMO.leadTeam.id}&rotate=1&interval=5`));
    await expect(page.getByTestId('tv-controls')).toHaveAttribute('data-visible', 'false', { timeout: 8000 });
    await expect(page.getByTestId('tv-mode')).toHaveClass(/cursor-none/);
    await page.mouse.move(300, 300);
    await expect(page.getByTestId('tv-controls')).toHaveAttribute('data-visible', 'true');
  });
});

test.describe('TV mode on a 4K screen', { tag: [TAG.area('tv')] }, () => {
  test.use({ viewport: { width: 3840, height: 2160 } });

  test('TVW-10 the layout scales with the screen (1 rem = 1/120 of the width) and nothing scrolls', async ({ signInAs, page }) => {
    await signInAs('admin', tv(`team=${DEMO.leadTeam.id}&theme=graphite`));
    await expect(page.getByTestId('tv-hero')).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('32px');
    const overflow = await page.getByTestId('tv-mode').evaluate((el) => ({ x: el.scrollWidth > el.clientWidth, y: el.scrollHeight > el.clientHeight }));
    expect(overflow).toEqual({ x: false, y: false });
  });
});

/** Boxes of the QA hero's score visual (the battery or the gauge) and what holds it. */
const heroBoxes = (page: Page) => page.evaluate(() => {
  const r = (el: Element | null) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const slot = document.querySelector('[data-testid="tv-battery"]');
  const visual = slot?.querySelector('[role="img"]') ?? null;
  // A clipped ancestor would hide part of it: every ancestor up to the hero shows overflow, or holds it whole.
  let clipped = false;
  const hero = document.querySelector('[data-testid="tv-hero"]');
  const vb = visual?.getBoundingClientRect();
  for (let el = visual?.parentElement ?? null; el && vb; el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (cs.overflow !== 'visible') {
      const eb = el.getBoundingClientRect();
      if (vb.left < eb.left - 0.5 || vb.right > eb.right + 0.5 || vb.top < eb.top - 0.5 || vb.bottom > eb.bottom + 0.5) clipped = true;
    }
    if (el === hero) break;
  }
  return {
    hero: r(hero), slot: r(slot), visual: r(visual), clipped,
    svg: r(slot?.querySelector('svg') ?? null),
    needle: r(slot?.querySelector('[data-testid="score-gauge-marker"]') ?? null),
    kind: visual?.getAttribute('data-score-visual') ?? 'battery',
  };
});

test.describe('TV mode with the gauge', { tag: [TAG.area('tv')] }, () => {
  for (const vp of [{ id: 'TVW-11', width: 1920, height: 1080 }, { id: 'TVW-12', width: 1366, height: 768 }] as const) {
    test.describe(`${vp.width}×${vp.height}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      test(`${vp.id} ${vp.width}×${vp.height}: the gauge sits inside the hero, whole and centred, about as tall as the battery`, async ({ signInAs, page }) => {
        await signInAs('admin', tv(`team=${DEMO.leadTeam.id}&theme=light`));
        await expect(page.getByTestId('tv-hero')).toBeVisible();
        await expect(page.getByTestId('tv-battery').getByRole('img')).toBeVisible();
        const battery = await heroBoxes(page);
        expect(battery.kind).toBe('battery');

        await page.evaluate(() => localStorage.setItem('irongate_score_display', 'gauge'));
        await page.reload();
        await expect(page.getByTestId('tv-battery').getByTestId('score-gauge')).toBeVisible();
        await expect(page.getByTestId('tv-status')).toBeVisible();
        const g = await heroBoxes(page);
        expect(g.kind).toBe('gauge');
        const [hero, slot, svg, needle] = [g.hero!, g.slot!, g.svg!, g.needle!];
        // Inside its slot and the hero, needle included; nothing clips it.
        for (const box of [svg, needle]) {
          expect(box.x).toBeGreaterThanOrEqual(slot.x - 0.5);
          expect(box.r).toBeLessThanOrEqual(slot.r + 0.5);
          expect(box.y).toBeGreaterThanOrEqual(slot.y - 0.5);
          expect(box.b).toBeLessThanOrEqual(slot.b + 0.5);
          expect(box.x).toBeGreaterThanOrEqual(hero.x);
          expect(box.r).toBeLessThanOrEqual(hero.r);
        }
        expect(g.clipped).toBe(false);
        // Centred in its slot.
        expect(Math.abs((svg.x + svg.r) / 2 - (slot.x + slot.r) / 2)).toBeLessThanOrEqual(1);
        expect(Math.abs((svg.y + svg.b) / 2 - (slot.y + slot.b) / 2)).toBeLessThanOrEqual(1);
        // Height-driven: it fills its slot's height, and is a comparable size to the battery
        // (a gauge is wider than tall, so not the very same height).
        expect(svg.h).toBeGreaterThan(slot.h - 30);
        expect(svg.h).toBeGreaterThanOrEqual(battery.visual!.h * 0.55);
        expect(svg.w).toBeGreaterThanOrEqual(battery.visual!.w);
        // Drawn at its size (no CSS scale), so it stays sharp: the SVG's own width is its width on screen.
        expect(Number(await page.getByTestId('tv-battery').locator('svg').getAttribute('width'))).toBeCloseTo(svg.w, 0);
        // The text around it stays inside the hero too (it used to be squeezed beside the gauge and spill over the KPIs).
        const spill = await page.getByTestId('tv-hero').evaluate((h) => {
          const hb = h.getBoundingClientRect();
          return Array.from(h.querySelectorAll('h2, p, [data-testid="tv-status"]'))
            .map((el) => ({ text: (el.textContent ?? '').slice(0, 30), b: el.getBoundingClientRect() }))
            .filter(({ b }) => b.left < hb.left || b.right > hb.right + 0.5 || b.top < hb.top || b.bottom > hb.bottom + 0.5)
            .map(({ text }) => text);
        });
        expect(spill).toEqual([]);
        // Nothing scrolls or spills out of the screen.
        const overflow = await page.getByTestId('tv-mode').evaluate((el) => ({ x: el.scrollWidth > el.clientWidth, y: el.scrollHeight > el.clientHeight }));
        expect(overflow).toEqual({ x: false, y: false });
        await page.evaluate(() => localStorage.removeItem('irongate_score_display'));
      });
    });
  }
});

test.describe('TV mode accessibility', { tag: [TAG.a11y, TAG.area('tv')] }, () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  const cases = [
    { id: 'A11Y-34', theme: 'light', key: '1' },
    { id: 'A11Y-35', theme: 'dark', key: '3' },
    { id: 'A11Y-36', theme: 'graphite', key: '4' },
    { id: 'A11Y-37', theme: 'porcelain', key: '2' },
  ] as const;
  for (const c of cases) {
    test(`${c.id} ${c.theme} theme: TV mode (panel ${c.key}) and its set-up dialog have no serious violations`, async ({ signInAs, page }, testInfo) => {
      await signInAs('admin', tv(`team=${DEMO.leadTeam.id}&theme=${c.theme}`));
      await expect(page.getByTestId('tv-team-name')).toBeVisible();
      await page.keyboard.press(c.key);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await checkA11y(page, testInfo, { known: [] });
      await page.keyboard.press('s');
      await expect(page.getByTestId('tv-settings-dialog')).toBeVisible();
      await checkA11y(page, testInfo, { known: [], include: '[data-testid="tv-settings-dialog"]' });
      await page.keyboard.press('Escape');
      await page.evaluate(() => localStorage.removeItem('irongate_tv_theme'));
    });
  }
});
