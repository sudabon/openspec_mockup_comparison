import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { testkitRepo } from './support.mjs';

test('testkitRepo gives a committed repository with testkit installed', t => {
  const repo = testkitRepo(t);
  for (const rel of ['.openspec-custom-testkit.json', 'scripts/lib/schema-family.mjs', 'openspec/schemas/quality-driven-e2e/schema.yaml']) {
    assert.ok(existsSync(join(repo.dir, rel)), rel);
  }
  assert.equal(repo.git(['status', '--porcelain']).trim(), '');
});

test('two repositories from the template are independent', t => {
  const a = testkitRepo(t);
  const b = testkitRepo(t);
  assert.notEqual(a.dir, b.dir);
  assert.notEqual(a.head(), '');
});
