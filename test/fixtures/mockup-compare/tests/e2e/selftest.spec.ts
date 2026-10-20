// mockup-compare.ts の selftest。サンドボックスに導入したヘルパーを、最小のモックと静的アプリで検証する
import { get } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { compareWithMockup, diffImages, findRepoRoot, startMockupServer, type MockupServer, RESULTS_DIR } from './support/mockup-compare';

const CHANGE = 'selftest-change';
const CLOCK = '2026-10-01T12:00:00Z';
const repoRoot = findRepoRoot(__dirname);
const resultDir = (vc: string) => join(repoRoot, RESULTS_DIR, CHANGE, vc);
const readMeta = (vc: string) => JSON.parse(readFileSync(join(resultDir(vc), 'meta.json'), 'utf8'));

let app: MockupServer;
test.beforeAll(async () => { app = await startMockupServer(join(repoRoot, 'app')); });
test.afterAll(async () => { await app.close(); });

const base = { changeId: CHANGE, mockup: 'user/list.html', clock: CLOCK, hide: { mockup: ['.samplebar'] } };

test('同一の画面は合格し、4 ファイルが出力される @VC-001', async ({ page }, testInfo) => {
  const meta = await compareWithMockup(page, testInfo, { ...base, vc: 'VC-001', app: `${app.url}/list.html` });
  expect(meta.pass).toBe(true);
  expect(meta.diffRatio).toBe(0);
  for (const f of ['mockup.png', 'actual.png', 'diff.png', 'meta.json']) {
    expect(existsSync(join(resultDir('VC-001'), f)), f).toBe(true);
  }
  const m = readMeta('VC-001');
  for (const k of ['vc', 'changeId', 'mockup', 'appUrl', 'viewport', 'diffRatio', 'maxDiffRatio', 'pass', 'sizeMismatch', 'fontsTimedOut', 'startedAt']) {
    expect(m, k).toHaveProperty(k);
  }
});

test('色が違う画面は VC-ID・差分率・許容値・出力先を含むメッセージで失敗する @VC-002', async ({ page }, testInfo) => {
  await expect(
    compareWithMockup(page, testInfo, { ...base, vc: 'VC-002', app: `${app.url}/list-red.html` }),
  ).rejects.toThrow(/\[VC-002\] モックとの差分率 [\d.]+% が許容差分率 1\.00% を超えました。 出力先: .*VC-002/);
  const m = readMeta('VC-002');
  expect(m.pass).toBe(false);
  expect(m.diffRatio).toBeGreaterThan(0.01);
  expect(existsSync(join(resultDir('VC-002'), 'diff.png'))).toBe(true);
});

test('ダミーデータの領域をマスクすれば合格する @VC-003', async ({ page }, testInfo) => {
  const meta = await compareWithMockup(page, testInfo, {
    ...base, vc: 'VC-003', app: `${app.url}/list-data.html`, mask: ['table tbody'], maxDiffRatio: 0,
  });
  expect(meta.pass).toBe(true);
  // マスクしなければ同じ組み合わせで差分が出る(マスクが効いていることの確認)
  const unmasked = await compareWithMockup(page, testInfo, {
    ...base, vc: 'VC-903', app: `${app.url}/list-data.html`, maxDiffRatio: 1,
  });
  expect(unmasked.diffRatio).toBeGreaterThan(0);
});

test('高さが違っても比較は実行され、サイズ不一致が記録される @VC-004', async ({ page }, testInfo) => {
  const meta = await compareWithMockup(page, testInfo, {
    ...base, vc: 'VC-004', app: `${app.url}/list-tall.html`, maxDiffRatio: 1,
  });
  expect(meta.sizeMismatch).toBe(true);
  expect(meta.actualSize.height).toBeGreaterThan(meta.mockupSize.height);
  expect(readMeta('VC-004').sizeMismatch).toBe(true);
});

test('同じモックを 2 回キャプチャすると差分率 0(時刻・乱数・読み込み演出の固定)', async ({ page }, testInfo) => {
  const opts = { changeId: CHANGE, mockup: 'user/random.html', app: `${app.url}/list.html`, seed: 'determinism', maxDiffRatio: 1 };
  await compareWithMockup(page, testInfo, { ...opts, vc: 'VC-901' });
  await page.waitForTimeout(1100); // 実時間が進んでも固定時刻なので変わらないことを見る
  await compareWithMockup(page, testInfo, { ...opts, vc: 'VC-902' });
  const a = readFileSync(join(resultDir('VC-901'), 'mockup.png'));
  const b = readFileSync(join(resultDir('VC-902'), 'mockup.png'));
  expect(diffImages(a, b).diffRatio).toBe(0);
});

test('存在しないモックは「モックが見つかりません」で失敗する', async ({ page }, testInfo) => {
  await expect(
    compareWithMockup(page, testInfo, { ...base, vc: 'VC-904', mockup: 'user/no-such.html', app: `${app.url}/list.html` }),
  ).rejects.toThrow('[VC-904] モックが見つかりません');
});

test('静的サーバは相対参照を配信し、ルート外へのパスは 404 にする', async () => {
  const server = await startMockupServer(join(repoRoot, 'mockup'));
  const raw = (path: string) => new Promise<{ status: number; type: string }>((ok, ng) => {
    const u = new URL(server.url);
    get({ host: u.hostname, port: u.port, path }, res => {
      res.resume();
      ok({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? '') });
    }).on('error', ng);
  });
  try {
    expect(await raw('/css/style.css')).toEqual({ status: 200, type: 'text/css; charset=utf-8' });
    expect((await raw('/js/mock.js')).type).toBe('text/javascript; charset=utf-8');
    expect((await raw('/../outside.txt')).status).toBe(404);
    expect((await raw('/%2e%2e/outside.txt')).status).toBe(404);
    expect((await raw('/user/..%2f..%2foutside.txt')).status).toBe(404);
  } finally {
    await server.close();
  }
});
