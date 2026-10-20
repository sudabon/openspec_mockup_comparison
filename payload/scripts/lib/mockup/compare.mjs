import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { release } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './base-digest.mjs';
import { findChangeDir } from './changes.mjs';
import { CONTAINER_ENV, MASK_COLOR, MK_ID, RUN_ROOT } from './constants.mjs';
import { readPlan } from './plan.mjs';
import { readPolicy } from './policy.mjs';
import { dirtyPaths, headCommit, mockupDigest, playwrightVersion } from './results.mjs';
import { startMockupServer } from './server.mjs';
import { loadTestkit, testkitMismatchMessage, tk } from './testkit.mjs';

const PIXELMATCH = join(dirname(fileURLToPath(import.meta.url)), 'vendor/pixelmatch.mjs');
const LOOPBACK = /^(?:data|blob|about):/;

export class MockupComparisonError extends Error {}

function fail(message) {
  throw new MockupComparisonError(message);
}

// The change and MK this test compares, from its tags. Both `@<change-id>` and `@MK-NNN` must be present and the
// MK tag must name the MK passed to the helper, so a test cannot compare one MK under another's plan row.
export function resolveTags(repo, tags, mkId) {
  if (!MK_ID.test(mkId)) fail(`compareWithMockup の MK-ID ${mkId} は MK- と3桁の数字ではありません`);
  const names = tags.map(tag => tag.replace(/^@/, ''));
  const mkTags = names.filter(name => MK_ID.test(name));
  if (!mkTags.includes(mkId)) fail(`テストに @${mkId} タグがありません（タグ: ${tags.join(' ') || 'なし'}）`);
  if (mkTags.length > 1) fail(`テストに MK タグが複数あります（${mkTags.join(', ')}）。MK ごとにテストを分けてください`);
  const candidates = names.filter(name => !MK_ID.test(name) && !/^TP-\d+$/.test(name))
    .map(name => ({ id: name, dir: findChangeDir(repo, name) }))
    .filter(candidate => candidate.dir);
  if (candidates.length !== 1) {
    fail(candidates.length
      ? `change のタグが複数あります（${candidates.map(item => item.id).join(', ')}）`
      : `テストに change のタグ @<change-id> がありません（タグ: ${tags.join(' ') || 'なし'}）`);
  }
  return candidates[0];
}

async function settle(page) {
  await page.waitForLoadState('load');
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

function intersectArea(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

// Screenshots `selector` (or the viewport) with the masks painted in one color. Returns the PNG and the area the
// masks cover inside the captured box.
async function capture(page, selector, masks, side) {
  const viewport = page.viewportSize();
  let box = { x: 0, y: 0, width: viewport.width, height: viewport.height };
  let target = null;
  if (selector) {
    target = page.locator(selector);
    const count = await target.count();
    if (count !== 1) fail(`${side} の selector ${selector} が ${count} 件に一致しました。1件に一致する selector にしてください`);
    await target.scrollIntoViewIfNeeded();
    box = await target.boundingBox();
    if (!box || !box.width || !box.height) fail(`${side} の selector ${selector} の要素が表示されていません`);
  }
  const maskLocators = masks.map(mask => page.locator(mask.selector));
  let masked = 0;
  for (const locator of maskLocators) {
    for (const element of await locator.all()) {
      const rect = await element.boundingBox();
      if (rect) masked += intersectArea(rect, box);
    }
  }
  const options = { animations: 'disabled', caret: 'hide', scale: 'css', mask: maskLocators, maskColor: MASK_COLOR };
  const png = target ? await target.screenshot(options) : await page.screenshot({ ...options, fullPage: false });
  return { png, maskArea: Math.min(masked, box.width * box.height) };
}

// Pixel comparison inside the browser with the vendored pixelmatch, so decoding and encoding PNGs needs no
// dependency. Images of different sizes are compared on a common canvas and count as a full difference.
async function diffInBrowser(context, expected, actual, tolerance) {
  const page = await context.newPage();
  try {
    const source = readFileSync(PIXELMATCH, 'utf8').replace(/^export default pixelmatch;$/m, 'globalThis.__mockupPixelmatch = pixelmatch;');
    await page.setContent('<!doctype html><title>mockup diff</title>');
    await page.addScriptTag({ content: source });
    const result = await page.evaluate(async ({ a, b, threshold }) => {
      const decode = async base64 => {
        const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
        return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      };
      const [first, second] = await Promise.all([decode(a), decode(b)]);
      const width = Math.max(first.width, second.width);
      const height = Math.max(first.height, second.height);
      const pixels = bitmap => {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, width, height).data;
      };
      const out = new OffscreenCanvas(width, height);
      const outCtx = out.getContext('2d');
      const output = outCtx.createImageData(width, height);
      const different = globalThis.__mockupPixelmatch(pixels(first), pixels(second), output.data, width, height, { threshold });
      outCtx.putImageData(output, 0, 0);
      const blob = await out.convertToBlob({ type: 'image/png' });
      const buffer = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
      return {
        different, width, height,
        sizeMismatch: first.width !== second.width || first.height !== second.height,
        sizes: { expected: [first.width, first.height], actual: [second.width, second.height] },
        diff: btoa(binary),
      };
    }, { a: expected.toString('base64'), b: actual.toString('base64'), threshold: tolerance });
    return { ...result, diff: Buffer.from(result.diff, 'base64') };
  } finally {
    await page.close();
  }
}

function environment(repo, browser, env) {
  return {
    os: process.platform,
    osRelease: release(),
    arch: process.arch,
    browser: browser?.browserType().name() ?? 'unknown',
    browserVersion: browser?.version() ?? 'unknown',
    playwright: playwrightVersion(repo) ?? 'unknown',
    image: env[CONTAINER_ENV] ? String(env[CONTAINER_ENV]).trim() : 'local',
  };
}

function writeRun(repo, change, mk, label, files, result) {
  const dir = posix.join(RUN_ROOT, change, mk, label);
  mkdirSync(join(repo, dir), { recursive: true });
  for (const [name, buf] of Object.entries(files)) writeFileSync(join(repo, dir, name), buf);
  writeFileSync(join(repo, dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return dir;
}

function repoRootOf(cwd) {
  return tk.git(cwd, ['rev-parse', '--show-toplevel']).trim();
}

// Compares the current state of `page` with the mockup of `mkId` at every viewport of its plan row, writes the
// images and result.json of each run under test-results/mockup/, and throws when any viewport does not pass.
export async function compareWithMockup(page, mkId, { navigate = false, testInfo, repo, env = process.env } = {}) {
  if (!testInfo) fail('compareWithMockup は Playwright のテスト内から呼んでください');
  const loaded = await loadTestkit();
  if (!loaded.ok) fail(testkitMismatchMessage(loaded.missing));
  const root = repo ?? repoRootOf(process.cwd());
  const change = resolveTags(root, testInfo.tags ?? [], mkId);
  const plan = readPlan(root, change.dir);
  if (!plan.exists) fail(`${change.dir}/mockup-plan.md がありません`);
  if (plan.problems.length) fail(plan.problems.join('\n'));
  if (plan.mockup !== 'required') fail(`${plan.path} は mockup: ${plan.mockup} です。比較テストは mockup: required の change だけで書きます`);
  const row = plan.rows.find(item => item.mk === mkId);
  if (!row) fail(`${plan.path} に ${mkId} の行がありません`);
  if (row.problems.length) fail(`${plan.path} の ${mkId}: ${row.problems.join(' / ')}`);
  const policy = readPolicy(root, {});
  if (policy.errors.length) fail(policy.errors.join('\n'));
  const values = policy.values;
  const threshold = row.threshold ?? values.mockup_default_threshold;
  const context = page.context();
  const browser = context.browser();
  const common = {
    change: change.id,
    mk: mkId,
    planRowDigest: row.digest,
    threshold,
    pixelTolerance: values.mockup_pixel_tolerance,
    commit: headCommit(root),
    dirty: dirtyPaths(root, values),
    environment: environment(root, browser, env),
    testFile: testInfo.file ? posix.normalize(testInfo.file.replace(`${root}/`, '')) : null,
  };
  const server = await startMockupServer(join(root, values.mockup_root));
  const outcomes = [];
  try {
    for (const viewport of row.viewports) {
      server.reset();
      const mockPage = await context.newPage();
      const blocked = [];
      try {
        await mockPage.route('**/*', route => {
          const url = route.request().url();
          if (url.startsWith(`${server.origin}/`) || LOOPBACK.test(url)) return route.continue();
          blocked.push(url);
          return route.abort('blockedbyclient');
        });
        await mockPage.setViewportSize({ width: viewport.width, height: viewport.height });
        const response = await mockPage.goto(`${server.origin}/${row.mockup.path.split('/').map(encodeURIComponent).join('/')}`);
        if (!response || response.status() !== 200) fail(`モック ${row.mockup.path} を開けません（HTTP ${response?.status() ?? '応答なし'}）`);
        await settle(mockPage);
        const expected = await capture(mockPage, row.mockup.selector, row.masks, 'モック');
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        if (navigate) await page.goto(row.target.path);
        await settle(page);
        const actual = await capture(page, row.target.selector, row.masks, '実画面');
        const diff = await diffInBrowser(context, expected.png, actual.png, values.mockup_pixel_tolerance);
        const area = diff.width * diff.height;
        const ratio = diff.sizeMismatch ? 1 : diff.different / area;
        const maskRatio = Math.max(expected.maskArea, actual.maskArea) / area;
        const files = server.served();
        let status = ratio > threshold ? 'diff' : 'pass';
        const notes = [];
        if (diff.sizeMismatch) notes.push(`寸法が違います（モック ${diff.sizes.expected.join('x')}、実画面 ${diff.sizes.actual.join('x')}）`);
        if (maskRatio > values.mockup_max_mask_ratio) {
          status = 'error';
          notes.push(`マスクの面積率 ${maskRatio.toFixed(4)} が上限 ${values.mockup_max_mask_ratio} を超えています`);
        }
        if (blocked.length) {
          status = 'error';
          notes.push(`モックが mockup root の外を読み込もうとしました: ${[...new Set(blocked)].join(', ')}`);
        }
        const result = {
          ...common,
          viewport: viewport.label,
          status,
          ratio: Number(ratio.toFixed(6)),
          maskRatio: Number(maskRatio.toFixed(6)),
          width: diff.width,
          height: diff.height,
          mockupSha: sha256(expected.png),
          actualSha: sha256(actual.png),
          diffSha: sha256(diff.diff),
          mockupFiles: files,
          mockupDigest: mockupDigest(files),
          notes,
          ranAt: new Date().toISOString(),
        };
        const dir = writeRun(root, change.id, mkId, viewport.label, { 'mockup.png': expected.png, 'actual.png': actual.png, 'diff.png': diff.diff }, result);
        for (const name of ['mockup.png', 'actual.png', 'diff.png']) {
          await testInfo.attach(`${mkId} ${viewport.label} ${name}`, { path: join(root, dir, name), contentType: 'image/png' });
        }
        outcomes.push(result);
      } finally {
        await mockPage.close();
      }
    }
  } finally {
    await server.close();
  }
  const failed = outcomes.filter(result => result.status !== 'pass');
  if (failed.length) {
    fail(failed.map(result => `${mkId} ${result.viewport}: ${result.status} 差分率 ${result.ratio}（閾値 ${result.threshold}）${result.notes.length ? ` ${result.notes.join(' / ')}` : ''}`).join('\n'));
  }
  return outcomes;
}
