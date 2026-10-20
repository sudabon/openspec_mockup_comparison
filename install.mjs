#!/usr/bin/env node
// openspec-e2e-mockup-kit installer.
// openspec_e2e_test (openspec-e2e-kit) の installer を fork したもの。取り込み元は UPSTREAM.md を参照。
// Node 標準ライブラリのみで実装する(外部依存を持たせない)。
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, chmodSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAYLOAD = join(HERE, 'payload');
const KIT_NAME = 'openspec-e2e-mockup-kit';
const STAMP_FILE = '.openspec-e2e-mockup-kit.json';
const MARKER_START = `# --- ${KIT_NAME} ---`;
const MARKER_END = `# --- /${KIT_NAME} ---`;

// 移行元の e2e kit (openspec_e2e_test)。記録ファイルとマーカーを検出して移行する
const E2E_KIT_STAMP_FILE = '.openspec-e2e-kit.json';
const E2E_KIT_MARKER_START = '# --- openspec-e2e-kit ---';
const E2E_KIT_MARKER_END = '# --- /openspec-e2e-kit ---';
const E2E_CONTEXT_LINES = [
  'E2Eテスト: Playwright。実装規約は .claude/skills/e2e-conventions/SKILL.md に従う。',
  'テストには必ず @<change-id> と @TP-NNN タグを付ける。',
];
// ルートを含むため行の先頭で kit の行かを判定する(ルート変更後の古い行を kit の行として扱う)
const MOCKUP_CONTEXT_PREFIXES = ['モック比較: モックルートは ', 'モック比較の差分超過は '];

/** config.yaml の context に書く kit の行 */
function contextLines(e2eRoot, mockupRoot) {
  return [
    ...E2E_CONTEXT_LINES,
    `${MOCKUP_CONTEXT_PREFIXES[0]}${mockupRoot}/。比較テストは ${e2eRoot}/support/mockup-compare.ts の compareWithMockup で書き、@<change-id> と @VC-NNN タグを付ける。`,
    `${MOCKUP_CONTEXT_PREFIXES[1]}.claude/skills/mockup-compare-review/SKILL.md の手順でレビューする(閾値やテストは変更しない)。`,
  ];
}

function isKitContextLine(line) {
  const t = line.trim();
  return E2E_CONTEXT_LINES.includes(t) || MOCKUP_CONTEXT_PREFIXES.some(p => t.startsWith(p));
}

const SCHEMA_NAME = 'spec-driven-e2e-mockup';

// openspec init が書く既定値と、移行元 e2e kit のスキーマ。これらは自動で SCHEMA_NAME に切り替える。
// 進行中の change は .openspec.yaml に自分のスキーマを記録しているので影響を受けない。
const REPLACEABLE_SCHEMAS = new Set(['spec-driven', 'spec-driven-e2e']);

// モック比較に必要な導入先の devDependencies。package.json は書き換えず案内だけ出す
const REQUIRED_DEV_DEPS = ['@playwright/test', 'pngjs', 'pixelmatch'];

// payload 内の E2E ルート。導入先の実際のルートを検出して、配置先とファイル内容の
// 両方をこの文字列から置き換える。payload 側はリテラルのまま置いておくことで、
// プレースホルダを使わずに payload 単体でも読める・テストできる状態を保つ。
const E2E_ROOT_DEFAULT = 'tests/e2e';

// 内容に E2E ルートのパスを含み、置換が必要なファイル(payload 相対)
const E2E_PATH_FILES = new Set([
  '.claude/skills/e2e-conventions/SKILL.md',
  '.claude/skills/mockup-compare-review/SKILL.md',
  'openspec/schemas/spec-driven-e2e-mockup/schema.yaml',
  'openspec/schemas/spec-driven-e2e-mockup/templates/mockup-compare.md',
  'openspec/schemas/spec-driven-e2e-mockup/templates/tasks.md',
  'scripts/check-test-plan.sh',
  'playwright.config.example.ts',
]);

// payload 内のモックルート。E2E ルートと同じく、payload ではリテラル `mockup/` で書いておき、
// 導入先で判別したルートへ置き換える。
const MOCKUP_ROOT_DEFAULT = 'mockup';
const MOCKUP_DIR_NAMES = new Set(['mockup', 'mockups', 'mock']);
// `mockup-compare.md` や `.../mockup-compare-review/` に誤爆しないよう、
// 単語・パスの途中ではない `mockup/` だけを対象にする
const MOCKUP_ROOT_RE = /(?<![\w.\-/])mockup\//g;

// 内容にモックルートのパスを含み、置換が必要なファイル(payload 相対)
const MOCKUP_PATH_FILES = new Set([
  '.claude/skills/mockup-compare-review/SKILL.md',
  'openspec/schemas/spec-driven-e2e-mockup/schema.yaml',
  'openspec/schemas/spec-driven-e2e-mockup/templates/mockup-compare.md',
  'tests/e2e/support/mockup-compare.ts',
]);

const PW_CONFIG_RE = /^playwright\.config\.(?:[cm]?[jt]s)$/;
const SCAN_SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'vendor',
  '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.venv', 'target', 'tmp',
]);
const SCAN_MAX_DEPTH = 3;

const USAGE = `usage: ${KIT_NAME} [install|update] [--force] [--dry-run] [--target <dir>] [--e2e-root <path>] [--mockup-root <path>] [--language <lang>]

  install              payload を対象リポジトリへ導入する(既定)
  update               install と同じ処理。出力の文言が「更新」になる
  --target <dir>       対象ディレクトリ(既定: カレントディレクトリ)
  --e2e-root <path>    E2E テストの置き場所(target 相対)。省略時は Playwright 設定の
                       testDir から自動判別し、見つからなければ ${E2E_ROOT_DEFAULT} を使う
  --mockup-root <path> HTML モックの置き場所(target 相対)。省略時は深さ ${SCAN_MAX_DEPTH} までの
                       mockup / mockups / mock のうち HTML を含む最も浅いものを使い、
                       見つからなければ ${MOCKUP_ROOT_DEFAULT} を使う
  --language <lang>    openspec/config.yaml を新規作成するとき、artifact の言語を指定する
                       (openspec init --language と同じ context を書く。例: Japanese)
  --force              差分のあるファイルを上書きし、git リポジトリ確認をスキップする
  --dry-run            一切書き込まず、実行予定の操作だけを表示する
  -h, --help           このヘルプを表示する`;

// ---------------------------------------------------------------- args

function parseArgs(argv) {
  const opts = { command: null, target: null, force: false, dryRun: false, help: false, e2eRoot: null, mockupRoot: null, language: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'install' || a === 'update') {
      if (opts.command) throw new UsageError(`サブコマンドが重複しています: ${a}`);
      opts.command = a;
    } else if (a === '--force') {
      opts.force = true;
    } else if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (a === '-h' || a === '--help') {
      opts.help = true;
    } else if (a === '--target') {
      const v = argv[++i];
      if (!v) throw new UsageError('--target には値が必要です');
      opts.target = v;
    } else if (a.startsWith('--target=')) {
      opts.target = a.slice('--target='.length);
      if (!opts.target) throw new UsageError('--target には値が必要です');
    } else if (a === '--e2e-root' || a.startsWith('--e2e-root=')) {
      const v = a.includes('=') ? a.slice('--e2e-root='.length) : argv[++i];
      if (!v) throw new UsageError('--e2e-root には値が必要です');
      opts.e2eRoot = normalizeRoot(v);
    } else if (a === '--mockup-root' || a.startsWith('--mockup-root=')) {
      const v = a.includes('=') ? a.slice('--mockup-root='.length) : argv[++i];
      if (!v) throw new UsageError('--mockup-root には値が必要です');
      opts.mockupRoot = normalizeRoot(v, 'モックルート');
    } else if (a === '--language' || a.startsWith('--language=')) {
      const v = a.includes('=') ? a.slice('--language='.length) : argv[++i];
      if (!v || !v.trim()) throw new UsageError('--language には値が必要です');
      opts.language = v.trim();
    } else {
      throw new UsageError(`不明な引数: ${a}`);
    }
  }
  opts.command ??= 'install';
  opts.target = resolve(opts.target ?? process.cwd());
  return opts;
}

class UsageError extends Error {}

// ---------------------------------------------------------------- fs helpers

function walkFiles(root, base = root) {
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const abs = join(root, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(abs, base));
    else if (entry.isFile()) out.push(relative(base, abs).split(sep).join('/'));
  }
  return out.sort();
}

function isInsideGitRepo(dir) {
  let cur = resolve(dir);
  for (;;) {
    if (existsSync(join(cur, '.git'))) return true;
    const parent = dirname(cur);
    if (parent === cur) return false;
    cur = parent;
  }
}

// ---------------------------------------------------------------- E2E root 検出

/** target 相対の正規化。'./e2e/' → 'e2e'。target の外を指す指定は拒否する */
function normalizeRoot(value, label = 'E2E ルート') {
  const v = String(value).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').trim();
  if (!v || v === '.') throw new UsageError(`${label}が空です`);
  if (v.startsWith('/') || /^[A-Za-z]:/.test(v)) {
    throw new UsageError(`${label}は target 相対で指定してください: ${value}`);
  }
  if (v.split('/').includes('..')) {
    throw new UsageError(`${label}に '..' は使えません: ${value}`);
  }
  return v;
}

/** playwright.config.* を深さ制限付きで探索する(浅い順 → 名前順) */
function findPlaywrightConfigs(root, dir = root, depth = 0) {
  if (!existsSync(dir)) return [];
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (entry.isFile() && PW_CONFIG_RE.test(entry.name)) {
      found.push(relative(root, join(dir, entry.name)).split(sep).join('/'));
    }
  }
  if (depth < SCAN_MAX_DEPTH) {
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') && entry.name !== '.') continue;
      if (SCAN_SKIP_DIRS.has(entry.name)) continue;
      found.push(...findPlaywrightConfigs(root, join(dir, entry.name), depth + 1));
    }
  }
  return found.sort((a, b) => {
    const da = a.split('/').length, db = b.split('/').length;
    return da !== db ? da - db : a.localeCompare(b);
  });
}

/** 設定ファイルから testDir を読む。読めなければ null */
function parseTestDir(absPath) {
  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
  const m = text.match(/testDir\s*:\s*['"`]([^'"`\n]+)['"`]/);
  return m ? m[1] : null;
}

/**
 * E2E ルートを決める。
 * 優先順: --e2e-root > スタンプの記録 > 設定の testDir > 既存ディレクトリ > 既定
 * @returns {{root: string, how: string, detected: string|null, configs: string[]}}
 */
function resolveE2eRoot(target, flagRoot, stampRoot, stampLabel = STAMP_FILE) {
  const configs = findPlaywrightConfigs(target);

  // 設定の testDir から検出する(浅い設定を優先)
  let detected = null;
  let detectedHow = null;
  for (const rel of configs) {
    const testDir = parseTestDir(join(target, rel));
    if (!testDir) continue;
    const abs = resolve(dirname(join(target, rel)), testDir);
    const relRoot = relative(target, abs).split(sep).join('/');
    if (!relRoot || relRoot.startsWith('..')) continue;
    detected = relRoot;
    detectedHow = `${rel} の testDir`;
    break;
  }

  // testDir が読めなかった場合は既存ディレクトリから推定する
  if (!detected) {
    const candidates = [];
    for (const rel of configs) {
      const base = dirname(rel) === '.' ? '' : `${dirname(rel)}/`;
      candidates.push(`${base}e2e`, `${base}tests/e2e`, `${base}playwright`);
    }
    candidates.push(E2E_ROOT_DEFAULT, 'e2e', 'playwright/e2e');
    for (const c of candidates) {
      if (existsSync(join(target, c))) {
        detected = c;
        detectedHow = `既存ディレクトリ ${c}`;
        break;
      }
    }
  }

  if (flagRoot) return { root: flagRoot, how: '--e2e-root の指定', detected, configs };
  if (stampRoot) return { root: stampRoot, how: `${stampLabel} の記録`, detected, configs };
  if (detected) return { root: detected, how: detectedHow, detected, configs };
  return { root: E2E_ROOT_DEFAULT, how: '既定値(検出できず)', detected, configs };
}

/** payload のパスを、検出した E2E ルートに合わせて読み替える */
function mapDestRel(rel, e2eRoot) {
  const prefix = `${E2E_ROOT_DEFAULT}/`;
  if (e2eRoot !== E2E_ROOT_DEFAULT && rel.startsWith(prefix)) {
    return `${e2eRoot}/${rel.slice(prefix.length)}`;
  }
  return rel;
}

/** ファイル内容の E2E ルートとモックルートを書き換える */
function transformContent(rel, buf, e2eRoot, mockupRoot) {
  const e2e = e2eRoot !== E2E_ROOT_DEFAULT && E2E_PATH_FILES.has(rel);
  const mockup = mockupRoot !== MOCKUP_ROOT_DEFAULT && MOCKUP_PATH_FILES.has(rel);
  if (!e2e && !mockup) return buf;
  let text = buf.toString('utf8');
  if (e2e) text = text.replaceAll(E2E_ROOT_DEFAULT, e2eRoot);
  if (mockup) text = text.replace(MOCKUP_ROOT_RE, `${mockupRoot}/`);
  return Buffer.from(text, 'utf8');
}

// ---------------------------------------------------------------- モックルート検出

/** dir 配下(深さ制限付き)に .html があるか */
function containsHtml(dir, depth = 0) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  if (entries.some(e => e.isFile() && /\.html?$/i.test(e.name))) return true;
  if (depth >= SCAN_MAX_DEPTH) return false;
  return entries.some(e => e.isDirectory() && !e.name.startsWith('.') && !SCAN_SKIP_DIRS.has(e.name)
    && containsHtml(join(dir, e.name), depth + 1));
}

/** mockup / mockups / mock という名前で HTML を含むディレクトリを探す(浅い順 → 名前順) */
function findMockupDirs(root, dir = root, depth = 1) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || SCAN_SKIP_DIRS.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (MOCKUP_DIR_NAMES.has(entry.name) && containsHtml(abs)) {
      found.push(relative(root, abs).split(sep).join('/'));
    }
    if (depth < SCAN_MAX_DEPTH) found.push(...findMockupDirs(root, abs, depth + 1));
  }
  return found.sort((a, b) => {
    const da = a.split('/').length, db = b.split('/').length;
    return da !== db ? da - db : a.localeCompare(b);
  });
}

/**
 * モックルートを決める。
 * 優先順: --mockup-root > スタンプの記録 > HTML を含む mockup/mockups/mock の最浅 > 既定
 * @returns {{root: string, how: string, detected: string|null, candidates: string[]}}
 */
function resolveMockupRoot(target, flagRoot, stampRoot) {
  const candidates = findMockupDirs(target);
  const detected = candidates[0] ?? null;
  if (flagRoot) return { root: flagRoot, how: '--mockup-root の指定', detected, candidates };
  if (stampRoot) return { root: stampRoot, how: `${STAMP_FILE} の記録`, detected, candidates };
  if (detected) return { root: detected, how: `HTML を含む ${detected}`, detected, candidates };
  return { root: MOCKUP_ROOT_DEFAULT, how: '既定値(検出できず)', detected, candidates };
}

// ---------------------------------------------------------------- unified diff

function unifiedDiff(oldText, newText, oldLabel, newLabel, context = 3) {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  // LCS テーブル(payload のファイルは小さいので O(n*m) で十分)
  const n = a.length, m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push([' ', a[i]]); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { ops.push(['-', a[i++]]); }
    else { ops.push(['+', b[j++]]); }
  }
  while (i < n) ops.push(['-', a[i++]]);
  while (j < m) ops.push(['+', b[j++]]);

  // 変更点の周囲 context 行だけを残す
  const keep = new Array(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op[0] === ' ') return;
    for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) keep[k] = true;
  });

  const lines = [`--- ${oldLabel}`, `+++ ${newLabel}`];
  let printedGap = false;
  for (let idx = 0; idx < ops.length; idx++) {
    if (!keep[idx]) { if (!printedGap) { lines.push('@@'); printedGap = true; } continue; }
    printedGap = false;
    lines.push(ops[idx][0] + ops[idx][1]);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- config.yaml merge

/** 先頭が空白でない(= トップレベル)かつコメントでない `key:` 行を探す */
function findTopLevelKey(lines, key) {
  const re = new RegExp(`^${key}:(\\s*)(.*)$`);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (m) return { index: i, value: m[2].trim() };
  }
  return null;
}

function findMarkerRange(lines, startMarker = MARKER_START, endMarker = MARKER_END) {
  const start = lines.findIndex(l => l.trim() === startMarker);
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && l.trim() === endMarker);
  if (end === -1) return null;
  return { start, end, indent: lines[start].match(/^\s*/)[0] };
}

/** openspec init --language が書くものと同じ context 本文(インデントなし) */
function languageLines(lang) {
  return [
    `Language: ${lang}`,
    `All artifacts must be written in ${lang}.`,
    'Keep OpenSpec structural headings and SHALL/MUST keywords in English.',
  ];
}

/** context ブロック内に置く kit のマーカーブロック */
function markerBlock(indent, ctxLines) {
  return [`${indent}${MARKER_START}`, ...ctxLines.map(l => `${indent}${l}`), `${indent}${MARKER_END}`];
}

/**
 * config.yaml を冪等にマージする。
 *
 * マーカーは必ず `context: |` の**内側**に置き、マーカー間には kit の行だけを入れる。
 * 以前の版はトップレベルのマーカーで `context: |` ごと囲んでいたため、その context に
 * 後から追記された行(Language 指定や他 kit の行)が update のたびに消えていた。
 * 旧形式を見つけた場合は、kit 以外の行を保持したまま新形式へ移行する。
 * e2e kit (openspec-e2e-kit) のマーカーブロックは、本 kit のマーカーブロックへ置き換える。
 *
 * @param {string[]} ctxLines context に書く kit の行(contextLines() の結果)
 * @returns {{text: string|null, notes: string[], warnings: string[]}} text=null は変更なし
 */
function mergeConfig(original, language, ctxLines) {
  const notes = [];
  const warnings = [];

  if (original === null) {
    const text = [
      `schema: ${SCHEMA_NAME}`,
      '',
      'context: |',
      ...(language ? languageLines(language).map(l => `  ${l}`) : []),
      ...markerBlock('  ', ctxLines),
      '',
    ].join('\n');
    notes.push(`openspec/config.yaml を新規作成 (schema: ${SCHEMA_NAME}${language ? `, language: ${language}` : ''} + context ブロック)`);
    return { text, notes, warnings };
  }

  let lines = original.split('\n');

  // --- schema: キー ---
  const schemaKey = findTopLevelKey(lines, 'schema');
  const schemaValue = schemaKey?.value.replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim();
  if (!schemaKey) {
    lines.unshift(`schema: ${SCHEMA_NAME}`);
    notes.push(`schema: ${SCHEMA_NAME} を追加`);
  } else if (REPLACEABLE_SCHEMAS.has(schemaValue)) {
    lines[schemaKey.index] = `schema: ${SCHEMA_NAME}`;
    notes.push(`schema: ${schemaValue} → ${SCHEMA_NAME}(進行中の change は各自の .openspec.yaml のスキーマのまま)`);
  } else if (schemaValue !== SCHEMA_NAME) {
    warnings.push(
      `openspec/config.yaml の schema が '${schemaValue}' です。` +
      `'${SCHEMA_NAME}' へは自動変更しません。E2E・モック比較のアーティファクトを使うには手動で変更してください。` +
      `\n  change 単位なら: openspec new change <name> --schema ${SCHEMA_NAME}`
    );
  }

  // --- e2e kit のマーカーブロックからの移行 ---
  // マーカー行だけを本 kit のものへ付け替え、中身の更新は以降の通常処理に任せる
  // (e2e kit の行は本 kit の行でもあるので、kit 以外の行の保持もそのまま機能する)。
  const e2eMarker = findMarkerRange(lines, E2E_KIT_MARKER_START, E2E_KIT_MARKER_END);
  if (e2eMarker && !findMarkerRange(lines)) {
    lines[e2eMarker.start] = lines[e2eMarker.start].replace(E2E_KIT_MARKER_START, MARKER_START);
    lines[e2eMarker.end] = lines[e2eMarker.end].replace(E2E_KIT_MARKER_END, MARKER_END);
    notes.push(`openspec-e2e-kit のマーカーブロックを ${KIT_NAME} のマーカーブロックへ置き換え`);
  } else if (e2eMarker) {
    // 両方ある: e2e kit のブロックは kit 以外の行だけを残して取り除く
    const foreign = lines.slice(e2eMarker.start + 1, e2eMarker.end).filter(l => l.trim() !== '' && !isKitContextLine(l));
    lines = [...lines.slice(0, e2eMarker.start), ...foreign, ...lines.slice(e2eMarker.end + 1)];
    notes.push('重複していた openspec-e2e-kit のマーカーブロックを削除' + (foreign.length ? `(kit 以外の ${foreign.length} 行を保持)` : ''));
  }

  // --- context マーカーブロック ---
  const marker = findMarkerRange(lines);
  if (marker && marker.indent === '' && lines.slice(marker.start + 1, marker.end).some(l => /^context:\s*\|[-+]?\s*$/.test(l))) {
    // 旧形式: トップレベルのマーカーが context: | ごと囲んでいる → 新形式へ移行
    const inner = lines.slice(marker.start + 1, marker.end);
    const ctxIdx = inner.findIndex(l => /^context:\s*\|[-+]?\s*$/.test(l));
    const before = inner.slice(0, ctxIdx);                       // マーカーと context: の間(通常は空)
    const body = inner.slice(ctxIdx + 1);
    const indent = body.find(l => l.trim() !== '')?.match(/^\s*/)[0] || '  ';
    const foreign = body.filter(l => l.trim() !== '' && !isKitContextLine(l));
    lines = [
      ...lines.slice(0, marker.start),
      ...before,
      inner[ctxIdx],
      ...foreign,
      ...markerBlock(indent, ctxLines),
      ...lines.slice(marker.end + 1),
    ];
    notes.push(
      '旧形式のマーカーブロックを context の内側へ移行' +
      (foreign.length ? `(kit 以外の ${foreign.length} 行を保持)` : '')
    );
  } else if (marker) {
    // 新形式: マーカー間だけを kit の行に揃える。マーカー外の行には触らない
    const desired = ctxLines.map(l => `${marker.indent}${l}`);
    const current = lines.slice(marker.start + 1, marker.end);
    if (current.join('\n') !== desired.join('\n')) {
      const foreign = current.filter(l => l.trim() !== '' && !isKitContextLine(l));
      lines = [
        ...lines.slice(0, marker.start),
        ...foreign,                                              // マーカー内に紛れた他の行はマーカーの前へ退避
        lines[marker.start],
        ...desired,
        ...lines.slice(marker.end),
      ];
      notes.push(`${KIT_NAME} マーカーブロックを更新` + (foreign.length ? `(kit 以外の ${foreign.length} 行をマーカーの外へ退避)` : ''));
    }
  } else {
    const contextKey = findTopLevelKey(lines, 'context');
    if (!contextKey) {
      while (lines.length && lines.at(-1).trim() === '') lines.pop();
      lines.push('', 'context: |', ...markerBlock('  ', ctxLines), '');
      notes.push('context ブロック(マーカー付き)を追加');
    } else if (/^\|[-+]?$/.test(contextKey.value)) {
      // 既存の literal block scalar の末尾に、同じインデントで追記する
      let end = contextKey.index + 1;
      let indent = null;
      while (end < lines.length) {
        const l = lines[end];
        if (l.trim() === '') { end++; continue; }
        const ind = l.match(/^\s*/)[0];
        if (ind.length === 0) break;
        indent ??= ind;
        end++;
      }
      while (end > contextKey.index + 1 && lines[end - 1].trim() === '') end--;
      lines = [...lines.slice(0, end), ...markerBlock(indent ?? '  ', ctxLines), ...lines.slice(end)];
      notes.push('既存の context ブロック末尾へマーカー付きで追記');
    } else {
      warnings.push(
        'openspec/config.yaml に literal block ではない context: があるため自動追記しません。' +
        `以下の行を手動で context へ追加してください:\n    ${ctxLines.join('\n    ')}`
      );
    }
  }

  if (language && !/^\s+Language:/m.test(original)) {
    warnings.push(
      'openspec/config.yaml が既にあるため --language は反映しません(openspec init と同じ扱い)。\n' +
      `  context に以下を手動で追加してください:\n    ${languageLines(language).join('\n    ')}`
    );
  }

  const text = lines.join('\n');
  return { text: text === original ? null : text, notes, warnings };
}

// ---------------------------------------------------------------- main

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(USAGE); return 0; }

  const verb = opts.command === 'update' ? '更新' : '導入';
  const version = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8')).version;

  console.log(`${KIT_NAME} v${version} — ${verb}先: ${opts.target}${opts.dryRun ? ' (dry-run)' : ''}`);

  // 1. git リポジトリ確認
  if (!isInsideGitRepo(opts.target)) {
    console.log(`\n⚠ ${opts.target} は git リポジトリではありません。`);
    if (opts.dryRun) {
      console.log('  (dry-run のため確認をスキップします)');
    } else if (opts.force) {
      console.log('  --force が指定されているため続行します。');
    } else if (process.stdin.isTTY) {
      if (!await confirm(`  このまま${verb}しますか?`)) {
        console.log('中止しました。');
        return 0;
      }
    } else {
      console.error('  対話できない環境です。続行するには --force を指定してください。');
      return 1;
    }
  }

  // e2e kit からの移行か
  const e2eKitStamp = readStamp(join(opts.target, E2E_KIT_STAMP_FILE));
  if (e2eKitStamp.exists) {
    console.log(
      `\ne2e kit (openspec_e2e_test) の記録 ${E2E_KIT_STAMP_FILE} を検出しました。移行として扱います。\n` +
      '  - e2e kit が配置したファイルは、以後この kit の管理下に置きます(内容が同じものはスキップします)\n' +
      '  - 以後は openspec_e2e_test の update を実行しないこと(schema と config.yaml の context が競合します)\n' +
      `  - ${E2E_KIT_STAMP_FILE} は削除せずに残します\n`
    );
  }

  // E2E ルートの決定(本 kit の記録が無ければ、移行元 e2e kit の記録を使う)
  const stampPath = join(opts.target, STAMP_FILE);
  const stamp = readStamp(stampPath);
  const stampData = stamp.data;
  let stampRoot = safeRoot(stampData?.e2eRoot);
  let stampLabel = STAMP_FILE;
  if (!stampRoot && safeRoot(e2eKitStamp.data?.e2eRoot)) {
    stampRoot = safeRoot(e2eKitStamp.data.e2eRoot);
    stampLabel = E2E_KIT_STAMP_FILE;
  }
  const e2e = resolveE2eRoot(opts.target, opts.e2eRoot, stampRoot, stampLabel);
  const e2eRoot = e2e.root;

  console.log(`E2E ルート: ${e2eRoot}  (${e2e.how})`);
  if (e2e.configs.length > 1) {
    console.log(
      `  Playwright 設定が ${e2e.configs.length} 件見つかりました。最も浅いものを採用しています。\n` +
      `  採用: ${e2e.configs[0]}\n` +
      `  対象外: ${e2e.configs.slice(1).join(', ')}\n` +
      `  意図と違う場合は --e2e-root <path> で指定してください。`
    );
  }
  if (stampRoot && e2e.detected && e2e.detected !== stampRoot) {
    console.log(
      `  ⚠ 記録は '${stampRoot}' ですが、検出結果は '${e2e.detected}' です。` +
      `記録を優先しました。切り替えるには --e2e-root ${e2e.detected} を指定してください。`
    );
  }
  if (stampRoot && stampRoot !== e2eRoot) {
    console.log(
      `  ⚠ 前回は '${stampRoot}' に配置していました。'${stampRoot}' 配下の不要になった` +
      `ファイルは自動削除しません。手で確認してください。`
    );
  }

  // モックルートの決定
  const stampMockupRoot = safeRoot(stampData?.mockupRoot, 'モックルート');
  const mock = resolveMockupRoot(opts.target, opts.mockupRoot, stampMockupRoot);
  const mockupRoot = mock.root;

  console.log(`モックルート: ${mockupRoot}  (${mock.how})`);
  if (mock.candidates.length > 1) {
    console.log(
      `  モックの候補が ${mock.candidates.length} 件見つかりました。最も浅いものを採用しています。\n` +
      `  採用: ${mock.candidates[0]}\n` +
      `  対象外: ${mock.candidates.slice(1).join(', ')}\n` +
      `  意図と違う場合は --mockup-root <path> で指定してください。`
    );
  }
  if (!existsSync(join(opts.target, mockupRoot))) {
    console.log(`  ⚠ ${mockupRoot} はまだありません。モックを置くか、--mockup-root <path> で指定してください。`);
  }
  if (stampMockupRoot && mock.detected && mock.detected !== stampMockupRoot && !opts.mockupRoot) {
    console.log(
      `  ⚠ 記録は '${stampMockupRoot}' ですが、検出結果は '${mock.detected}' です。` +
      `記録を優先しました。切り替えるには --mockup-root ${mock.detected} を指定してください。`
    );
  }
  if (stampMockupRoot && stampMockupRoot !== mockupRoot) {
    console.log(
      `  ⚠ 前回のモックルートは '${stampMockupRoot}' でした。'${stampMockupRoot}' 配下のファイルは削除しません。\n` +
      `    配布ファイルの内容は新しいルートで書き換わるため、差分ありで skip されたファイルは --force で更新してください。\n` +
      `    既存の mockup-compare.md やテストに書いたモックパスは変更しません。`
    );
  }

  const planned = [];   // dry-run 用の操作一覧
  const created = [];
  const overwritten = [];
  const skipped = [];   // 内容が異なるため skip したファイル
  const warnings = [];

  // 2. payload の再帰コピー
  for (const rel of walkFiles(PAYLOAD)) {
    const src = join(PAYLOAD, rel);
    const content = transformContent(rel, readFileSync(src), e2eRoot, mockupRoot);
    let destRel = mapDestRel(rel, e2eRoot);

    if (rel === 'playwright.config.example.ts') {
      // 既存プロジェクトの設定は上書きしない。設定は**リポジトリ全体**を探索して
      // 判定する(ルートだけ見ていると frontend/playwright.config.ts のような
      // 構成で 2 つ目の設定を作ってしまう)。
      const rootConfig = join(opts.target, 'playwright.config.ts');
      const kitPlacedRoot = e2e.configs.length === 1
        && e2e.configs[0] === 'playwright.config.ts'
        && existsSync(rootConfig)
        && readFileSync(rootConfig).equals(content);
      if (e2e.configs.length === 0) {
        destRel = 'playwright.config.ts';
      } else if (kitPlacedRoot) {
        continue; // kit が設置したものなので何もしない(2 回目で .example が増えるのを防ぐ)
      } else {
        destRel = 'playwright.config.example.ts';
      }
    }

    const dest = join(opts.target, destRel);

    if (!existsSync(dest)) {
      planned.push(`create  ${destRel}`);
      created.push(destRel);
      if (!opts.dryRun) {
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, content);
        if (destRel.endsWith('.sh')) applyExecBit(src, dest);
      }
      continue;
    }

    const existing = readFileSync(dest);
    if (existing.equals(content)) continue; // 同一内容 → サイレント skip

    if (opts.force) {
      planned.push(`overwrite ${destRel}`);
      overwritten.push(destRel);
      if (!opts.dryRun) {
        writeFileSync(dest, content);
        if (destRel.endsWith('.sh')) applyExecBit(src, dest);
      }
    } else {
      planned.push(`skip(差分あり) ${destRel}`);
      skipped.push(destRel);
      console.log(`\n差分あり(上書きしません): ${destRel}`);
      console.log(unifiedDiff(existing.toString('utf8'), content.toString('utf8'), `target/${destRel}`, `payload/${rel}`));
    }
  }

  // 3. openspec/config.yaml のマージ
  const configPath = join(opts.target, 'openspec', 'config.yaml');
  const configBefore = existsSync(configPath) ? readFileSync(configPath, 'utf8') : null;
  const merged = mergeConfig(configBefore, opts.language, contextLines(e2eRoot, mockupRoot));
  warnings.push(...merged.warnings);
  if (merged.text !== null) {
    for (const n of merged.notes) planned.push(`config  ${n}`);
    if (!opts.dryRun) {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, merged.text);
    }
  }

  // 4. インストールスタンプ(version かルートが変わったときだけ書く。no-op の update で git 差分を作らない)
  const stampChanged = stampData?.version !== version || stampData?.e2eRoot !== e2eRoot
    || stampData?.mockupRoot !== mockupRoot;
  if (stampChanged) {
    planned.push(`stamp   ${STAMP_FILE} (version ${version}, e2eRoot ${e2eRoot}, mockupRoot ${mockupRoot})`);
    if (!opts.dryRun) {
      writeFileSync(
        stampPath,
        JSON.stringify({ version, installedAt: new Date().toISOString(), e2eRoot, mockupRoot }, null, 2) + '\n',
      );
    }
  }

  // 5. 結果表示
  if (opts.dryRun) {
    console.log('\n実行予定の操作(書き込みは行っていません):');
    if (planned.length === 0) console.log('  (なし)');
    for (const p of planned) console.log(`  ${p}`);
  } else {
    console.log('');
    console.log(`作成: ${created.length} 件 / 上書き: ${overwritten.length} 件 / 差分により skip: ${skipped.length} 件`);
    for (const n of merged.notes) console.log(`  config.yaml: ${n}`);
    if (created.length === 0 && overwritten.length === 0 && merged.notes.length === 0) {
      console.log('  変更はありません(既に最新です)。');
    }
  }

  if (skipped.length) {
    console.log('\n以下のファイルは対象側の内容が異なるため skip しました(上書きするには --force):');
    for (const f of skipped) console.log(`  - ${f}`);
  }
  for (const w of warnings) console.log(`\n⚠ ${w}`);

  // 依存パッケージの案内(package.json は書き換えない)
  const pkgDir = e2e.configs.length ? dirname(e2e.configs[0]) : '.';
  const missing = missingDevDeps(opts.target, pkgDir);
  if (missing.length) {
    const where = pkgDir === '.' ? '' : `   # ${pkgDir}/ で実行`;
    console.log(
      `\nモック比較には次の devDependencies が必要です(package.json は変更していません):\n` +
      `  npm i -D ${missing.join(' ')}${where}`
    );
  }

  // openspec init 前に導入した場合の案内(config.yaml があると init --language はエラーになる)
  if (!existsSync(join(opts.target, 'openspec', 'specs'))) {
    console.log('\n次のステップ: openspec init --tools <tool>   # 例: --tools claude');
    console.log('  ※ openspec/config.yaml が既にあるため、openspec init に --language を付けるとエラーになります。');
    console.log('    言語はこの kit の --language で指定してください。');
  }

  console.log(opts.dryRun ? `\ndry-run 完了。書き込みは行っていません。` : `\n${verb}が完了しました。`);
  return 0;
}

/** 記録ファイルを読む。壊れていれば data=null(検出に任せる) */
function readStamp(path) {
  if (!existsSync(path)) return { exists: false, data: null };
  try {
    return { exists: true, data: JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return { exists: true, data: null };
  }
}

/** 記録値のルートを正規化する。不正な値は無視する */
function safeRoot(value, label) {
  if (!value) return null;
  try {
    return normalizeRoot(value, label);
  } catch {
    return null;
  }
}

/** target と Playwright 設定のある package.json を見て、足りない devDependencies を返す */
function missingDevDeps(target, pkgDir) {
  const have = new Set();
  for (const dir of new Set(['.', pkgDir])) {
    try {
      const pkg = JSON.parse(readFileSync(join(target, dir, 'package.json'), 'utf8'));
      for (const k of ['dependencies', 'devDependencies']) Object.keys(pkg[k] ?? {}).forEach(n => have.add(n));
    } catch {
      /* package.json が無い・読めない場合は、すべて不足として案内する */
    }
  }
  return REQUIRED_DEV_DEPS.filter(n => !have.has(n));
}

function applyExecBit(src, dest) {
  try {
    const mode = statSync(src).mode;
    if (mode & 0o111) chmodSync(dest, mode & 0o777);
  } catch {
    /* 実行ビットの引き継ぎに失敗しても致命的ではない */
  }
}

try {
  process.exitCode = await main();
} catch (err) {
  if (err instanceof UsageError) {
    console.error(`エラー: ${err.message}\n\n${USAGE}`);
    process.exitCode = 2;
  } else {
    console.error(`エラー: ${err?.stack ?? err}`);
    process.exitCode = 1;
  }
}
