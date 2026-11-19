import { expect, type Locator, type Page } from '@playwright/test';

/** The signed-in app frame: top bar, navigation drawer, theme, sign out (src/components/Layout.tsx). */
export class AppShell {
  readonly page: Page;
  constructor(page: Page) { this.page = page; }

  get burger(): Locator { return this.page.getByTestId('nav-toggle'); }
  get drawer(): Locator { return this.page.locator('#app-navigation'); }
  get title(): Locator { return this.page.locator('header h1'); }

  async openNav(): Promise<void> {
    if ((await this.burger.getAttribute('aria-expanded')) !== 'true') await this.burger.click();
    await expect(this.page.getByTestId('sidebar-nav')).toBeVisible();
  }

  async closeNav(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await expect(this.burger).toHaveAttribute('aria-expanded', 'false');
  }

  /** data-testid of every visible navigation entry (nav-*), once the operator check has answered. */
  async navItems(): Promise<string[]> {
    await this.openNav();
    // The Platform entry appears after GET /api/operator/status; give it a moment to settle.
    await this.page.waitForLoadState('networkidle').catch(() => undefined);
    return this.page.getByTestId('sidebar-nav').locator('button[data-testid^="nav-"]').evaluateAll(
      (els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
  }

  /** Open a page from the navigation by its data-testid (e.g. 'nav-users'). */
  async go(navTestId: string, expectedTitle?: string | RegExp): Promise<void> {
    await this.openNav();
    await this.page.getByTestId(navTestId).click();
    if (expectedTitle) await expect(this.title).toHaveText(expectedTitle);
  }

  async signOut(): Promise<void> {
    await this.openNav();
    await this.page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(this.page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  }

  /** The Appearance menu in the top bar (src/components/HeaderParts.tsx AppearanceMenu). */
  get appearanceButton(): Locator { return this.page.getByRole('button', { name: 'Appearance' }); }
  get appearanceMenu(): Locator { return this.page.getByRole('menu', { name: 'Appearance' }); }

  async openAppearance(): Promise<void> {
    if ((await this.appearanceButton.getAttribute('aria-expanded')) !== 'true') await this.appearanceButton.click();
    await expect(this.appearanceMenu).toBeVisible();
  }

  async closeAppearance(): Promise<void> {
    if ((await this.appearanceButton.getAttribute('aria-expanded')) !== 'true') return;
    await this.page.keyboard.press('Escape');
    await expect(this.appearanceMenu).toHaveCount(0);
  }

  /** Pick a theme by its menu label (Light, Dark, Graphite, Porcelain, Match system); the menu is closed after. */
  async setTheme(label: 'Light' | 'Dark' | 'Graphite' | 'Porcelain' | 'Match system'): Promise<void> {
    await this.openAppearance();
    await this.appearanceMenu.getByRole('menuitemradio', { name: new RegExp(`^${label}`) }).click();
    await this.closeAppearance();
  }

  async setScoreDisplay(label: 'Battery' | 'Gauge'): Promise<void> {
    await this.openAppearance();
    await this.appearanceMenu.getByRole('menuitemradio', { name: label, exact: true }).click();
    await this.closeAppearance();
  }

  /** Light <-> Dark (the old one-click switch, now through the Appearance menu). */
  async toggleTheme(): Promise<void> {
    await this.setTheme((await this.isDark()) ? 'Light' : 'Dark');
  }

  async isDark(): Promise<boolean> {
    return this.page.evaluate(() => document.documentElement.classList.contains('dark'));
  }

  /** The theme on <html> (data-theme). */
  async theme(): Promise<string | null> {
    return this.page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  }
}

/**
 * The page has no sideways scrolling: neither the document nor the main column is wider than the
 * viewport, and no element sticks out to the right (except inside a container that scrolls or clips
 * on purpose, such as a wide table).
 */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  // The configured width: with mobile emulation the layout viewport grows to fit overflowing content.
  const width = page.viewportSize()?.width ?? 0;
  await expect.poll(() => page.evaluate((vwConfigured) => {
    const vw = Math.min(vwConfigured || Infinity, document.documentElement.clientWidth);
    const main = document.getElementById('main-scroll');
    const over = (el: Element | null) => (el ? el.scrollWidth - el.clientWidth : 0);
    const clipped = (el: Element) => {
      for (let e = el.parentElement; e && e !== main && e !== document.body; e = e.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(e).overflowX)) return true;
      }
      return false;
    };
    let sticking = 0;
    (main ?? document.body).querySelectorAll('*').forEach((el) => {
      const b = el.getBoundingClientRect();
      if (b.width > 0 && b.right > vw + 1 && !clipped(el)) sticking = Math.max(sticking, Math.round(b.right - vw));
    });
    const docWider = Math.max(0, document.documentElement.scrollWidth - vw);
    return Math.max(over(document.documentElement), over(document.body), over(main), sticking, docWider);
  }, width), { message: 'horizontal overflow in px' }).toBeLessThanOrEqual(1);
}

/** Collect uncaught page errors; call the returned function at the end to assert none happened. */
export function trackPageErrors(page: Page): () => void {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return () => expect(errors, 'uncaught errors in the page').toEqual([]);
}
