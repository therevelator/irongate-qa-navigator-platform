// Report ESLint results without failing the build on the existing lint debt.
// Usage: npx eslint . -f json -o eslint-report.json; node scripts/ci/lint-summary.mjs eslint-report.json
// Prints totals and the most common rules, and appends them to $GITHUB_STEP_SUMMARY when set.
import { readFileSync, appendFileSync } from 'node:fs';

const file = process.argv[2] || 'eslint-report.json';
const results = JSON.parse(readFileSync(file, 'utf8'));
let errors = 0;
let warnings = 0;
let files = 0;
const rules = new Map();
for (const r of results) {
  errors += r.errorCount;
  warnings += r.warningCount;
  if (r.errorCount + r.warningCount > 0) files += 1;
  for (const m of r.messages) {
    const id = m.ruleId || '(parse error)';
    rules.set(id, (rules.get(id) || 0) + 1);
  }
}
const top = [...rules.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
const lines = [
  '### ESLint (report only)',
  '',
  `${errors} errors, ${warnings} warnings in ${files} of ${results.length} files.`,
  '',
  '| Rule | Count |',
  '| --- | ---: |',
  ...top.map(([id, n]) => `| \`${id}\` | ${n} |`),
  '',
];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
for (const r of results) {
  for (const m of r.messages) {
    if (m.fatal) {
      console.error(`Parse error in ${r.filePath}: ${m.message}`);
      process.exitCode = 1;
    }
  }
}
