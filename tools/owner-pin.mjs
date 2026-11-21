#!/usr/bin/env node
/**
 * Set the owner's PIN on this till.
 *
 *   npm run owner-pin -- 4812
 *
 * For the two ways a restaurant ends up locked out of its own system: the
 * first-run PIN scrolled past unread, or the owner left and took theirs with
 * them. PINs are stored scrypt-hashed and cannot be read back out of the
 * database by anybody, us included, so recovery means setting a new one.
 *
 * If there is an admin account it is re-PINned; if there is not, one called
 * Owner is created. Either way everybody holding a session for that account
 * is signed out, which is the point.
 *
 * This has to be run ON the till, in the folder the till runs from. That is
 * the whole of its security: somebody standing at that machine with the
 * database in front of them can already do anything to it. It is deliberately
 * not reachable over the network, where somebody merely on the wi-fi could
 * find it.
 */

import { config } from '../server/config.js';
import { openDatabase, closeDatabase } from '../server/db/index.js';
import { one, all } from '../server/db/index.js';
import * as auth from '../server/auth.js';

const pin = String(process.argv[2] || '').trim();

const usage = (message) => {
  console.error(`\n  ${message}\n`);
  console.error('  Usage:  npm run owner-pin -- 4812');
  console.error('          (four digits, on the till itself)\n');
  process.exit(1);
};

if (!pin) usage('Give the new PIN as an argument.');

openDatabase();
try {
  // validatePin refuses the guessable ones — 1234, 0000, a birthday year —
  // and it refuses them here for exactly the reason it refuses them in Setup.
  try {
    auth.validatePin(pin);
  } catch (error) {
    usage(error.message);
  }

  const admin = one(
    "SELECT * FROM users WHERE role = 'admin' AND active = 1 ORDER BY created_at LIMIT 1"
  );

  if (admin) {
    auth.updateUser(admin.id, { pin });
    console.log(`\n  ${admin.name}'s PIN is now ${pin}.`);
    console.log('  Anybody signed in as them has been signed out.\n');
  } else {
    const created = auth.createUser({ name: 'Owner', role: 'admin', pin });
    console.log(`\n  There was no owner on this till, so one was created.`);
    console.log(`  Sign in as ${created.name} with ${pin}.\n`);
  }

  const others = all("SELECT name, role FROM users WHERE active = 1 AND role != 'admin'");
  if (others.length) {
    console.log('  The rest of the staff are untouched:');
    for (const row of others) console.log(`    ${row.name} · ${row.role}`);
    console.log('');
  }

  console.log(`  Till data: ${config.dataDir}`);
  console.log('  Change it again from Setup, People, once you are in.\n');
} finally {
  closeDatabase();
}
