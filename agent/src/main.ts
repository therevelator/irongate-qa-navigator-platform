#!/usr/bin/env node
/** Entry point of the bundle (dist/qe-agent.mjs). */
import { main } from './cli';
import { EXIT } from './run';

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (e) => { process.stderr.write(`qe-agent: ${(e as Error)?.message ?? e}\n`); process.exitCode = EXIT.INTERNAL; },
);
