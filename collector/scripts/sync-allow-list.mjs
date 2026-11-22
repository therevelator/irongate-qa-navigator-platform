// Vendor the shared field allow-list into the Collector:
//   server/lib/ingest/fieldAllowList.ts  →  collector/src/vendor/fieldAllowList.ts  (byte for byte, plus a header)
// The Collector applies exactly the list QE Navigator applies. The file must stay free of server imports:
// only Node's crypto module is allowed. With --check, fails when the vendored copy is out of date
// (run in the monorepo; outside it there is nothing to compare and the check is skipped).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, '..', 'server', 'lib', 'ingest', 'fieldAllowList.ts');
const target = join(root, 'src', 'vendor', 'fieldAllowList.ts');
const check = process.argv.includes('--check');

if (!existsSync(source)) {
  console.log(`No ${source}: not in the QE Navigator monorepo, nothing to sync (the vendored copy is used as it is).`);
  process.exit(0);
}
const text = readFileSync(source, 'utf8');
const imports = [...text.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
const bad = imports.filter((m) => !['crypto', 'node:crypto'].includes(m));
if (bad.length) {
  console.error(`fieldAllowList.ts imports ${bad.join(', ')}: the shared allow-list must have no dependencies other than crypto.`);
  process.exit(1);
}
const sum = createHash('sha256').update(text).digest('hex');
const vendored = `// VENDORED: a byte-for-byte copy of server/lib/ingest/fieldAllowList.ts (sha256 ${sum}).\n// Do not edit here: change the server file and run \`npm run sync-allow-list\` in collector/.\n${text}`;
if (check) {
  const cur = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (cur !== vendored) {
    console.error('collector/src/vendor/fieldAllowList.ts is out of date: run `npm run sync-allow-list` in collector/.');
    process.exit(1);
  }
  console.log(`Vendored allow-list is up to date (sha256 ${sum.slice(0, 16)}…).`);
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, vendored);
  console.log(`Vendored ${source} → ${target} (sha256 ${sum.slice(0, 16)}…).`);
}
