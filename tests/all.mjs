/**
 * Test entry point.
 *
 *   node tests/all.mjs            everything
 *   node tests/all.mjs unit       the domain only, no server
 *   node tests/all.mjs api        the API only
 *   node tests/all.mjs till       the published demonstration only
 *   node tests/all.mjs sync       the cloud copy only
 *   node tests/all.mjs printer    the kitchen printer only
 *   node tests/all.mjs boot       starting it the way a till starts it
 *   node tests/all.mjs browser    a real browser against the built site
 *
 * No framework, no dependencies, no build step — the same constraints the
 * application itself runs under.
 */

import { run } from './run.mjs';

const only = process.argv[2];

const UNIT = [
  './unit/pricing.test.mjs',
  './unit/orders.test.mjs',
];

const API = [
  './api/server.test.mjs',
];

/** The published demonstration, held against the product it demonstrates. */
const TILL = [
  './till/parity.test.mjs',
];

/** The cloud copy, against a stand-in for Supabase. */
const SYNC = [
  './sync/sync.test.mjs',
];

/** The kitchen printer, against a socket and a file. */
const PRINTER = [
  './printer/printer.test.mjs',
];

/**
 * Starting it the way a restaurant starts it: `node server/main.js`, spawned,
 * not imported. Every other suite calls `start()` directly and so cannot see
 * whether the file starts itself.
 */
const BOOT = [
  './boot/boot.test.mjs',
];

/**
 * A real browser against the built site. IndexedDB exists nowhere else, so
 * "does a table survive the tab closing" cannot be asked in Node. Needs the
 * site built (`npm run site`) and Playwright present; skips itself, saying
 * so, when either is missing.
 */
const BROWSER = [
  './browser/persist.test.mjs',
];

const SUITES = {
  unit: UNIT, api: API, till: TILL, sync: SYNC,
  printer: PRINTER, boot: BOOT, browser: BROWSER,
};

const files = SUITES[only] || [...UNIT, ...API, ...TILL, ...SYNC, ...PRINTER, ...BOOT];

await run(files);
