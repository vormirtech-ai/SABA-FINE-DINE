#!/usr/bin/env node
/**
 * Run the server with some environment set.
 *
 *   node tools/run-with.mjs SABA_SEED_DEMO=1 SABA_SETUP_PIN=1379
 *
 * `"demo": "SABA_SEED_DEMO=1 node server/main.js"` is POSIX shell syntax.
 * Windows cmd reads it as a command called SABA_SEED_DEMO=1 and says it is
 * not recognised, so those scripts did not run on the one platform most
 * tills use. This does the same thing in Node, which runs everywhere.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const env = { ...process.env };
const args = [];

for (const arg of process.argv.slice(2)) {
  const eq = arg.indexOf('=');
  // Assignments come first; everything after the first non-assignment is
  // passed through to the server untouched.
  if (eq > 0 && !args.length) env[arg.slice(0, eq)] = arg.slice(eq + 1);
  else args.push(arg);
}

const main = fileURLToPath(new URL('../server/main.js', import.meta.url));

const child = spawn(process.execPath, [...args, main], { env, stdio: 'inherit' });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
