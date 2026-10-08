import assert from 'node:assert/strict';
import test from 'node:test';
import { mockupChange } from './fixtures.mjs';
import { addonRepo, runGate, writeIn } from './support.mjs';

function integratedChange(repo, id) {
  writeIn(repo.dir, `openspec/changes/${id}/.openspec.yaml`, 'schema: quality-driven-e2e\ncreated: 2026-10-08\n');
  writeIn(repo.dir, `openspec/changes/${id}/proposal.md`, '# Proposal\n');
}

test('Mixed pull request: only the mockup change is checked, the integrated one is out of scope', t => {
  const repo = addonRepo(t);
  const base = repo.head();
  mockupChange(repo);
  integratedChange(repo, 'add-api');
  repo.commit('both');
  const result = runGate(repo.dir, ['check', '--base', base]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /▶ add-login \(active\/plan\)/);
  assert.match(result.stdout, /- add-api: 対象外 \(schema: quality-driven-e2e\)/);
  assert.match(result.stdout, /checked: 1 change\(s\), failures: 0/);
});

test('Switched away from the mockup schema: the change is not dropped silently', t => {
  for (const to of ['quality-driven-e2e', 'team-custom']) {
    const repo = addonRepo(t);
    mockupChange(repo);
    const base = repo.commit('mockup change');
    writeIn(repo.dir, 'openspec/changes/add-login/.openspec.yaml', `schema: ${to}\ncreated: 2026-10-08\n`);
    repo.commit('switch');
    const result = runGate(repo.dir, ['check', '--base', base]);
    assert.equal(result.status, 1, to);
    assert.match(result.stdout, new RegExp(`比較元で quality-driven-e2e-mockup だった change の schema が ${to} に変更されています`), to);
  }
});

test('an input error of testkit selection is exit code 2', t => {
  const repo = addonRepo(t);
  const missingRef = runGate(repo.dir, ['check', '--base', 'no-such-ref']);
  assert.equal(missingRef.status, 2);
  assert.match(missingRef.stderr, /比較元refを解決できません/);
  const missingChange = runGate(repo.dir, ['check', 'nope']);
  assert.equal(missingChange.status, 2);
  for (const args of [['check', '--phase', 'later'], ['check', '--bogus'], ['verify'], ['nothing']]) {
    assert.equal(runGate(repo.dir, args).status, 2, args.join(' '));
  }
});

test('testkit selection errors of a mockup change are failures of the mockup gate too', t => {
  const repo = addonRepo(t);
  mockupChange(repo);
  const base = repo.commit('mockup change');
  writeIn(repo.dir, 'openspec/changes/add-login/.openspec.yaml', 'schema: [broken\n');
  repo.commit('broken metadata');
  const result = runGate(repo.dir, ['check', '--base', base]);
  assert.equal(result.status, 1);
});

test('the phase follows testkit: all tasks done means final', t => {
  const repo = addonRepo(t);
  mockupChange(repo, { tasks: '# Tasks\n\n## 7. Mockup Comparison\n\n- [x] 7.1 done\n' });
  repo.commit('done');
  const result = runGate(repo.dir, ['check', 'add-login']);
  assert.match(result.stdout, /▶ add-login \(active\/final\)/);
  assert.match(result.stdout, /mockup-results\.json がありません/);
  assert.equal(result.status, 1);
});
