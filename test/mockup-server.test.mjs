import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { requestedPath, startMockupServer } from '../payload/scripts/lib/mockup/server.mjs';
import { tempDir, writeIn } from './support.mjs';

// Sends the path exactly as written, without the URL normalisation fetch() would apply.
function rawGet(origin, path) {
  const { hostname, port } = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, path, method: 'GET' }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), type: res.headers['content-type'] }));
    });
    req.on('error', reject);
    req.end();
  });
}

function fixture() {
  const dir = tempDir('mk-server-');
  writeIn(dir, 'secret.txt', 'outside\n');
  writeIn(dir, 'mockups/login.html', '<link rel="stylesheet" href="/assets/app.css"><h1>Login</h1>\n');
  writeIn(dir, 'mockups/assets/app.css', 'h1 { color: red; }\n');
  writeIn(dir, 'mockups/sub/index.html', '<p>index</p>\n');
  mkdirSync(join(dir, 'mockups/linked'), { recursive: true });
  symlinkSync(join(dir, 'secret.txt'), join(dir, 'mockups/leak.txt'));
  symlinkSync(dir, join(dir, 'mockups/linked/up'));
  return dir;
}

test('requestedPath refuses parent segments, backslashes and NUL', () => {
  assert.equal(requestedPath('/login.html'), 'login.html');
  assert.equal(requestedPath('/sub/'), 'sub/index.html');
  assert.equal(requestedPath('/a%20b.html'), 'a b.html');
  for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/sub/%2E%2E/%2E%2E/secret.txt', '/a\\..\\b', '/x%00.html', '/%E0%A4%A']) {
    const rel = requestedPath(path);
    assert.ok(rel === null || !rel.split('/').includes('..'), `${path} → ${rel}`);
  }
});

test('the server serves files under the root and records what it served', async () => {
  const dir = fixture();
  const server = await startMockupServer(join(dir, 'mockups'));
  try {
    const page = await rawGet(server.origin, '/login.html');
    assert.equal(page.status, 200);
    assert.match(page.type, /text\/html/);
    assert.equal((await rawGet(server.origin, '/assets/app.css')).status, 200);
    assert.equal((await rawGet(server.origin, '/sub/')).status, 200);
    assert.equal((await rawGet(server.origin, '/missing.html')).status, 404);
    const sha = text => createHash('sha256').update(text).digest('hex');
    assert.deepEqual(server.served(), [
      { path: 'assets/app.css', sha256: sha('h1 { color: red; }\n') },
      { path: 'login.html', sha256: sha('<link rel="stylesheet" href="/assets/app.css"><h1>Login</h1>\n') },
      { path: 'sub/index.html', sha256: sha('<p>index</p>\n') },
    ]);
    server.reset();
    assert.deepEqual(server.served(), []);
  } finally {
    await server.close();
  }
});

test('paths outside the root are refused with 403: parent segments, absolute paths and symlinks', async () => {
  const dir = fixture();
  const server = await startMockupServer(join(dir, 'mockups'));
  try {
    for (const path of ['/../secret.txt', '/sub/../../secret.txt', '/%2e%2e/secret.txt', `/${encodeURIComponent(join(dir, 'secret.txt'))}`, '/leak.txt', '/linked/up/secret.txt', '/sub']) {
      const response = await rawGet(server.origin, path);
      assert.ok([403, 404].includes(response.status), `${path} → ${response.status}`);
      assert.doesNotMatch(response.body, /outside/, path);
    }
    // `..` is resolved by URL parsing before the file system is touched, so it only ever reaches paths inside the root.
    for (const path of ['/leak.txt', '/linked/up/secret.txt']) {
      assert.equal((await rawGet(server.origin, path)).status, 403, path);
    }
    assert.deepEqual(server.served(), []);
  } finally {
    await server.close();
  }
});

test('the server listens only on the loopback interface', async () => {
  const dir = fixture();
  const server = await startMockupServer(join(dir, 'mockups'));
  try {
    assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  } finally {
    await server.close();
  }
});
