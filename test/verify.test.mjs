import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { mockupChange, writeAllRaw } from './fixtures.mjs';
import { addonRepo, runGate } from './support.mjs';

function recorded(t, common = {}) {
  const repo = addonRepo(t);
  mockupChange(repo);
  repo.commit('change');
  writeAllRaw(repo, {}, { image: 'local', ...common });
  assert.equal(runGate(repo.dir, ['record', 'add-login']).status, 0);
  repo.commit('results');
  return repo;
}

test('a reproduction with the same images passes', t => {
  const repo = recorded(t);
  writeAllRaw(repo, {}, { image: 'local', root: 'ci-run' });
  const result = runGate(repo.dir, ['verify', '--results', 'ci-run']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /✓ MK-001 1280x800/);
  assert.match(result.stdout, /verified: 1 change\(s\), failures: 0/);
});

test('Results produced outside the reference environment do not reproduce', t => {
  // The committed results claim the reference image but were made elsewhere; the CI re-run gives other images.
  const repo = recorded(t);
  writeAllRaw(repo, {
    'MK-001 375x812': { actualSha: 'f'.repeat(64), diffSha: 'e'.repeat(64), ratio: 0.002 },
  }, { root: 'ci-run' });
  const result = runGate(repo.dir, ['verify', '--results', 'ci-run', 'add-login']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /✗ MK-001 375x812 が再現しません: ratio 0 → 0\.002, actualSha [0-9a-f]{64} → f{64}, diffSha [0-9a-f]{64} → e{64}/);
  assert.match(result.stdout, /再実行の環境 \(mcr\.microsoft\.com\/playwright.*\) が記録の環境 \(local\) と違います/);
});

test('a pair missing from the re-run fails', t => {
  const repo = recorded(t);
  writeAllRaw(repo, {}, { image: 'local', root: 'ci-run' });
  rmSync(join(repo.dir, 'ci-run/add-login/MK-002'), { recursive: true });
  const result = runGate(repo.dir, ['verify', '--results', 'ci-run', 'add-login']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /✗ MK-002 1280x800 が再実行の結果にありません/);
});

test('verify needs --results and an existing directory', t => {
  const repo = recorded(t);
  assert.equal(runGate(repo.dir, ['verify']).status, 2);
  assert.equal(runGate(repo.dir, ['verify', '--results', 'nowhere']).status, 2);
});
