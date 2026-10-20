import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// mockup-compare.md の VC 一覧と、compareWithMockup が出力した meta.json を突き合わせる。
// 終了コード(e2e-report.mjs と同じ体系):
//   0 = 失敗も欠落もなし(「比較対象なし」の change を含む)
//   1 = 未実行の VC あり(mockup-compare.md の VC-ID に対応する結果が無い)
//   2 = 引数エラー、mockup-compare.md / meta.json が読めない、または --max-age 超過で
//       結果が古い(前の周の結果を読んでいる疑い)
//   3 = 失敗した VC あり(欠落の有無は問わない。両方あるときも 3)
const USAGE = `usage: mockup-report.mjs <change-id> [results-dir] [--max-age <seconds>]

  results-dir          比較結果のディレクトリ(既定: mockup-compare-results/<change-id>)
  --max-age <seconds>  meta.json の実行開始時刻(startedAt)の最古値がこの秒数より古ければ exit 2。
                       周回ごとに実行する用途で、前の周の結果を読んでしまう事故を防ぐ。
                       実行時刻が記録されていない場合や結果が 1 件も無い場合も、検証不能として exit 2 にする

exit code: 0=問題なし / 1=未実行の VC あり / 2=引数・入力エラー / 3=失敗した VC あり`;

const argv = process.argv.slice(2);
const positional = [];
let maxAge = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
  if (a === '--max-age' || a.startsWith('--max-age=')) {
    const raw = a.includes('=') ? a.slice('--max-age='.length) : argv[++i];
    maxAge = Number(raw);
    if (raw === undefined || raw === '' || !Number.isFinite(maxAge) || maxAge < 0) {
      console.error(`--max-age には 0 以上の秒数を指定してください: ${raw}`);
      process.exit(2);
    }
  } else if (a.startsWith('-')) {
    console.error(`不明な引数: ${a}\n\n${USAGE}`);
    process.exit(2);
  } else {
    positional.push(a);
  }
}

const changeId = positional[0];
if (!changeId || positional.length > 2) { console.error(USAGE); process.exit(2); }
const resultsDir = positional[1] ?? join('mockup-compare-results', changeId);
const planPath = `openspec/changes/${changeId}/mockup-compare.md`;

function read(path, what) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    console.error(`${what} を読めません: ${path} (${err.code ?? err.message})`);
    process.exit(2);
  }
}

// 観点一覧の表の行(先頭セルが VC-NNN)だけを拾う。作成ルールなどの本文中の言及は数えない
const planned = [...new Set(
  [...read(planPath, 'mockup-compare.md').matchAll(/^\|\s*(VC-\d{3})\s*\|/gm)].map(m => m[1])
)];
if (planned.length === 0) {
  console.log(`${planPath} に比較観点(VC-NNN)がありません(比較対象なし)。レポートを省略します。`);
  process.exit(0);
}

const rows = [];
for (const vc of planned) {
  const metaPath = join(resultsDir, vc, 'meta.json');
  if (!existsSync(metaPath)) { rows.push({ vc, meta: null }); continue; }
  let meta;
  try {
    meta = JSON.parse(read(metaPath, 'meta.json'));
  } catch (err) {
    console.error(`meta.json を解釈できません: ${metaPath} (${err.message})`);
    process.exit(2);
  }
  rows.push({ vc, meta });
}
const found = rows.filter(r => r.meta);

// --- 実行の鮮度 ---
// 周回ごとに実行する運用で、その周の比較が meta.json を書けなかった場合に
// 前の周の結果を読んで誤報告しないよう、最古の実行開始時刻で判定する。
const times = found.map(r => new Date(r.meta.startedAt ?? NaN).getTime());
const oldest = found.length && times.every(t => !Number.isNaN(t)) ? Math.min(...times) : null;
const ageSec = oldest !== null ? (Date.now() - oldest) / 1000 : null;

const fmtAge = s => s < 60 ? `${Math.round(s)}秒`
  : s < 3600 ? `${Math.round(s / 60)}分`
  : `${(s / 3600).toFixed(1)}時間`;

if (maxAge !== null) {
  if (ageSec === null) {
    console.error(
      found.length
        ? `${resultsDir} に実行開始時刻(startedAt)の無い meta.json があります。鮮度を検証できないため中断します。`
        : `${resultsDir} に比較結果がありません。鮮度を検証できないため中断します。`
    );
    process.exit(2);
  }
  if (ageSec > maxAge) {
    console.error(`${resultsDir} の最も古い実行開始が ${fmtAge(ageSec)}前で、--max-age ${maxAge} 秒を超えています。`);
    console.error('前の周の結果を読んでいる可能性があります。今回のモック比較テストが結果を書けたか確認してください。');
    process.exit(2);
  }
}

const pct = r => typeof r === 'number' ? `${(r * 100).toFixed(2)}%` : '-';
console.log(
  `実行開始(最古): ${oldest !== null ? new Date(oldest).toISOString() : '不明'}` +
  (ageSec !== null ? ` (${fmtAge(ageSec)}前)` : '') +
  ` / ${resultsDir}`
);
console.log('');
console.log('| VC-ID | モック | 判定 | 差分率 | 許容差分率 | 備考 |');
console.log('|-------|-------|------|-------|-----------|------|');
for (const { vc, meta } of rows) {
  if (!meta) {
    console.log(`| ${vc} | - | 未実行 | - | - | |`);
    continue;
  }
  const notes = [
    meta.sizeMismatch ? 'サイズ不一致' : '',
    meta.fontsTimedOut ? 'フォント待ちタイムアウト' : '',
  ].filter(Boolean).join(' / ');
  console.log(`| ${vc} | ${meta.mockup ?? '-'} | ${meta.pass ? 'pass' : 'fail'} | ${pct(meta.diffRatio)} | ${pct(meta.maxDiffRatio)} | ${notes} |`);
}

const failed = found.filter(r => !r.meta.pass).map(r => r.vc);
const missing = rows.filter(r => !r.meta).map(r => r.vc);
console.log(`\n合計 ${rows.length} 件: pass ${found.length - failed.length} / fail ${failed.length} / 未実行 ${missing.length}`);
if (failed.length) {
  console.log(`\n✗ 差分超過: ${failed.join(', ')}(画像は ${resultsDir}/<VC-ID>/。.claude/skills/mockup-compare-review/SKILL.md でレビューする)`);
}
if (missing.length) {
  console.log(`\n⚠ 未実行: ${missing.join(', ')} に対応する比較結果がありません(@VC-NNN のテストが未実装/未実行)`);
}

// 失敗は欠落より重いので 3 を優先する(欠落の警告は上に出力済み)。
if (failed.length) process.exitCode = 3;
else if (missing.length) process.exitCode = 1;
