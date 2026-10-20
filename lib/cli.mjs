import { execFileSync } from 'node:child_process';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../payload/scripts/lib/mockup/base-digest.mjs';
import {
  ADDON_NAME, ADDON_STAMP, BASE_SCHEMA, BASE_SCHEMA_DIR, DERIVED_SCHEMA, DERIVED_SCHEMA_DIR, POLICY_PATH,
} from '../payload/scripts/lib/mockup/constants.mjs';
import { mergeConfig, unmergeConfig } from './config-merge.mjs';
import { deriveSchema } from './derive-schema.mjs';
import { checkTestkit, testkitE2eRoot } from './prereq.mjs';

export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAYLOAD = join(PACKAGE_ROOT, 'payload');
const PAYLOAD_SCHEMA = join(PAYLOAD, 'schema');
const E2E_PAYLOAD_PREFIX = 'tests/e2e/';
// Payload files that are installer input, not files to place.
const NOT_PLACED = new Set(['schema']);
// Files whose content the user owns after the first install. They are never overwritten, even with --force.
const PROTECTED = new Set([POLICY_PATH]);

export const USAGE = `usage: openspec-mockup-comparison [install|update|uninstall] [--target <dir>] [--dry-run] [--force] [--set-default|--keep-default]

  install        testkit を導入済みのリポジトリへアドオンを導入する(既定)
  update         install と同じ処理。testkit の update 後は派生 schema を再生成する
  uninstall      アドオンを削除する。派生 schema を使う active change があれば中止する
  --target <dir> 対象ディレクトリ(既定: カレントディレクトリ)
  --dry-run      一切書き込まず、予定の操作だけを表示する
  --force        利用者が編集した配布ファイルも上書きする(mockup-policy.md は上書きしない)
  --set-default  openspec/config.yaml の既定 schema を必ず ${DERIVED_SCHEMA} にする
                 (オプションなしでも、初めての install では既定が ${BASE_SCHEMA}・spec-driven・
                 未指定なら ${DERIVED_SCHEMA} に変える。update と導入済みの再実行では変えない)
  --keep-default 既定 schema を変えない
  -h, --help     このヘルプを表示する`;

export class UsageError extends Error {}

export function exitCodeFor(err) {
  return err instanceof UsageError ? 2 : null;
}

export function parseArgs(argv) {
  const opts = { command: 'install', target: process.cwd(), dryRun: false, force: false, setDefault: false, keepDefault: false, help: false };
  let commandSeen = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--set-default') opts.setDefault = true;
    else if (arg === '--keep-default') opts.keepDefault = true;
    else if (arg === '--target') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new UsageError('--target にはディレクトリが必要です');
      opts.target = value;
    } else if (!arg.startsWith('-') && !commandSeen && ['install', 'update', 'uninstall'].includes(arg)) {
      opts.command = arg;
      commandSeen = true;
    } else throw new UsageError(`不明な引数です: ${arg}`);
  }
  if (opts.setDefault && opts.keepDefault) throw new UsageError('--set-default と --keep-default は同時に指定できません');
  if (opts.command === 'uninstall' && (opts.force || opts.setDefault || opts.keepDefault)) throw new UsageError('uninstall には --force / --set-default / --keep-default を付けられません');
  opts.target = resolve(opts.target);
  return opts;
}

function walk(root, base = root, out = []) {
  for (const name of readdirSync(root).sort()) {
    const abs = join(root, name);
    if (statSync(abs).isDirectory()) walk(abs, base, out);
    else out.push(relative(base, abs).split(sep).join('/'));
  }
  return out;
}

function isGitRepo(dir) {
  try {
    execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function isSymlink(abs) {
  try {
    return lstatSync(abs).isSymbolicLink();
  } catch {
    return false;
  }
}

function readStamp(target) {
  const abs = join(target, ADDON_STAMP);
  if (!existsSync(abs)) return { exists: false, data: null };
  try {
    return { exists: true, data: JSON.parse(readFileSync(abs, 'utf8')) };
  } catch (err) {
    return { exists: true, broken: true, error: err.message, data: null };
  }
}

// Refuses any destination that resolves outside the target, including through a symlinked directory.
function escapes(target, rel) {
  const root = realpathSync(target);
  let probe = join(target, rel);
  while (!existsSync(probe)) probe = dirname(probe);
  const real = realpathSync(probe);
  return real !== root && !real.startsWith(root + sep);
}

// Places the add-on ever writes to. Paths read from the stamp are trusted only inside these.
const PLACED_PREFIXES = [
  'scripts/mockup-gate.mjs', 'scripts/lib/mockup/', `${DERIVED_SCHEMA_DIR}/`, POLICY_PATH, 'openspec/roles/mockup-reviewer.md',
  '.claude/skills/mockup-comparison/', '.claude/agents/mockup-reviewer.md',
];

// Why a path recorded in the stamp may not be touched, or null. The stamp lives in the repository, so a pull
// request can edit it; uninstall must never read or delete anything outside what the add-on places.
export function unsafeStampPath(target, rel, e2eRoot) {
  if (typeof rel !== 'string' || !rel || isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.includes('\\') || rel.includes('\0')) return '絶対パスまたは不正なパスです';
  if (rel.split('/').some(segment => segment === '..' || segment === '.' || segment === '')) return '.. などを含むパスです';
  const helper = typeof e2eRoot === 'string' ? `${e2eRoot}/support/mockup.ts` : null;
  if (!PLACED_PREFIXES.some(prefix => (prefix.endsWith('/') ? rel.startsWith(prefix) : rel === prefix)) && rel !== helper) return 'アドオンが配置する場所ではありません';
  if (escapes(target, rel)) return 'target の外を指しています';
  return null;
}

function unifiedDiff(oldText, newText, label) {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const out = [`--- target/${label}`, `+++ payload/${label}`];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (i < a.length && !b.slice(j).includes(a[i])) out.push(`-${a[i++]}`);
    else if (j < b.length) out.push(`+${b[j++]}`);
    else out.push(`-${a[i++]}`);
  }
  return out.slice(0, 80).join('\n');
}

// The action for one file: create, same, update (unedited previous version), keep (edited, no --force),
// overwrite (edited, --force) or protect (user-owned file that differs).
export function decideAction({ exists, same, recorded, protectedFile, force }) {
  if (!exists) return 'create';
  if (same) return 'same';
  if (protectedFile) return 'protect';
  if (recorded) return 'update';
  return force ? 'overwrite' : 'keep';
}

function planFiles(opts, e2eRoot, derived, previous) {
  const desired = new Map();
  for (const rel of walk(PAYLOAD)) {
    if (NOT_PLACED.has(rel.split('/')[0])) continue;
    const dest = rel.startsWith(E2E_PAYLOAD_PREFIX) ? `${e2eRoot}/${rel.slice(E2E_PAYLOAD_PREFIX.length)}` : rel;
    desired.set(dest, { buf: readFileSync(join(PAYLOAD, rel)), src: rel, mode: statSync(join(PAYLOAD, rel)).mode & 0o777 });
  }
  for (const [rel, buf] of derived.files) desired.set(`${DERIVED_SCHEMA_DIR}/${rel}`, { buf, src: `(生成) ${rel}`, mode: 0o644 });
  const recordedFiles = previous?.files ?? {};
  return [...desired].map(([dest, item]) => {
    const abs = join(opts.target, dest);
    const exists = existsSync(abs);
    const existing = exists ? readFileSync(abs) : null;
    const same = exists && existing.equals(item.buf);
    const recorded = exists && recordedFiles[dest] === sha256(existing);
    const action = decideAction({ exists, same, recorded, protectedFile: PROTECTED.has(dest), force: opts.force });
    return { dest, abs, ...item, existing, action };
  });
}

function writeFileAtomic(abs, buf, mode) {
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  writeFileSync(tmp, buf, { mode });
  chmodSync(tmp, mode);
  renameSync(tmp, abs);
}

function stampBody({ version, e2eRoot, ops, derived, previous, config }) {
  const files = {};
  for (const op of ops) {
    if (op.action === 'keep' || op.action === 'protect') {
      // The stamp keeps what it knew about a file the user owns now.
      if (previous?.files?.[op.dest]) files[op.dest] = previous.files[op.dest];
      else if (op.action === 'protect') files[op.dest] = sha256(op.existing);
      continue;
    }
    files[op.dest] = sha256(op.buf);
  }
  const body = {
    name: ADDON_NAME,
    version,
    schema: DERIVED_SCHEMA,
    e2eRoot,
    generatedFrom: derived.generatedFrom,
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
  };
  // The default schema before the add-on switched it, kept across updates; null means there was no schema line.
  if (config.switched) body.defaultSchemaBefore = config.previousDefault;
  else if (previous && Object.hasOwn(previous, 'defaultSchemaBefore')) body.defaultSchemaBefore = previous.defaultSchemaBefore;
  return body;
}

function configPath(target) {
  const yaml = join(target, 'openspec/config.yaml');
  const yml = join(target, 'openspec/config.yml');
  return existsSync(yaml) || !existsSync(yml) ? yaml : yml;
}

const LABELS = {
  create: '作成', same: '変更なし', update: '更新', keep: '保持(編集済み。--force で上書き)', overwrite: '上書き(--force)', protect: '保持(利用者が管理)',
};

// How the default schema is decided (design D1): an explicit option wins; otherwise only a first install (no add-on
// stamp yet) may switch it, so an update never overrides a default the user chose afterwards.
export function defaultModeFor(opts, stamp) {
  if (opts.setDefault) return 'force';
  if (opts.keepDefault || stamp.exists) return 'keep';
  return 'auto';
}

async function install(opts, io, version) {
  const { log, error } = io;
  const verb = opts.command === 'update' ? '更新' : '導入';
  log(`${ADDON_NAME} v${version} — ${verb}先: ${opts.target}${opts.dryRun ? ' (dry-run)' : ''}`);
  if (!existsSync(opts.target)) {
    error(`対象ディレクトリがありません: ${opts.target}`);
    return 1;
  }
  if (!isGitRepo(opts.target)) {
    error('git リポジトリではありません。testkit と同じく git 管理下にだけ導入します');
    return 1;
  }
  const prereq = await checkTestkit(opts.target);
  if (!prereq.ok) {
    for (const problem of prereq.problems) error(`✗ ${problem}`);
    error('何も書き込んでいません。');
    return 1;
  }
  const stamp = readStamp(opts.target);
  if (stamp.broken) {
    error(`${ADDON_STAMP} が壊れています (${stamp.error})。修復するか削除してから再実行してください`);
    return 1;
  }
  let e2eRoot;
  try {
    e2eRoot = await testkitE2eRoot(opts.target);
  } catch (err) {
    error(`testkit の E2E ルートを特定できません: ${err.message}`);
    return 1;
  }
  const derived = deriveSchema(join(opts.target, BASE_SCHEMA_DIR), PAYLOAD_SCHEMA);
  if (derived.errors.length) {
    for (const problem of derived.errors) error(`✗ 派生 schema を生成できません: ${problem}`);
    error('何も書き込んでいません。');
    return 1;
  }
  const ops = planFiles(opts, e2eRoot, derived, stamp.data);
  const cfgPath = configPath(opts.target);
  const cfgBefore = existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8') : null;
  const config = mergeConfig(cfgBefore, { defaultMode: defaultModeFor(opts, stamp) });
  const cfgRel = relative(opts.target, cfgPath).split(sep).join('/');
  const escaped = [...ops.map(op => op.dest), cfgRel, ADDON_STAMP].filter(rel => escapes(opts.target, rel));
  if (escaped.length) {
    error(`target の外への書き込みを拒否しました: ${escaped.join(', ')}`);
    return 1;
  }

  for (const op of ops) {
    if (op.action !== 'same') log(`  ${LABELS[op.action]}: ${op.dest}`);
    if ((op.action === 'keep' || op.action === 'protect') && !op.buf.includes(0)) log(unifiedDiff(op.existing.toString('utf8'), op.buf.toString('utf8'), op.dest));
  }
  for (const note of config.notes) log(`  config: ${note}`);
  for (const warning of config.warnings) log(`  ⚠ ${warning}`);
  const body = stampBody({
    version, e2eRoot, ops, derived, previous: stamp.data, config,
  });
  const { installedAt: previousInstalledAt, ...previousBody } = stamp.data ?? {};
  const stampChanged = JSON.stringify(previousBody) !== JSON.stringify(body);
  if (opts.dryRun) {
    log(`dry-run: 書き込みません（stamp ${stampChanged ? 'を更新予定' : 'は変更なし'}）`);
    return 0;
  }
  for (const op of ops) {
    if (['create', 'update', 'overwrite'].includes(op.action)) writeFileAtomic(op.abs, op.buf, op.mode);
  }
  if (!config.blocked && config.text !== (cfgBefore ?? '')) writeFileAtomic(cfgPath, config.text, existsSync(cfgPath) ? statSync(cfgPath).mode & 0o777 : 0o644);
  if (stampChanged || !stamp.exists) {
    const installedAt = stampChanged || !previousInstalledAt ? new Date().toISOString() : previousInstalledAt;
    writeFileAtomic(join(opts.target, ADDON_STAMP), `${JSON.stringify({ ...body, installedAt }, null, 2)}\n`, 0o644);
  }
  log(`\n${verb}が完了しました。次を実行してください:`);
  log('  - node scripts/mockup-gate.mjs doctor');
  log(`  - openspec schema validate ${DERIVED_SCHEMA}`);
  if (config.blocked || config.defaultSchema !== DERIVED_SCHEMA) log(`  - モック比較の change: openspec new change <name> --schema ${DERIVED_SCHEMA}`);
  else log('  - モック比較の change: openspec new change <name>（既定 schema が派生 schema です）');
  return 0;
}

function activeUsers(target) {
  const root = join(target, 'openspec/changes');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter(name => name !== 'archive' && statSync(join(root, name)).isDirectory()).filter(name => {
    const meta = join(root, name, '.openspec.yaml');
    if (!existsSync(meta)) return false;
    const line = readFileSync(meta, 'utf8').split(/\r?\n/).find(text => /^schema:/.test(text));
    return line?.replace(/^schema:/, '').replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '') === DERIVED_SCHEMA;
  }).sort();
}

function removeEmptyDirs(target, rels) {
  const dirs = new Set();
  for (const rel of rels) {
    let dir = dirname(rel);
    while (dir && dir !== '.') {
      dirs.add(dir);
      dir = dirname(dir);
    }
  }
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
    const abs = join(target, dir);
    if (existsSync(abs) && lstatSync(abs).isDirectory() && !readdirSync(abs).length) rmdirSync(abs);
  }
}

function uninstall(opts, io) {
  const { log, error } = io;
  log(`${ADDON_NAME} — 削除: ${opts.target}${opts.dryRun ? ' (dry-run)' : ''}`);
  const stamp = readStamp(opts.target);
  if (!stamp.exists || stamp.broken) {
    error(`${ADDON_STAMP} が${stamp.broken ? '壊れています' : 'ありません'}。導入記録が無いため削除しません`);
    return 1;
  }
  const users = activeUsers(opts.target);
  if (users.length) {
    error(`${DERIVED_SCHEMA} を使う active change があるため削除しません: ${users.join(', ')}`);
    error('これらを archive するか、別の schema で作り直してから再実行してください。');
    return 1;
  }
  const recorded = Object.entries(stamp.data.files ?? {});
  const unsafe = recorded.map(([rel]) => [rel, unsafeStampPath(opts.target, rel, stamp.data.e2eRoot)]).filter(([, reason]) => reason);
  if (unsafe.length) {
    for (const [rel, reason] of unsafe) error(`✗ ${ADDON_STAMP} のパスを拒否しました: ${rel}（${reason}）`);
    error('何も削除していません。stamp が書き換えられていないか確認してください。');
    return 1;
  }
  const removed = [];
  for (const [rel, expected] of recorded) {
    if (PROTECTED.has(rel)) {
      log(`  保持: ${rel}`);
      continue;
    }
    const abs = join(opts.target, rel);
    if (!existsSync(abs) && !isSymlink(abs)) continue;
    if (isSymlink(abs) || !lstatSync(abs).isFile()) {
      log(`  保持(通常のファイルではありません): ${rel}`);
      continue;
    }
    if (sha256(readFileSync(abs)) !== expected) {
      log(`  保持(編集済み): ${rel}`);
      continue;
    }
    log(`  削除: ${rel}`);
    removed.push(rel);
  }
  const cfgPath = configPath(opts.target);
  const cfgBefore = existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8') : null;
  const config = cfgBefore == null ? null : unmergeConfig(cfgBefore);
  for (const note of config?.notes ?? []) log(`  config: ${note}`);
  for (const warning of config?.warnings ?? []) log(`  ⚠ ${warning}`);
  if (opts.dryRun) {
    log('dry-run: 書き込みません');
    return 0;
  }
  for (const rel of removed) rmSync(join(opts.target, rel), { force: true });
  removeEmptyDirs(opts.target, removed);
  if (config && !config.blocked && config.text !== cfgBefore) writeFileSync(cfgPath, config.text);
  rmSync(join(opts.target, ADDON_STAMP), { force: true });
  log(`\n削除が完了しました。${POLICY_PATH} は残しています。`);
  return 0;
}

export async function main(argv = process.argv.slice(2), io = {}) {
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;
  const opts = parseArgs(argv);
  if (opts.help) {
    log(USAGE);
    return 0;
  }
  const version = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;
  if (opts.command === 'uninstall') return uninstall(opts, { log, error });
  return install(opts, { log, error }, version);
}
