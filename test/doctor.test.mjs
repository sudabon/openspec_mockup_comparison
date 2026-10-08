import assert from 'node:assert/strict';
import { appendFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { parsePolicy } from '../payload/scripts/lib/mockup/policy.mjs';
import { addonRepo, readIn, runGate, runInstall, runTestkitGate, ROOT } from './support.mjs';

test('doctor passes right after install and notes the missing @playwright/test without failing', t => {
  const repo = addonRepo(t);
  const result = runGate(repo.dir, ['doctor']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /統合系統の派生 schema として扱われます/);
  assert.match(result.stdout, /@playwright\/test が見つかりません/);
  assert.match(result.stdout, /doctor: ok/);
});

test('testkit was updated after the add-on: doctor reports the drift until the add-on is updated', t => {
  const repo = addonRepo(t);
  appendFileSync(join(repo.dir, 'openspec/schemas/quality-driven-e2e/schema.yaml'), '# changed by a testkit update\n');
  const drift = runGate(repo.dir, ['doctor']);
  assert.equal(drift.status, 1);
  assert.match(drift.stdout, /統合 schema が派生 schema の生成後に変わっています \(schema\.yaml\).*update/);
  const update = runInstall(repo.dir, ['update']);
  assert.equal(update.status, 0, update.stderr);
  assert.match(update.stdout, /更新: openspec\/schemas\/quality-driven-e2e-mockup\/schema\.yaml/);
  assert.equal(runGate(repo.dir, ['doctor']).status, 0);
});

test('a changed template of the integrated schema is drift too', t => {
  const repo = addonRepo(t);
  appendFileSync(join(repo.dir, 'openspec/schemas/quality-driven-e2e/templates/quality.md'), '\n<!-- new -->\n');
  const drift = runGate(repo.dir, ['doctor']);
  assert.equal(drift.status, 1);
  assert.match(drift.stdout, /templates\/quality\.md/);
});

test('a tampered gate module or generated schema fails doctor', t => {
  for (const rel of ['scripts/lib/mockup/check.mjs', 'openspec/schemas/quality-driven-e2e-mockup/schema.yaml']) {
    const repo = addonRepo(t);
    appendFileSync(join(repo.dir, rel), '\n// edited\n');
    const result = runGate(repo.dir, ['doctor']);
    assert.equal(result.status, 1, rel);
    assert.match(result.stdout, new RegExp(`必須ファイルが導入内容と違います: ${rel.replaceAll('.', '\\.')}`), rel);
  }
});

test('testkit no longer recognising the derived schema fails doctor', t => {
  const repo = addonRepo(t);
  rmSync(join(repo.dir, 'openspec/schemas/quality-driven-e2e-mockup/testkit-compat.json'));
  const result = runGate(repo.dir, ['doctor']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /testkit が quality-driven-e2e-mockup を統合系統の派生 schema と判定しません/);
  assert.match(runTestkitGate(repo.dir, ['doctor']).stdout + '', /./);
});

test('a missing testkit export is reported by name with exit code 2', t => {
  const repo = addonRepo(t);
  writeFileSync(join(repo.dir, 'scripts/lib/registry.mjs'), 'export const nothing = 1;\n');
  const result = runGate(repo.dir, ['doctor']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /registry\.mjs#checkRegistry/);
});

test('an invalid policy fails doctor and environment variables are ignored with a note', t => {
  const repo = addonRepo(t);
  const policy = readIn(repo.dir, 'openspec/mockup-policy.md').replace('mockup_max_threshold: 0.05', 'mockup_max_threshold: 0.005');
  writeFileSync(join(repo.dir, 'openspec/mockup-policy.md'), policy);
  const result = runGate(repo.dir, ['doctor'], { env: { ...process.env, MOCKUP_MAX_THRESHOLD: '1' } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /mockup_default_threshold \(0\.01\) が mockup_max_threshold \(0\.005\) を超えています/);
  assert.match(result.stdout, /環境変数 MOCKUP_MAX_THRESHOLD は無視しました/);
});

test('the shipped policy is valid and pins the reference image by digest', () => {
  const text = readIn(ROOT, 'payload/openspec/mockup-policy.md');
  const parsed = parsePolicy(text);
  assert.deepEqual(parsed.errors, []);
  assert.match(parsed.values.mockup_reference_environment, /^mcr\.microsoft\.com\/playwright:v[\d.]+-noble@sha256:[0-9a-f]{64}$/);
  assert.equal(parsed.values.mockup_root, 'mockups');
});

test('policy keys must be standalone lines', () => {
  const text = readIn(ROOT, 'payload/openspec/mockup-policy.md');
  for (const [from, to, message] of [
    ['mockup_root: mockups', '- mockup_root: mockups', /独立した行/],
    ['mockup_root: mockups', 'mockup_root: ../outside', /repo 内の相対パス/],
    ['mockup_pixel_tolerance: 0.1', 'mockup_pixel_tolerance: 2', /0〜1/],
    ['mockup_ignore_paths: [docs/**, README*, "**/*.md"]', 'mockup_ignore_paths: docs/**', /\[a, b\]/],
  ]) {
    const parsed = parsePolicy(text.replace(from, to));
    assert.ok(parsed.errors.some(error => message.test(error)), `${to}: ${parsed.errors.join(' | ')}`);
  }
});
