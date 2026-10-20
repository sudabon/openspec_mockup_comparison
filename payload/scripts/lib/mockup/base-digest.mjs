import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function listTemplates(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name => statSync(join(dir, name)).isFile()).sort();
}

// Digests of the integrated schema that a derived schema was generated from: schema.yaml and every template.
// The installer records them in the add-on stamp and doctor compares them with the current files.
export function currentBaseDigests(baseDir) {
  const schemaPath = join(baseDir, 'schema.yaml');
  if (!existsSync(schemaPath)) return null;
  const templates = {};
  for (const name of listTemplates(join(baseDir, 'templates'))) templates[name] = sha256(readFileSync(join(baseDir, 'templates', name)));
  return { schemaYaml: sha256(readFileSync(schemaPath)), templates };
}
