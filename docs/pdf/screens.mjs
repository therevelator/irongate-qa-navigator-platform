#!/usr/bin/env node
/**
 * Takes the screenshots used in the feature guides (docs/pdf/src/screens/<slug>.jpg) from a running app with the
 * demonstration data, in the Porcelain theme.
 *
 *   APP_URL=http://localhost:5173 API_URL=http://localhost:3000/api DEMO_EMAIL=admin@irongate.com DEMO_PASSWORD=… npm run docs:pdf:screens
 *
 * Then `npm run docs:pdf` puts them into the PDFs. A page that fails to load is skipped and reported; its guide
 * is built without a picture.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'src', 'screens');
const APP = process.env.APP_URL ?? 'http://localhost:5173';
const API = process.env.API_URL ?? 'http://localhost:3000/api';
const EMAIL = process.env.DEMO_EMAIL ?? 'admin@irongate.com';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo123';

/** slug → address, and what must be on screen before the picture is taken. */
const PAGES = [
  ['overview', '/'], ['executive-summary', '/summary'], ['analytics', '/analytics'], ['compare-teams', '/compare'], ['notifications-alerts', '/notifications'],
  ['time-lost', '/time-lost'], ['findings', '/findings'], ['outcomes', '/outcomes'], ['data-readiness', '/data-readiness'],
  ['flaky-tests', '/analytics/flaky-tests'], ['test-execution', '/analytics/timeline'], ['technical-debt', '/analytics/technical-debt'], ['performance', '/analytics/performance'],
  ['cicd-pipeline', '/analytics/pipeline'], ['developer-productivity', '/analytics/productivity'], ['wellbeing-pulse', '/analytics/pulse'], ['business-impact', '/analytics/business-impact'],
  ['team-rankings', '/analytics/gamification'], ['reports', '/analytics/reports'],
  ['users', '/users'], ['teams', '/teams'], ['departments', '/departments'], ['roles', '/roles'], ['activity', '/activity'], ['user-activity', '/user-activity'],
  ['admin-console', '/admin-panel'], ['manual-metrics', '/manual-metrics'], ['upload-files', '/upload-files'], ['update-frequency', '/metric-intervals'],
  ['parameters', '/parameters-config'], ['ingestion-log', '/ingestion-log'],
];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
await context.addInitScript(() => {
  try {
    localStorage.setItem('irongate_theme_mode', 'porcelain');
    if (!localStorage.getItem('qe.team.section')) localStorage.setItem('qe.team.section', 'recommendations');
  } catch { /* storage unavailable */ }
});
const page = await context.newPage();
const login = await context.request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
if (!login.ok()) { console.error(`Sign-in failed (${login.status()}). Is the app running at ${APP} with the demo data?`); process.exit(1); }

const snap = async (slug) => {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, `${slug}.jpg`), type: 'jpeg', quality: 78 });
  console.log(`  ${slug}.jpg`);
};
const failed = [];
for (const [slug, address] of PAGES) {
  try {
    await page.goto(`${APP}${address}`, { waitUntil: 'domcontentloaded' });
    await page.locator('main').first().waitFor({ timeout: 15000 });
    await snap(slug);
  } catch (e) { failed.push(`${slug}: ${String(e.message).split('\n')[0]}`); }
}
// The team page (opened from the overview) and TV mode for that team.
try {
  await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('team-card').first().click();
  await page.getByTestId('section-switch').waitFor({ timeout: 15000 });
  await snap('team-page');
  await page.goto(`${APP}/tv?theme=porcelain`, { waitUntil: 'domcontentloaded' });
  await snap('tv-mode');
} catch (e) { failed.push(`team-page / tv-mode: ${String(e.message).split('\n')[0]}`); }
await browser.close();
if (failed.length) console.log(`Skipped:\n  ${failed.join('\n  ')}`);
