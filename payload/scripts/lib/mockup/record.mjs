import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChangeDir } from './changes.mjs';
import { REPORT_FILE, RESULTS_FILE, RESULTS_VERSION, RUN_ROOT } from './constants.mjs';
import { readPlan } from './plan.mjs';
import { readPolicy } from './policy.mjs';
import { readReport, updateFindings } from './report.mjs';

const REPORT_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '../../../openspec/schemas/quality-driven-e2e-mockup/templates', REPORT_FILE);
const RESULT_KEYS = ['status', 'ratio', 'threshold', 'maskRatio', 'width', 'height', 'mockupSha', 'actualSha', 'diffSha', 'mockupFiles', 'mockupDigest', 'planRowDigest', 'notes'];
const RUN_KEYS = ['commit', 'dirty', 'environment'];

// Every raw result.json the helper wrote for `change` under `runRoot` (absolute), keyed by `MK viewport`.
export function readRawResults(runRoot, change) {
  const base = join(runRoot, change);
  const out = new Map();
  const problems = [];
  if (!existsSync(base)) return { results: out, problems };
  for (const mk of readdirSync(base).sort()) {
    const mkDir = join(base, mk);
    if (!existsSync(mkDir) || !readdirSync(mkDir, { withFileTypes: true }).length) continue;
    for (const entry of readdirSync(mkDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = join(mkDir, entry.name, 'result.json');
      if (!existsSync(file)) continue;
      try {
        const data = JSON.parse(readFileSync(file, 'utf8'));
        if (data.mk !== mk || data.viewport !== entry.name || data.change !== change) {
          problems.push(`${file} の change / MK / viewport が置き場所と一致しません`);
          continue;
        }
        out.set(`${mk} ${entry.name}`, data);
      } catch (err) {
        problems.push(`${file} を読めません (${err.message})`);
      }
    }
  }
  return { results: out, problems };
}

function sameRun(a, b) {
  return RUN_KEYS.every(key => JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

// Builds mockup-results.json for `changeId` from the latest run under test-results/mockup/, and refreshes the
// findings table of mockup-report.md. Returns the exit code.
export function runRecord(repo, changeId, env, io) {
  const dir = findChangeDir(repo, changeId);
  if (!dir) {
    io.error(`change が存在しません: ${changeId}`);
    return 2;
  }
  const plan = readPlan(repo, dir);
  if (!plan.exists) {
    io.error(`${dir}/mockup-plan.md がありません`);
    return 2;
  }
  if (plan.problems.length || plan.rows.some(row => row.problems.length)) {
    io.error([...plan.problems, ...plan.rows.flatMap(row => row.problems.map(problem => `${row.mk}: ${problem}`))].join('\n'));
    return 2;
  }
  if (plan.mockup !== 'required') {
    io.error(`${plan.path} は mockup: ${plan.mockup} です。記録する結果はありません`);
    return 2;
  }
  const policy = readPolicy(repo, env);
  if (policy.errors.length) {
    io.error(policy.errors.join('\n'));
    return 2;
  }
  const raw = readRawResults(join(repo, RUN_ROOT), changeId);
  if (raw.problems.length) {
    io.error(raw.problems.join('\n'));
    return 2;
  }
  const expected = plan.rows.flatMap(row => row.viewports.map(viewport => ({ mk: row.mk, viewport: viewport.label })));
  const found = expected.map(pair => raw.results.get(`${pair.mk} ${pair.viewport}`)).filter(Boolean);
  if (!found.length) {
    io.error(`${RUN_ROOT}/${changeId}/ に比較の結果がありません。比較テストを実行してから record してください`);
    return 2;
  }
  const run = found[0];
  const mixed = found.filter(result => !sameRun(result, run));
  if (mixed.length) {
    io.error(`別の実行（commit・作業ツリー・環境が違う）の結果が混ざっています: ${mixed.map(result => `${result.mk} ${result.viewport}`).join(', ')}。`
      + `${RUN_ROOT}/${changeId}/ を消してから、全 MK の比較をやり直してください`);
    return 1;
  }
  for (const key of raw.results.keys()) {
    if (!expected.some(pair => `${pair.mk} ${pair.viewport}` === key)) io.log(`  ! mockup-plan に無い結果を無視しました: ${key}`);
  }
  const results = expected.map(pair => {
    const result = raw.results.get(`${pair.mk} ${pair.viewport}`);
    if (!result) return { mk: pair.mk, viewport: pair.viewport, status: 'missing', notes: ['比較テストの結果がありません'] };
    return { mk: pair.mk, viewport: pair.viewport, ...Object.fromEntries(RESULT_KEYS.map(key => [key, result[key]])) };
  });
  const document = {
    version: RESULTS_VERSION,
    change: changeId,
    commit: run.commit,
    dirty: run.dirty,
    environment: run.environment,
    recordedAt: new Date().toISOString(),
    results,
  };
  writeFileSync(join(repo, dir, 'mockup-results.json'), `${JSON.stringify(document, null, 2)}\n`);
  const report = readReport(repo, dir);
  const reportText = report.exists ? report.text : readFileSync(REPORT_TEMPLATE, 'utf8');
  const diffs = results.filter(result => result.status === 'diff');
  writeFileSync(join(repo, dir, REPORT_FILE), updateFindings(reportText, diffs, report.findings));
  const counts = ['pass', 'diff', 'error', 'missing'].map(status => `${status} ${results.filter(result => result.status === status).length}`).join(' / ');
  io.log(`${dir}/${RESULTS_FILE} を記録しました（${counts}、commit ${run.commit.slice(0, 12)}、環境 ${run.environment?.image ?? 'unknown'}）`);
  if (run.dirty?.length) io.log(`  ! 未コミットの変更がある状態の結果です（${run.dirty.join(', ')}）。final ゲートは受け付けません`);
  if (diffs.length) io.log(`  ! 閾値を超えた結果を ${REPORT_FILE} の所見に転記しました。mockup-reviewer に分類を、人間に許容判断を依頼してください`);
  return 0;
}
