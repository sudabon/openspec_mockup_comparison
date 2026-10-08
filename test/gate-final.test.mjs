import assert from 'node:assert/strict';
import test from 'node:test';
import { approve, classify, mockupChange, planText, readResults, ROWS, writeAllRaw } from './fixtures.mjs';
import { addonRepo, readIn, runGate, writeIn } from './support.mjs';

const DIFF = { 'MK-002 1280x800': { status: 'diff', ratio: 0.05, threshold: 0.02 } };

// A committed change whose results were recorded at HEAD in the reference environment.
function recorded(t, overrides = {}, common = {}) {
  const repo = addonRepo(t);
  mockupChange(repo);
  repo.commit('change');
  writeAllRaw(repo, overrides, common);
  const record = runGate(repo.dir, ['record', 'add-login']);
  assert.equal(record.status, 0, record.stdout + record.stderr);
  repo.commit('results');
  return repo;
}

function final(repo) {
  return runGate(repo.dir, ['check', '--phase', 'final', 'add-login']);
}

test('results that all pass in the reference environment pass the final gate', t => {
  const repo = recorded(t);
  const result = final(repo);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /▶ add-login \(active\/final\)/);
});

test('Implementation changed after the run: the results are stale', t => {
  const repo = recorded(t);
  writeIn(repo.dir, 'src/pages/login.tsx', 'export default 1;\n');
  repo.commit('implementation');
  const result = final(repo);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /比較の実行後に変わったファイルがあります。比較をやり直して record してください: src\/pages\/login\.tsx/);
});

test('ignored paths and OpenSpec artifacts do not make the results stale', t => {
  const repo = recorded(t);
  writeIn(repo.dir, 'docs/guide.md', '# guide\n');
  writeIn(repo.dir, 'README.md', '# readme\n');
  writeIn(repo.dir, 'openspec/changes/add-login/design.md', '# design\n');
  repo.commit('docs');
  const result = final(repo);
  assert.equal(result.status, 0, result.stdout);
});

test('Result from a local machine is refused', t => {
  const repo = recorded(t, {}, { image: 'local' });
  const result = final(repo);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /正の環境の結果ではありません（結果: local、policy: mcr\.microsoft\.com\/playwright/);
});

test('Mockup edited after the run fails by digest', t => {
  const repo = recorded(t);
  writeIn(repo.dir, 'mockups/assets/app.css', '.login { width: 360px; }\n');
  repo.commit('mockup');
  const result = final(repo);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /MK-001 1280x800 は比較の実行後にモックが変わっています/);
});

test('a plan row edited after the run fails by row digest', t => {
  const repo = recorded(t);
  const rows = ROWS.map((row, index) => (index === 0 ? { ...row, Masks: '`.clock`: 現在時刻; `.avatar`: 画像' } : row));
  writeIn(repo.dir, 'openspec/changes/add-login/mockup-plan.md', planText(rows));
  repo.commit('plan');
  const result = final(repo);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /MK-001 1280x800 は比較の実行後に mockup-plan の行が変わっています/);
  assert.doesNotMatch(result.stdout, /MK-002 1280x800 は比較の実行後に mockup-plan/);
});

test('a run with uncommitted changes, a foreign commit or bad statuses fails', t => {
  const dirty = recorded(t, {}, { dirty: ['src/login.tsx'] });
  assert.match(final(dirty).stdout, /未コミットの変更がある状態の結果です（src\/login\.tsx）/);
  const foreign = recorded(t, {}, { commit: '0123456789abcdef0123456789abcdef01234567' });
  assert.match(final(foreign).stdout, /commit 0123456789ab は HEAD の祖先ではありません/);
  const errored = recorded(t, { 'MK-001 375x812': { status: 'error', notes: ['マスクの面積率 0.5 が上限 0.3 を超えています'] } });
  assert.match(final(errored).stdout, /MK-001 375x812 は error です（マスクの面積率 0\.5/);
});

test('a missing results file fails and not-applicable needs none', t => {
  const repo = addonRepo(t);
  mockupChange(repo);
  repo.commit('change');
  assert.match(final(repo).stdout, /mockup-results\.json がありません/);
  const backend = addonRepo(t);
  mockupChange(backend, { plan: planText([], { mockup: 'not-applicable', reason: 'UI 変更なし' }), tests: false });
  backend.commit('backend');
  const result = final(backend);
  assert.equal(result.status, 0, result.stdout);
});

test('a diff without a human acceptance fails, and its finding must be classified', t => {
  const repo = recorded(t, DIFF);
  const result = final(repo);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /MK-002 1280x800 の所見の分類は 実装の不備 \/ 意図した差 \/ 描画ノイズ のどれかです（実際: 空）/);
  assert.match(result.stdout, /MK-002 1280x800 は閾値を超えています（差分率 0\.05、閾値 0\.02）。実装を直して比較をやり直すか、人間が mockup-report\.md の許容判断に記入してください/);
});

test('Approved intentional difference passes', t => {
  const repo = recorded(t, DIFF);
  classify(repo);
  const digest = readResults(repo).results.find(item => item.mk === 'MK-002').diffSha;
  approve(repo, { mk: 'MK-002', viewport: '1280x800', digest });
  repo.commit('accepted');
  const result = final(repo);
  assert.equal(result.status, 0, result.stdout);
});

test('Approval for an older diff is invalid after a re-run', t => {
  const repo = recorded(t, DIFF);
  classify(repo);
  const old = readResults(repo).results.find(item => item.mk === 'MK-002').diffSha;
  approve(repo, { mk: 'MK-002', viewport: '1280x800', digest: old });
  repo.commit('accepted');
  writeAllRaw(repo, { 'MK-002 1280x800': { status: 'diff', ratio: 0.04, threshold: 0.02 } });
  assert.equal(runGate(repo.dir, ['record', 'add-login']).status, 0);
  classify(repo);
  repo.commit('re-run');
  const result = final(repo);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /MK-002 1280x800 の許容判断の差分 digest が現在の差分画像と一致しません（比較をやり直したため承認は無効です）/);
});

test('Reviewer says noise but no approval: the finding alone does not pass', t => {
  const repo = recorded(t, DIFF);
  classify(repo, { classification: '描画ノイズ', basis: 'アンチエイリアスの差' });
  repo.commit('classified');
  const result = final(repo);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /MK-002 1280x800 は閾値を超えています/);
  assert.doesNotMatch(result.stdout, /所見の分類/);
});

test('an acceptance without approver or with a bad date fails', t => {
  for (const [field, message] of [[{ approver: '' }, /許容判断に承認者がありません/], [{ date: '2026/10/09' }, /承認日が YYYY-MM-DD ではありません（実際: 2026\/10\/09）/]]) {
    const repo = recorded(t, DIFF);
    classify(repo);
    const digest = readResults(repo).results.find(item => item.mk === 'MK-002').diffSha;
    approve(repo, { mk: 'MK-002', viewport: '1280x800', digest, ...field });
    repo.commit('accepted');
    const result = final(repo);
    assert.equal(result.status, 1, JSON.stringify(field));
    assert.match(result.stdout, message);
  }
});

test('the acceptance table is required in mockup-report.md', t => {
  const repo = recorded(t, DIFF);
  classify(repo);
  const path = 'openspec/changes/add-login/mockup-report.md';
  writeIn(repo.dir, path, readIn(repo.dir, path).split('## 許容判断')[0]);
  repo.commit('no acceptance table');
  assert.match(final(repo).stdout, /mockup-report\.md に ## 許容判断 がありません/);
});
