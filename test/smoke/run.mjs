#!/usr/bin/env node
// Smoke test with a real browser: installs testkit and this add-on into a temporary repository, adds the smoke app,
// mockups and a quality-driven-e2e-mockup change, runs the comparison tests with Playwright, and checks what the
// helper, `record` and `check` produced. It never skips: a missing browser, testkit or OpenSpec CLI fails it.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { addonRepo, ROOT, runGate } from '../support.mjs';

const SMOKE_APP = join(ROOT, 'test/smoke-app');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function step(name, fn) {
  process.stdout.write(`- ${name} ... `);
  fn();
  process.stdout.write('ok\n');
}

const cleanups = [];
const t = { after: fn => cleanups.push(fn) };
let failed = false;
try {
  const repo = addonRepo(t);
  const port = await freePort();
  cpSync(SMOKE_APP, repo.dir, { recursive: true });
  symlinkSync(join(ROOT, 'node_modules'), join(repo.dir, 'node_modules'));
  writeFileSync(join(repo.dir, '.gitignore'), 'node_modules\ntest-results/\n');
  writeFileSync(join(repo.dir, 'playwright.config.mjs'), `export default {
  testDir: 'tests/e2e',
  workers: 1,
  retries: 0,
  reporter: [['json', { outputFile: 'test-results/playwright.json' }], ['line']],
  use: { baseURL: 'http://127.0.0.1:${port}' },
  webServer: { command: 'node app/server.mjs', url: 'http://127.0.0.1:${port}/login', env: { PORT: '${port}' }, reuseExistingServer: false },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
};
`);
  repo.commit('smoke app');

  const run = spawnSync(process.execPath, [join(ROOT, 'node_modules/@playwright/test/cli.js'), 'test', '--config', 'playwright.config.mjs'], { cwd: repo.dir, encoding: 'utf8', env: { ...process.env, CI: '1' } });
  process.stdout.write(run.stdout);
  process.stderr.write(run.stderr);
  step('every Playwright test passed', () => {
    assert.equal(run.status, 0, 'playwright test failed');
    const report = JSON.parse(readFileSync(join(repo.dir, 'test-results/playwright.json'), 'utf8'));
    assert.equal(report.stats.expected, 6);
    assert.equal(report.stats.unexpected, 0);
  });

  step('record writes mockup-results.json with every MK and viewport', () => {
    const record = runGate(repo.dir, ['record', 'add-login']);
    assert.equal(record.status, 0, record.stdout + record.stderr);
    const results = JSON.parse(readFileSync(join(repo.dir, 'openspec/changes/add-login/mockup-results.json'), 'utf8'));
    const statuses = Object.fromEntries(results.results.map(item => [`${item.mk} ${item.viewport}`, item.status]));
    assert.deepEqual(statuses, {
      'MK-001 1280x800': 'pass', 'MK-001 375x812': 'pass', 'MK-002 1280x800': 'diff', 'MK-003 1280x800': 'missing', 'MK-004 800x600': 'diff',
    });
    assert.equal(results.environment.image, 'local');
    assert.deepEqual(results.dirty, []);
    assert.equal(results.commit, repo.head());
    const report = readFileSync(join(repo.dir, 'openspec/changes/add-login/mockup-report.md'), 'utf8');
    const mk2 = results.results.find(item => item.mk === 'MK-002');
    assert.match(report, new RegExp(`\\| MK-002 \\| 1280x800 \\| ${mk2.ratio} \\| ${mk2.diffSha} \\|  \\|  \\|`));
  });

  step('the plan gate passes and the final gate refuses the local results', () => {
    const plan = runGate(repo.dir, ['check', 'add-login']);
    assert.equal(plan.status, 0, plan.stdout + plan.stderr);
    const final = runGate(repo.dir, ['check', '--phase', 'final', 'add-login']);
    assert.equal(final.status, 1);
    assert.match(final.stdout, /正の環境の結果ではありません（結果: local/);
    assert.match(final.stdout, /MK-003 1280x800 は missing です/);
  });

  step('verify reproduces the recorded run from the same output', () => {
    const verify = runGate(repo.dir, ['verify', '--results', 'test-results/mockup', 'add-login']);
    assert.equal(verify.status, 1, verify.stdout);
    assert.match(verify.stdout, /✓ MK-001 1280x800/);
    assert.match(verify.stdout, /✗ MK-003 1280x800 が再実行の結果にありません/);
  });
  assert.ok(existsSync(join(repo.dir, 'test-results/mockup/add-login/MK-002/1280x800/diff.png')));
  execFileSync('git', ['-C', repo.dir, 'status', '--porcelain']);
  console.log('smoke ok');
} catch (err) {
  failed = true;
  console.error(`\nsmoke failed: ${err.stack ?? err}`);
} finally {
  for (const fn of cleanups) fn();
}
process.exitCode = failed ? 1 : 0;
