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

  async toggleTheme(): Promise<void> {
    await this.page.getByRole('button', { name: 'Toggle colour theme' }).click();
  }

  async isDark(): Promise<boolean> {
    return this.page.evaluate(() => document.documentElement.classList.contains('dark'));
  }
}

/** The page has no sideways scrolling (document wider than the viewport). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const doc = document.documentElement;
    const main = document.getElementById('main-scroll');
    const over = (el: Element | null) => (el ? el.scrollWidth - el.clientWidth : 0);
    return Math.max(over(doc), over(document.body), over(main));
  }), { message: 'horizontal overflow in px' }).toBeLessThanOrEqual(1);
}

/** Collect uncaught page errors; call the returned function at the end to assert none happened. */
export function trackPageErrors(page: Page): () => void {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return () => expect(errors, 'uncaught errors in the page').toEqual([]);
}
