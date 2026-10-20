// モックアップ比較ヘルパー(openspec-e2e-mockup-kit が配布)。
// HTML/CSS/JS の動的モックと実画面を同じ条件でキャプチャし、ピクセル差分率で合否を判定する。
// 結果は合否にかかわらず mockup-compare-results/<change-id>/<VC-ID>/ に 4 ファイルで残す。
//
// 依存(導入先の devDependencies): @playwright/test, pngjs, pixelmatch
//
// 使い方:
//   test('一覧画面がモックと一致', { tag: ['@add-x', '@VC-001'] }, async ({ page }, testInfo) => {
//     await compareWithMockup(page, testInfo, {
//       vc: 'VC-001', changeId: 'add-x',
//       mockup: 'user/sc-mr-11_case-list-by-facility.html',
//       app: '/cases/by-facility',
//       hide: { mockup: ['.samplebar'] },
//       mask: ['table tbody'],
//     });
//   });
import { createServer, type Server } from 'node:http';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

/** モックルート(リポジトリルート相対)。kit のインストーラが導入先のルートに書き換える */
export const MOCKUP_ROOT = 'mockup/';
/** 結果の出力先(リポジトリルート相対)。scripts/mockup-report.mjs と揃える */
export const RESULTS_DIR = 'mockup-compare-results';

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const DEFAULT_MOCKUP_CLOCK = '2026-01-01T10:00:00+09:00';
const DEFAULT_MOCKUP_QUERY = 'noload=1';
const DEFAULT_MAX_DIFF_RATIO = 0.01;
const DEFAULT_THRESHOLD = 0.1;
const DEFAULT_SETTLE_TIMEOUT = 5_000;
const MASK_COLOR = '#FF00FF';

type Side<T> = { mockup?: T; app?: T };

export interface CompareOptions {
  /** 比較観点 ID(mockup-compare.md の VC-NNN) */
  vc: string;
  /** openspec の change-id */
  changeId: string;
  /** モックルート相対のモックファイル。クエリ(?a=b)を含めてもよい */
  mockup: string;
  /** 実画面の URL。相対パスなら Playwright の baseURL 基準 */
  app: string;
  /** 両方のビューポート(既定 1440x900) */
  viewport?: { width: number; height: number };
  /** 既定は実画面の devicePixelRatio。実画面と異なる値は指定できない(test.use で揃える) */
  deviceScaleFactor?: number;
  /** 固定する現在時刻。モック側は未指定でも既定時刻に固定する。指定時は実画面側も固定する */
  clock?: string | number | Date;
  /** Math.random のシード(既定は vc) */
  seed?: string;
  /** モックの読み込み演出を無効にするクエリ(既定 'noload=1')。'' で付けない */
  mockupQuery?: string;
  /** キャプチャ前に display:none にするセレクタ */
  hide?: Side<string[]>;
  /** 両方の画像で同じ単色に塗るセレクタ。配列なら両方に同じものを使う */
  mask?: string[] | Side<string[]>;
  /** 比較範囲の要素。未指定ならページ全体。文字列なら両方に同じものを使う */
  target?: string | Side<string>;
  /** ページ全体のときにスクロール領域まで含めるか(既定 true) */
  fullPage?: boolean;
  /** 許容差分率(0〜1、既定 0.01) */
  maxDiffRatio?: number;
  /** pixelmatch の色差の感度(0〜1、既定 0.1) */
  threshold?: number;
  /** キャプチャ前の到達手順 */
  steps?: Side<(page: Page) => Promise<void>>;
  /** Web フォントとネットワーク静止を待つ上限(ms、既定 5000) */
  settleTimeout?: number;
}

export interface CompareMeta {
  vc: string;
  changeId: string;
  mockup: string;
  mockupUrl: string;
  appUrl: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  target: Side<string> | null;
  mask: Side<string[]>;
  hide: Side<string[]>;
  mockupSize: { width: number; height: number };
  actualSize: { width: number; height: number };
  diffPixels: number;
  diffRatio: number;
  maxDiffRatio: number;
  threshold: number;
  pass: boolean;
  sizeMismatch: boolean;
  fontsTimedOut: boolean;
  networkIdleTimedOut: boolean;
  startedAt: string;
  finishedAt: string;
}

// ---------------------------------------------------------------- 静的サーバ

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
};

export interface MockupServer {
  url: string;
  root: string;
  close(): Promise<void>;
}

/** root 配下だけを配信する静的サーバを 127.0.0.1 の空きポートで起動する */
export async function startMockupServer(root: string): Promise<MockupServer> {
  const absRoot = resolve(root);
  const server: Server = createServer(async (req, res) => {
    const notFound = () => {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
    };
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return notFound();
      const rawPath = (req.url ?? '/').split(/[?#]/)[0];
      let file = resolve(absRoot, '.' + decodeURIComponent(rawPath));
      // ルート外(../ やエンコードされた ..)は 404
      if (file !== absRoot && !file.startsWith(absRoot + sep)) return notFound();
      if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
      if (!existsSync(file) || !statSync(file).isFile()) return notFound();
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      notFound();
    }
  });
  await new Promise<void>((ok, ng) => {
    server.once('error', ng);
    server.listen(0, '127.0.0.1', () => ok());
  });
  server.unref(); // ワーカーの終了を妨げない
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    root: absRoot,
    close: () => new Promise(ok => server.close(() => ok())),
  };
}

// ワーカー(= プロセス)単位で 1 つだけ遅延起動する
let serverPromise: Promise<MockupServer> | null = null;
function workerServer(root: string): Promise<MockupServer> {
  serverPromise ??= startMockupServer(root).then(s => {
    process.once('exit', () => { void s.close(); });
    return s;
  });
  return serverPromise;
}

// ---------------------------------------------------------------- パス

/** openspec/ を持つ最も近い祖先をリポジトリルートとみなす */
export function findRepoRoot(from: string): string {
  let cur = resolve(from);
  for (;;) {
    if (existsSync(join(cur, 'openspec'))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return process.cwd();
    cur = parent;
  }
}

// ---------------------------------------------------------------- 決定化

/** VC-ID などの文字列から 32bit のシードを作る(FNV-1a) */
function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** ページ内で Math.random をシード付き擬似乱数(mulberry32)に置き換える */
function seedRandom(seed: number) {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ネットワークの静止と Web フォントの読み込みを待つ。タイムアウトしても続行し、結果を返す */
async function settle(page: Page, timeout: number) {
  let networkIdleTimedOut = false;
  await page.waitForLoadState('networkidle', { timeout }).catch(() => { networkIdleTimedOut = true; });
  const fontsReady = await Promise.race([
    page.evaluate(() => document.fonts.ready.then(() => true)).catch(() => false),
    new Promise<boolean>(ok => setTimeout(() => ok(false), timeout)),
  ]);
  return { fontsTimedOut: !fontsReady, networkIdleTimedOut };
}

async function hideElements(page: Page, selectors: string[] = []) {
  if (!selectors.length) return;
  await page.addStyleTag({ content: `${selectors.join(',\n')} { display: none !important; }` });
}

async function capture(page: Page, target: string | undefined, mask: string[], fullPage: boolean) {
  const opts = {
    mask: mask.map(s => page.locator(s)),
    maskColor: MASK_COLOR,
    animations: 'disabled' as const,
    caret: 'hide' as const,
  };
  if (target) {
    const el: Locator = page.locator(target);
    return el.screenshot(opts);
  }
  return page.screenshot({ ...opts, fullPage });
}

// ---------------------------------------------------------------- 差分

/** 左上合わせで width x height のキャンバスに置く。余白は透明 */
function pad(img: PNG, width: number, height: number): PNG {
  if (img.width === width && img.height === height) return img;
  const out = new PNG({ width, height }); // 0 埋め = 透明
  PNG.bitblt(img, out, 0, 0, img.width, img.height, 0, 0);
  return out;
}

export function diffImages(mockupPng: Buffer, actualPng: Buffer, threshold = DEFAULT_THRESHOLD) {
  const a = PNG.sync.read(mockupPng);
  const b = PNG.sync.read(actualPng);
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(pad(a, width, height).data, pad(b, width, height).data, diff.data, width, height, { threshold });
  return {
    diffPixels,
    diffRatio: width * height === 0 ? 0 : diffPixels / (width * height),
    diffPng: PNG.sync.write(diff),
    mockupSize: { width: a.width, height: a.height },
    actualSize: { width: b.width, height: b.height },
    sizeMismatch: a.width !== b.width || a.height !== b.height,
  };
}

// ---------------------------------------------------------------- 本体

function sides<T>(v: T | Side<T> | undefined, isShared: (v: unknown) => v is T): Side<T> {
  if (v === undefined) return {};
  return isShared(v) ? { mockup: v, app: v } : v;
}

/** モックと実画面をキャプチャして比較する。差分率が許容値を超えたらテストを失敗させる */
export async function compareWithMockup(page: Page, testInfo: TestInfo, options: CompareOptions): Promise<CompareMeta> {
  const startedAt = new Date().toISOString();
  const {
    vc, changeId, app,
    viewport = DEFAULT_VIEWPORT,
    clock,
    seed = vc,
    mockupQuery = DEFAULT_MOCKUP_QUERY,
    hide = {},
    fullPage = true,
    maxDiffRatio = DEFAULT_MAX_DIFF_RATIO,
    threshold = DEFAULT_THRESHOLD,
    steps = {},
    settleTimeout = DEFAULT_SETTLE_TIMEOUT,
  } = options;
  const mask = sides(options.mask, Array.isArray);
  const target = sides(options.target, (v): v is string => typeof v === 'string');

  const repoRoot = findRepoRoot(dirname(testInfo.file));
  const mockupRoot = resolve(repoRoot, MOCKUP_ROOT);
  const [mockupPath, mockupOwnQuery = ''] = options.mockup.split('?');
  const mockupFile = resolve(mockupRoot, mockupPath);
  if (!mockupFile.startsWith(mockupRoot + sep) || !existsSync(mockupFile)) {
    throw new Error(`[${vc}] モックが見つかりません: ${options.mockup} (モックルート: ${mockupRoot})`);
  }

  // 実画面側: ビューポート・reduced motion・(指定時のみ)時刻を揃える
  const appDpr = await page.evaluate(() => window.devicePixelRatio).catch(() => 1);
  const deviceScaleFactor = options.deviceScaleFactor ?? appDpr;
  if (deviceScaleFactor !== appDpr) {
    throw new Error(
      `[${vc}] deviceScaleFactor ${deviceScaleFactor} が実画面の ${appDpr} と異なります。` +
      `test.use({ deviceScaleFactor: ${deviceScaleFactor} }) で実画面側を揃えてください。`,
    );
  }
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (clock !== undefined) await page.clock.setFixedTime(new Date(clock));

  // モック側: 実画面の context(認証状態など)を汚さないよう別 context で開く
  const browser = page.context().browser();
  if (!browser) throw new Error(`[${vc}] モック用の context を作れません(persistent context は未対応)`);
  const server = await workerServer(mockupRoot);
  const query = [mockupOwnQuery, mockupQuery].filter(Boolean).join('&');
  const mockupUrl = `${server.url}/${mockupPath.split('/').map(encodeURIComponent).join('/')}${query ? `?${query}` : ''}`;

  const mockupContext = await browser.newContext({ viewport, deviceScaleFactor, reducedMotion: 'reduce' });
  let mockupPng: Buffer;
  let mockupSettle;
  try {
    const mp = await mockupContext.newPage();
    await mp.clock.setFixedTime(new Date(clock ?? DEFAULT_MOCKUP_CLOCK));
    await mp.addInitScript(seedRandom, seedFrom(seed));
    const res = await mp.goto(mockupUrl, { waitUntil: 'load' });
    if (!res || !res.ok()) throw new Error(`[${vc}] モックを開けません: ${mockupUrl} (HTTP ${res?.status()})`);
    mockupSettle = await settle(mp, settleTimeout);
    if (steps.mockup) {
      await steps.mockup(mp);
      mockupSettle = await settle(mp, settleTimeout);
    }
    await hideElements(mp, hide.mockup);
    mockupPng = await capture(mp, target.mockup, mask.mockup ?? [], fullPage);
  } finally {
    await mockupContext.close();
  }

  await page.goto(app, { waitUntil: 'load' });
  let appSettle = await settle(page, settleTimeout);
  if (steps.app) {
    await steps.app(page);
    appSettle = await settle(page, settleTimeout);
  }
  await hideElements(page, hide.app);
  const actualPng = await capture(page, target.app, mask.app ?? [], fullPage);

  // 判定と出力(合否にかかわらず 4 ファイルを残す)
  const result = diffImages(mockupPng, actualPng, threshold);
  const pass = result.diffRatio <= maxDiffRatio;
  const outDir = join(repoRoot, RESULTS_DIR, changeId, vc);
  const meta: CompareMeta = {
    vc,
    changeId,
    mockup: options.mockup,
    mockupUrl,
    appUrl: page.url(),
    viewport,
    deviceScaleFactor,
    target: options.target === undefined ? null : target,
    mask,
    hide,
    mockupSize: result.mockupSize,
    actualSize: result.actualSize,
    diffPixels: result.diffPixels,
    diffRatio: result.diffRatio,
    maxDiffRatio,
    threshold,
    pass,
    sizeMismatch: result.sizeMismatch,
    fontsTimedOut: mockupSettle.fontsTimedOut || appSettle.fontsTimedOut,
    networkIdleTimedOut: mockupSettle.networkIdleTimedOut || appSettle.networkIdleTimedOut,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(join(outDir, 'mockup.png'), mockupPng),
    writeFile(join(outDir, 'actual.png'), actualPng),
    writeFile(join(outDir, 'diff.png'), result.diffPng),
    writeFile(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n'),
  ]);
  await testInfo.attach(`${vc}-diff.png`, { body: result.diffPng, contentType: 'image/png' });

  const pct = (r: number) => `${(r * 100).toFixed(2)}%`;
  expect(
    result.diffRatio,
    `[${vc}] モックとの差分率 ${pct(result.diffRatio)} が許容差分率 ${pct(maxDiffRatio)} を超えました。` +
    (result.sizeMismatch
      ? ` サイズ不一致: モック ${result.mockupSize.width}x${result.mockupSize.height} / 実画面 ${result.actualSize.width}x${result.actualSize.height}。`
      : '') +
    ` 出力先: ${outDir}`,
  ).toBeLessThanOrEqual(maxDiffRatio);
  return meta;
}
