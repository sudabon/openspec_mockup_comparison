import assert from 'node:assert/strict';
import { rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { mockupChange, planText, QUALITY_VIEWPOINTS, ROWS } from './fixtures.mjs';
import { addonRepo, readIn, runGate, writeIn } from './support.mjs';

function check(t, options = {}, edit) {
  const repo = addonRepo(t);
  mockupChange(repo, options);
  edit?.(repo);
  return { repo, result: runGate(repo.dir, ['check', 'add-login'], { env: { ...process.env, ...(options.env ?? {}) } }) };
}

function withRow(over, index = 0) {
  return ROWS.map((row, i) => (i === index ? { ...row, ...over } : row));
}

test('a complete plan passes the plan gate', t => {
  const { result } = check(t);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /mockup: required（MK 2 件）/);
});

test('Threshold over the policy limit fails', t => {
  const { result } = check(t, { rows: withRow({ Threshold: '0.2' }) });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /MK-001 の Threshold 0\.2 が policy の上限 mockup_max_threshold \(0\.05\) を超えています/);
});

test('Mockup outside the root fails, including through a symlink', t => {
  const { result } = check(t, { rows: withRow({ Mockup: '../secrets/page.html' }, 1) });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /MK-002 の Mockup \.\.\/secrets\/page\.html は mockup root \(mockups\) の外を指しています/);
  const linked = check(t, {}, repo => {
    writeIn(repo.dir, 'outside/page.html', '<p>x</p>\n');
    symlinkSync(join(repo.dir, 'outside/page.html'), join(repo.dir, 'mockups/linked.html'));
    writeIn(repo.dir, 'openspec/changes/add-login/mockup-plan.md', planText(withRow({ Mockup: 'linked.html' })));
  });
  assert.match(linked.result.stdout, /MK-001 の Mockup linked\.html は symlink で mockup root の外を指しています/);
});

test('each plan problem is reported', t => {
  const cases = [
    [{ rows: withRow({ 'MK-ID': 'MK-1' }) }, /MK-ID MK-1 は MK- と3桁の数字ではありません/],
    [{ rows: withRow({ 'MK-ID': 'MK-002' }) }, /MK-002 が重複しています/],
    [{ rows: withRow({ Requirement: 'Unknown requirement' }) }, /Requirement「Unknown requirement」が change の specs にありません/],
    [{ rows: withRow({ Scenario: 'Unknown scenario' }) }, /Scenario「Unknown scenario」が Requirement「Login page layout」にありません/],
    [{ rows: withRow({ Mockup: 'missing.html' }) }, /MK-001 の Mockup mockups\/missing\.html がありません/],
    [{ rows: withRow({ Mockup: 'assets/app.css' }) }, /HTML ファイルではありません/],
    [{ rows: withRow({ Viewports: '1280*800' }) }, /Viewports の 1280\*800 は 幅x高さ ではありません/],
    [{ rows: withRow({ Masks: '`.clock`' }) }, /理由は必須です/],
    [{ rows: withRow({ Masks: '' }) }, /Masks が空です/],
    [{ rows: withRow({ Threshold: 'small' }) }, /Threshold の small は 0〜1 の数値ではありません/],
    [{ rows: withRow({ Fixture: 'seed:user' }) }, /fixture user|seed:user/],
    [{ rows: withRow({ Fixture: '' }) }, /Fixture|前提/],
    [{ tasks: '# Tasks\n\n## 1. Oracle\n\n- [ ] 1.1 oracle\n' }, /tasks\.md に ## 7\. Mockup Comparison がありません/],
    [{ quality: QUALITY_VIEWPOINTS('na') }, /「見た目の回帰」が該当なしなのに、mockup: required です/],
    [{ plan: planText([]) }, /required ですが MK 行がありません/],
    [{ plan: planText([], { mockup: 'maybe' }) }, /mockup は required か not-applicable です/],
    [{ plan: planText(ROWS, { mockup: 'not-applicable', reason: 'UI 変更なし' }) }, /not-applicable ですが MK 行があります/],
    [{ plan: planText([], { mockup: 'not-applicable' }) }, /not-applicable ですが reason がありません/],
    [{ plan: planText(ROWS).replace('| MK-ID | Requirement |', '| MK | Requirement |') }, /列は MK-ID, Requirement/],
  ];
  for (const [options, message] of cases) {
    const { result } = check(t, options);
    assert.equal(result.status, 1, `${message}\n${result.stdout}`);
    assert.match(result.stdout, message);
  }
});

test('Backend-only change: not-applicable with a reason passes without rows or tests', t => {
  const { result } = check(t, { plan: planText([], { mockup: 'not-applicable', reason: 'UI 変更なし' }), tests: false });
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /mockup: not-applicable/);
});

test('a missing plan is pending until tasks.md exists', t => {
  const pending = check(t, { tasks: null }, repo => rmSync(join(repo.dir, 'openspec/changes/add-login/mockup-plan.md')));
  assert.equal(pending.result.status, 0, pending.result.stdout);
  assert.match(pending.result.stdout, /mockup-plan\.md は未作成です/);
  const missing = check(t, {}, repo => rmSync(join(repo.dir, 'openspec/changes/add-login/mockup-plan.md')));
  assert.equal(missing.result.status, 1);
  assert.match(missing.result.stdout, /mockup-plan\.md がありません（tasks\.md は作成済み）/);
});

test('an MK without a tagged test is a warning in plan and a failure in final', t => {
  const { repo, result } = check(t, { tests: false });
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /! MK-001 の比較テスト（@add-login と @MK-001 のタグ）がありません/);
  const final = runGate(repo.dir, ['check', '--phase', 'final', 'add-login']);
  assert.equal(final.status, 1);
  assert.match(final.stdout, /✗ MK-001 の比較テスト/);
});

test('a registered fixture passes and an unregistered one fails', t => {
  const { result } = check(t, { rows: withRow({ Fixture: 'seed:user' }) }, repo => {
    const readme = readIn(repo.dir, 'tests/e2e/fixtures/README.md');
    writeIn(repo.dir, 'tests/e2e/fixtures/README.md', readme.replace(/^(\| `seed:user-with-one-order` .*)$/m, '$1\n| `seed:user` | ログイン済みのユーザー | add-login:MK-001 | シードAPI |'));
  });
  assert.equal(result.status, 0, result.stdout);
});

test('Environment variable cannot relax the gate', t => {
  const { result } = check(t, { rows: withRow({ Threshold: '0.2' }), env: { MOCKUP_MAX_THRESHOLD: '1' } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /環境変数 MOCKUP_MAX_THRESHOLD は無視しました/);
  assert.match(result.stdout, /上限 mockup_max_threshold \(0\.05\)/);
});

test('an invalid policy fails every check', t => {
  const { result } = check(t, {}, repo => {
    writeIn(repo.dir, 'openspec/mockup-policy.md', readIn(repo.dir, 'openspec/mockup-policy.md').replace(/^mockup_root: .*\n/m, ''));
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /mockup_root がありません/);
});
