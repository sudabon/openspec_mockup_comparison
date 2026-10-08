#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadTestkit, testkitMismatchMessage } from './lib/mockup/testkit.mjs';

const USAGE = `usage: mockup-gate.mjs doctor
       mockup-gate.mjs check [--phase plan|final] [--base <ref>] [<change>...]
       mockup-gate.mjs record <change>
       mockup-gate.mjs verify --results <dir> [<change>...]

終了コード: 0 成功 / 1 検査の失敗 / 2 引数・入力・前提の不正 / 3 内部エラー`;

export const processIo = {
  log: message => console.log(message),
  error: message => console.error(message),
};

function repoRoot(cwd) {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function printResult(io, { failures = [], warnings = [], notes = [], lines = [] }) {
  for (const line of lines) io.log(line);
  for (const note of notes) io.log(`  ! ${note}`);
  for (const warning of warnings) io.log(`  ! ${warning}`);
  for (const failure of failures) io.log(`  ✗ ${failure}`);
}

// Runs one command and returns its exit code.
export async function main(argv = process.argv.slice(2), env = process.env, io = processIo) {
  const [command, ...rest] = argv;
  if (!command || command === '-h' || command === '--help') {
    io.log(USAGE);
    return 0;
  }
  if (!['doctor', 'check', 'record', 'verify'].includes(command)) {
    io.error(USAGE);
    return 2;
  }
  const repo = repoRoot(io.cwd ?? process.cwd());
  if (!repo) {
    io.error('git リポジトリではありません');
    return 2;
  }
  const loaded = await loadTestkit();
  if (!loaded.ok) {
    io.error(testkitMismatchMessage(loaded.missing));
    return 2;
  }
  if (command === 'doctor') {
    const { doctor } = await import('./lib/mockup/doctor.mjs');
    const result = doctor(repo, env);
    printResult(io, result);
    io.log(result.ok ? 'doctor: ok' : `doctor: ${result.failures.length} 件の問題があります`);
    return result.ok ? 0 : 1;
  }
  if (command === 'check') {
    const { parseCheckArgs, runCheck } = await import('./lib/mockup/check.mjs');
    const args = parseCheckArgs(rest);
    if (args.error) {
      io.error(`${args.error}\n${USAGE}`);
      return 2;
    }
    return runCheck(repo, args, env, io);
  }
  if (command === 'record') {
    const { runRecord } = await import('./lib/mockup/record.mjs');
    if (rest.length !== 1 || rest[0].startsWith('-')) {
      io.error(`record には change 名を1つ指定します\n${USAGE}`);
      return 2;
    }
    return runRecord(repo, rest[0], env, io);
  }
  const { parseVerifyArgs, runVerify } = await import('./lib/mockup/verify.mjs');
  const args = parseVerifyArgs(rest);
  if (args.error) {
    io.error(`${args.error}\n${USAGE}`);
    return 2;
  }
  return runVerify(repo, args, env, io);
}

function isMain() {
  try {
    return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  try {
    process.exitCode = await main();
  } catch (err) {
    console.error(err?.stack ?? err);
    process.exitCode = 3;
  }
}
