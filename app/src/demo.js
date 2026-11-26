/**
 * Standing the till up inside the tab.
 *
 * This is the only file the browser-hosted build adds. It opens the till,
 * says plainly on screen what kind of till it is, and then boots the
 * ordinary application — which from that point on is byte-for-byte the
 * software a restaurant installs.
 *
 * The ordering matters: `main.js` asks the till who is signed in before it
 * paints anything, so the till has to be open and loaded from storage first.
 * Importing it at the top of the file, as this once did, boots the
 * application against a till that is still empty.
 */

import { install, till } from './net/till/index.js';
import { DEMO_STAFF } from './net/till/seed.js';
import * as local from './db/local.js';

/** Showroom or real restaurant, decided by the page that loaded this. */
const SHOWROOM = !document.documentElement.dataset.saba
  || document.documentElement.dataset.saba === 'demo';

const opened = await install({ demo: SHOWROOM });

/**
 * A line across the top that tells the truth about where this data lives.
 *
 * It used to say everything was forgotten when you closed the tab, which was
 * true of the in-memory till and is not true of this one. Saying so when it
 * is no longer so is the one thing a line like this must never do.
 */
function banner() {
  const bar = document.createElement('div');
  bar.className = 'demobar';

  const where = opened.persisted
    ? 'Everything you do is kept in this browser, on this device.'
    : 'This browser will not let the till store anything, so nothing here'
      + ' survives the tab. Trading like this would lose a service.';

  const pins = DEMO_STAFF
    .map((person) => `<b>${person.name.split(' ')[0]} ${person.pin}</b>`)
    .join(', ');

  bar.innerHTML = `
    <span class="demobar__dot" aria-hidden="true"></span>
    <strong>${SHOWROOM ? 'Demonstration.' : 'Saba.'}</strong>
    <span class="demobar__text">
      ${where}
      ${SHOWROOM ? `Sign in as ${pins}.` : ''}
    </span>
    <button class="demobar__reset" type="button">Start again</button>
    <a class="demobar__back" href="../">About Saba</a>
  `;

  bar.querySelector('.demobar__reset').addEventListener('click', async () => {
    const ok = window.confirm(
      opened.persisted
        ? 'Start again?\n\nEvery table, bill and booking kept in this browser'
        + ' is deleted, and the demonstration is rebuilt from scratch.'
        : 'Start again?'
    );
    if (!ok) return;
    try {
      await local.wipeAll();
    } catch { /* nothing stored; the reload is the whole reset */ }
    window.location.reload();
  });

  document.body.appendChild(bar);
  document.body.classList.add('has-demobar');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', banner, { once: true });
} else {
  banner();
}

// The real entry point, untouched, and only once the till is loaded.
await import('./main.js');

export { till, DEMO_STAFF };
