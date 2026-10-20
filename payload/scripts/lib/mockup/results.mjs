import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './base-digest.mjs';
import { RUN_OUTPUT_PATHS } from './constants.mjs';
import { tk } from './testkit.mjs';

// Glob with `**` (any path, including none), `*` (within a segment) and `?`. Paths use `/`.
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      re += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (char === '*') re += '[^/]*';
    else if (char === '?') re += '[^/]';
    else re += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(path, globs) {
  return globs.some(glob => globToRegExp(glob).test(path));
}

// Paths whose change after a run never makes the run stale or dirty: OpenSpec artifacts, the mockups (their
// content is checked by digest instead), run output, and the policy's mockup_ignore_paths.
export function ignoredGlobs(policy) {
  return ['openspec/**', `${policy.mockup_root}/**`, ...RUN_OUTPUT_PATHS, ...(policy.mockup_ignore_paths ?? [])];
}

// Uncommitted paths that matter for a comparison run.
export function dirtyPaths(repo, policy) {
  const text = tk.git(repo, ['status', '--porcelain', '-z', '--untracked-files=all']);
  const paths = [];
  const entries = text.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const status = entry.slice(0, 2);
    paths.push(entry.slice(3));
    // A rename lists its source as the next entry.
    if (status[0] === 'R' || status[0] === 'C') paths.push(entries[++i]);
  }
  const globs = ignoredGlobs(policy);
  return [...new Set(paths.filter(Boolean))].filter(path => !matchesAny(path, globs)).sort();
}

export function headCommit(repo) {
  return tk.git(repo, ['rev-parse', 'HEAD']).trim();
}

// The digest of what the browser loaded for a mockup: every served file's path and sha256, in path order.
export function mockupDigest(files) {
  return sha256(files.map(file => `${file.path}\t${file.sha256}`).join('\n'));
}

// The same digest recomputed from the current files under the mockup root. Missing files yield null.
export function currentMockupDigest(repo, policy, files) {
  const current = [];
  for (const file of files) {
    const abs = join(repo, policy.mockup_root, file.path);
    if (!existsSync(abs)) return { digest: null, missing: file.path };
    current.push({ path: file.path, sha256: sha256(readFileSync(abs)) });
  }
  return { digest: mockupDigest(current), missing: null };
}

export function playwrightVersion(repo) {
  const abs = join(repo, 'node_modules/@playwright/test/package.json');
  if (!existsSync(abs)) return null;
  try {
    return JSON.parse(readFileSync(abs, 'utf8')).version ?? null;
  } catch {
    return null;
  }
}
