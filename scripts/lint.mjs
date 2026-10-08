#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYamlText } from '../payload/scripts/lib/mockup/yaml-safe.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const skip = new Set(['node_modules', '.git', 'test-results', 'playwright-report', '.tmp', 'openspec']);
const failures = [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

const files = walk(root);
for (const file of files) {
  const rel = relative(root, file);
  if (file.endsWith('.mjs')) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      failures.push(`syntax ${rel}\n${err.stderr?.toString() ?? err.message}`);
    }
  } else if (file.endsWith('.yaml') || file.endsWith('.yml')) {
    const parsed = parseYamlText(readFileSync(file, 'utf8'));
    if (parsed.errors.length || parsed.alias || parsed.tagged) failures.push(`yaml ${rel}: ${parsed.errors.join('; ') || 'alias または独自 tag'}`);
  }
}

// Every place that tells an Agent what to do must forbid it from filling in the human approval.
const APPROVAL_BAN = '人間が実施。Agent は記入しない';
const AGENT_FACING = [
  'payload/schema/apply.append.md',
  'payload/schema/tasks.append.md',
  'payload/schema/templates/mockup-report.md',
  'payload/.claude/skills/mockup-comparison/SKILL.md',
  'payload/.claude/agents/mockup-reviewer.md',
  'payload/openspec/roles/mockup-reviewer.md',
];
for (const rel of AGENT_FACING) {
  const abs = join(root, rel);
  if (!existsSync(abs)) failures.push(`${rel} がありません`);
  else if (!readFileSync(abs, 'utf8').includes(APPROVAL_BAN)) failures.push(`${rel} に承認欄の記入禁止（${APPROVAL_BAN}）がありません`);
}

// CI examples must not hide failures or interpolate untrusted PR text into shell.
for (const file of files.filter(abs => relative(root, abs).startsWith('examples/') && /\.ya?ml$/.test(abs))) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(root, file);
  if (text.includes('|| true')) failures.push(`${rel} が || true で失敗を隠しています`);
  if (/\$\{\{\s*github\.event\.pull_request\.(title|body|head\.ref)/.test(text)) failures.push(`${rel} が PR の title / body / head.ref を展開しています`);
  const parsed = parseYamlText(text).data;
  for (const [name, job] of Object.entries(parsed?.jobs ?? {})) {
    if (!Array.isArray(job?.steps)) failures.push(`${rel}: job ${name} に steps がありません`);
    for (const step of job?.steps ?? []) {
      if (step.uses && !/@[0-9a-f]{40}$|@v\d+(\.\d+)*$/.test(step.uses)) failures.push(`${rel}: ${step.uses} の版が固定されていません`);
      if (!step.uses && !step.run) failures.push(`${rel}: job ${name} に uses も run も無い step があります`);
    }
  }
}

if (failures.length) {
  for (const failure of failures) console.error(failure);
  console.error(`lint failed: ${failures.length}`);
  process.exit(1);
}
console.log(`lint ok (${files.length} files scanned)`);
