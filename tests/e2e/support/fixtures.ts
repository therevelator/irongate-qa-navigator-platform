import { test as base, expect } from '@playwright/test';
import { AppShell } from './app';
import { signIn, type Credentials } from './auth';
import { registerCompany, deleteCompany, type FreshCompany } from './data';
import type { Role } from './roles';

/**
 * The suite's test object. Fixtures:
 *  - app: the app frame page object (navigation, theme, sign out)
 *  - signInAs(role | credentials, path?): signed in through the API, then `path` opened
 *  - freshCompany: a newly registered organisation (its super admin's credentials), deleted afterwards
 */
export const test = base.extend<{
  app: AppShell;
  signInAs: (who: Role | Credentials, path?: string) => Promise<AppShell>;
  freshCompany: FreshCompany;
}>({
  app: async ({ page }, use) => { await use(new AppShell(page)); },
  signInAs: async ({ page, app }, use) => {
    await use(async (who, path = '/') => { await signIn(page, who, path); return app; });
  },
  freshCompany: async ({}, use) => {
    const company = await registerCompany();
    try {
      await use(company);
    } finally {
      await deleteCompany(company.id);
    }
  },
});

export { expect };

/** Tags (see docs/testing/README.md): filter with --grep, e.g. --grep "@smoke" or --grep "@negative.*@area:auth". */
export const TAG = {
  smoke: '@smoke',
  negative: '@negative',
  a11y: '@a11y',
  readonly: '@readonly',
  role: (r: Role) => `@role:${r}`,
  area: (a: string) => `@area:${a}`,
} as const;
