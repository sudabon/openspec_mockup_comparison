import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mockupDigest } from '../payload/scripts/lib/mockup/results.mjs';
import { planRowDigest } from '../payload/scripts/lib/mockup/plan.mjs';
import { readIn, writeIn } from './support.mjs';

export const sha = data => createHash('sha256').update(data).digest('hex');
export const IMAGE = 'mcr.microsoft.com/playwright:v1.55.1-noble@sha256:2f29369043d81d6d69a815ceb80760f55e85f5020371ad06a4d996f18503ad1c';
export const COLUMNS = ['MK-ID', 'Requirement', 'Scenario', 'Mockup', 'Target', 'Viewports', 'Fixture', 'Masks', 'Threshold'];

export const ROWS = [
  { 'MK-ID': 'MK-001', Requirement: 'Login page layout', Scenario: 'Desktop and mobile layout', Mockup: 'login.html', Target: '/login', Viewports: '1280x800, 375x812', Fixture: 'なし', Masks: '`.clock`: 現在時刻', Threshold: '' },
  { 'MK-ID': 'MK-002', Requirement: 'Login page layout', Scenario: 'Desktop and mobile layout', Mockup: 'login.html#.login-form', Target: '/login#.login-form', Viewports: '1280x800', Fixture: 'なし', Masks: 'なし', Threshold: '0.02' },
];

export function planText(rows = ROWS, { mockup = 'required', reason = '' } = {}) {
  const table = rows.length || mockup === 'required'
    ? [`| ${COLUMNS.join(' | ')} |`, `|${COLUMNS.map(() => '---').join('|')}|`, ...rows.map(row => `| ${COLUMNS.map(column => row[column] ?? '').join(' | ')} |`)].join('\n')
    : '';
  return `---\nmockup: ${mockup}\nreason: "${reason}"\n---\n\n# Mockup Plan\n\n## モック対応表\n\n${table}\n`;
}

export const SPEC = `# Spec Delta

## Purpose

Lets a user sign in from a page that matches the design mockup.

## ADDED Requirements

### Requirement: Login page layout
The login page SHALL match the login mockup.

#### Scenario: Desktop and mobile layout
- **WHEN** the user opens /login
- **THEN** the page matches mockups/login.html
`;

export const TASKS = `# Tasks

## 1. Oracle

- [ ] 1.1 oracle

## 7. Mockup Comparison

- [ ] 7.1 MK のテスト
`;

export const QUALITY_VIEWPOINTS = visual => `---
risk_level: low
---

# Quality

## Non-functional Viewpoints

| 観点 | Failure Mode | 該当なし理由 |
|------|--------------|--------------|
| 見た目の回帰 | ${visual === 'na' ? '' : 'F1'} | ${visual === 'na' ? '見た目は変わらない' : ''} |
`;

// A quality-driven-e2e-mockup change with mockups, specs, plan, tasks and a test source for every MK.
export function mockupChange(repo, { id = 'add-login', rows = ROWS, plan, tasks = TASKS, tests = true, quality = null } = {}) {
  writeIn(repo.dir, 'mockups/login.html', '<link rel="stylesheet" href="/assets/app.css"><main class="login"><form class="login-form"></form></main>\n');
  writeIn(repo.dir, 'mockups/assets/app.css', '.login { width: 320px; }\n');
  const dir = `openspec/changes/${id}`;
  writeIn(repo.dir, `${dir}/.openspec.yaml`, 'schema: quality-driven-e2e-mockup\ncreated: 2026-10-08\n');
  writeIn(repo.dir, `${dir}/proposal.md`, '# Proposal\n');
  writeIn(repo.dir, `${dir}/specs/login/spec.md`, SPEC);
  writeIn(repo.dir, `${dir}/mockup-plan.md`, plan ?? planText(rows));
  if (tasks != null) writeIn(repo.dir, `${dir}/tasks.md`, tasks);
  if (quality) writeIn(repo.dir, `${dir}/quality.md`, quality);
  if (tests) {
    const body = rows.map(row => `test('${row['MK-ID']}', { tag: ['@${id}', '@${row['MK-ID']}'] }, async ({ page }) => {\n  await compareWithMockup(page, '${row['MK-ID']}');\n});\n`).join('\n');
    writeIn(repo.dir, `tests/e2e/${id}.spec.ts`, `import { test } from '@playwright/test';\nimport { compareWithMockup } from './support/mockup';\n\n${body}`);
  }
  return dir;
}

export function servedFiles(repo, files = ['assets/app.css', 'login.html']) {
  return files.map(path => ({ path, sha256: sha(readFileSync(join(repo.dir, 'mockups', path))) }));
}

// A raw result.json as the helper writes it, consistent with the current plan row and mockup files.
export function rawResult(repo, { change = 'add-login', mk, viewport, row, status = 'pass', ratio = 0, threshold = 0.01, image = IMAGE, commit, dirty = [], diffSha, ...rest }) {
  const files = servedFiles(repo);
  return {
    change,
    mk,
    viewport,
    planRowDigest: planRowDigest(row),
    threshold,
    pixelTolerance: 0.1,
    commit: commit ?? repo.head(),
    dirty,
    environment: { os: 'linux', osRelease: '6', browser: 'chromium', browserVersion: '140', playwright: '1.55.1', image },
    testFile: `tests/e2e/${change}.spec.ts`,
    status,
    ratio,
    maskRatio: 0,
    width: 1280,
    height: 800,
    mockupSha: sha(`mockup ${mk} ${viewport}`),
    actualSha: sha(`actual ${mk} ${viewport} ${ratio}`),
    diffSha: diffSha ?? sha(`diff ${mk} ${viewport} ${ratio}`),
    mockupFiles: files,
    mockupDigest: mockupDigest(files),
    notes: [],
    ranAt: '2026-10-08T00:00:00.000Z',
    ...rest,
  };
}

export function writeRaw(repo, result, root = 'test-results/mockup') {
  writeIn(repo.dir, `${root}/${result.change}/${result.mk}/${result.viewport}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
}

// Writes raw results for every MK and viewport of ROWS. `overrides` maps `MK viewport` to result fields.
export function writeAllRaw(repo, overrides = {}, common = {}) {
  const pairs = [['MK-001', '1280x800', ROWS[0]], ['MK-001', '375x812', ROWS[0]], ['MK-002', '1280x800', ROWS[1]]];
  const written = [];
  for (const [mk, viewport, row] of pairs) {
    const result = rawResult(repo, { mk, viewport, row, ...common, ...(overrides[`${mk} ${viewport}`] ?? {}) });
    writeRaw(repo, result, common.root);
    written.push(result);
  }
  return written;
}

export function readResults(repo, dir = 'openspec/changes/add-login') {
  return JSON.parse(readIn(repo.dir, `${dir}/mockup-results.json`));
}

export function approve(repo, { mk, viewport, digest, approver = 'y-suda', date = '2026-10-09', dir = 'openspec/changes/add-login' }) {
  const path = `${dir}/mockup-report.md`;
  const text = readIn(repo.dir, path).replace(/\n*$/, '\n');
  writeIn(repo.dir, path, `${text}| ${mk} | ${viewport} | ${digest} | 意図した差 | ${approver} | ${date} |\n`);
}

export function classify(repo, { dir = 'openspec/changes/add-login', classification = '意図した差', basis = 'ボタンの角丸の差' } = {}) {
  const path = `${dir}/mockup-report.md`;
  writeIn(repo.dir, path, readIn(repo.dir, path).replace(/\|  \|  \|$/gm, `| ${classification} | ${basis} |`));
}
