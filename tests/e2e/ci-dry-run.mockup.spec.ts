// openspec-e2e-mockup-gate.yml を PR から動かすための検証用テスト(マージしない)。
// 実画面の代わりに、静的な HTML を startMockupServer で配信して比較する。
import { dirname, join } from 'node:path';
import { test } from '@playwright/test';
import { compareWithMockup, findRepoRoot, startMockupServer, type MockupServer } from './support/mockup-compare';

let app: MockupServer;
// ESM のプロジェクトでは __dirname が無いため、testInfo.file から辿る
test.beforeAll(async ({}, testInfo) => {
  app = await startMockupServer(join(findRepoRoot(dirname(testInfo.file)), 'tests/e2e/ci-dry-run-app'));
});
test.afterAll(async () => { await app.close(); });

const base = { changeId: 'ci-dry-run', mockup: 'user/list.html', clock: '2026-10-01T12:00:00Z', hide: { mockup: ['.samplebar'] } };

test('一覧画面がモックと一致する', { tag: ['@ci-dry-run', '@VC-001'] }, async ({ page }, testInfo) => {
  await compareWithMockup(page, testInfo, { ...base, vc: 'VC-001', app: `${app.url}/list.html` });
});

test('ヘッダー色が違う一覧画面はモックと一致しない(検証用に失敗させる)', { tag: ['@ci-dry-run', '@VC-002'] }, async ({ page }, testInfo) => {
  await compareWithMockup(page, testInfo, { ...base, vc: 'VC-002', app: `${app.url}/list-red.html` });
});
