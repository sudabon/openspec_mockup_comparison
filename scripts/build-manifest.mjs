#!/usr/bin/env node
// Records the vendored third-party files with their upstream, version, license and sha256.
// `--check` fails when upstream/manifest.json does not match the files on disk.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const VENDORED = [
  { path: 'payload/scripts/lib/mockup/vendor/pixelmatch.mjs', license: 'payload/scripts/lib/mockup/vendor/pixelmatch.LICENSE', name: 'pixelmatch', version: '5.3.0', spdx: 'ISC', url: 'https://github.com/mapbox/pixelmatch', note: 'CommonJS の export 行だけを ES module の export に変更' },
  { path: 'payload/scripts/lib/mockup/vendor/yaml.mjs', license: 'payload/scripts/lib/mockup/vendor/yaml.LICENSE', name: 'yaml', version: '2.8.1', spdx: 'ISC', url: 'https://github.com/eemeli/yaml', note: 'openspec-custom-testkit の payload/scripts/lib/vendor/yaml.mjs と同じ bundle' },
];

const sha = rel => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
const manifest = {
  vendored: VENDORED.map(item => ({ ...item, sha256: sha(item.path), licenseSha256: sha(item.license) })),
};
const text = `${JSON.stringify(manifest, null, 2)}\n`;
const out = join(root, 'upstream/manifest.json');
if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(out, 'utf8'); } catch { /* reported below */ }
  if (current !== text) {
    console.error('upstream/manifest.json が vendor のファイルと一致しません。npm run manifest を実行してください');
    process.exit(1);
  }
  console.log('upstream/manifest.json is up to date');
} else {
  writeFileSync(out, text);
  console.log('upstream/manifest.json を更新しました');
}
