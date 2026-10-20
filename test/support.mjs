import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const INSTALL = join(ROOT, 'install.mjs');

// The local testkit checkout (or unpacked package) the tests install from. It is required: tests never skip
// themselves when it is missing, because a skipped add-on test looks like a passing one.
export function testkitDir() {
  const dir = process.env.TESTKIT_DIR;
  if (!dir) throw new Error('TESTKIT_DIR に openspec_custom_testkit の clone を指定してください（例: TESTKIT_DIR=../openspec_custom_testkit npm test）');
  const abs = resolve(dir);
  if (!existsSync(join(abs, 'install.mjs'))) throw new Error(`TESTKIT_DIR=${abs} に install.mjs がありません`);
  return abs;
}

export function tempDir(prefix = 'mk-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeIn(dir, rel, text) {
  const abs = join(dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, text);
}

export function readIn(dir, rel) {
  return readFileSync(join(dir, rel), 'utf8');
}

function gitIn(dir, args) {
  return execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' });
}

function makeRepo(dir) {
  return {
    dir,
    git: args => gitIn(dir, args),
    commit(message = 'change') {
      gitIn(dir, ['add', '-A']);
      gitIn(dir, ['commit', '-q', '--allow-empty', '-m', message]);
      return gitIn(dir, ['rev-parse', 'HEAD']).trim();
    },
    head() {
      return gitIn(dir, ['rev-parse', 'HEAD']).trim();
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function gitRepo(t) {
  const dir = tempDir();
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', dir]);
  const repo = makeRepo(dir);
  repo.commit('init');
  t?.after(() => repo.cleanup());
  return repo;
}

let template = null;

// A git repository with testkit installed and committed. The first call installs into a template that later
// calls copy, so each test gets its own repository without re-running the testkit installer.
export function testkitRepo(t) {
  if (!template) {
    const dir = tempDir('mk-template-');
    execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', dir]);
    gitIn(dir, ['commit', '-q', '--allow-empty', '-m', 'init']);
    const result = spawnSync(process.execPath, [join(testkitDir(), 'install.mjs'), 'install', '--language', 'Japanese'], { cwd: dir, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`testkit の install に失敗しました:\n${result.stdout}\n${result.stderr}`);
    gitIn(dir, ['add', '-A']);
    gitIn(dir, ['commit', '-q', '-m', 'testkit']);
    template = dir;
    process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  }
  const dir = tempDir();
  cpSync(template, dir, { recursive: true });
  const repo = makeRepo(dir);
  t?.after(() => repo.cleanup());
  return repo;
}

export function runInstall(cwd, args = [], opts = {}) {
  return spawnSync(process.execPath, [INSTALL, ...args], { cwd, encoding: 'utf8', ...opts });
}

// testkit plus this add-on, both committed.
export function addonRepo(t, args = []) {
  const repo = testkitRepo(t);
  const result = runInstall(repo.dir, ['install', ...args]);
  if (result.status !== 0) throw new Error(`add-on の install に失敗しました:\n${result.stdout}\n${result.stderr}`);
  repo.commit('addon');
  return repo;
}

export function runGate(cwd, args, opts = {}) {
  return spawnSync(process.execPath, [join(cwd, 'scripts/mockup-gate.mjs'), ...args], { cwd, encoding: 'utf8', ...opts });
}

export function runTestkitGate(cwd, args, opts = {}) {
  return spawnSync(process.execPath, [join(cwd, 'scripts/testkit-gate.mjs'), ...args], { cwd, encoding: 'utf8', ...opts });
}
