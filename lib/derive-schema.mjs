import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_SCHEMA, COMPAT_DECLARATION, COMPAT_FILE, DERIVED_SCHEMA, PLAN_FILE, REPORT_FILE } from '../payload/scripts/lib/mockup/constants.mjs';
import { listTemplates, sha256 } from '../payload/scripts/lib/mockup/base-digest.mjs';
import { isMap, isScalar, isSeq, parse, parseDocument, parseYamlText, Scalar } from '../payload/scripts/lib/mockup/yaml-safe.mjs';

export const PLAN_ARTIFACT = 'mockup-plan';
const INSERT_AFTER = 'test-plan';
const DESCRIPTION = 'Integrated quality and E2E workflow with mockup comparison - derived from quality-driven-e2e by openspec-mockup-comparison. '
  + 'Adds mockup-plan (after specs and quality) and the 7. Mockup Comparison task group; every artifact and instruction of quality-driven-e2e is kept verbatim.';

function readAdditions(payloadSchemaDir) {
  const read = rel => readFileSync(join(payloadSchemaDir, rel), 'utf8').replace(/\s+$/, '');
  return {
    planInstruction: read('mockup-plan.instruction.md'),
    tasksAppend: read('tasks.append.md'),
    applyAppend: read('apply.append.md'),
    templates: {
      [PLAN_FILE]: readFileSync(join(payloadSchemaDir, 'templates', PLAN_FILE)),
      [REPORT_FILE]: readFileSync(join(payloadSchemaDir, 'templates', REPORT_FILE)),
    },
  };
}

function blockScalar(value) {
  const node = new Scalar(value);
  node.type = Scalar.BLOCK_LITERAL;
  return node;
}

function appendText(original, addition) {
  return `${String(original).replace(/\s+$/, '')}\n\n${addition}\n`;
}

// The schema.yaml text of the derived schema, built by editing the integrated schema's AST.
function deriveYaml(baseText, additions) {
  const doc = parseDocument(baseText, { prettyErrors: false });
  if (doc.errors.length) throw new Error(`統合 schema を解釈できません: ${doc.errors[0].message}`);
  doc.set('name', DERIVED_SCHEMA);
  doc.set('description', DESCRIPTION);
  const artifacts = doc.get('artifacts', true);
  if (!isSeq(artifacts)) throw new Error('統合 schema の artifacts が配列ではありません');
  const idOf = item => (isMap(item) ? item.get('id') : undefined);
  const afterIndex = artifacts.items.findIndex(item => idOf(item) === INSERT_AFTER);
  const tasks = artifacts.items.find(item => idOf(item) === 'tasks');
  if (afterIndex === -1 || !tasks) throw new Error(`統合 schema に ${INSERT_AFTER} または tasks の artifact がありません`);
  if (artifacts.items.some(item => idOf(item) === PLAN_ARTIFACT)) throw new Error(`統合 schema に既に ${PLAN_ARTIFACT} があります`);

  const plan = doc.createNode({
    id: PLAN_ARTIFACT,
    generates: PLAN_FILE,
    description: 'モック照合の計画 - mockup root の HTML モックと実画面の対応、viewport、マスク、閾値',
    template: PLAN_FILE,
    instruction: '',
    requires: ['specs', 'quality'],
  });
  plan.set('instruction', blockScalar(`${additions.planInstruction}\n`));
  artifacts.items.splice(afterIndex + 1, 0, plan);

  const requires = tasks.get('requires', true);
  if (!isSeq(requires)) throw new Error('統合 schema の tasks.requires が配列ではありません');
  requires.add(PLAN_ARTIFACT);
  const taskInstruction = tasks.get('instruction', true);
  if (!isScalar(taskInstruction)) throw new Error('統合 schema の tasks.instruction が文字列ではありません');
  tasks.set('instruction', blockScalar(appendText(taskInstruction.value, additions.tasksAppend)));

  const apply = doc.get('apply', true);
  if (!isMap(apply)) throw new Error('統合 schema に apply がありません');
  const applyInstruction = apply.get('instruction', true);
  apply.set('instruction', blockScalar(appendText(isScalar(applyInstruction) ? applyInstruction.value : '', additions.applyAppend)));
  return doc.toString({ lineWidth: 0 });
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Every difference between the integrated and the derived schema that is not one of the additions.
export function derivationErrors(base, derived, additions) {
  const errors = [];
  if (derived.name !== DERIVED_SCHEMA) errors.push(`name が ${DERIVED_SCHEMA} ではありません`);
  if (derived.version !== base.version) errors.push('version が統合 schema と違います');
  const baseArtifacts = base.artifacts ?? [];
  const derivedArtifacts = derived.artifacts ?? [];
  const expectedIds = [...baseArtifacts.map(item => item.id)];
  expectedIds.splice(expectedIds.indexOf(INSERT_AFTER) + 1, 0, PLAN_ARTIFACT);
  if (!sameJson(derivedArtifacts.map(item => item.id), expectedIds)) errors.push(`artifact の並びが想定と違います: ${derivedArtifacts.map(item => item.id).join(', ')}`);
  for (const expected of baseArtifacts) {
    const actual = derivedArtifacts.find(item => item.id === expected.id);
    if (!actual) continue;
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      if (expected.id === 'tasks' && key === 'requires') {
        if (!sameJson(actual.requires, [...(expected.requires ?? []), PLAN_ARTIFACT])) errors.push('tasks.requires は統合 schema の値に mockup-plan を足したものではありません');
      } else if (expected.id === 'tasks' && key === 'instruction') {
        if (actual.instruction !== appendText(expected.instruction, additions.tasksAppend)) errors.push('tasks.instruction は統合 schema の文面に追記したものではありません');
      } else if (!sameJson(actual[key], expected[key])) {
        errors.push(`artifact ${expected.id} の ${key} が統合 schema と違います`);
      }
    }
  }
  const plan = derivedArtifacts.find(item => item.id === PLAN_ARTIFACT);
  if (!plan || plan.generates !== PLAN_FILE || !sameJson(plan.requires, ['specs', 'quality']) || plan.instruction !== `${additions.planInstruction}\n`) {
    errors.push(`${PLAN_ARTIFACT} artifact が想定と違います`);
  }
  const baseApply = base.apply ?? {};
  const derivedApply = derived.apply ?? {};
  if (!sameJson(derivedApply.requires, baseApply.requires) || derivedApply.tracks !== baseApply.tracks) errors.push('apply.requires / apply.tracks が統合 schema と違います');
  if (derivedApply.instruction !== appendText(baseApply.instruction ?? '', additions.applyAppend)) errors.push('apply.instruction は統合 schema の文面に追記したものではありません');
  const extraKeys = Object.keys(derived).filter(key => !['name', 'version', 'description', 'artifacts', 'apply'].includes(key));
  const missingKeys = Object.keys(base).filter(key => !(key in derived));
  if (extraKeys.length || missingKeys.length) errors.push(`トップレベルのキーが統合 schema と違います (${[...extraKeys, ...missingKeys].join(', ')})`);
  return errors;
}

// Builds the derived schema from the integrated schema directory `baseDir`.
// Returns { files: Map<rel inside the derived dir, Buffer>, generatedFrom, errors }. Nothing is written here.
export function deriveSchema(baseDir, payloadSchemaDir) {
  const schemaPath = join(baseDir, 'schema.yaml');
  if (!existsSync(schemaPath)) return { files: new Map(), generatedFrom: null, errors: [`${BASE_SCHEMA}/schema.yaml がありません`] };
  const baseText = readFileSync(schemaPath, 'utf8');
  const safety = parseYamlText(baseText);
  if (safety.errors.length || safety.alias || safety.tagged) {
    return { files: new Map(), generatedFrom: null, errors: [`統合 schema を安全に解釈できません: ${safety.errors[0] ?? 'alias または独自 tag を含みます'}`] };
  }
  const additions = readAdditions(payloadSchemaDir);
  let derivedText;
  try {
    derivedText = deriveYaml(baseText, additions);
  } catch (err) {
    return { files: new Map(), generatedFrom: null, errors: [err.message] };
  }
  const errors = derivationErrors(parse(baseText), parse(derivedText), additions);
  const files = new Map();
  files.set('schema.yaml', Buffer.from(derivedText));
  files.set(COMPAT_FILE, Buffer.from(`${JSON.stringify(COMPAT_DECLARATION, null, 2)}\n`));
  const templates = {};
  const templateDir = join(baseDir, 'templates');
  for (const name of listTemplates(templateDir)) {
    const buf = readFileSync(join(templateDir, name));
    templates[name] = sha256(buf);
    if (name in additions.templates) errors.push(`統合 schema に ${name} テンプレートが既にあります`);
    files.set(`templates/${name}`, buf);
  }
  for (const [name, buf] of Object.entries(additions.templates)) files.set(`templates/${name}`, buf);
  return { files, generatedFrom: { schemaYaml: sha256(baseText), templates }, errors };
}
