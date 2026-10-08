import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, posix, sep } from 'node:path';
import {
  BASE_SCHEMA, DERIVED_SCHEMA, FINDING_CLASSES, PLAN_FILE, RESULTS_FILE, RESULTS_VERSION, TASK_GROUP, VIEWPOINT_ROW,
} from './constants.mjs';
import { readPlan } from './plan.mjs';
import { readPolicy } from './policy.mjs';
import { readReport } from './report.mjs';
import { currentMockupDigest, ignoredGlobs, matchesAny } from './results.mjs';
import { tk } from './testkit.mjs';

const SOURCE = /\.(?:[cm]?[jt]sx?)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git']);

export function parseCheckArgs(argv) {
  let phase = 'plan';
  let base;
  const names = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--phase' || arg === '--base') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) return { error: `${arg} には値が必要です` };
      if (arg === '--phase') phase = value;
      else base = value;
    } else if (arg.startsWith('-')) return { error: `不明な引数です: ${arg}` };
    else names.push(arg);
  }
  if (phase !== 'plan' && phase !== 'final') return { error: '--phase は plan または final です' };
  return { phase, base, names };
}

// Requirement name → scenario names of the change's delta specs.
function specIndex(repo, dir) {
  const index = new Map();
  const root = join(repo, dir, 'specs');
  const walk = abs => {
    if (!existsSync(abs)) return;
    for (const name of readdirSync(abs).sort()) {
      const path = join(abs, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.md')) {
        let current = null;
        for (const line of tk.markdownProse(readFileSync(path, 'utf8')).text.split('\n')) {
          const requirement = line.match(/^### Requirement:\s*(.+?)\s*$/);
          const scenario = line.match(/^#### Scenario:\s*(.+?)\s*$/);
          if (requirement) {
            current = requirement[1];
            if (!index.has(current)) index.set(current, new Set());
          } else if (scenario && current) index.get(current).add(scenario[1]);
          else if (/^#{1,3} /.test(line)) current = null;
        }
      }
    }
  };
  walk(root);
  return index;
}

function mockupProblems(repo, policy, row) {
  const rel = row.mockup.path;
  if (!rel) return [];
  const normalized = posix.normalize(rel);
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel) || normalized.startsWith('../') || normalized === '..' || rel.split('/').includes('..')) {
    return [`${row.mk} の Mockup ${rel} は mockup root (${policy.mockup_root}) の外を指しています`];
  }
  if (!/\.html?$/i.test(normalized)) return [`${row.mk} の Mockup ${rel} は HTML ファイルではありません`];
  const rootAbs = join(repo, policy.mockup_root);
  const abs = join(rootAbs, normalized);
  if (!existsSync(abs)) return [`${row.mk} の Mockup ${policy.mockup_root}/${normalized} がありません`];
  const realRoot = realpathSync(rootAbs);
  const real = realpathSync(abs);
  if (real !== realRoot && !real.startsWith(realRoot + sep)) return [`${row.mk} の Mockup ${rel} は symlink で mockup root の外を指しています`];
  return [];
}

// The 見た目の回帰 row (or a single 全観点 row) of quality.md's Non-functional Viewpoints, as { na, reason }.
function visualViewpoint(repo, dir) {
  const abs = join(repo, dir, 'quality.md');
  if (!existsSync(abs)) return null;
  const body = tk.section(tk.markdownProse(readFileSync(abs, 'utf8')).text, '## Non-functional Viewpoints');
  if (body == null) return null;
  const { headers, rows } = tk.parseTable(body);
  const [aspect, mode, reason] = headers;
  const row = rows.find(item => String(item[aspect] ?? '').trim() === VIEWPOINT_ROW) ?? rows.find(item => String(item[aspect] ?? '').trim() === '全観点');
  if (!row) return null;
  const failureModes = String(row[mode] ?? '').trim();
  return { na: !failureModes && Boolean(String(row[reason] ?? '').trim()), aspect: String(row[aspect]).trim() };
}

function sourceFiles(repo, root) {
  const out = [];
  const walk = abs => {
    if (!existsSync(abs)) return;
    for (const name of readdirSync(abs)) {
      if (SKIP_DIRS.has(name)) continue;
      const path = join(abs, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (SOURCE.test(name)) out.push(path);
    }
  };
  walk(join(repo, root));
  return out;
}

// MKs of the plan without a test source that carries both @<change-id> and @MK-NNN.
function untestedMks(repo, change, rows) {
  let root;
  try {
    root = tk.installedE2eRoot(repo);
  } catch (err) {
    return { error: `E2E ルートを特定できません (${err.message})`, missing: [] };
  }
  // The helper itself documents the tags and never counts as a comparison test.
  const helper = join(repo, root, 'support/mockup.ts');
  const texts = sourceFiles(repo, root).filter(path => path !== helper).map(path => readFileSync(path, 'utf8'))
    .filter(text => tk.hasBoundedToken(text, change.id));
  return { missing: rows.filter(row => !texts.some(text => tk.hasBoundedToken(text, row.mk))).map(row => row.mk) };
}

function planChecks(repo, change, plan, policy, phase, out) {
  const tasksPath = join(repo, change.path, 'tasks.md');
  const hasTasks = existsSync(tasksPath);
  if (!plan.exists) {
    if (hasTasks || phase === 'final') out.failures.push(`${PLAN_FILE} がありません${hasTasks ? '（tasks.md は作成済み）' : ''}`);
    else out.notes.push(`${PLAN_FILE} は未作成です`);
    return;
  }
  out.failures.push(...plan.problems);
  if (plan.mockup === 'not-applicable') {
    if (!plan.reason) out.failures.push(`${plan.path} は not-applicable ですが reason がありません`);
    if (plan.rows.length) out.failures.push(`${plan.path} は not-applicable ですが MK 行があります`);
  } else if (plan.mockup === 'required') {
    if (!plan.rows.length) out.failures.push(`${plan.path} は required ですが MK 行がありません`);
    const specs = specIndex(repo, change.path);
    const seen = new Set();
    for (const row of plan.rows) {
      for (const problem of row.problems) out.failures.push(`${row.mk || '(MK-ID なし)'}: ${problem}`);
      if (seen.has(row.mk)) out.failures.push(`${row.mk} が重複しています`);
      seen.add(row.mk);
      const scenarios = specs.get(row.requirement);
      if (!scenarios) out.failures.push(`${row.mk} の Requirement「${row.requirement}」が change の specs にありません`);
      else if (!scenarios.has(row.scenario)) out.failures.push(`${row.mk} の Scenario「${row.scenario}」が Requirement「${row.requirement}」にありません`);
      out.failures.push(...mockupProblems(repo, policy, row));
      if (row.threshold != null && row.threshold > policy.mockup_max_threshold) {
        out.failures.push(`${row.mk} の Threshold ${row.threshold} が policy の上限 mockup_max_threshold (${policy.mockup_max_threshold}) を超えています`);
      }
    }
    const registry = tk.checkRegistry(repo, { ...change, schema: BASE_SCHEMA }, plan.rows.map(row => ({ 'TP-ID': row.mk, Fixture: row.fixture })));
    out.failures.push(...registry.errors.map(line => line.replace(`${change.id}: `, '')));
    const viewpoint = visualViewpoint(repo, change.path);
    if (viewpoint?.na) out.failures.push(`quality.md の Non-functional Viewpoints で「${viewpoint.aspect}」が該当なしなのに、mockup: required です`);
    const tests = untestedMks(repo, change, plan.rows);
    if (tests.error) out.failures.push(tests.error);
    for (const mk of tests.missing) {
      const message = `${mk} の比較テスト（@${change.id} と @${mk} のタグ）がありません`;
      if (phase === 'final') out.failures.push(message);
      else out.warnings.push(message);
    }
  }
  if (hasTasks && !readFileSync(tasksPath, 'utf8').split(/\r?\n/).some(line => line.trim() === TASK_GROUP)) {
    out.failures.push(`tasks.md に ${TASK_GROUP} がありません`);
  }
}

function readResults(repo, dir) {
  const path = `${dir}/${RESULTS_FILE}`;
  const abs = join(repo, path);
  if (!existsSync(abs)) return { error: `${RESULTS_FILE} がありません。正の環境で比較して node scripts/mockup-gate.mjs record <change> を実行してください` };
  try {
    const data = JSON.parse(readFileSync(abs, 'utf8'));
    if (data?.version !== RESULTS_VERSION || !Array.isArray(data.results)) return { error: `${RESULTS_FILE} の形式が違います（version ${RESULTS_VERSION} と results が必要です）` };
    return { data };
  } catch (err) {
    return { error: `${RESULTS_FILE} を読めません (${err.message})` };
  }
}

function freshnessProblems(repo, policy, commit) {
  if (!/^[0-9a-f]{40}$/.test(String(commit ?? ''))) return [`${RESULTS_FILE} の commit が不正です`];
  try {
    tk.git(repo, ['merge-base', '--is-ancestor', commit, 'HEAD']);
  } catch {
    return [`${RESULTS_FILE} の commit ${commit.slice(0, 12)} は HEAD の祖先ではありません`];
  }
  const changed = tk.git(repo, ['diff', '--name-only', '-z', commit, 'HEAD']).split('\0').filter(Boolean);
  const stale = changed.filter(path => !matchesAny(path, ignoredGlobs(policy)));
  return stale.length ? [`比較の実行後に変わったファイルがあります。比較をやり直して record してください: ${stale.join(', ')}`] : [];
}

function acceptanceProblems(report, result) {
  const label = `${result.mk} ${result.viewport}`;
  const problems = [];
  const finding = report.findings.find(row => row.mk === result.mk && row.viewport === result.viewport);
  if (!finding) problems.push(`${label} の所見が mockup-report.md にありません`);
  else {
    if (finding.digest !== result.diffSha) problems.push(`${label} の所見の差分 digest が結果と一致しません。record をやり直してください`);
    if (!FINDING_CLASSES.includes(finding.classification)) problems.push(`${label} の所見の分類は ${FINDING_CLASSES.join(' / ')} のどれかです（実際: ${finding.classification || '空'}）`);
    if (!finding.basis) problems.push(`${label} の所見に根拠がありません`);
  }
  const accepted = report.acceptances.filter(row => row.mk === result.mk && row.viewport === result.viewport);
  if (!accepted.length) {
    problems.push(`${label} は閾値を超えています（差分率 ${result.ratio}、閾値 ${result.threshold}）。実装を直して比較をやり直すか、人間が mockup-report.md の許容判断に記入してください`);
    return problems;
  }
  const valid = accepted.find(row => row.digest === result.diffSha && row.approver && tk.validDate(row.date));
  if (!valid) {
    const row = accepted.at(-1);
    if (row.digest !== result.diffSha) problems.push(`${label} の許容判断の差分 digest が現在の差分画像と一致しません（比較をやり直したため承認は無効です）`);
    if (!row.approver) problems.push(`${label} の許容判断に承認者がありません`);
    if (!tk.validDate(row.date)) problems.push(`${label} の許容判断の承認日が YYYY-MM-DD ではありません（実際: ${row.date || '空'}）`);
  }
  return problems;
}

function finalChecks(repo, change, plan, policy, out) {
  if (!plan.exists || plan.mockup !== 'required' || out.failures.length) {
    if (plan.exists && plan.mockup === 'required' && out.failures.length) out.notes.push('計画の不備があるため、結果の検査は行いません');
    return;
  }
  const loaded = readResults(repo, change.path);
  if (loaded.error) {
    out.failures.push(loaded.error);
    return;
  }
  const results = loaded.data;
  if (results.change !== change.id) out.failures.push(`${RESULTS_FILE} の change (${results.change}) が ${change.id} と違います`);
  if (results.environment?.image !== policy.mockup_reference_environment) {
    out.failures.push(`正の環境の結果ではありません（結果: ${results.environment?.image ?? '不明'}、policy: ${policy.mockup_reference_environment}）`);
  }
  if (!Array.isArray(results.dirty) || results.dirty.length) {
    out.failures.push(`未コミットの変更がある状態の結果です（${Array.isArray(results.dirty) ? results.dirty.join(', ') : '記録なし'}）。コミットしてから比較をやり直してください`);
  }
  out.failures.push(...freshnessProblems(repo, policy, results.commit));
  const report = readReport(repo, change.path);
  for (const row of plan.rows) {
    for (const viewport of row.viewports) {
      const label = `${row.mk} ${viewport.label}`;
      const result = results.results.find(item => item.mk === row.mk && item.viewport === viewport.label);
      if (!result) {
        out.failures.push(`${label} の結果がありません`);
        continue;
      }
      if (result.status === 'missing' || result.status === 'error') {
        out.failures.push(`${label} は ${result.status} です${result.notes?.length ? `（${result.notes.join(' / ')}）` : ''}`);
        continue;
      }
      if (result.planRowDigest !== row.digest) out.failures.push(`${label} は比較の実行後に mockup-plan の行が変わっています。比較をやり直してください`);
      const mockup = currentMockupDigest(repo, policy, Array.isArray(result.mockupFiles) ? result.mockupFiles : []);
      if (mockup.missing) out.failures.push(`${label} が読み込んだモックのファイル ${mockup.missing} がありません`);
      else if (mockup.digest !== result.mockupDigest) out.failures.push(`${label} は比較の実行後にモックが変わっています。比較をやり直してください`);
      if (result.status === 'diff') {
        if (!report.exists) out.failures.push(`${label} は閾値を超えていますが mockup-report.md がありません`);
        else out.failures.push(...report.problems, ...acceptanceProblems(report, result));
      } else if (result.status !== 'pass') out.failures.push(`${label} の status ${result.status} は不正です`);
    }
  }
  out.failures = [...new Set(out.failures)];
}

// The schema the change declared at the base, or null.
function baseDeclaredSchema(repo, base, change) {
  if (!base) return null;
  for (const dir of [change.path, `openspec/changes/${change.id}`]) {
    let text;
    try {
      text = tk.gitShow(repo, base, `${dir}/.openspec.yaml`);
    } catch {
      text = null;
    }
    if (text == null) continue;
    const parsed = tk.parseYamlText(text);
    if (tk.isPlainMapping(parsed.data)) return tk.asString(parsed.data.schema) || null;
  }
  return null;
}

export function runCheck(repo, args, env, io) {
  const selected = tk.selectChanges({ repo, base: args.base, names: args.names, env });
  if (selected.exitCode === 2) {
    io.error(selected.error);
    return 2;
  }
  const policy = readPolicy(repo, env);
  for (const note of policy.notes) io.log(`! ${note}`);
  let failed = 0;
  let checked = 0;
  if (policy.errors.length) {
    for (const error of policy.errors) io.log(`✗ ${error}`);
    failed += policy.errors.length;
  }
  for (const change of selected.changes) {
    const declared = change.declaredSchema ?? change.schema;
    const before = baseDeclaredSchema(repo, selected.base, change);
    if (declared !== DERIVED_SCHEMA) {
      if (before === DERIVED_SCHEMA) {
        io.log(`▶ ${change.id} (${change.lifecycle})`);
        io.log(`  ✗ 比較元で ${DERIVED_SCHEMA} だった change の schema が ${declared ?? '(なし)'} に変更されています。モック比較の検査は外せません`);
        failed++;
      } else io.log(`- ${change.id}: 対象外 (schema: ${declared ?? '(なし)'})`);
      continue;
    }
    checked++;
    const tasks = tk.taskState(tk.parseTasks(change.tasksText));
    const phase = tk.effectivePhase(args.phase, change, tasks);
    const out = { failures: [...(change.errors ?? [])], warnings: [], notes: [] };
    if (!policy.errors.length) {
      const plan = readPlan(repo, change.path);
      planChecks(repo, change, plan, policy.values, phase, out);
      if (phase === 'final') finalChecks(repo, change, plan, policy.values, out);
      if (!out.failures.length) out.notes.push(`mockup: ${plan.mockup ?? '未作成'}${plan.rows?.length ? `（MK ${plan.rows.length} 件）` : ''}`);
    }
    io.log(`▶ ${change.id} (${change.lifecycle}/${phase})`);
    for (const note of out.notes) io.log(`  ${note}`);
    for (const warning of out.warnings) io.log(`  ! ${warning}`);
    for (const failure of out.failures) io.log(`  ✗ ${failure}`);
    failed += out.failures.length;
  }
  io.log('---');
  io.log(`checked: ${checked} change(s), failures: ${failed}`);
  return failed ? 1 : 0;
}
