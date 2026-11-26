/**
 * Does a table survive the browser being closed?
 *
 * That one question is the whole difference between the demonstration this
 * was and the till it is meant to be, and no test that runs in Node can
 * answer it: IndexedDB only exists in a browser, so this suite drives a real
 * one against the built site.
 *
 * Each case gets its own browser context, which is its own origin storage —
 * so "a second device" and "the same device tomorrow" are both expressible,
 * and neither can see the other's leftovers.
 */

import { fileURLToPath } from 'node:url';

import { test } from '../run.mjs';
import { nextPort } from '../port.mjs';
import { serveSite } from './serve.mjs';
import { launch } from './browser.mjs';

const SITE = fileURLToPath(new URL('../../site/demo', import.meta.url));

/** Sign in and seat a table, the way a captain would. */
async function seatATable(page, { name = 'Priya', pin = '5814', table = 't1' } = {}) {
  await page.evaluate(async ([t]) => {
    const staff = await (await window.SABA_TILL('/api/session/staff')).json();
    const who = staff.staff.find((u) => u.name.startsWith('Priya')) || staff.staff[0];
    await window.SABA_TILL('/api/session', {
      method: 'POST',
      body: JSON.stringify({ userId: who.id, pin: who.pin || '5814', terminal: 'test' }),
    });
    const res = await window.SABA_TILL(`/api/tables/${t}/seat`, {
      method: 'POST',
      body: JSON.stringify({ covers: 4, guestName: 'Survives a reload' }),
    });
    return (await res.json()).order;
  }, [table]);
}

/** Every open table this till can see, by label. */
const openTables = (page) => page.evaluate(async () => {
  const state = await (await window.SABA_TILL('/api/state')).json();
  return state.orders
    .filter((o) => o.status === 'OPEN')
    .map((o) => `${o.tableLabel}:${o.guestName || ''}`)
    .sort();
});

test('a table seated on this till is still there after the browser closes', async (t) => {
  const site = await serveSite(SITE, nextPort());
  const browser = await launch();

  try {
    // Monday evening: a captain seats a table.
    const monday = await browser.newContext();
    const page = await monday.newPage();
    await page.goto(`${site.base}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.SABA_TILL));

    await seatATable(page);
    const before = await openTables(page);
    t.ok(before.some((row) => row.includes('Survives a reload')),
      'the table is open on the till that seated it');

    // The tab is closed. Not refreshed — closed, and the page torn down.
    await page.close();

    // Tuesday morning: the same device, opened again.
    const tuesday = await monday.newPage();
    await tuesday.goto(`${site.base}/`, { waitUntil: 'networkidle' });
    await tuesday.waitForFunction(() => Boolean(window.SABA_TILL));

    const after = await openTables(tuesday);
    t.ok(after.some((row) => row.includes('Survives a reload')),
      'and it is still open the next time the till is opened');
    t.equal(after.length, before.length, 'with the rest of the room exactly as it was');

    // And it is genuinely in storage, not merely in a seeded example.
    const stored = await tuesday.evaluate(async () => {
      const idb = await new Promise((resolve, reject) => {
        const request = indexedDB.open('saba');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const rows = await new Promise((resolve) => {
        const request = idb.transaction(['orders']).objectStore('orders').getAll();
        request.onsuccess = () => resolve(request.result);
      });
      idb.close();
      return rows.filter((o) => o.guestName === 'Survives a reload').length;
    });
    t.equal(stored, 1, 'and it is a row in IndexedDB, written once');

    await monday.close();
  } finally {
    await browser.close();
    await site.stop();
  }
});

test('another device does not see this one’s tables until they are shared', async (t) => {
  const site = await serveSite(SITE, nextPort());
  const browser = await launch();

  try {
    const till1 = await browser.newContext();
    const page1 = await till1.newPage();
    await page1.goto(`${site.base}/`, { waitUntil: 'networkidle' });
    await page1.waitForFunction(() => Boolean(window.SABA_TILL));
    await seatATable(page1, { table: 't2' });

    // A second browser context is a second device: its own storage, its own
    // everything. Nothing is connected yet, so it must not see table 2.
    const till2 = await browser.newContext();
    const page2 = await till2.newPage();
    await page2.goto(`${site.base}/`, { waitUntil: 'networkidle' });
    await page2.waitForFunction(() => Boolean(window.SABA_TILL));

    // Signed in on its own account, because a session belongs to a terminal
    // and not to the restaurant — which is the thing being checked here.
    await page2.evaluate(async () => {
      const staff = await (await window.SABA_TILL('/api/session/staff')).json();
      const who = staff.staff.find((u) => u.role === 'admin');
      await window.SABA_TILL('/api/session', {
        method: 'POST',
        body: JSON.stringify({ userId: who.id, pin: '1379', terminal: 'test' }),
      });
    });

    const theirs = await openTables(page2);
    t.ok(!theirs.some((row) => row.includes('Survives a reload')),
      'the second device is a till of its own, not a window onto the first');

    await till1.close();
    await till2.close();
  } finally {
    await browser.close();
    await site.stop();
  }
});

test('every kind of record survives, not just the orders', async (t) => {
  const site = await serveSite(SITE, nextPort());
  const browser = await launch();

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${site.base}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.SABA_TILL));

    // Sign in as the owner, who can reach everything, and touch one record of
    // several kinds: a booking, the carte, an 86, the tax rate, the roster.
    await page.evaluate(async () => {
      const staff = await (await window.SABA_TILL('/api/session/staff')).json();
      const owner = staff.staff.find((u) => u.role === 'admin');
      await window.SABA_TILL('/api/session', {
        method: 'POST',
        body: JSON.stringify({ userId: owner.id, pin: '1379', terminal: 'test' }),
      });

      const post = (path, body) => window.SABA_TILL(path, {
        method: 'POST', body: JSON.stringify(body),
      });

      await post('/api/reservations', {
        name: 'Stored', covers: 2, at: Date.now() + 3600_000,
      });
      await post('/api/attendance/in', {});

      const state = await (await window.SABA_TILL('/api/state')).json();
      const dish = state.menu.find((i) => i.available);
      await post(`/api/menu/${dish.id}/eighty-six`, { on: true, note: 'stored' });

      await window.SABA_TILL('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ charges: { serviceChargePercent: 7.5 } }),
      });
    });

    await page.close();

    const again = await context.newPage();
    await again.goto(`${site.base}/`, { waitUntil: 'networkidle' });
    await again.waitForFunction(() => Boolean(window.SABA_TILL));

    const kept = await again.evaluate(async () => {
      const staff = await (await window.SABA_TILL('/api/session/staff')).json();
      const owner = staff.staff.find((u) => u.role === 'admin');
      await window.SABA_TILL('/api/session', {
        method: 'POST',
        body: JSON.stringify({ userId: owner.id, pin: '1379', terminal: 'test' }),
      });
      const state = await (await window.SABA_TILL('/api/state')).json();
      const settings = await (await window.SABA_TILL('/api/settings')).json();
      const hours = await (await window.SABA_TILL('/api/attendance')).json();
      return {
        booking: state.reservations.some((r) => r.name === 'Stored'),
        eightySix: state.menu.filter((item) => item.eightySixed).length,
        service: settings.settings.charges.serviceChargeBps,
        clockedIn: (hours.mine || []).length,
      };
    });

    t.ok(kept.booking, 'a booking written in the book is still in the book');
    t.ok(kept.eightySix > 0, 'a dish taken off the carte is still off it');
    t.equal(kept.service, 750, 'and the restaurant’s own service charge survived');
    t.ok(kept.clockedIn > 0, 'and the shift somebody clocked into is still open');

    await context.close();
  } finally {
    await browser.close();
    await site.stop();
  }
});

test('a record edited five times offline queues once, not five times', async (t) => {
  const site = await serveSite(SITE, nextPort());
  const browser = await launch();

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${site.base}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.SABA_TILL));

    const queued = await page.evaluate(async () => {
      const staff = await (await window.SABA_TILL('/api/session/staff')).json();
      const who = staff.staff.find((u) => u.role === 'captain');
      await window.SABA_TILL('/api/session', {
        method: 'POST',
        body: JSON.stringify({ userId: who.id, pin: '2471', terminal: 'test' }),
      });

      const seated = await (await window.SABA_TILL('/api/tables/t5/seat', {
        method: 'POST', body: JSON.stringify({ covers: 2 }),
      })).json();
      const id = seated.order.id;

      const state = await (await window.SABA_TILL('/api/state')).json();
      const dish = state.menu.find((i) => i.available && !i.modifierGroups?.length);

      // Five separate writes against the same table.
      for (let n = 0; n < 5; n += 1) {
        await window.SABA_TILL(`/api/orders/${id}/lines`, {
          method: 'POST', body: JSON.stringify({ itemId: dish.id, qty: 1 }),
        });
      }

      const idb = await new Promise((resolve) => {
        const request = indexedDB.open('saba');
        request.onsuccess = () => resolve(request.result);
      });
      const rows = await new Promise((resolve) => {
        const request = idb.transaction(['syncOutbox']).objectStore('syncOutbox').getAll();
        request.onsuccess = () => resolve(request.result);
      });
      idb.close();

      return {
        forThisOrder: rows.filter((r) => r.id === id).length,
        key: rows.find((r) => r.id === id)?.key,
        kinds: [...new Set(rows.map((r) => r.store))].sort(),
      };
    });

    t.equal(queued.forThisOrder, 1,
      'the table is queued once however many dishes were rung up against it');
    t.ok(queued.key?.startsWith('orders::'),
      'filed under its store and its id, which is what makes that collapse work');
    t.ok(queued.kinds.includes('orders') && queued.kinds.includes('audit'),
      'and the audit line the same write produced is queued beside it');

    await context.close();
  } finally {
    await browser.close();
    await site.stop();
  }
});

test('a till that already holds a restaurant is never seeded over', async (t) => {
  const site = await serveSite(SITE, nextPort());
  const browser = await launch();

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Build a database by hand, the way a till that has been trading would
    // have left one, and then let the application open it. Today's schema is
    // version 1, so this is the oldest there is — when it becomes version 2
    // this case is what will catch an upgrade that quietly drops a year of
    // bills, which is the whole reason to write it now rather than then.
    // Deliberately NOT the application: loading it would boot a till, which
    // would seed itself, which is the very thing being tested. Any page on
    // the same origin shares that origin's storage, and a 404 is a page.
    await page.goto(`${site.base}/not-the-app`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      const idb = await new Promise((resolve, reject) => {
        const request = indexedDB.open('saba', 1);
        request.onupgradeneeded = () => {
          for (const name of ['orders', 'reservations', 'menu', 'eightySix',
            'users', 'audit', 'shifts', 'attendance', 'settings', 'counters']) {
            request.result.createObjectStore(name, { keyPath: 'id' });
          }
          request.result.createObjectStore('syncOutbox', { keyPath: 'key' });
          request.result.createObjectStore('device', { keyPath: 'key' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      const tx = idb.transaction(['users', 'settings', 'orders'], 'readwrite');
      tx.objectStore('users').put({
        id: 'u_old', name: 'Hilda Dsouza', initials: 'HD',
        role: 'admin', pin: '8317', active: true,
      });
      tx.objectStore('settings').put({ id: 'restaurant', value: { name: 'The Old Till' } });
      tx.objectStore('orders').put({
        id: 'ord_old', number: 4001, code: 'SAB-4001', tableId: 't9', tableLabel: '9',
        sectionId: 'hall', covers: 6, guestName: 'Been here a year', status: 'OPEN',
        openedAt: Date.now(), lines: [], kots: [], payments: [],
        charges: { serviceCharge: true, discount: { mode: 'NONE', value: 0 } },
      });
      await new Promise((resolve) => { tx.oncomplete = resolve; });
      idb.close();
    });

    // Now open the application against it.
    const fresh = await context.newPage();
    await fresh.goto(`${site.base}/`, { waitUntil: 'networkidle' });
    await fresh.waitForFunction(() => Boolean(window.SABA_TILL));

    const found = await fresh.evaluate(async () => {
      const staff = await (await window.SABA_TILL('/api/session/staff')).json();
      await window.SABA_TILL('/api/session', {
        method: 'POST',
        body: JSON.stringify({ userId: 'u_old', pin: '8317', terminal: 'test' }),
      });
      const state = await (await window.SABA_TILL('/api/state')).json();
      return {
        staff: staff.staff.map((u) => u.name),
        tables: (state.orders || []).map((o) => o.guestName),
        restaurant: state.settings?.restaurant?.name,
      };
    });

    t.ok(found.staff.includes('Hilda Dsouza'),
      'the staff who were on this till are still the staff on this till');
    t.ok(!found.staff.includes('Alina Rahman'),
      'and the demonstration cast was not seeded in on top of them');
    t.ok(found.tables.includes('Been here a year'),
      'the table that was open is still open');
    t.equal(found.restaurant, 'The Old Till',
      'and it is still their restaurant, not the one the carte ships with');

    await context.close();
  } finally {
    await browser.close();
    await site.stop();
  }
});
