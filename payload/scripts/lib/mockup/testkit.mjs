import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The testkit modules this add-on reuses, with the exports it calls. testkit copies them into the target's
// scripts/lib/, next to scripts/lib/mockup/. They are loaded dynamically so that a missing or older testkit is
// reported by name with exit code 2 instead of crashing on a static import.
export const REQUIRED_EXPORTS = {
  'select.mjs': ['selectChanges'],
  'schema-family.mjs': ['resolveSchemaFamily', 'listCompatDeclarations', 'readCompatDeclaration'],
  'frontmatter.mjs': ['splitFrontmatter', 'parseYamlText', 'asString', 'validDate', 'isPlainMapping'],
  'markdown.mjs': ['section', 'parseTable', 'markdownProse', 'hasBoundedToken'],
  'git.mjs': ['git', 'gitShow'],
  'registry.mjs': ['checkRegistry'],
  'evaluate.mjs': ['effectivePhase'],
  'tasks.mjs': ['parseTasks', 'taskState'],
  'e2e-root.mjs': ['installedE2eRoot'],
  'hash.mjs': ['sha256', 'sha256File'],
  'changes.mjs': ['listActiveChanges', 'listArchivedChanges'],
};

// Filled by loadTestkit(). Modules of this add-on read testkit functions from here.
export const tk = {};

export const DEFAULT_LIB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

// Loads every required module from `libDir` (the target's scripts/lib). Returns { ok, missing } where missing lists
// `module` or `module#export` entries; tk is filled only when nothing is missing.
export async function loadTestkit(libDir = DEFAULT_LIB_DIR) {
  const missing = [];
  const loaded = {};
  for (const [file, names] of Object.entries(REQUIRED_EXPORTS)) {
    const abs = join(libDir, file);
    if (!existsSync(abs)) {
      missing.push(file);
      continue;
    }
    let mod;
    try {
      mod = await import(pathToFileURL(abs).href);
    } catch (err) {
      missing.push(`${file} (読み込めません: ${err.message})`);
      continue;
    }
    for (const name of names) {
      if (typeof mod[name] !== 'function') missing.push(`${file}#${name}`);
      else loaded[name] = mod[name];
    }
  }
  if (!missing.length) Object.assign(tk, loaded);
  return { ok: missing.length === 0, missing };
}

export function testkitMismatchMessage(missing) {
  return `testkit の版が合いません。次の module / export がありません: ${missing.join(', ')}。`
    + 'testkit を update してください（npx github:sudabon/openspec_custom_testkit update）';
}
