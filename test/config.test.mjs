import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeConfig, unmergeConfig } from '../lib/config-merge.mjs';
import { addonRepo, readIn, runInstall } from './support.mjs';

const BASE = `schema: quality-driven-e2e

# project note
context: |
  Language: Japanese
  # --- openspec-custom-testkit ---
  E2Eテスト: Playwright。
  # --- /openspec-custom-testkit ---

rules:
  proposal:
    - keep it short
`;

test('auto replaces only the integrated default, spec-driven and a missing schema', () => {
  for (const [text, before] of [['schema: quality-driven-e2e\n', 'quality-driven-e2e'], ['schema: spec-driven # default\n', 'spec-driven'], ['context: |\n  x\n', null]]) {
    const merged = mergeConfig(text);
    assert.equal(merged.switched, true, text);
    assert.equal(merged.previousDefault, before, text);
    assert.match(merged.text, /^schema: quality-driven-e2e-mockup$/m, text);
    assert.equal(merged.text.match(/^schema:/gm).length, 1, text);
    assert.match(merged.notes.join(), /既定 schema: .* → quality-driven-e2e-mockup/);
  }
});

test('auto keeps legacy and custom defaults and tells how to create a mockup change', () => {
  for (const schema of ['quality-driven', 'spec-driven-e2e', 'team-custom']) {
    const merged = mergeConfig(`schema: ${schema}\n`);
    assert.equal(merged.switched, false, schema);
    assert.match(merged.text, new RegExp(`^schema: ${schema}$`, 'm'));
    assert.match(merged.notes.join(), /独自に選ばれた schema なので変更しません.*--schema quality-driven-e2e-mockup.*--set-default/);
  }
});

test('force always switches and keep never does', () => {
  const forced = mergeConfig('schema: team-custom\n', { defaultMode: 'force' });
  assert.equal(forced.switched, true);
  assert.equal(forced.previousDefault, 'team-custom');
  assert.match(forced.text, /^schema: quality-driven-e2e-mockup$/m);
  const kept = mergeConfig('schema: quality-driven-e2e\n', { defaultMode: 'keep' });
  assert.equal(kept.switched, false);
  assert.match(kept.text, /^schema: quality-driven-e2e$/m);
  assert.match(kept.notes.join(), /--keep-default/);
  const already = mergeConfig('schema: quality-driven-e2e-mockup\n', { defaultMode: 'force' });
  assert.equal(already.switched, false);
});

test('Default schema is kept: install --keep-default leaves schema and prints the create command', t => {
  const repo = addonRepo(t, ['--keep-default']);
  assert.match(readIn(repo.dir, 'openspec/config.yaml'), /^schema: quality-driven-e2e$/m);
  const again = runInstall(repo.dir, ['update']);
  assert.match(again.stdout, /openspec new change <name> --schema quality-driven-e2e-mockup/);
});

test('the marked block is appended inside the context block and keeps comments and other keys', () => {
  const merged = mergeConfig(BASE);
  assert.equal(merged.blocked, false);
  const lines = merged.text.split('\n');
  const start = lines.indexOf('  # --- openspec-mockup-comparison ---');
  assert.ok(start > lines.indexOf('  # --- /openspec-custom-testkit ---'));
  assert.ok(start < lines.indexOf('rules:'));
  assert.match(merged.text, /# project note/);
  assert.match(merged.text, /- keep it short/);
});

test('re-merging does not duplicate the block and refreshes an outdated one', () => {
  const once = mergeConfig(BASE).text;
  assert.equal(mergeConfig(once).text, once);
  const outdated = once.replace(/モック比較: .*\n/, 'モック比較: 古い記述\n');
  const refreshed = mergeConfig(outdated).text;
  assert.equal(refreshed, once);
  assert.equal(refreshed.split('# --- openspec-mockup-comparison ---').length, 2);
});

test('a config without context gets one; force switches the default schema', () => {
  const merged = mergeConfig('schema: quality-driven-e2e\n', { defaultMode: 'force' });
  assert.match(merged.text, /^schema: quality-driven-e2e-mockup$/m);
  assert.match(merged.text, /^context: \|\n {2}# --- openspec-mockup-comparison ---$/m);
  assert.equal(merged.previousDefault, 'quality-driven-e2e');
});

test('store, aliases, custom tags and broken YAML are never edited in any mode', () => {
  for (const text of ['store: team\nschema: quality-driven-e2e\n', 'a: &x 1\nb: *x\nschema: quality-driven-e2e\n', 'schema: !custom x\n', 'schema: [\n']) {
    for (const defaultMode of ['auto', 'force', 'keep']) {
      const merged = mergeConfig(text, { defaultMode });
      assert.equal(merged.blocked, true, text);
      assert.equal(merged.switched, false, text);
      assert.equal(merged.text, text);
    }
    const merged = mergeConfig(text);
    assert.equal(merged.blocked, true, text);
    assert.equal(merged.text, text);
    assert.match(merged.warnings[0], /変更しません/);
  }
});

test('a single-line context is left alone with a warning', () => {
  const merged = mergeConfig('schema: quality-driven-e2e\ncontext: "one line"\n', { defaultMode: 'keep' });
  assert.equal(merged.text, 'schema: quality-driven-e2e\ncontext: "one line"\n');
  assert.match(merged.warnings[0], /手で追記/);
});

test('unmerge removes the block and restores the integrated default', () => {
  const merged = mergeConfig(BASE, { defaultMode: 'force' }).text;
  const restored = unmergeConfig(merged).text;
  assert.equal(restored, BASE);
});
