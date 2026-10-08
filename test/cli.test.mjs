import assert from 'node:assert/strict';
import test from 'node:test';
import { runInstall, tempDir } from './support.mjs';

test('--help prints the usage and exits 0', () => {
  const result = runInstall(tempDir(), ['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /usage: openspec-mockup-comparison \[install\|update\|uninstall\]/);
});

test('an unknown argument is a usage error with exit code 2', () => {
  for (const args of [['--bogus'], ['install', 'extra'], ['--target'], ['uninstall', '--force']]) {
    const result = runInstall(tempDir(), args);
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.stderr, /usage:/);
  }
});

test('Conflicting options: --set-default with --keep-default is a usage error', () => {
  const result = runInstall(tempDir(), ['install', '--set-default', '--keep-default']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--set-default と --keep-default は同時に指定できません/);
  assert.equal(runInstall(tempDir(), ['uninstall', '--keep-default']).status, 2);
});

test('the usage explains the default schema options', () => {
  const result = runInstall(tempDir(), ['--help']);
  assert.match(result.stdout, /--keep-default 既定 schema を変えない/);
  assert.match(result.stdout, /初めての install では既定が quality-driven-e2e・spec-driven・/);
});
