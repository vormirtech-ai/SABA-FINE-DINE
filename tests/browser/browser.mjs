/**
 * The browser, found rather than installed.
 *
 * Playwright is not a dependency of this project and must never become one —
 * a restaurant's till does not need a browser automation library to run. It
 * is used only by this suite, so it is resolved at call time and the suite
 * skips itself, loudly, if it is not there.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function playwright() {
  for (const spec of ['playwright', '/opt/node-tools/node_modules/playwright/index.js']) {
    try {
      return require(spec);
    } catch { /* try the next */ }
  }
  return null;
}

export const available = () => Boolean(playwright());

export async function launch() {
  const pw = playwright();
  if (!pw) throw new Error('playwright is not installed; skip this suite');
  return pw.chromium.launch();
}
