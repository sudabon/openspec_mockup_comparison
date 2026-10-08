import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import test from 'node:test';
import { decideAction } from '../lib/cli.mjs';
import { addonRepo, gitRepo, readIn, runInstall, testkitRepo, writeIn } from './support.mjs';

const STAMP = '.openspec-mockup-comparison.json';
const sha = buf => createHash('sha256').update(buf).digest('hex');

function snapshot(dir) {
  const out = {};
  const walk = abs => {
    for (const name of readdirSync(abs)) {
      if (name === '.git') continue;
      const path = join(abs, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else out[relative(dir, path)] = { sha: sha(readFileSync(path)), mode: stat.mode, mtime: stat.mtimeMs };
    }
  };
  walk(dir);
  return out;
}

test('testkit is not installed: nothing is written and the exit code is 1', t => {
  const repo = gitRepo(t);
  const before = snapshot(repo.dir);
  const result = runInstall(repo.dir, ['install']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\.openspec-custom-testkit\.json がありません.*testkit/s);
  assert.deepEqual(snapshot(repo.dir), before);
});

test('testkit is too old: a missing schema-family module or export stops the install without writes', t => {
  for (const [label, edit] of [
    ['module', dir => rmSync(join(dir, 'scripts/lib/schema-family.mjs'))],
    ['export', dir => writeFileSync(join(dir, 'scripts/lib/schema-family.mjs'), 'export function resolveSchemaFamily() {}\n')],
  ]) {
    const repo = testkitRepo(t);
    edit(repo.dir);
    const before = snapshot(repo.dir);
    const result = runInstall(repo.dir, ['install']);
    assert.equal(result.status, 1, label);
    assert.match(result.stderr, /update/, label);
    assert.deepEqual(snapshot(repo.dir), before, label);
  }
});

test('not a git repository: the install stops with exit code 1', t => {
  const repo = gitRepo(t);
  rmSync(join(repo.dir, '.git'), { recursive: true, force: true });
  const result = runInstall(repo.dir, ['install']);
  assert.equal(result.status, 1);
});

test('install places the payload, the derived schema and the stamp', t => {
  const repo = addonRepo(t);
  for (const rel of [
    STAMP, 'scripts/mockup-gate.mjs', 'scripts/lib/mockup/constants.mjs', 'openspec/mockup-policy.md',
    'openspec/schemas/quality-driven-e2e-mockup/schema.yaml', 'openspec/schemas/quality-driven-e2e-mockup/testkit-compat.json',
    'openspec/schemas/quality-driven-e2e-mockup/templates/mockup-plan.md', 'tests/e2e/support/mockup.ts',
  ]) assert.ok(existsSync(join(repo.dir, rel)), rel);
  const stamp = JSON.parse(readIn(repo.dir, STAMP));
  assert.equal(stamp.schema, 'quality-driven-e2e-mockup');
  assert.equal(stamp.e2eRoot, 'tests/e2e');
  assert.match(stamp.generatedFrom.schemaYaml, /^[0-9a-f]{64}$/);
  assert.ok(!existsSync(join(repo.dir, 'schema')), 'installer input is not placed');
  assert.ok(statSync(join(repo.dir, 'scripts/mockup-gate.mjs')).mode & 0o100, 'gate is executable');
});

test('Re-running install: no file content, mtime or stamp installedAt changes', t => {
  const repo = addonRepo(t);
  const before = snapshot(repo.dir);
  const result = runInstall(repo.dir, ['install']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(snapshot(repo.dir), before);
  assert.equal(repo.git(['status', '--porcelain']).trim(), '');
});

test('--dry-run writes nothing', t => {
  const repo = testkitRepo(t);
  const before = snapshot(repo.dir);
  const result = runInstall(repo.dir, ['install', '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dry-run/);
  assert.match(result.stdout, /作成: scripts\/mockup-gate\.mjs/);
  assert.deepEqual(snapshot(repo.dir), before);
});

test('Edited policy is kept: update --force leaves the policy and shows the diff', t => {
  const repo = addonRepo(t);
  const policy = readIn(repo.dir, 'openspec/mockup-policy.md').replace('mockup_default_threshold: 0.01', 'mockup_default_threshold: 0.02');
  writeIn(repo.dir, 'openspec/mockup-policy.md', policy);
  const result = runInstall(repo.dir, ['update', '--force']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readIn(repo.dir, 'openspec/mockup-policy.md'), policy);
  assert.match(result.stdout, /保持\(利用者が管理\): openspec\/mockup-policy\.md/);
  assert.match(result.stdout, /-mockup_default_threshold: 0\.02/);
});

test('an edited distributed file is kept without --force and overwritten with it', t => {
  const repo = addonRepo(t);
  const rel = '.claude/skills/mockup-comparison/SKILL.md';
  writeIn(repo.dir, rel, 'edited\n');
  const kept = runInstall(repo.dir, ['update']);
  assert.equal(kept.status, 0, kept.stderr);
  assert.equal(readIn(repo.dir, rel), 'edited\n');
  assert.match(kept.stdout, /保持\(編集済み。--force で上書き\)/);
  const forced = runInstall(repo.dir, ['update', '--force']);
  assert.equal(forced.status, 0, forced.stderr);
  assert.notEqual(readIn(repo.dir, rel), 'edited\n');
});

test('testkit files untouched: every file in the testkit stamp keeps its sha256', t => {
  const repo = testkitRepo(t);
  const testkitStamp = JSON.parse(readIn(repo.dir, '.openspec-custom-testkit.json'));
  const files = Object.keys(testkitStamp.files ?? {});
  assert.ok(files.length > 10);
  const before = Object.fromEntries(files.map(rel => [rel, sha(readFileSync(join(repo.dir, rel)))]));
  const result = runInstall(repo.dir, ['install', '--set-default']);
  assert.equal(result.status, 0, result.stderr);
  for (const rel of files) assert.equal(sha(readFileSync(join(repo.dir, rel))), before[rel], rel);
  assert.equal(readIn(repo.dir, '.openspec-custom-testkit.json'), JSON.stringify(testkitStamp, null, 2) + '\n');
});

test('install does not touch package.json or an existing Playwright config', t => {
  const repo = testkitRepo(t);
  writeIn(repo.dir, 'package.json', '{"name":"app"}\n');
  writeIn(repo.dir, 'playwright.config.ts', 'export default {};\n');
  const result = runInstall(repo.dir, ['install']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readIn(repo.dir, 'package.json'), '{"name":"app"}\n');
  assert.equal(readIn(repo.dir, 'playwright.config.ts'), 'export default {};\n');
});

test('decideAction covers every combination', () => {
  assert.equal(decideAction({ exists: false }), 'create');
  assert.equal(decideAction({ exists: true, same: true }), 'same');
  assert.equal(decideAction({ exists: true, same: false, protectedFile: true, force: true }), 'protect');
  assert.equal(decideAction({ exists: true, same: false, recorded: true }), 'update');
  assert.equal(decideAction({ exists: true, same: false, recorded: false, force: false }), 'keep');
  assert.equal(decideAction({ exists: true, same: false, recorded: false, force: true }), 'overwrite');
});

function newChange(repo, name, schema) {
  writeIn(repo.dir, `openspec/changes/${name}/.openspec.yaml`, `schema: ${schema}\ncreated: 2026-10-08\n`);
  writeIn(repo.dir, `openspec/changes/${name}/proposal.md`, '# Proposal\n');
}

test('Active change still uses the schema: uninstall removes nothing and names the change', t => {
  const repo = addonRepo(t);
  newChange(repo, 'add-login-page', 'quality-driven-e2e-mockup');
  repo.commit('change');
  const before = snapshot(repo.dir);
  const result = runInstall(repo.dir, ['uninstall']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /add-login-page/);
  assert.match(result.stderr, /archive/);
  assert.deepEqual(snapshot(repo.dir), before);
});

test('uninstall removes the add-on, keeps the policy and restores the default schema', t => {
  const repo = addonRepo(t, ['--set-default']);
  assert.match(readIn(repo.dir, 'openspec/config.yaml'), /^schema: quality-driven-e2e-mockup$/m);
  newChange(repo, 'archived-one', 'quality-driven-e2e');
  repo.commit('other change');
  const result = runInstall(repo.dir, ['uninstall']);
  assert.equal(result.status, 0, result.stderr);
  for (const rel of [STAMP, 'scripts/mockup-gate.mjs', 'scripts/lib/mockup', 'openspec/schemas/quality-driven-e2e-mockup', 'tests/e2e/support/mockup.ts']) {
    assert.ok(!existsSync(join(repo.dir, rel)), rel);
  }
  assert.ok(existsSync(join(repo.dir, 'openspec/mockup-policy.md')));
  const config = readIn(repo.dir, 'openspec/config.yaml');
  assert.match(config, /^schema: quality-driven-e2e$/m);
  assert.doesNotMatch(config, /openspec-mockup-comparison/);
  assert.ok(existsSync(join(repo.dir, 'tests/e2e')), 'testkit E2E root stays');
  assert.ok(existsSync(join(repo.dir, 'scripts/testkit-gate.mjs')), 'testkit stays');
});

test('uninstall keeps a distributed file the user edited', t => {
  const repo = addonRepo(t);
  writeIn(repo.dir, '.claude/agents/mockup-reviewer.md', 'mine\n');
  const result = runInstall(repo.dir, ['uninstall']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readIn(repo.dir, '.claude/agents/mockup-reviewer.md'), 'mine\n');
  assert.match(result.stdout, /保持\(編集済み\)/);
});

test('uninstall refuses stamp paths outside what the add-on places and deletes nothing', t => {
  const outside = gitRepo(t);
  writeIn(outside.dir, 'victim.txt', 'keep me\n');
  writeIn(outside.dir, 'empty/.keep', '');
  for (const rel of [`${outside.dir}/victim.txt`, `../${relative(join(outside.dir, '..'), outside.dir)}/victim.txt`, 'scripts/lib/mockup/../../../victim.txt', 'src/app.ts', 'README.md']) {
    const repo = addonRepo(t);
    const stamp = JSON.parse(readIn(repo.dir, STAMP));
    stamp.files[rel] = sha(Buffer.from('keep me\n'));
    writeIn(repo.dir, STAMP, JSON.stringify(stamp, null, 2));
    writeIn(repo.dir, 'src/app.ts', 'keep me\n');
    writeIn(repo.dir, 'README.md', 'keep me\n');
    const before = snapshot(repo.dir);
    const result = runInstall(repo.dir, ['uninstall']);
    assert.equal(result.status, 1, rel);
    assert.match(result.stderr, /のパスを拒否しました/, rel);
    assert.deepEqual(snapshot(repo.dir), before, rel);
    assert.equal(readIn(outside.dir, 'victim.txt'), 'keep me\n');
  }
});

test('uninstall refuses a recorded path that is a symlink leaving the target', t => {
  const outside = gitRepo(t);
  writeIn(outside.dir, 'victim.txt', 'keep me\n');
  const repo = addonRepo(t);
  const rel = '.claude/agents/mockup-reviewer.md';
  rmSync(join(repo.dir, rel));
  symlinkSync(join(outside.dir, 'victim.txt'), join(repo.dir, rel));
  const stamp = JSON.parse(readIn(repo.dir, STAMP));
  stamp.files[rel] = sha(Buffer.from('keep me\n'));
  writeIn(repo.dir, STAMP, JSON.stringify(stamp, null, 2));
  const result = runInstall(repo.dir, ['uninstall']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /target の外を指しています/);
  assert.equal(readIn(outside.dir, 'victim.txt'), 'keep me\n');
  assert.ok(existsSync(join(repo.dir, 'scripts/mockup-gate.mjs')));
});

test('First install switches the integrated default and records it in the stamp', t => {
  const repo = testkitRepo(t);
  assert.match(readIn(repo.dir, 'openspec/config.yaml'), /^schema: quality-driven-e2e$/m);
  const result = runInstall(repo.dir, ['install']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(readIn(repo.dir, 'openspec/config.yaml'), /^schema: quality-driven-e2e-mockup$/m);
  assert.equal(JSON.parse(readIn(repo.dir, STAMP)).defaultSchemaBefore, 'quality-driven-e2e');
  assert.match(result.stdout, /既定 schema: quality-driven-e2e → quality-driven-e2e-mockup（初めての導入。/);
  assert.match(result.stdout, /openspec new change <name>（既定 schema が派生 schema です）/);
});

test('Update keeps the default the user chose', t => {
  const repo = addonRepo(t);
  const config = readIn(repo.dir, 'openspec/config.yaml').replace(/^schema: .*$/m, 'schema: quality-driven-e2e');
  writeIn(repo.dir, 'openspec/config.yaml', config);
  for (const command of ['update', 'install']) {
    const result = runInstall(repo.dir, [command]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readIn(repo.dir, 'openspec/config.yaml'), config, command);
    assert.match(result.stdout, /既定 schema は変更しません/, command);
  }
  assert.equal(JSON.parse(readIn(repo.dir, STAMP)).defaultSchemaBefore, 'quality-driven-e2e', 'the stamp keeps the original value');
});

test('Custom default is kept on a first install', t => {
  const repo = testkitRepo(t);
  writeIn(repo.dir, 'openspec/config.yaml', readIn(repo.dir, 'openspec/config.yaml').replace(/^schema: .*$/m, 'schema: team-custom'));
  const result = runInstall(repo.dir, ['install']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(readIn(repo.dir, 'openspec/config.yaml'), /^schema: team-custom$/m);
  assert.match(result.stdout, /openspec new change <name> --schema quality-driven-e2e-mockup/);
  assert.ok(!Object.hasOwn(JSON.parse(readIn(repo.dir, STAMP)), 'defaultSchemaBefore'));
});

test('--set-default switches a custom default even on update', t => {
  const repo = addonRepo(t, ['--keep-default']);
  writeIn(repo.dir, 'openspec/config.yaml', readIn(repo.dir, 'openspec/config.yaml').replace(/^schema: .*$/m, 'schema: team-custom'));
  const result = runInstall(repo.dir, ['update', '--set-default']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(readIn(repo.dir, 'openspec/config.yaml'), /^schema: quality-driven-e2e-mockup$/m);
  assert.match(result.stdout, /既定 schema: team-custom → quality-driven-e2e-mockup（--set-default。/);
  assert.equal(JSON.parse(readIn(repo.dir, STAMP)).defaultSchemaBefore, 'team-custom');
});

test('--dry-run shows the planned switch and writes nothing', t => {
  const repo = testkitRepo(t);
  const before = snapshot(repo.dir);
  const result = runInstall(repo.dir, ['install', '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /既定 schema: quality-driven-e2e → quality-driven-e2e-mockup/);
  assert.deepEqual(snapshot(repo.dir), before);
});
