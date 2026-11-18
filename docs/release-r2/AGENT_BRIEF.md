# Accuracy fix — shared brief (read fully before editing)

Repo: /home/user/irongate-qa-navigator-platform (branch claude/wonderful-lamport-0a1h9w, clean commit de6222e).
App: React 19 + Vite + Tailwind v4 frontend (src/), Express 5 + Postgres (pg) API (server/). DB helper: src/lib/db.ts
(`query`/`queryOne` with `?` placeholders; NUMERIC/AVG come back as **strings** — wrap in Number()).

The owner of this app may be held accountable for numbers it shows. Four independent audits found fabricated,
random and wrong metrics. The audit reports are here (read the ones relevant to your files):
- /tmp/claude-0/-home-user/3061e665-38e0-537b-ac16-1bf45adbbcb9/tasks/a46ce3ec0335ffa8c.output  (developer productivity / wellbeing)
- /tmp/claude-0/-home-user/3061e665-38e0-537b-ac16-1bf45adbbcb9/tasks/ae921b93d72d68451.output  (business impact / statistics)
- /tmp/claude-0/-home-user/3061e665-38e0-537b-ac16-1bf45adbbcb9/tasks/ae59bfbd55697bc59.output  (executive overview / team scores)
- /tmp/claude-0/-home-user/3061e665-38e0-537b-ac16-1bf45adbbcb9/tasks/a53b32e27cb311e46.output  (quality & delivery pages)
(They are JSON-lines transcripts; the final report is the last assistant message. `tail -c 40000 <file>` is usually enough.)
Verify each finding against the code before fixing — line numbers may have drifted; do not fix things that turn out not to be real.

## Rules everyone follows
1. **Never display an invented number.** Remove every `Math.random()` used for a displayed value, every hardcoded
   metric constant (e.g. pipeline health 96, "+5.2%"), and every `|| <plausible default>` that turns missing data into a
   believable number. Missing → server returns `null` (or `[]`); client renders "—" or an empty state
   ("No data recorded"). Use `?? fallback` only where the fallback is genuinely correct, never `||` on numbers (0 is valid).
2. Synthetic-data generators stay in the code but are **off unless `process.env.ENABLE_SYNTHETIC_DATA === 'true'`**
   (owned by the server-jobs agent). Explicit "generate sample data" buttons in the UI must be removed or clearly
   labelled "Sample data" and must not be saved as if a person entered it.
3. Labels must match the calculation: units (/min vs /s), "mean of daily p95", formula text identical to the code,
   "as of <date>" where data can be stale, correlation is not causation, "exploratory" for uncorrected stats.
4. One definition per metric. If two code paths compute the same metric differently, unify them (shared helper)
   inside your files, and report any cross-file mismatch you couldn't fix.
5. **Only edit files you own** (listed in your prompt). If a fix needs a change in someone else's file, describe it
   precisely in your final report instead. API response shapes may change only where needed (e.g. value → null);
   list every shape change in your report so the client side can be checked.
6. UI you touch must use the design system in src/components/ui.tsx (Page, PageIntro, Card, CardHeader, Badge, StatTile,
   EmptyState, SegmentedControl, buttonClass, inputClass, cx). Business tone: no emoji, no gradient banners, no
   glows/neon, no "Back to Features"/back buttons in page headers (the Layout already shows a breadcrumb + title;
   pages should start with a PageIntro or go straight to content). Palette: slate neutrals, brand-*, green/amber/red
   for status only. Support dark mode with `dark:` classes like ui.tsx does.
7. Do not touch the database contents, do not commit, do not push, do not start/stop servers on ports 3000/5173
   (they are running; vite hot-reloads). Do not delete rows. Do not run `npm install`.
8. Before finishing: `cd /home/user/irongate-qa-navigator-platform && npx tsc --noEmit -p tsconfig.app.json` (or the
   tsconfig that covers your files — check `ls tsconfig*`) must show no new errors in your files.
   Server agents: also run `npx jest --config jest.config.cjs tests/api` if it runs against the local DB from .env and
   report the result (pre-existing failures are fine to report as such).
9. Final report (concise): per finding — fixed / not reproducible / deferred (why); API shape changes; cross-file asks.

## Light AND dark mode (explicit user requirement)
Every page you touch must look correct in both themes. Dark mode is class-based (`.dark` on <html>, Tailwind
`dark:` variants). For every bg/text/border class add its `dark:` pair (bg-white→dark:bg-slate-900,
text-slate-900→dark:text-white, text-slate-500→dark:text-slate-400, border-slate-200→dark:border-slate-800,
tinted fills like bg-red-50→dark:bg-red-950/40). Never leave a page with a hard-coded dark background in light mode
(e.g. ManualMetricsInput currently forces a navy/dark panel in light mode) or white panels in dark mode.
Charts (recharts): axis/grid/tooltip colours must be readable in both themes — use `useTheme()` from
src/contexts/ThemeContext.tsx (`isDark`/`theme` — check its exports) to pick stroke/fill colours, and style tooltips
with theme-aware contentStyle. To check visually you may run (light, then dark):
  node /tmp/claude-0/-home-user/3061e665-38e0-537b-ac16-1bf45adbbcb9/scratchpad/shoot2.cjs <outdir> <tag> /analytics/<page>
(read the script first to see how it works and whether it supports a dark flag; if not, copy it into your own file and
set localStorage theme='dark' before navigation — check ThemeContext for the storage key). Write screenshots to your own
directory under the scratchpad, not the shared shots/ folder.
Theme storage key: localStorage 'irongate_theme_mode' = 'dark' | 'light'. ThemeContext exposes isDark (check the hook name in the file).
