/**
 * The only module in this application that speaks IndexedDB.
 *
 * Everything above it — the till, the views, the sync loop — asks for records
 * and hands back records. If you find `indexedDB` anywhere else, that is a
 * bug: the whole point of putting it behind one door is that the rules below
 * are enforced in one place rather than remembered in forty.
 *
 * Two invariants, and they are the ones that matter:
 *
 *   A record and the reminder to send it are written in the SAME transaction.
 *   If a bill is saved but the outbox entry is not, that bill exists on this
 *   till and nowhere else, and nobody will ever find out. `commit()` writes
 *   both or neither.
 *
 *   Nothing in here ever awaits anything that is not storage. An IndexedDB
 *   transaction closes itself the moment control returns to the event loop
 *   without a pending request against it — so a `fetch` inside a transaction
 *   does not slow the transaction down, it ends it, and the writes after the
 *   await are lost. Network work happens before `commit()` is called or after
 *   it has resolved, never inside.
 */

const NAME = 'saba';

/**
 * Bump this when the stores change, and add a step to `upgrade()`.
 * Version 1 is the first durable till; before it the demonstration kept
 * everything in a plain object that died with the tab.
 */
export const VERSION = 1;

/**
 * The records a restaurant accumulates. Each is a store here and a `kind` in
 * the shared database, so adding a seventh kind of record needs no schema
 * change in either place.
 *
 * `settings` and `counters` look like single objects from the outside and are
 * kept here one key at a time — settings/charges, counters/invoice — because
 * two tills changing the tax rate and the floor plan in the same minute
 * should not have to fight over one row.
 */
export const RECORD_STORES = [
  'orders', 'reservations', 'menu', 'eightySix',
  'users', 'audit', 'shifts', 'attendance',
  'settings', 'counters',
];

/** Queued work: what this device has written and the server has not accepted. */
const OUTBOX = 'syncOutbox';

/**
 * This device's own business, which must never leave it and must never be
 * overwritten by another device: who is signed in at this terminal, the
 * connection settings, the sync cursor, the device tag.
 *
 * If connection settings synced, switching sharing off on the office laptop
 * would switch it off at the till, and one device with a bad key would push
 * that key to every other.
 */
const DEVICE = 'device';

const ALL_STORES = [...RECORD_STORES, OUTBOX, DEVICE];

/** The key an outbox entry is filed under, so five edits queue once. */
export const outboxKey = (store, id) => `${store}::${id}`;

let handle = null;

/* ----------------------------------------------------------- promises --- */

/** An IDBRequest as a promise. Only ever awaited outside a transaction. */
const ask = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/** A transaction as a promise that settles on commit, not on the last write. */
const settled = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('the write was aborted'));
});

/* --------------------------------------------------------------- open --- */

export function available() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    // Safari in a blocked third-party frame throws on the property itself.
    return false;
  }
}

/**
 * Open the database, creating or upgrading it as needed.
 *
 * Upgrades add stores and leave records alone. A till that has been trading
 * for a year must come through a version bump with every bill it had — which
 * is what `tests/browser/upgrade` builds an old database by hand to prove.
 */
export async function open() {
  if (handle) return handle;
  if (!available()) throw new Error('This browser has no storage for the till to use');

  const request = indexedDB.open(NAME, VERSION);
  request.onupgradeneeded = (event) => upgrade(request.result, event.oldVersion);

  handle = await ask(request);

  // Another tab opening a newer version: close ours rather than hold it back.
  handle.onversionchange = () => { handle.close(); handle = null; };

  return handle;
}

function upgrade(idb, from) {
  // Step 1 creates everything. Later steps only add what is new — never
  // delete a store with records in it to "clean up" a rename.
  if (from < 1) {
    for (const name of RECORD_STORES) {
      if (!idb.objectStoreNames.contains(name)) idb.createObjectStore(name, { keyPath: 'id' });
    }
    if (!idb.objectStoreNames.contains(OUTBOX)) {
      idb.createObjectStore(OUTBOX, { keyPath: 'key' });
    }
    if (!idb.objectStoreNames.contains(DEVICE)) {
      idb.createObjectStore(DEVICE, { keyPath: 'key' });
    }
  }
}

export function close() {
  handle?.close();
  handle = null;
}

/* --------------------------------------------------------------- read --- */

/**
 * Every record on this device, as one object the till can hold in memory.
 *
 * The whole working set in one read, on purpose. A restaurant's year is tens
 * of thousands of rows, which is nothing, and a screen that has it all in
 * hand repaints without touching storage at all.
 */
export async function readAll() {
  const idb = await open();
  const tx = idb.transaction(RECORD_STORES, 'readonly');
  const out = {};

  for (const name of RECORD_STORES) {
    out[name] = [];
    const request = tx.objectStore(name).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      out[name].push(cursor.value);
      cursor.continue();
    };
  }

  await settled(tx);
  return out;
}

/* -------------------------------------------------------------- write --- */

/**
 * Write a set of changes, and queue them to be shared, in one transaction.
 *
 * @param {Array<{store: string, id: string|number, value: object|null}>} changes
 *   `value: null` is a deletion, which travels as a tombstone rather than a
 *   silence — a record that merely vanishes comes straight back from the next
 *   device that still has it.
 * @param {object}  [opts]
 * @param {boolean} [opts.queue=true] false when applying what the server just
 *   sent us. A record that arrived from the server must not be queued to go
 *   back to the server, or two devices volley it between them forever.
 *
 * Resolves on commit. Not on the last write — on commit. Everything above
 * this line is allowed to tell a waiter their bill is saved only once this
 * promise has settled.
 */
export async function commit(changes, { queue = true } = {}) {
  if (!changes.length) return;

  const idb = await open();
  const touched = [...new Set(changes.map((c) => c.store))];
  const stores = queue ? [...touched, OUTBOX] : touched;
  const tx = idb.transaction(stores, 'readwrite');

  const at = Date.now();

  for (const change of changes) {
    const store = tx.objectStore(change.store);
    if (change.value === null) store.delete(change.id);
    else store.put(change.value);

    if (queue) {
      // Keyed by record, not by edit: a table that gets five dishes added
      // while the line is down queues once and goes up once, carrying
      // whatever it finally says.
      tx.objectStore(OUTBOX).put({
        key: outboxKey(change.store, change.id),
        store: change.store,
        id: change.id,
        deleted: change.value === null,
        at,
      });
    }
  }

  await settled(tx);
}

/* ------------------------------------------------------------- outbox --- */

/** What is still waiting to go up, oldest first. */
export async function outbox(limit = 500) {
  const idb = await open();
  const tx = idb.transaction([OUTBOX], 'readonly');
  const rows = await new Promise((resolve, reject) => {
    const request = tx.objectStore(OUTBOX).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await settled(tx);
  return rows.sort((a, b) => a.at - b.at).slice(0, limit);
}

export async function outboxCount() {
  const idb = await open();
  const tx = idb.transaction([OUTBOX], 'readonly');
  const n = await ask(tx.objectStore(OUTBOX).count());
  await settled(tx);
  return n;
}

/**
 * Forget queued entries, once the server has them.
 *
 * Called only after the server has answered. An entry dropped because the
 * request was *sent* is an entry dropped because of a dropped connection.
 */
export async function clearOutbox(keys) {
  if (!keys.length) return;
  const idb = await open();
  const tx = idb.transaction([OUTBOX], 'readwrite');
  for (const key of keys) tx.objectStore(OUTBOX).delete(key);
  await settled(tx);
}

/* ------------------------------------------------- this device's own --- */

export async function getDevice(key, fallback = null) {
  const idb = await open();
  const tx = idb.transaction([DEVICE], 'readonly');
  const row = await ask(tx.objectStore(DEVICE).get(key));
  await settled(tx);
  return row ? row.value : fallback;
}

export async function setDevice(key, value) {
  const idb = await open();
  const tx = idb.transaction([DEVICE], 'readwrite');
  tx.objectStore(DEVICE).put({ key, value });
  await settled(tx);
}

/* -------------------------------------------------------------- reset --- */

/**
 * Empty every record store, leaving this device's own settings alone.
 *
 * Used when a till joins a shared database that already has a restaurant in
 * it. The caller asks first and takes a backup first; this only does the
 * emptying.
 */
export async function wipeRecords() {
  const idb = await open();
  const tx = idb.transaction([...RECORD_STORES, OUTBOX], 'readwrite');
  for (const name of [...RECORD_STORES, OUTBOX]) tx.objectStore(name).clear();
  await settled(tx);
}

/** Everything, including the connection. Used by the demonstration's reset. */
export async function wipeAll() {
  const idb = await open();
  const tx = idb.transaction(ALL_STORES, 'readwrite');
  for (const name of ALL_STORES) tx.objectStore(name).clear();
  await settled(tx);
}
