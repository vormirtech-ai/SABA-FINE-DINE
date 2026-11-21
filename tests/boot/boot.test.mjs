/**
 * Starting the way a restaurant starts it.
 *
 * Every other suite imports `start()` and calls it. That is not what a till
 * does: a till runs `npm start`, which runs `node server/main.js`, and the
 * difference between those two is a one-line guard at the foot of main.js.
 *
 * That guard was wrong on Windows for the whole of this product's life. It
 * built `file://` + argv[1], which on Windows is
 * `file://C:\Users\...` against an `import.meta.url` of
 * `file:///C:/Users/...`. They never matched, so main.js defined its
 * functions, called none of them, and exited 0 — no error, no log line,
 * straight back to the prompt. Nothing in a suite that imports `start()`
 * could ever see it.
 *
 * So this suite does not import anything. It spawns the file.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { test } from '../run.mjs';
import { nextPort } from '../port.mjs';

const MAIN = fileURLToPath(new URL('../../server/main.js', import.meta.url));

/** Run `node server/main.js` and wait for it to say it is listening. */
function startAsATillWould(port, dataDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MAIN], {
      env: { ...process.env, SABA_PORT: String(port), SABA_DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    const watch = (chunk) => {
      output += chunk;
      if (output.includes('is running')) resolve({ child, output });
    };
    child.stdout.on('data', watch);
    child.stderr.on('data', watch);

    // The symptom was a silent exit, so that is the thing to report clearly.
    child.on('exit', (code) => reject(new Error(
      `server/main.js exited with code ${code} instead of listening.`
      + (output.trim() ? ` It said: ${output.trim().slice(0, 400)}`
        : ' It printed nothing at all — the start guard at the foot of'
          + ' main.js did not recognise it as the main module.')
    )));

    setTimeout(() => reject(new Error(`no sign of life in 15s. Output: ${output.slice(0, 400)}`)), 15_000)
      .unref?.();
  });
}

test('`node server/main.js` actually starts a till', async (t) => {
  const port = nextPort();
  const dataDir = mkdtempSync(join(tmpdir(), 'saba-boot-'));
  let child;

  try {
    const started = await startAsATillWould(port, dataDir);
    child = started.child;

    t.ok(started.output.includes('is running'), 'it says it is running');
    t.ok(started.output.includes(String(port)), 'on the port it was given');
    t.ok(started.output.includes('FIRST RUN'), 'and prints the first-run PIN once');

    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    t.equal(response.status, 200, 'and answers on it');
  } finally {
    child?.kill('SIGTERM');
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('the start guard recognises the main module on any platform', (t) => {
  // The bug in one line. `file://` with a path glued on is only ever correct
  // for a POSIX absolute path; pathToFileURL is correct everywhere.
  const posix = '/opt/saba/server/main.js';
  t.equal(`file://${posix}`, pathToFileURL(posix).href,
    'gluing happens to work on a POSIX path, which is why this hid for so long');

  // What Windows gives you. The glued form is not even a valid file URL:
  // no third slash, a drive letter in the host position, backslashes.
  const windows = 'C:\\Users\\user\\saba\\server\\main.js';
  const glued = `file://${windows}`;
  t.ok(!glued.startsWith('file:///'), 'the glued form has no path root on Windows');
  t.ok(glued.includes('\\'), 'and carries backslashes a URL never has');

  // And the guard as it is now compares like with like.
  t.equal(import.meta.url, pathToFileURL(fileURLToPath(import.meta.url)).href,
    'a path round-trips through pathToFileURL to exactly the URL node reports');
});
