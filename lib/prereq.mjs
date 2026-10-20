import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BASE_SCHEMA_DIR, TESTKIT_STAMP } from '../payload/scripts/lib/mockup/constants.mjs';

// testkit features this add-on needs at install time, checked by what the installed files export rather than by
// testkit's package version (which does not change between these releases).
export async function checkTestkit(target) {
  const problems = [];
  const stampPath = join(target, TESTKIT_STAMP);
  if (!existsSync(stampPath)) {
    problems.push(`${TESTKIT_STAMP} がありません。先に testkit を導入してください: npx github:sudabon/openspec_custom_testkit install`);
    return { ok: false, problems };
  }
  try {
    JSON.parse(readFileSync(stampPath, 'utf8'));
  } catch (err) {
    problems.push(`${TESTKIT_STAMP} を読めません (${err.message})。testkit を update して修復してください`);
  }
  const family = join(target, 'scripts/lib/schema-family.mjs');
  if (!existsSync(family)) {
    problems.push('scripts/lib/schema-family.mjs がありません。派生 schema に対応した testkit へ update してください: npx github:sudabon/openspec_custom_testkit update');
  } else {
    try {
      const mod = await import(pathToFileURL(family).href);
      for (const name of ['listCompatDeclarations', 'resolveSchemaFamily']) {
        if (typeof mod[name] !== 'function') problems.push(`scripts/lib/schema-family.mjs に ${name} がありません。testkit を update してください: npx github:sudabon/openspec_custom_testkit update`);
      }
    } catch (err) {
      problems.push(`scripts/lib/schema-family.mjs を読み込めません (${err.message})`);
    }
  }
  if (!existsSync(join(target, BASE_SCHEMA_DIR, 'schema.yaml'))) {
    problems.push(`${BASE_SCHEMA_DIR}/schema.yaml がありません。testkit を update してください`);
  }
  return { ok: problems.length === 0, problems };
}

// The E2E root testkit installed into, from testkit's own resolver.
export async function testkitE2eRoot(target) {
  const mod = await import(pathToFileURL(join(target, 'scripts/lib/e2e-root.mjs')).href);
  return mod.installedE2eRoot(target);
}
