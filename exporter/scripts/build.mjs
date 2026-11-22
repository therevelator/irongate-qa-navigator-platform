// Build dist/qe-exporter.mjs: one ESM file for Node 20+, no runtime dependency, not minified (reviewable),
// deterministic (same source + same esbuild version = same bytes), and dist/SHA256SUMS.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = readFileSync(join(root, 'src/version.ts'), 'utf8').match(/VERSION = '([^']+)'/)[1];
if (version !== pkg.version) throw new Error(`src/version.ts (${version}) and package.json (${pkg.version}) differ`);

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist/qe-exporter.mjs');
const result = await build({
  entryPoints: [join(root, 'src/main.ts')],
  outfile: out,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  charset: 'utf8',
  logLevel: 'warning',
  metafile: true,
  banner: { js: `// qe-exporter ${version}: QE Navigator Exporter. Built from exporter/src with esbuild; no runtime dependencies.` },
});
const inputs = Object.keys(result.metafile.inputs);
// Only the Exporter's own code: no third-party code and no server code (the Exporter calculates nothing).
const foreign = inputs.filter((p) => !p.startsWith('src/'));
if (foreign.length) throw new Error(`The bundle must contain only exporter/src: found ${foreign.join(', ')}`);
const bytes = readFileSync(out);
const sum = createHash('sha256').update(bytes).digest('hex');
writeFileSync(join(root, 'dist/SHA256SUMS'), `${sum}  qe-exporter.mjs\n`);
console.log(`dist/qe-exporter.mjs  ${bytes.length} bytes  sha256 ${sum}  (${inputs.length} source files)`);
