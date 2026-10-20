import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { declaredSchemaOf, findChangeDir } from './changes.mjs';
import { DERIVED_SCHEMA, RESULTS_FILE } from './constants.mjs';
import { readRawResults } from './record.mjs';

const COMPARED = ['status', 'ratio', 'mockupSha', 'actualSha', 'diffSha'];

export function parseVerifyArgs(argv) {
  let results;
  const names = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--results') {
      results = argv[++i];
      if (!results || results.startsWith('--')) return { error: '--results には比較の実行結果のディレクトリ（test-results/mockup に相当）が必要です' };
    } else if (arg.startsWith('-')) return { error: `不明な引数です: ${arg}` };
    else names.push(arg);
  }
  if (!results) return { error: '--results を指定してください' };
  return { results, names };
}

function activeDerivedChanges(repo) {
  const root = join(repo, 'openspec/changes');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter(name => name !== 'archive' && declaredSchemaOf(repo, `openspec/changes/${name}`) === DERIVED_SCHEMA)
    .filter(name => existsSync(join(root, name, RESULTS_FILE))).sort();
}

// Compares a fresh run in the reference environment (`--results`) with the committed mockup-results.json of each
// change. Every committed MK and viewport must be reproduced with the same status, ratio and image digests.
export function runVerify(repo, args, env, io) {
  const runRoot = resolve(repo, args.results);
  if (!existsSync(runRoot)) {
    io.error(`--results のディレクトリがありません: ${args.results}`);
    return 2;
  }
  const names = args.names.length ? args.names : activeDerivedChanges(repo);
  let failed = 0;
  for (const name of names) {
    const dir = findChangeDir(repo, name);
    if (!dir) {
      io.error(`change が存在しません: ${name}`);
      return 2;
    }
    io.log(`▶ ${name}`);
    const path = join(repo, dir, RESULTS_FILE);
    if (!existsSync(path)) {
      io.log(`  ✗ ${RESULTS_FILE} がありません`);
      failed++;
      continue;
    }
    let committed;
    try {
      committed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      io.log(`  ✗ ${RESULTS_FILE} を読めません (${err.message})`);
      failed++;
      continue;
    }
    const fresh = readRawResults(runRoot, name);
    for (const problem of fresh.problems) {
      io.log(`  ✗ ${problem}`);
      failed++;
    }
    const freshEnv = [...fresh.results.values()][0]?.environment;
    if (freshEnv?.image && freshEnv.image !== committed.environment?.image) io.log(`  ! 再実行の環境 (${freshEnv.image}) が記録の環境 (${committed.environment?.image}) と違います`);
    if (freshEnv?.arch && committed.environment?.arch && freshEnv.arch !== committed.environment.arch) {
      io.log(`  ! 再実行の CPU アーキテクチャ (${freshEnv.arch}) が記録 (${committed.environment.arch}) と違います。同じ画像でも描画が変わることがあります`);
    }
    for (const result of committed.results ?? []) {
      const label = `${result.mk} ${result.viewport}`;
      const again = fresh.results.get(label);
      if (!again) {
        io.log(`  ✗ ${label} が再実行の結果にありません`);
        failed++;
        continue;
      }
      const differing = COMPARED.filter(key => JSON.stringify(again[key]) !== JSON.stringify(result[key]));
      if (differing.length) {
        io.log(`  ✗ ${label} が再現しません: ${differing.map(key => `${key} ${result[key]} → ${again[key]}`).join(', ')}`);
        failed++;
      } else io.log(`  ✓ ${label}`);
    }
  }
  io.log('---');
  io.log(`verified: ${names.length} change(s), failures: ${failed}`);
  return failed ? 1 : 0;
}
