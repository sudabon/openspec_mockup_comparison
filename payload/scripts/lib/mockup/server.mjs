import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, sep } from 'node:path';
import { sha256 } from './base-digest.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

// The path inside the root that a request asks for, or null when it may not be served.
export function requestedPath(rawUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(rawUrl, 'http://127.0.0.1').pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0') || pathname.includes('\\')) return null;
  if (pathname.endsWith('/')) pathname += 'index.html';
  const rel = pathname.replace(/^\/+/, '');
  if (!rel || rel.split('/').some(segment => segment === '..' || segment === '.')) return null;
  return rel;
}

// Serves `root` on 127.0.0.1 at a free port. Anything that resolves outside the root (`..`, absolute paths,
// symlinks) is refused with 403. Every file served is recorded with its sha256, so the caller can digest exactly
// what the browser loaded.
export function startMockupServer(root) {
  const realRoot = realpathSync(root);
  const served = new Map();
  const server = createServer((req, res) => {
    const deny = (code, text) => {
      res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(text);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return deny(405, 'method not allowed');
    const rel = requestedPath(req.url);
    if (rel == null) return deny(403, 'forbidden');
    const abs = join(realRoot, rel);
    if (!existsSync(abs)) return deny(404, 'not found');
    let real;
    try {
      real = realpathSync(abs);
    } catch {
      return deny(404, 'not found');
    }
    if (real !== realRoot && !real.startsWith(realRoot + sep)) return deny(403, 'forbidden');
    if (statSync(real).isDirectory()) return deny(403, 'forbidden');
    const body = readFileSync(real);
    served.set(rel, sha256(body));
    res.writeHead(200, { 'content-type': TYPES[extname(rel).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        origin: `http://127.0.0.1:${port}`,
        served: () => [...served].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([path, sha]) => ({ path, sha256: sha })),
        reset: () => served.clear(),
        close: () => new Promise(done => server.close(() => done())),
      });
    });
  });
}
