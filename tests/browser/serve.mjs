/**
 * A static server for the browser tests, and nothing more.
 *
 * `file://` blocks ES modules and IndexedDB, so the built site has to be
 * served over HTTP even to test it. Node built-ins only, same as the rest of
 * this project.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

export function serveSite(root, port) {
  const server = createServer(async (req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';

    const full = normalize(join(root, rel));
    if (full !== root && !full.startsWith(root + sep)) {
      res.writeHead(403).end('no');
      return;
    }

    try {
      const body = await readFile(full);
      res.writeHead(200, {
        'content-type': TYPES[extname(full)] || 'application/octet-stream',
        // A test that silently reads a stale file is worse than a slow one.
        'cache-control': 'no-store',
      }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({
      server,
      base: `http://127.0.0.1:${port}`,
      stop: () => new Promise((done) => server.close(done)),
    }));
  });
}
