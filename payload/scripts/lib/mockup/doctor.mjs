import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { currentBaseDigests, sha256 } from './base-digest.mjs';
import { ADDON_STAMP, BASE_SCHEMA_DIR, DERIVED_SCHEMA, DERIVED_SCHEMA_DIR, POLICY_PATH, TESTKIT_STAMP } from './constants.mjs';
import { readPolicy } from './policy.mjs';
import { tk } from './testkit.mjs';

// Files whose content must stay exactly as installed: the gate, its modules and the generated schema.
export function isCriticalFile(rel) {
  return rel === 'scripts/mockup-gate.mjs' || rel.startsWith('scripts/lib/mockup/') || rel.startsWith(`${DERIVED_SCHEMA_DIR}/`);
}

function readStamp(repo) {
  const abs = join(repo, ADDON_STAMP);
  if (!existsSync(abs)) return { error: `${ADDON_STAMP} がありません。アドオンを install してください` };
  try {
    return { data: JSON.parse(readFileSync(abs, 'utf8')) };
  } catch (err) {
    return { error: `${ADDON_STAMP} が壊れています (${err.message})` };
  }
}

function driftErrors(repo, generatedFrom) {
  const current = currentBaseDigests(join(repo, BASE_SCHEMA_DIR));
  if (!current) return [`${BASE_SCHEMA_DIR}/schema.yaml がありません`];
  if (!generatedFrom) return [`${ADDON_STAMP} に派生 schema の生成元の記録がありません。アドオンを update してください`];
  const changed = [];
  if (current.schemaYaml !== generatedFrom.schemaYaml) changed.push('schema.yaml');
  for (const name of new Set([...Object.keys(current.templates), ...Object.keys(generatedFrom.templates ?? {})])) {
    if (current.templates[name] !== generatedFrom.templates?.[name]) changed.push(`templates/${name}`);
  }
  if (!changed.length) return [];
  return [`統合 schema が派生 schema の生成後に変わっています (${changed.join(', ')})。testkit の update のあとはアドオンも update して再生成してください: npx github:sudabon/openspec_mockup_comparison update`];
}

function playwrightNote(repo) {
  return existsSync(join(repo, 'node_modules/@playwright/test/package.json'))
    ? []
    : ['@playwright/test が見つかりません。比較テストの実行には導入先の依存として @playwright/test が必要です（アドオンは package.json を変更しません）'];
}

// Readiness of the add-on in `repo`. tk must be loaded; the caller reports a testkit mismatch before calling.
export function doctor(repo, env = {}) {
  const failures = [];
  const notes = [];
  if (!existsSync(join(repo, TESTKIT_STAMP))) failures.push(`${TESTKIT_STAMP} がありません。testkit を導入してください`);
  const stamp = readStamp(repo);
  if (stamp.error) failures.push(stamp.error);
  else {
    for (const [rel, expected] of Object.entries(stamp.data.files ?? {})) {
      if (!isCriticalFile(rel)) continue;
      const abs = join(repo, rel);
      if (!existsSync(abs)) failures.push(`必須ファイルがありません: ${rel}`);
      else if (sha256(readFileSync(abs)) !== expected) failures.push(`必須ファイルが導入内容と違います: ${rel}`);
    }
    if (stamp.data.e2eRoot && !existsSync(join(repo, stamp.data.e2eRoot, 'support/mockup.ts'))) {
      failures.push(`比較ヘルパーがありません: ${stamp.data.e2eRoot}/support/mockup.ts`);
    }
    failures.push(...driftErrors(repo, stamp.data.generatedFrom));
  }
  const family = tk.resolveSchemaFamily(repo, DERIVED_SCHEMA);
  if (!family.derived) failures.push(`testkit が ${DERIVED_SCHEMA} を統合系統の派生 schema と判定しません${family.error ? ` (${family.error})` : ''}`);
  else notes.push(`${DERIVED_SCHEMA} は testkit から統合系統の派生 schema として扱われます`);
  const policy = readPolicy(repo, env);
  if (policy.errors.length) failures.push(...policy.errors);
  notes.push(...policy.notes);
  if (/@sha256:[0-9a-f]{64}$/.test(policy.values.mockup_reference_environment ?? '') === false && policy.values.mockup_reference_environment) {
    failures.push(`${POLICY_PATH} の mockup_reference_environment は 名前@sha256:<64桁> で書きます（実際: ${policy.values.mockup_reference_environment}）`);
  }
  notes.push(...playwrightNote(repo));
  return { ok: failures.length === 0, failures, notes };
}
