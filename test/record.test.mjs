import assert from 'node:assert/strict';
import test from 'node:test';
import { classify, mockupChange, readResults, ROWS, rawResult, writeAllRaw, writeRaw } from './fixtures.mjs';
import { addonRepo, readIn, runGate, writeIn } from './support.mjs';

function setup(t) {
  const repo = addonRepo(t);
  mockupChange(repo);
  repo.commit('change');
  return repo;
}

test('Recording after a run: every MK and viewport with the run environment', t => {
  const repo = setup(t);
  const written = writeAllRaw(repo, { 'MK-002 1280x800': { status: 'diff', ratio: 0.05, threshold: 0.02 } });
  const result = runGate(repo.dir, ['record', 'add-login']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /pass 2 \/ diff 1 \/ error 0 \/ missing 0/);
  const results = readResults(repo);
  assert.equal(results.version, 1);
  assert.equal(results.change, 'add-login');
  assert.equal(results.commit, repo.head());
  assert.deepEqual(results.dirty, []);
  assert.equal(results.environment.image, written[0].environment.image);
  assert.deepEqual(results.results.map(item => `${item.mk} ${item.viewport} ${item.status}`), ['MK-001 1280x800 pass', 'MK-001 375x812 pass', 'MK-002 1280x800 diff']);
  const diff = results.results[2];
  for (const key of ['ratio', 'threshold', 'mockupSha', 'actualSha', 'diffSha', 'mockupDigest', 'planRowDigest']) assert.equal(diff[key], written[2][key], key);
  const report = readIn(repo.dir, 'openspec/changes/add-login/mockup-report.md');
  assert.match(report, new RegExp(`\\| MK-002 \\| 1280x800 \\| 0\\.05 \\| ${diff.diffSha} \\|  \\|  \\|`));
  assert.match(report, /## 許容判断/);
  assert.doesNotMatch(report, /MK-001 \| 1280x800/);
});

test('a viewport without a run is recorded as missing', t => {
  const repo = setup(t);
  writeRaw(repo, rawResult(repo, { mk: 'MK-001', viewport: '1280x800', row: ROWS[0] }));
  const result = runGate(repo.dir, ['record', 'add-login']);
  assert.equal(result.status, 0, result.stderr);
  const statuses = readResults(repo).results.map(item => item.status);
  assert.deepEqual(statuses, ['pass', 'missing', 'missing']);
});

test('Uncommitted changes during the run are recorded and reported', t => {
  const repo = setup(t);
  writeAllRaw(repo, {}, { dirty: ['src/login.tsx'] });
  const result = runGate(repo.dir, ['record', 'add-login']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readResults(repo).dirty, ['src/login.tsx']);
  assert.match(result.stdout, /未コミットの変更がある状態の結果です（src\/login\.tsx）。final ゲートは受け付けません/);
});

test('results of different runs are never mixed', t => {
  const repo = setup(t);
  writeAllRaw(repo, { 'MK-002 1280x800': { image: 'local' } });
  const result = runGate(repo.dir, ['record', 'add-login']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /別の実行.*MK-002 1280x800/s);
});

test('re-recording replaces the results and keeps a classification only while the diff image is unchanged', t => {
  const repo = setup(t);
  writeAllRaw(repo, {
    'MK-001 375x812': { status: 'diff', ratio: 0.03 },
    'MK-002 1280x800': { status: 'diff', ratio: 0.05, threshold: 0.02 },
  });
  assert.equal(runGate(repo.dir, ['record', 'add-login']).status, 0);
  classify(repo);
  const before = readResults(repo);
  writeAllRaw(repo, {
    'MK-001 375x812': { status: 'diff', ratio: 0.03 },
    'MK-002 1280x800': { status: 'diff', ratio: 0.04, threshold: 0.02 },
  });
  assert.equal(runGate(repo.dir, ['record', 'add-login']).status, 0);
  const after = readResults(repo);
  assert.notEqual(after.recordedAt, before.recordedAt);
  const report = readIn(repo.dir, 'openspec/changes/add-login/mockup-report.md');
  assert.match(report, /\| MK-001 \| 375x812 \| 0\.03 \| [0-9a-f]{64} \| 意図した差 \| ボタンの角丸の差 \|/);
  assert.match(report, /\| MK-002 \| 1280x800 \| 0\.04 \| [0-9a-f]{64} \|  \|  \|/);
  assert.equal(report.split('\n').filter(line => line === '## 所見').length, 1);
});

test('record refuses inputs it cannot use', t => {
  const repo = setup(t);
  assert.equal(runGate(repo.dir, ['record']).status, 2);
  assert.equal(runGate(repo.dir, ['record', 'nope']).status, 2);
  const none = runGate(repo.dir, ['record', 'add-login']);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /比較の結果がありません/);
  const misplacedResult = { ...rawResult(repo, { mk: 'MK-001', viewport: '1280x800', row: ROWS[0] }), mk: 'MK-002' };
  writeIn(repo.dir, 'test-results/mockup/add-login/MK-001/1280x800/result.json', JSON.stringify(misplacedResult));
  const misplaced = runGate(repo.dir, ['record', 'add-login']);
  assert.equal(misplaced.status, 2);
  assert.match(misplaced.stderr, /置き場所と一致しません/);
});
