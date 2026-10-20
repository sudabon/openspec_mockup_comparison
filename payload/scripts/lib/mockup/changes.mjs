import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tk } from './testkit.mjs';

// The directory of change `id`: the active one, or else its latest archive folder. tk must be loaded.
export function findChangeDir(repo, id) {
  const active = `openspec/changes/${id}`;
  if (existsSync(join(repo, active, '.openspec.yaml')) || existsSync(join(repo, active, 'proposal.md'))) return active;
  const archived = tk.listArchivedChanges(repo).filter(change => change.id === id).map(change => change.dir).sort();
  return archived.at(-1) ?? null;
}

// The schema an active or archived change declares in its .openspec.yaml, or null.
export function declaredSchemaOf(repo, dir) {
  const abs = join(repo, dir, '.openspec.yaml');
  if (!existsSync(abs)) return null;
  const parsed = tk.parseYamlText(readFileSync(abs, 'utf8'));
  return tk.isPlainMapping(parsed.data) ? tk.asString(parsed.data.schema) || null : null;
}
