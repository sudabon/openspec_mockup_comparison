import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { deriveSchema, derivationErrors } from '../lib/derive-schema.mjs';
import { parse } from '../payload/scripts/lib/mockup/yaml-safe.mjs';
import { addonRepo, readIn, ROOT, runInstall, runTestkitGate, testkitDir, testkitRepo, writeIn } from './support.mjs';

const BASE_DIR = () => join(testkitDir(), 'payload/openspec/schemas/quality-driven-e2e');
const PAYLOAD_SCHEMA = join(ROOT, 'payload/schema');

function openspec(cwd, args) {
  const result = spawnSync('openspec', args, { cwd, encoding: 'utf8' });
  if (result.error) throw new Error(`OpenSpec CLI を実行できません（skip しません）: ${result.error.message}`);
  return result;
}

test('Integrated instructions are inherited verbatim: every artifact of quality-driven-e2e is unchanged', () => {
  const derived = deriveSchema(BASE_DIR(), PAYLOAD_SCHEMA);
  assert.deepEqual(derived.errors, []);
  const base = parse(readFileSync(join(BASE_DIR(), 'schema.yaml'), 'utf8'));
  const schema = parse(derived.files.get('schema.yaml').toString());
  assert.equal(schema.name, 'quality-driven-e2e-mockup');
  for (const artifact of base.artifacts) {
    const mine = schema.artifacts.find(item => item.id === artifact.id);
    assert.ok(mine, artifact.id);
    for (const key of ['generates', 'template', 'description']) assert.equal(mine[key], artifact[key], `${artifact.id}.${key}`);
    if (artifact.id === 'tasks') {
      assert.ok(mine.instruction.startsWith(artifact.instruction.replace(/\s+$/, '')), 'tasks instruction keeps the integrated text first');
      assert.match(mine.instruction, /## 7\. Mockup Comparison/);
      assert.deepEqual(mine.requires, [...artifact.requires, 'mockup-plan']);
    } else {
      assert.equal(mine.instruction, artifact.instruction, `${artifact.id}.instruction`);
      assert.deepEqual(mine.requires, artifact.requires, `${artifact.id}.requires`);
    }
  }
  assert.ok(schema.apply.instruction.startsWith(base.apply.instruction.replace(/\s+$/, '')));
  assert.match(schema.apply.instruction, /M4\. .*人間が実施。Agent は記入しない/);
  assert.deepEqual(schema.apply.requires, base.apply.requires);
  assert.equal(schema.apply.tracks, base.apply.tracks);
  const ids = schema.artifacts.map(item => item.id);
  assert.equal(ids[ids.indexOf('test-plan') + 1], 'mockup-plan');
  for (const name of Object.keys(derived.generatedFrom.templates)) {
    assert.ok(derived.files.get(`templates/${name}`).equals(readFileSync(join(BASE_DIR(), 'templates', name))), name);
  }
  assert.deepEqual(JSON.parse(derived.files.get('testkit-compat.json').toString()), { extends: 'quality-driven-e2e', compatVersion: 1 });
});

test('the self-check rejects any change to inherited content', () => {
  const derived = deriveSchema(BASE_DIR(), PAYLOAD_SCHEMA);
  const base = parse(readFileSync(join(BASE_DIR(), 'schema.yaml'), 'utf8'));
  const additions = {
    planInstruction: readFileSync(join(PAYLOAD_SCHEMA, 'mockup-plan.instruction.md'), 'utf8').replace(/\s+$/, ''),
    tasksAppend: readFileSync(join(PAYLOAD_SCHEMA, 'tasks.append.md'), 'utf8').replace(/\s+$/, ''),
    applyAppend: readFileSync(join(PAYLOAD_SCHEMA, 'apply.append.md'), 'utf8').replace(/\s+$/, ''),
  };
  const good = parse(derived.files.get('schema.yaml').toString());
  assert.deepEqual(derivationErrors(base, good, additions), []);
  const weakened = structuredClone(good);
  weakened.artifacts.find(item => item.id === 'quality').instruction = 'なんでもよい';
  assert.match(derivationErrors(base, weakened, additions).join('\n'), /artifact quality の instruction が統合 schema と違います/);
  const dropped = structuredClone(good);
  dropped.artifacts = dropped.artifacts.filter(item => item.id !== 'test-plan');
  assert.match(derivationErrors(base, dropped, additions).join('\n'), /artifact の並び/);
});

test('generation refuses an integrated schema that is not safe YAML or lacks test-plan', t => {
  const repo = testkitRepo(t);
  const path = join(repo.dir, 'openspec/schemas/quality-driven-e2e/schema.yaml');
  const original = readFileSync(path, 'utf8');
  writeFileSync(path, original.replace('name: quality-driven-e2e', 'name: &n quality-driven-e2e\nalias: *n'));
  assert.match(deriveSchema(join(repo.dir, 'openspec/schemas/quality-driven-e2e'), PAYLOAD_SCHEMA).errors.join(), /alias/);
  writeFileSync(path, original.replace('- id: test-plan', '- id: test-plan-renamed'));
  assert.match(deriveSchema(join(repo.dir, 'openspec/schemas/quality-driven-e2e'), PAYLOAD_SCHEMA).errors.join(), /test-plan/);
  const result = runInstall(repo.dir, ['install']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /派生 schema を生成できません/);
});

test('OpenSpec accepts the generated schema and serves the mockup-plan instructions', t => {
  const repo = addonRepo(t);
  const validate = openspec(repo.dir, ['schema', 'validate', 'quality-driven-e2e-mockup']);
  assert.equal(validate.status, 0, validate.stdout + validate.stderr);
  const created = openspec(repo.dir, ['new', 'change', 'demo', '--schema', 'quality-driven-e2e-mockup']);
  assert.equal(created.status, 0, created.stdout + created.stderr);
  assert.match(readIn(repo.dir, 'openspec/changes/demo/.openspec.yaml'), /schema: quality-driven-e2e-mockup/);
  const status = JSON.parse(openspec(repo.dir, ['status', '--change', 'demo', '--json']).stdout);
  const plan = status.artifacts.find(item => item.id === 'mockup-plan');
  assert.deepEqual(plan.requires, ['specs', 'quality']);
  assert.ok(status.artifacts.find(item => item.id === 'tasks').requires.includes('mockup-plan'));
  const instructions = JSON.parse(openspec(repo.dir, ['instructions', 'mockup-plan', '--change', 'demo', '--json']).stdout);
  assert.match(instructions.instruction, /MK-ID, Requirement, Scenario, Mockup, Target, Viewports, Fixture, Masks, Threshold/);
  assert.match(instructions.template, /\| MK-ID \| Requirement \| Scenario \| Mockup \| Target \| Viewports \| Fixture \| Masks \| Threshold \|/);
});

test('Generated schema is recognised by testkit: doctor and select treat it as the integrated family', t => {
  const repo = addonRepo(t);
  const doctor = runTestkitGate(repo.dir, ['doctor']);
  assert.match(doctor.stdout + doctor.stderr, /派生 schema quality-driven-e2e-mockup を統合 schema \(quality-driven-e2e\) の系統として扱います/);
  assert.doesNotMatch(doctor.stdout + doctor.stderr, /互換宣言が無効/);
  writeIn(repo.dir, 'openspec/changes/demo/.openspec.yaml', 'schema: quality-driven-e2e-mockup\ncreated: 2026-10-08\n');
  writeIn(repo.dir, 'openspec/changes/demo/proposal.md', '# Proposal\n');
  const select = runTestkitGate(repo.dir, ['select', 'demo', '--json']);
  const change = JSON.parse(select.stdout).changes[0];
  assert.equal(change.schema, 'quality-driven-e2e');
  assert.equal(change.declaredSchema, 'quality-driven-e2e-mockup');
  assert.equal(change.qe, true);
});

test('Regeneration after a testkit update: a changed test-plan instruction reaches the derived schema', t => {
  const repo = addonRepo(t);
  const path = join(repo.dir, 'openspec/schemas/quality-driven-e2e/schema.yaml');
  const before = JSON.parse(readIn(repo.dir, '.openspec-mockup-comparison.json')).generatedFrom.schemaYaml;
  writeFileSync(path, readFileSync(path, 'utf8').replace('specs の全シナリオを E2E か対象外へ割り当てる。', 'specs の全シナリオを E2E か対象外へ割り当てる（更新版）。'));
  const update = runInstall(repo.dir, ['update']);
  assert.equal(update.status, 0, update.stderr);
  const derived = parse(readIn(repo.dir, 'openspec/schemas/quality-driven-e2e-mockup/schema.yaml'));
  assert.match(derived.artifacts.find(item => item.id === 'test-plan').instruction, /（更新版）/);
  const after = JSON.parse(readIn(repo.dir, '.openspec-mockup-comparison.json')).generatedFrom.schemaYaml;
  assert.notEqual(after, before);
  execFileSync(process.execPath, [join(repo.dir, 'scripts/mockup-gate.mjs'), 'doctor'], { cwd: repo.dir });
});
