// Tiny app for the smoke test. /login renders the mockup's markup with a live clock, /login-shifted moves the
// form down, /cards has three .card elements and /box is wider than the mockup's box.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const pages = { '/login': 'login.html', '/login-shifted': 'login-shifted.html', '/cards': 'cards.html', '/box': 'box.html', '/assets/app.css': 'assets/app.css' };
const port = Number(process.env.PORT ?? 4317);

createServer((req, res) => {
  const file = pages[new URL(req.url, 'http://x').pathname];
  if (!file) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  let body = readFileSync(join(root, file), 'utf8');
  body = body.replace('__CLOCK__', new Date().toISOString().slice(11, 19));
  res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' });
  res.end(body);
}).listen(port, '127.0.0.1');
