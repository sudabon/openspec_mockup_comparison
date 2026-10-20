#!/usr/bin/env bash
# openspec-e2e-mockup-kit セルフテスト。npm test から呼ばれる。
# (a)〜(n) は上流 openspec_e2e_test の selftest を本 kit 向けに読み替えたもの。(o) 以降は本 kit で追加。
# 破壊的操作はサンドボックス(/tmp 配下)に限定する。
set -uo pipefail

KIT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="${SANDBOX:-/tmp/mkit-sandbox}"
REPORT_WORK="/tmp/mkit-report-work"
SCHEMA="spec-driven-e2e-mockup"
STAMP=".openspec-e2e-mockup-kit.json"

pass_count=0
fail_count=0

ok()   { printf '  \033[32mPASS\033[0m %s\n' "$1"; pass_count=$((pass_count + 1)); }
ng()   { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail_count=$((fail_count + 1)); }
skip() { printf '  \033[33mSKIP\033[0m %s\n' "$1"; }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

assert_file() {
  if [ -f "$1" ]; then ok "$2"; else ng "$2 (missing: $1)"; fi
}
assert_grep() {
  # assert_grep <pattern> <file> <label>
  if grep -qF -- "$1" "$2" 2>/dev/null; then ok "$3"; else ng "$3 (pattern not found: $1)"; fi
}
assert_contains() {
  # assert_contains <pattern> <text> <label>
  if printf '%s' "$2" | grep -qF -- "$1"; then ok "$3"; else ng "$3 (missing: $1)"; fi
}

# ------------------------------------------------------------------ (a)
step "(a) サンドボックスに最小の openspec プロジェクトを用意する"
case "$SANDBOX" in
  /tmp/*|/private/tmp/*) ;;
  *) echo "SANDBOX は /tmp 配下でなければなりません: $SANDBOX" >&2; exit 1 ;;
esac
rm -rf "$SANDBOX" "$REPORT_WORK"
mkdir -p "$SANDBOX/openspec/specs" "$SANDBOX/openspec/changes/archive"
touch "$SANDBOX/openspec/specs/.gitkeep" "$SANDBOX/openspec/changes/archive/.gitkeep"
cat > "$SANDBOX/openspec/config.yaml" <<'EOF'
schema: spec-driven

# Project context (optional)
# Example:
#   context: |
#     Tech stack: TypeScript
EOF
git -C "$SANDBOX" init -q
ok "sandbox 作成: $SANDBOX (openspec/config.yaml は schema: spec-driven)"

# ------------------------------------------------------------------ (b)
step "(b) install を実行する"
install_out="$(node "$KIT_ROOT/install.mjs" install --target "$SANDBOX" 2>&1)"
install_rc=$?
printf '%s\n' "$install_out" | sed 's/^/    | /'
if [ "$install_rc" -eq 0 ]; then ok "install が exit 0 で終了"; else ng "install が exit $install_rc で終了"; fi

# ------------------------------------------------------------------ (c)
step "(c) 配置とマージを検証する"
assert_file "$SANDBOX/openspec/schemas/$SCHEMA/schema.yaml" "スキーマ schema.yaml が配置された"
assert_file "$SANDBOX/openspec/schemas/$SCHEMA/templates/test-plan.md" "テンプレート test-plan.md が配置された"
assert_file "$SANDBOX/openspec/schemas/$SCHEMA/templates/mockup-compare.md" "テンプレート mockup-compare.md が配置された"
assert_grep "E2Eテスト実装タスク" "$SANDBOX/openspec/schemas/$SCHEMA/templates/tasks.md" "tasks.md に E2E 実装タスク指示が入っている"
assert_grep "モック比較テスト実装タスク" "$SANDBOX/openspec/schemas/$SCHEMA/templates/tasks.md" "tasks.md にモック比較の実装タスク指示が入っている"
assert_grep "id: test-plan" "$SANDBOX/openspec/schemas/$SCHEMA/schema.yaml" "schema.yaml に test-plan アーティファクトがある"
assert_grep "id: mockup-compare" "$SANDBOX/openspec/schemas/$SCHEMA/schema.yaml" "schema.yaml に mockup-compare アーティファクトがある"
if [ -e "$SANDBOX/openspec/schemas/spec-driven-e2e" ]; then ng "上流スキーマ spec-driven-e2e まで配置された"; else ok "上流スキーマ spec-driven-e2e は配置しない"; fi
assert_file "$SANDBOX/.claude/skills/mockup-compare-review/SKILL.md" "レビュースキル mockup-compare-review が配置された"
assert_file "$SANDBOX/scripts/mockup-report.mjs" "scripts/mockup-report.mjs が配置された"
assert_file "$SANDBOX/tests/e2e/support/mockup-compare.ts" "tests/e2e/support/mockup-compare.ts が配置された"
assert_file "$SANDBOX/.claude/skills/e2e-conventions/SKILL.md" "スキル SKILL.md が配置された"
assert_file "$SANDBOX/scripts/e2e-report.mjs" "scripts/e2e-report.mjs が配置された"
assert_file "$SANDBOX/scripts/check-test-plan.sh" "scripts/check-test-plan.sh が配置された"
if [ -x "$SANDBOX/scripts/check-test-plan.sh" ]; then ok "check-test-plan.sh に実行権限がある"; else ng "check-test-plan.sh に実行権限がない"; fi
assert_file "$SANDBOX/tests/e2e/fixtures/README.md" "tests/e2e/fixtures/README.md が配置された"
assert_file "$SANDBOX/playwright.config.ts" "playwright.config.ts として設置された (.example が外れた)"
if [ -f "$SANDBOX/playwright.config.example.ts" ]; then
  ng "playwright.config.example.ts が残っている"
else
  ok "playwright.config.example.ts は設置されていない"
fi
assert_grep "# --- openspec-e2e-mockup-kit ---" "$SANDBOX/openspec/config.yaml" "config.yaml にマーカーブロックが追記された"
assert_grep "@VC-NNN" "$SANDBOX/openspec/config.yaml" "config.yaml にモック比較の規約行が入っている"
assert_grep ".claude/skills/e2e-conventions/SKILL.md" "$SANDBOX/openspec/config.yaml" "config.yaml に context 追記内容が入っている"
assert_grep "schema: $SCHEMA" "$SANDBOX/openspec/config.yaml" "openspec init 既定の schema: spec-driven を $SCHEMA へ切り替えた"
assert_contains "schema: spec-driven → $SCHEMA" "$install_out" "schema の切り替えを報告した"
assert_file "$SANDBOX/$STAMP" "$STAMP が書かれた"
if node -e "const j=require('$SANDBOX/$STAMP'); process.exit(j.version && j.installedAt && j.e2eRoot && j.mockupRoot ? 0 : 1)"; then
  ok "$STAMP に version・installedAt・e2eRoot・mockupRoot がある"
else
  ng "$STAMP の内容が不正"
fi
if [ -e "$SANDBOX/.openspec-e2e-kit.json" ]; then ng "e2e kit の記録ファイルを作った"; else ok "e2e kit の記録ファイル .openspec-e2e-kit.json は作らない"; fi
assert_contains "モックルート: mockup  (既定値(検出できず))" "$install_out" "モックが無いときは既定のモックルート mockup を使う"
assert_contains "npm i -D @playwright/test pngjs pixelmatch" "$install_out" "package.json が無いとき devDependencies の導入コマンドを案内する"

# ------------------------------------------------------------------ (d)
step "(d) 2回目の install が冪等であることを検証する"
before_hash="$(find "$SANDBOX" -type f -not -path '*/.git/*' -not -name "$STAMP" -exec shasum {} \; | sort | shasum)"
second_out="$(node "$KIT_ROOT/install.mjs" install --target "$SANDBOX" 2>&1)"
second_rc=$?
printf '%s\n' "$second_out" | sed 's/^/    | /'
after_hash="$(find "$SANDBOX" -type f -not -path '*/.git/*' -not -name "$STAMP" -exec shasum {} \; | sort | shasum)"
if [ "$second_rc" -eq 0 ]; then ok "2回目の install が exit 0"; else ng "2回目の install が exit $second_rc"; fi
if [ "$before_hash" = "$after_hash" ]; then
  ok "2回目の install でファイル内容が一切変化しない(冪等)"
else
  ng "2回目の install でファイルが変化した(冪等でない)"
fi
assert_contains "変更はありません" "$second_out" "2回目は「変更はありません」と報告する"

# ------------------------------------------------------------------ (e)
step "(e) sandbox 内でスキーマを validate する"
if command -v openspec >/dev/null 2>&1; then
  validate_out="$(cd "$SANDBOX" && openspec schema validate $SCHEMA 2>&1)"
  validate_rc=$?
  printf '%s\n' "$validate_out" | sed 's/^/    | /'
  if [ "$validate_rc" -eq 0 ]; then
    ok "openspec schema validate $SCHEMA が通る"
  else
    ng "openspec schema validate $SCHEMA が失敗 (exit $validate_rc)"
  fi
else
  skip "openspec CLI が無いため schema validate を省略"
fi

# ------------------------------------------------------------------ (f)
step "(f) e2e-report.mjs をフィクスチャで検証する"
mkdir -p "$REPORT_WORK/openspec/changes/demo-change"
cat > "$REPORT_WORK/openspec/changes/demo-change/test-plan.md" <<'EOF'
# Test Plan
| TP-ID | 対応シナリオ |
|-------|-------------|
| TP-001 | 注文できる |
| TP-002 | 在庫切れは注文できない |
| TP-003 | カート件数が増える |
| TP-004 | 未実装の観点(欠落検知用) |
EOF
report_out="$(cd "$REPORT_WORK" && node "$KIT_ROOT/payload/scripts/e2e-report.mjs" demo-change "$KIT_ROOT/test/fixtures/sample-results.json" 2>&1)"
report_rc=$?
printf '%s\n' "$report_out" | sed 's/^/    | /'
assert_contains "| TP-001 |" "$report_out" "TP-001 の行が出力される"
assert_contains "| pass |" "$report_out" "pass のテストが結果表に出る"
assert_contains "| fail |" "$report_out" "fail のテストが結果表に出る"
assert_contains "⚠ |" "$report_out" "フレークがマークされる"
assert_contains "TP-004" "$report_out" "欠落 TP-ID が警告に出る"
assert_contains "カバレッジ欠落" "$report_out" "カバレッジ欠落の警告文が出る"
if [ "$report_rc" -eq 3 ]; then ok "失敗テストがあるとき exit 3 ($report_rc)"; else ng "失敗テストがあるのに exit $report_rc (期待: 3)"; fi

# 終了コードの3系統を検証する。フィクスチャから失敗 spec を落としたものを派生させる。
node -e "
  const fs = require('fs');
  const r = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  const strip = s => ({
    ...s,
    specs: (s.specs ?? []).filter(sp => sp.ok),
    ...(s.suites ? { suites: s.suites.map(strip) } : {}),
  });
  r.suites = r.suites.map(strip);
  fs.writeFileSync(process.argv[2], JSON.stringify(r));
" "$KIT_ROOT/test/fixtures/sample-results.json" "$REPORT_WORK/pass-only.json"

# 全 pass + 欠落あり(TP-002/TP-004 が未実行) → 1
(cd "$REPORT_WORK" && node "$KIT_ROOT/payload/scripts/e2e-report.mjs" demo-change pass-only.json >/dev/null 2>&1)
rc_gap=$?
if [ "$rc_gap" -eq 1 ]; then ok "全 pass でカバレッジ欠落のみのとき exit 1"; else ng "カバレッジ欠落のみで exit $rc_gap (期待: 1)"; fi

# 全 pass + 欠落なし → 0
mkdir -p "$REPORT_WORK/openspec/changes/clean-change"
printf '| TP-001 | a |\n| TP-003 | c |\n' > "$REPORT_WORK/openspec/changes/clean-change/test-plan.md"
(cd "$REPORT_WORK" && node "$KIT_ROOT/payload/scripts/e2e-report.mjs" clean-change pass-only.json >/dev/null 2>&1)
rc_clean=$?
if [ "$rc_clean" -eq 0 ]; then ok "全 pass かつ欠落なしのとき exit 0"; else ng "問題なしなのに exit $rc_clean (期待: 0)"; fi

# 読めないファイル → 2
(cd "$REPORT_WORK" && node "$KIT_ROOT/payload/scripts/e2e-report.mjs" clean-change no-such-file.json >/dev/null 2>&1)
rc_err=$?
if [ "$rc_err" -eq 2 ]; then ok "results.json が読めないとき exit 2"; else ng "入力エラーで exit $rc_err (期待: 2)"; fi

# 鮮度検出: 周回ごとの実行で前の周の JSON を読んでしまう事故を防ぐ
assert_contains "実行開始:" "$report_out" "レポートに実行開始時刻が出力される"

# startTime を実行時に書き換えて、fresh / stale / stats なし の3系統を作る
node -e "
  const fs = require('fs');
  const base = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  const write = (name, mutate) => {
    const r = JSON.parse(JSON.stringify(base));
    mutate(r);
    fs.writeFileSync(process.argv[2] + '/' + name, JSON.stringify(r));
  };
  write('fresh.json', r => { r.stats.startTime = new Date().toISOString(); });
  write('stale.json', r => { r.stats.startTime = new Date(Date.now() - 3600e3).toISOString(); });
  write('nostats.json', r => { delete r.stats; });
" "$KIT_ROOT/test/fixtures/sample-results.json" "$REPORT_WORK"

(cd "$REPORT_WORK" && node "$KIT_ROOT/payload/scripts/e2e-report.mjs" demo-change fresh.json --max-age 300 >/dev/null 2>&1)
rc_fresh=$?
if [ "$rc_fresh" -eq 3 ]; then ok "--max-age 内なら鮮度チェックを通過し通常の終了コードになる ($rc_fresh)"; else ng "新鮮な JSON で exit $rc_fresh (期待: 3)"; fi

stale_out="$(cd "$REPORT_WORK" && node "$KIT_ROOT/payload/scripts/e2e-report.mjs" demo-change stale.json --max-age 300 2>&1)"
rc_stale=$?
if [ "$rc_stale" -eq 2 ]; then ok "--max-age を超えた古い JSON は exit 2 で中断する ($rc_stale)"; else ng "古い JSON で exit $rc_stale (期待: 2)"; fi
assert_contains "前の周の結果を読んでいる可能性" "$stale_out" "古い JSON のとき原因の説明が出る"
if printf '%s' "$stale_out" | grep -qF '| TP-'; then
  ng "古い JSON なのに結果表を出力した(誤報告の温床)"
else
  ok "古い JSON では結果表を出さずに中断する"
fi

(cd "$REPORT_WORK" && node "$KIT_ROOT/payload/scripts/e2e-report.mjs" demo-change nostats.json --max-age 300 >/dev/null 2>&1)
rc_nostats=$?
if [ "$rc_nostats" -eq 2 ]; then ok "実行時刻が無い JSON は検証不能として exit 2 (fail closed)"; else ng "stats 無しで exit $rc_nostats (期待: 2)"; fi

# --max-age 未指定なら鮮度で落とさない(既定の挙動は変えない)
(cd "$REPORT_WORK" && node "$KIT_ROOT/payload/scripts/e2e-report.mjs" demo-change stale.json >/dev/null 2>&1)
rc_noflag=$?
if [ "$rc_noflag" -eq 3 ]; then ok "--max-age 未指定なら古い JSON でも従来どおり動く ($rc_noflag)"; else ng "--max-age 未指定で exit $rc_noflag (期待: 3)"; fi

# 真の失敗(retries により results が2件ある)をフレーク扱いしないこと
flaky_marks="$(printf '%s' "$report_out" | grep -c '⚠ |')"
if [ "$flaky_marks" -eq 1 ]; then
  ok "フレークは1件だけ(失敗テストをフレーク扱いしない)"
else
  ng "フレークマークが $flaky_marks 件ある(期待: 1件)"
fi

# ------------------------------------------------------------------ dry-run
step "(g) --dry-run が書き込みゼロで動作一覧を出す"
dry_target="/tmp/mkit-dryrun-target"
rm -rf "$dry_target"
dry_out="$(node "$KIT_ROOT/install.mjs" --dry-run --target "$dry_target" 2>&1)"
dry_rc=$?
assert_contains "create  scripts/e2e-report.mjs" "$dry_out" "dry-run が作成予定を一覧表示する"
assert_contains "create  tests/e2e/support/mockup-compare.ts" "$dry_out" "dry-run が比較ヘルパーの作成予定を表示する"
assert_contains "モックルート: mockup" "$dry_out" "dry-run が判別したモックルートを表示する"
assert_contains "config  openspec/config.yaml を新規作成" "$dry_out" "dry-run が config の変更予定を表示する"
if [ ! -e "$dry_target" ]; then ok "dry-run で対象に一切書き込まない"; else ng "dry-run が $dry_target に書き込んだ"; fi
if [ "$dry_rc" -eq 0 ]; then ok "dry-run が exit 0"; else ng "dry-run が exit $dry_rc"; fi

# ------------------------------------------------------------------ (h)
step "(h) 既存ファイルがある対象での差分ハンドリング"
alt="/tmp/mkit-alt-target"
rm -rf "$alt"
mkdir -p "$alt/openspec"
git -C "$alt" init -q 2>/dev/null || mkdir -p "$alt/.git"
printf 'export default { testDir: "./e2e" };\n' > "$alt/playwright.config.ts"
node "$KIT_ROOT/install.mjs" install --target "$alt" >/dev/null 2>&1
assert_file "$alt/playwright.config.example.ts" "既存 playwright.config.ts があると .example.ts で配置される"
assert_grep 'testDir: "./e2e"' "$alt/playwright.config.ts" "既存 playwright.config.ts は上書きされない"

# payload と異なる内容へ書き換えて、diff 表示 + skip になることを確認
printf '# locally modified\n' >> "$alt/scripts/e2e-report.mjs"
diff_out="$(node "$KIT_ROOT/install.mjs" install --target "$alt" 2>&1)"
assert_contains "差分あり" "$diff_out" "差分のあるファイルで diff を表示する"
assert_contains "-# locally modified" "$diff_out" "unified diff に削除行が出る"
assert_contains "skip しました" "$diff_out" "skip したファイルを一覧表示する"
assert_grep "# locally modified" "$alt/scripts/e2e-report.mjs" "skip なので対象ファイルは変更されない"

force_out="$(node "$KIT_ROOT/install.mjs" update --target "$alt" --force 2>&1)"
assert_contains "更新" "$force_out" "update サブコマンドは「更新」と表示する"
if grep -qF "# locally modified" "$alt/scripts/e2e-report.mjs"; then
  ng "--force でも上書きされていない"
else
  ok "--force で差分ファイルを上書きする"
fi

# ------------------------------------------------------------------ (i)
step "(i) スキーマが実際の change フローで機能することを検証する"
# schema validate は構造しか見ないため、openspec 本体のアップグレードで
# アーティファクトのパイプラインや context の受け渡しが壊れても検出できない。
# config.yaml が無い対象へ導入し、実際に change を作って確認する。
if ! command -v openspec >/dev/null 2>&1; then
  skip "openspec CLI が無いため change フローの検証を省略"
else
  pipe="/tmp/mkit-pipeline-target"
  rm -rf "$pipe"
  mkdir -p "$pipe"
  git -C "$pipe" init -q
  node "$KIT_ROOT/install.mjs" install --target "$pipe" >/dev/null 2>&1

  # config.yaml が無い対象では新規作成され、schema が spec-driven-e2e-mockup になる
  assert_grep "schema: $SCHEMA" "$pipe/openspec/config.yaml" "config.yaml が無い対象では schema: $SCHEMA で新規作成される"

  new_out="$(cd "$pipe" && openspec new change demo-change 2>&1)"
  status_out="$(cd "$pipe" && openspec status --change demo-change 2>&1)"
  printf '%s\n' "$status_out" | sed 's/^/    | /'

  assert_contains "Schema: $SCHEMA" "$status_out" "config.yaml から $SCHEMA が自動検出される"
  assert_contains "[ ] proposal" "$status_out" "proposal が ready になる"
  assert_contains "mockup-compare (blocked by: specs)" "$status_out" "mockup-compare が specs に依存してパイプラインに現れる"
  assert_contains "test-plan (blocked by: specs, mockup-compare)" "$status_out" "test-plan が specs と mockup-compare に依存する"
  assert_contains "tasks (blocked by: specs, design, test-plan)" "$status_out" "tasks の依存に test-plan が入っている"

  instr_out="$(cd "$pipe" && openspec instructions test-plan --change demo-change 2>&1)"
  assert_contains "<project_context>" "$instr_out" "test-plan の instructions に project_context が含まれる"
  assert_contains ".claude/skills/e2e-conventions/SKILL.md" "$instr_out" "config.yaml の context 追記が instructions に届いている"
  assert_contains "TP-NNN" "$instr_out" "タグ規約が instructions に届いている"
  assert_contains "mockup-compare.md" "$instr_out" "test-plan の instruction に VC への参照が入っている"

  mc_out="$(cd "$pipe" && openspec instructions mockup-compare --change demo-change 2>&1)"
  assert_contains "<project_context>" "$mc_out" "mockup-compare の instructions に project_context が含まれる"
  assert_contains "モック比較: モックルートは mockup/" "$mc_out" "project_context にモックルートの規約行がある"
  assert_contains "@VC-NNN" "$mc_out" "project_context にモック比較タグの規約行がある"
  assert_contains ".claude/skills/mockup-compare-review/SKILL.md" "$mc_out" "project_context にレビュースキルの参照がある"
  for item in "VC-NNN" "source scenario" "mockup file" "state to compare" "viewport" "comparison scope" "mask / hide" "allowed diff ratio" "比較対象外" "比較対象なし" "Do NOT write selectors, URLs" "ダミーデータ"; do
    assert_contains "$item" "$mc_out" "mockup-compare の instruction に「${item}」が含まれる"
  done
  tasks_instr="$(cd "$pipe" && openspec instructions tasks --change demo-change 2>&1)"
  assert_contains "@VC-NNN" "$tasks_instr" "tasks の instruction に VC の 1:1 タスク規約がある"
fi

# ------------------------------------------------------------------ (j)
step "(j) E2E ルートを Playwright 設定から自動判別する"
# PostAll のような frontend/ 配下に Playwright がある構成では、payload の
# tests/e2e/ をそのまま配置すると毎回手作業の付け替えが必要になる。
mono="/tmp/mkit-monorepo"
rm -rf "$mono"
mkdir -p "$mono/openspec" "$mono/frontend/e2e"
git -C "$mono" init -q
cat > "$mono/frontend/playwright.config.ts" <<'EOF'
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
  retries: 1,
})
EOF

mono_out="$(node "$KIT_ROOT/install.mjs" install --target "$mono" 2>&1)"
mono_rc=$?
printf '%s\n' "$mono_out" | sed 's/^/    | /'
if [ "$mono_rc" -eq 0 ]; then ok "monorepo 構成で install が exit 0"; else ng "install が exit $mono_rc"; fi
assert_contains "E2E ルート: frontend/e2e" "$mono_out" "frontend/playwright.config.ts の testDir から frontend/e2e を検出する"

# 配置先が検出したルートに読み替わる
assert_file "$mono/frontend/e2e/fixtures/README.md" "fixtures README が frontend/e2e/ に配置される"
if [ -e "$mono/tests" ]; then ng "既定パス tests/ が作られてしまった"; else ok "既定パス tests/ は作られない"; fi

# 内容の E2E ルートも置換される
assert_grep "frontend/e2e/pages/" "$mono/.claude/skills/e2e-conventions/SKILL.md" "SKILL.md の POM パスが置換される"
assert_grep "frontend/e2e/fixtures/" "$mono/.claude/skills/e2e-conventions/SKILL.md" "SKILL.md の fixtures パスが置換される"
assert_grep "frontend/e2e/mocks/" "$mono/.claude/skills/e2e-conventions/SKILL.md" "SKILL.md の mocks パスが置換される"
assert_grep "frontend/e2e/" "$mono/scripts/check-test-plan.sh" "check-test-plan.sh の grep 対象が置換される"
assert_grep "frontend/e2e/fixtures/README.md" "$mono/openspec/schemas/$SCHEMA/schema.yaml" "schema.yaml の instruction のパスが置換される"
assert_grep "frontend/e2e/support/mockup-compare.ts" "$mono/openspec/schemas/$SCHEMA/schema.yaml" "schema.yaml の比較ヘルパーのパスが置換される"
assert_file "$mono/frontend/e2e/support/mockup-compare.ts" "比較ヘルパーが frontend/e2e/support/ に配置される"
assert_grep "frontend/e2e/support/mockup-compare.ts" "$mono/openspec/config.yaml" "config の context 行の E2E ルートが置換される"
if grep -q 'tests/e2e' "$mono/.claude/skills/e2e-conventions/SKILL.md" "$mono/scripts/check-test-plan.sh"; then
  ng "置換漏れの tests/e2e が残っている"
else
  ok "置換対象ファイルに tests/e2e が残っていない"
fi

# 既存の Playwright 設定がルート以外にある場合、ルートに2つ目を作らない
if [ -f "$mono/playwright.config.ts" ]; then
  ng "ルートに2つ目の playwright.config.ts が作られた"
else
  ok "ルートに2つ目の playwright.config.ts を作らない"
fi
assert_file "$mono/playwright.config.example.ts" "参考用に playwright.config.example.ts を配置する"
assert_grep "frontend/e2e" "$mono/playwright.config.example.ts" "example の testDir も置換される"

# スタンプに e2eRoot が記録される
if node -e "const j=require('$mono/$STAMP'); process.exit(j.e2eRoot === 'frontend/e2e' ? 0 : 1)"; then
  ok "$STAMP に e2eRoot が記録される"
else
  ng "$STAMP の e2eRoot が不正"
fi

# 冪等性: 置換後の内容と比較していないと2回目で毎回 diff が出る
mono_before="$(find "$mono" -type f -not -path '*/.git/*' -not -name "$STAMP" -exec shasum {} \; | sort | shasum)"
mono_second="$(node "$KIT_ROOT/install.mjs" install --target "$mono" 2>&1)"
mono_after="$(find "$mono" -type f -not -path '*/.git/*' -not -name "$STAMP" -exec shasum {} \; | sort | shasum)"
if [ "$mono_before" = "$mono_after" ]; then
  ok "置換込みでも2回目の install が無変更(冪等)"
else
  ng "2回目の install でファイルが変化した(置換後の内容と比較していない)"
fi
assert_contains "変更はありません" "$mono_second" "2回目は「変更はありません」と報告する"

# ------------------------------------------------------------------ (k)
step "(k) E2E ルートの明示指定と複数設定の扱い"
expl="/tmp/mkit-explicit"
rm -rf "$expl"
mkdir -p "$expl/openspec"
git -C "$expl" init -q
expl_out="$(node "$KIT_ROOT/install.mjs" install --target "$expl" --e2e-root playwright/specs 2>&1)"
assert_contains "E2E ルート: playwright/specs" "$expl_out" "--e2e-root の指定が優先される"
assert_file "$expl/playwright/specs/fixtures/README.md" "指定したルートに配置される"
assert_grep "playwright/specs/pages/" "$expl/.claude/skills/e2e-conventions/SKILL.md" "指定したルートで内容が置換される"

# target の外を指す指定は拒否する
node "$KIT_ROOT/install.mjs" install --target "$expl" --e2e-root ../outside >/dev/null 2>&1
rc_escape=$?
if [ "$rc_escape" -eq 2 ]; then ok "'..' を含む --e2e-root を引数エラーで拒否する"; else ng "'..' 指定で exit $rc_escape (期待: 2)"; fi
node "$KIT_ROOT/install.mjs" install --target "$expl" --e2e-root /abs/path >/dev/null 2>&1
rc_abs=$?
if [ "$rc_abs" -eq 2 ]; then ok "絶対パスの --e2e-root を引数エラーで拒否する"; else ng "絶対パス指定で exit $rc_abs (期待: 2)"; fi

# 複数の Playwright 設定: 最も浅いものを採用し、対象外を警告表示する
multi="/tmp/mkit-multi"
rm -rf "$multi"
mkdir -p "$multi/openspec" "$multi/packages/web" "$multi/packages/admin"
git -C "$multi" init -q
printf "export default { testDir: './e2e' }\n" > "$multi/packages/web/playwright.config.ts"
printf "export default { testDir: './e2e' }\n" > "$multi/packages/admin/playwright.config.ts"
multi_out="$(node "$KIT_ROOT/install.mjs" install --target "$multi" 2>&1)"
assert_contains "Playwright 設定が 2 件" "$multi_out" "複数設定を検出したことを報告する"
assert_contains "採用: packages/admin/playwright.config.ts" "$multi_out" "最も浅い(同深さなら名前順)設定を採用する"
assert_contains "対象外: packages/web/playwright.config.ts" "$multi_out" "対象外にした設定を列挙する"
assert_contains "--e2e-root" "$multi_out" "指定で上書きできることを案内する"
assert_file "$multi/packages/admin/e2e/fixtures/README.md" "採用した設定のルートに配置される"

# ------------------------------------------------------------------ (l)
step "(l) 旧形式のマーカーブロック(context: | ごと囲む形)を移行する"
legacy="/tmp/mkit-legacy-sandbox"
rm -rf "$legacy"; mkdir -p "$legacy/openspec/specs"; git -C "$legacy" init -q
cat > "$legacy/openspec/config.yaml" <<'EOF'
schema: spec-driven-e2e

# --- openspec-e2e-kit ---
context: |
  E2Eテスト: Playwright。実装規約は .claude/skills/e2e-conventions/SKILL.md に従う。
  テストには必ず @<change-id> と @TP-NNN タグを付ける。
  Language: Japanese
# --- /openspec-e2e-kit ---
EOF
legacy_out="$(node "$KIT_ROOT/install.mjs" update --target "$legacy" 2>&1)"
assert_contains "旧形式のマーカーブロックを context の内側へ移行" "$legacy_out" "旧形式を検出して移行を報告する"
if grep -q '^context: |' "$legacy/openspec/config.yaml" && grep -q '^  # --- openspec-e2e-mockup-kit ---' "$legacy/openspec/config.yaml"; then
  ok "context: | がトップレベル、マーカーが context の内側になる"
else
  ng "移行後の形が不正"; sed 's/^/    | /' "$legacy/openspec/config.yaml"
fi
assert_grep "  Language: Japanese" "$legacy/openspec/config.yaml" "マーカー内にあった kit 以外の行(Language)を保持する"
if [ "$(grep -c 'E2Eテスト: Playwright' "$legacy/openspec/config.yaml")" = "1" ]; then ok "kit の行が重複しない"; else ng "kit の行が重複した"; fi
printf '  他ツールが追記した行\n' >> "$legacy/openspec/config.yaml"
legacy_hash="$(shasum "$legacy/openspec/config.yaml")"
node "$KIT_ROOT/install.mjs" update --target "$legacy" >/dev/null 2>&1
if [ "$legacy_hash" = "$(shasum "$legacy/openspec/config.yaml")" ]; then
  ok "移行後の update は冪等で、マーカー外に追記された行を消さない"
else
  ng "移行後の update で config.yaml が変化した"; sed 's/^/    | /' "$legacy/openspec/config.yaml"
fi
if command -v openspec >/dev/null 2>&1; then
  (cd "$legacy" && openspec new change legacy-check >/dev/null 2>&1)
  legacy_instr="$(cd "$legacy" && openspec instructions test-plan --change legacy-check 2>&1)"
  assert_contains "Language: Japanese" "$legacy_instr" "移行後の context が YAML として読める(Language が届く)"
  assert_contains "他ツールが追記した行" "$legacy_instr" "マーカー外の追記行も context として届く"
  assert_contains ".claude/skills/e2e-conventions/SKILL.md" "$legacy_instr" "kit の context 行も届く"
else
  skip "openspec CLI が無いため移行後の instructions 検証を省略"
fi

# ------------------------------------------------------------------ (m)
step "(m) openspec init より前に --language 付きで導入する"
preinit="/tmp/mkit-preinit-sandbox"
rm -rf "$preinit"; mkdir -p "$preinit"; git -C "$preinit" init -q
preinit_out="$(node "$KIT_ROOT/install.mjs" --target "$preinit" --language Japanese 2>&1)"
assert_grep "  Language: Japanese" "$preinit/openspec/config.yaml" "--language の context を書き込む"
assert_contains "openspec init --tools" "$preinit_out" "未初期化を検出し、--language なしの init を案内する"
if command -v openspec >/dev/null 2>&1; then
  if (cd "$preinit" && openspec init --tools claude --no-animation . >/dev/null 2>&1); then
    ok "導入後の openspec init(--language なし)が成功する"
  else
    ng "導入後の openspec init が失敗した"
  fi
  assert_grep "schema: $SCHEMA" "$preinit/openspec/config.yaml" "init 後も schema が保持される"
  assert_grep "  Language: Japanese" "$preinit/openspec/config.yaml" "init 後も Language が保持される"
  (cd "$preinit" && openspec new change pre-check >/dev/null 2>&1)
  pre_instr="$(cd "$preinit" && openspec instructions test-plan --change pre-check 2>&1)"
  assert_contains "Language: Japanese" "$pre_instr" "Language が instructions に届く"
  assert_contains ".claude/skills/e2e-conventions/SKILL.md" "$pre_instr" "kit の context も instructions に届く"
  post_lang_out="$(node "$KIT_ROOT/install.mjs" update --target "$preinit" 2>&1)"
  assert_contains "変更はありません" "$post_lang_out" "init 後の update は変更なし"
else
  skip "openspec CLI が無いため init 連携の検証を省略"
fi
lang_warn_out="$(node "$KIT_ROOT/install.mjs" update --target "$SANDBOX" --language Japanese 2>&1)"
assert_contains "--language は反映しません" "$lang_warn_out" "既存 config.yaml に --language を指定すると警告のみ"

# ------------------------------------------------------------------ (n)
step "(n) no-op の update でスタンプを書き換えない"
stamp_before="$(shasum "$SANDBOX/$STAMP")"
sleep 1
node "$KIT_ROOT/install.mjs" update --target "$SANDBOX" >/dev/null 2>&1
if [ "$stamp_before" = "$(shasum "$SANDBOX/$STAMP")" ]; then
  ok "$STAMP が変化しない(git 差分を作らない)"
else
  ng "$STAMP が書き換わった"
fi

# ------------------------------------------------------------------ (o)
step "(o) モックルートを自動判別し、配布ファイルと config に反映する"
deep="/tmp/mkit-deep-mockup"
rm -rf "$deep"; mkdir -p "$deep/openspec" "$deep/requirements/mockup/user"; git -C "$deep" init -q
printf '<!doctype html><title>mock</title>\n' > "$deep/requirements/mockup/index.html"
deep_out="$(node "$KIT_ROOT/install.mjs" install --target "$deep" 2>&1)"
printf '%s\n' "$deep_out" | sed 's/^/    | /'
assert_contains "モックルート: requirements/mockup  (HTML を含む requirements/mockup)" "$deep_out" "深い位置の requirements/mockup を判別して表示する"
assert_grep "requirements/mockup/" "$deep/openspec/schemas/$SCHEMA/schema.yaml" "schema.yaml の instruction にモックルートが反映される"
assert_grep "requirements/mockup/" "$deep/openspec/schemas/$SCHEMA/templates/mockup-compare.md" "mockup-compare テンプレートにモックルートが反映される"
assert_grep "requirements/mockup/" "$deep/.claude/skills/mockup-compare-review/SKILL.md" "レビュースキルにモックルートが反映される"
assert_grep "export const MOCKUP_ROOT = 'requirements/mockup/';" "$deep/tests/e2e/support/mockup-compare.ts" "比較ヘルパーの MOCKUP_ROOT が反映される"
assert_grep "モック比較: モックルートは requirements/mockup/" "$deep/openspec/config.yaml" "config の context 行にモックルートが反映される"
if grep -nE '(^|[^-./[:alnum:]_])mockup/' "$deep/openspec/schemas/$SCHEMA/schema.yaml" "$deep/openspec/schemas/$SCHEMA/templates/mockup-compare.md" \
     "$deep/.claude/skills/mockup-compare-review/SKILL.md" "$deep/tests/e2e/support/mockup-compare.ts" | grep -v 'requirements/mockup/'; then
  ng "置換漏れの mockup/ が残っている"
else
  ok "置換対象ファイルに既定の mockup/ が残っていない"
fi
assert_grep "mockup-compare-review/SKILL.md" "$deep/openspec/schemas/$SCHEMA/schema.yaml" "置換が mockup-compare-review などの名前を壊さない"
if node -e "const j=require('$deep/$STAMP'); process.exit(j.mockupRoot === 'requirements/mockup' ? 0 : 1)"; then
  ok "$STAMP に mockupRoot が記録される"
else
  ng "$STAMP の mockupRoot が不正"
fi
deep_before="$(find "$deep" -type f -not -path '*/.git/*' -not -name "$STAMP" -exec shasum {} \; | sort | shasum)"
deep_second="$(node "$KIT_ROOT/install.mjs" install --target "$deep" 2>&1)"
deep_after="$(find "$deep" -type f -not -path '*/.git/*' -not -name "$STAMP" -exec shasum {} \; | sort | shasum)"
if [ "$deep_before" = "$deep_after" ]; then ok "モックルート置換込みでも 2 回目の install が無変更(冪等)"; else ng "2 回目の install でファイルが変化した"; fi
assert_contains "モックルート: requirements/mockup  ($STAMP の記録)" "$deep_second" "2 回目は記録値のモックルートを使う"

# 候補が複数: 最も浅い mockup を採用し、対象外を表示する。HTML の無い候補は数えない
mmulti="/tmp/mkit-multi-mockup"
rm -rf "$mmulti"; mkdir -p "$mmulti/openspec" "$mmulti/mockup" "$mmulti/docs/mockups/sub" "$mmulti/design/mock"; git -C "$mmulti" init -q
printf '<p>a</p>\n' > "$mmulti/mockup/a.html"
printf '<p>b</p>\n' > "$mmulti/docs/mockups/sub/b.html"
printf 'no html\n' > "$mmulti/design/mock/readme.txt"
mmulti_out="$(node "$KIT_ROOT/install.mjs" install --target "$mmulti" 2>&1)"
assert_contains "モックルート: mockup  (HTML を含む mockup)" "$mmulti_out" "複数候補のうち最も浅い mockup を採用する"
assert_contains "モックの候補が 2 件" "$mmulti_out" "HTML を含む候補だけを数えて報告する"
assert_contains "対象外: docs/mockups" "$mmulti_out" "対象外にした候補を表示する"
assert_contains "--mockup-root" "$mmulti_out" "指定で上書きできることを案内する"

# 明示指定で前回と異なるルートにすると、削除せず警告する
mchg_out="$(node "$KIT_ROOT/install.mjs" update --target "$mmulti" --mockup-root docs/mockups 2>&1)"
assert_contains "モックルート: docs/mockups  (--mockup-root の指定)" "$mchg_out" "--mockup-root の指定が記録値より優先される"
assert_contains "前回のモックルートは 'mockup' でした" "$mchg_out" "ルート変更時に警告する"
if [ -f "$mmulti/mockup/a.html" ]; then ok "ルート変更でも古いモックは削除しない"; else ng "古いモックが削除された"; fi
assert_contains "差分あり" "$mchg_out" "ルート変更で内容が変わる配布ファイルは差分として表示する"
node "$KIT_ROOT/install.mjs" install --target "$mmulti" --mockup-root ../outside >/dev/null 2>&1
rc_mescape=$?
if [ "$rc_mescape" -eq 2 ]; then ok "'..' を含む --mockup-root を引数エラーで拒否する"; else ng "'..' 指定で exit $rc_mescape (期待: 2)"; fi

# ------------------------------------------------------------------ (p)
step "(p) e2e kit (openspec_e2e_test) 導入済みのリポジトリから移行する"
# e2e kit を導入した状態を再現する。e2e 由来で内容が同じファイルは本 kit の payload から、
# 内容が違うもの(スキーマ・check-test-plan.sh)は test/upstream/ の上流スナップショットから置く。
mig="/tmp/mkit-migrate"
rm -rf "$mig"; mkdir -p "$mig/openspec/specs" "$mig/openspec/schemas" "$mig/scripts" "$mig/.claude/skills" "$mig/tests/e2e/fixtures"; git -C "$mig" init -q
cp -R "$KIT_ROOT/test/upstream/spec-driven-e2e" "$mig/openspec/schemas/"
cp -R "$KIT_ROOT/payload/.claude/skills/e2e-conventions" "$mig/.claude/skills/"
cp "$KIT_ROOT/payload/scripts/e2e-report.mjs" "$mig/scripts/"
cp "$KIT_ROOT/test/upstream/scripts/check-test-plan.sh" "$mig/scripts/"
cp "$KIT_ROOT/payload/tests/e2e/fixtures/README.md" "$mig/tests/e2e/fixtures/"
cp "$KIT_ROOT/payload/playwright.config.example.ts" "$mig/playwright.config.ts"
printf '{\n  "version": "0.2.0",\n  "installedAt": "2026-09-01T00:00:00.000Z",\n  "e2eRoot": "tests/e2e"\n}\n' > "$mig/.openspec-e2e-kit.json"
printf '{ "name": "app", "devDependencies": { "@playwright/test": "^1.55.0" } }\n' > "$mig/package.json"
cat > "$mig/openspec/config.yaml" <<'EOF'
schema: spec-driven-e2e

context: |
  Language: Japanese
  # --- openspec-e2e-kit ---
  E2Eテスト: Playwright。実装規約は .claude/skills/e2e-conventions/SKILL.md に従う。
  テストには必ず @<change-id> と @TP-NNN タグを付ける。
  # --- /openspec-e2e-kit ---
  他ツールが追記した行

rules:
  proposal:
    - 利用者のルール
EOF
pkg_before="$(shasum "$mig/package.json")"
mig_out="$(node "$KIT_ROOT/install.mjs" install --target "$mig" 2>&1)"
mig_rc=$?
printf '%s\n' "$mig_out" | sed 's/^/    | /'
if [ "$mig_rc" -eq 0 ]; then ok "移行の install が exit 0"; else ng "移行の install が exit $mig_rc"; fi
assert_contains "移行として扱います" "$mig_out" ".openspec-e2e-kit.json を検出して移行として扱う"
assert_contains "以後は openspec_e2e_test の update を実行しないこと" "$mig_out" "e2e kit の update を実行しないよう案内する"
assert_contains "E2E ルート: tests/e2e  (.openspec-e2e-kit.json の記録)" "$mig_out" "e2e kit の記録の E2E ルートを引き継ぐ"
assert_contains "schema: spec-driven-e2e → $SCHEMA" "$mig_out" "schema: spec-driven-e2e を切り替えたことを報告する"
assert_grep "schema: $SCHEMA" "$mig/openspec/config.yaml" "schema が $SCHEMA になる"
assert_contains "openspec-e2e-kit のマーカーブロックを openspec-e2e-mockup-kit のマーカーブロックへ置き換え" "$mig_out" "マーカーブロックの置き換えを報告する"
if grep -qF "# --- openspec-e2e-kit ---" "$mig/openspec/config.yaml"; then ng "e2e kit のマーカーが残っている"; else ok "e2e kit のマーカーは残らない"; fi
assert_grep "  # --- openspec-e2e-mockup-kit ---" "$mig/openspec/config.yaml" "本 kit のマーカーが context の内側に入る"
assert_grep "  Language: Japanese" "$mig/openspec/config.yaml" "マーカー外の行(Language)を保持する"
assert_grep "  他ツールが追記した行" "$mig/openspec/config.yaml" "マーカー外の行(他ツール)を保持する"
assert_grep "    - 利用者のルール" "$mig/openspec/config.yaml" "context 以外のキーを保持する"
if [ "$(grep -c 'E2Eテスト: Playwright' "$mig/openspec/config.yaml")" = "1" ]; then ok "e2e の context 行が重複しない"; else ng "e2e の context 行が重複した"; fi
for f in .claude/skills/e2e-conventions/SKILL.md scripts/e2e-report.mjs tests/e2e/fixtures/README.md; do
  if printf '%s' "$mig_out" | grep -qF -- "$f"; then ng "内容が同じ $f が報告された(スキップされていない)"; else ok "内容が同じ $f は黙ってスキップする"; fi
done
if [ -f "$mig/playwright.config.example.ts" ]; then ng "e2e kit が置いた playwright.config.ts の横に .example を作った"; else ok "e2e kit が置いた playwright.config.ts はそのまま使う"; fi
assert_contains "差分あり(上書きしません): scripts/check-test-plan.sh" "$mig_out" "e2e kit 版の check-test-plan.sh は差分として表示し上書きしない"
assert_file "$mig/openspec/schemas/spec-driven-e2e/schema.yaml" "移行前のスキーマは削除しない(進行中の change 用)"
assert_file "$mig/.openspec-e2e-kit.json" ".openspec-e2e-kit.json は削除しない"
assert_file "$mig/$STAMP" "$STAMP が作られる"
if [ "$pkg_before" = "$(shasum "$mig/package.json")" ]; then ok "package.json は書き換えない"; else ng "package.json が書き換わった"; fi
assert_contains "npm i -D pngjs pixelmatch" "$mig_out" "不足している devDependencies(pngjs, pixelmatch)だけを案内する"
mig_hash="$(shasum "$mig/openspec/config.yaml")"
node "$KIT_ROOT/install.mjs" update --target "$mig" >/dev/null 2>&1
if [ "$mig_hash" = "$(shasum "$mig/openspec/config.yaml")" ]; then ok "移行後の update で config.yaml が変化しない"; else ng "移行後の update で config.yaml が変化した"; fi
if command -v openspec >/dev/null 2>&1; then
  (cd "$mig" && openspec new change mig-check >/dev/null 2>&1)
  mig_instr="$(cd "$mig" && openspec instructions mockup-compare --change mig-check 2>&1)"
  assert_contains "Language: Japanese" "$mig_instr" "移行後の context が YAML として読める(Language が届く)"
  assert_contains "@VC-NNN" "$mig_instr" "移行後の context にモック比較の規約行が届く"
else
  skip "openspec CLI が無いため移行後の instructions 検証を省略"
fi

# 別スキーマが設定済みなら変更しない
other="/tmp/mkit-other-schema"
rm -rf "$other"; mkdir -p "$other/openspec"; git -C "$other" init -q
printf 'schema: quality-driven\n' > "$other/openspec/config.yaml"
other_out="$(node "$KIT_ROOT/install.mjs" install --target "$other" 2>&1)"
assert_grep "schema: quality-driven" "$other/openspec/config.yaml" "別スキーマ(quality-driven)は変更しない"
assert_contains "--schema $SCHEMA" "$other_out" "change 単位の --schema 指定を案内する"

# ------------------------------------------------------------------ (q)
step "(q) 上流スキーマ (spec-driven-e2e) との差分が想定範囲内である"
UP="$KIT_ROOT/test/upstream/spec-driven-e2e"
OURS="$KIT_ROOT/payload/openspec/schemas/$SCHEMA"
removed="$(diff "$UP/schema.yaml" "$OURS/schema.yaml" | grep '^< ' || true)"
expected_removed="$(printf '%s\n' '< name: spec-driven-e2e' '< description: Spec-driven workflow with E2E test planning - proposal → specs → design → test-plan → tasks')"
if [ "$removed" = "$expected_removed" ]; then
  ok "schema.yaml で上流から変えた行は name と description だけ(他は追記のみ)"
else
  ng "schema.yaml で上流の行が変更・削除されている"; printf '%s\n' "$removed" | sed 's/^/    | /'
fi
for t in proposal spec design test-plan tasks; do
  if diff "$UP/templates/$t.md" "$OURS/templates/$t.md" | grep -q '^< '; then
    ng "templates/$t.md で上流の行が変更・削除されている"
  else
    ok "templates/$t.md は上流への追記だけ"
  fi
done
if node -e "
  const fs = require('fs');
  const y = fs.readFileSync(process.argv[1], 'utf8');
  const block = id => y.split(/\n  - id: /).find(b => b.startsWith(id + '\n'));
  const req = id => (block(id).match(/\n    requires:\n((?:      - .*\n?)+)/) || [, ''])[1].trim().split(/\s*- /).filter(Boolean);
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const ok = eq(req('mockup-compare'), ['specs']) && eq(req('test-plan'), ['specs', 'mockup-compare'])
    && eq(req('tasks'), ['specs', 'design', 'test-plan']) && eq(req('design'), ['proposal']) && eq(req('specs'), ['proposal']);
  process.exit(ok ? 0 : 1);
" "$OURS/schema.yaml"; then
  ok "依存順序: mockup-compare←specs、test-plan←specs+mockup-compare、tasks←specs+design+test-plan"
else
  ng "schema.yaml の requires が想定と異なる"
fi
for f in .claude/skills/e2e-conventions/SKILL.md scripts/e2e-report.mjs tests/e2e/fixtures/README.md playwright.config.example.ts; do
  if [ -f "$KIT_ROOT/payload/$f" ]; then ok "e2e 由来の $f を内包している"; else ng "e2e 由来の $f が無い"; fi
done
if diff -q "$KIT_ROOT/test/upstream/scripts/check-test-plan.sh" "$KIT_ROOT/payload/scripts/check-test-plan.sh" >/dev/null; then
  ng "check-test-plan.sh に VC の検証が追記されていない"
else
  ok "check-test-plan.sh は上流から拡張されている"
fi

# ------------------------------------------------------------------ (r)
step "(r) mockup-report.mjs の終了コードと鮮度判定"
MR="$KIT_ROOT/payload/scripts/mockup-report.mjs"
mr="$REPORT_WORK/mockup"
mkdir -p "$mr/openspec/changes/vc-change" "$mr/openspec/changes/none-change"
cat > "$mr/openspec/changes/vc-change/mockup-compare.md" <<'EOF'
# Mockup Compare
## 作成ルール
- VC-NNN 形式の ID を 001 から連番で振る(本文中の VC-009 は数えない)
## 比較観点一覧
| VC-ID | 対応シナリオ | モックファイル | 比較状態 | ビューポート | 比較範囲 | マスク・非表示(理由) | 許容差分率 |
|-------|-------------|---------------|---------|-------------|---------|---------------------|-----------|
| VC-001 | 一覧 | user/list.html | 初期表示 | 1440x900 | ページ全体 | なし | 1% |
| VC-002 | 詳細 | user/detail.html | ドロワー | 1440x900 | ページ全体 | なし | 1% |
EOF
printf '# Mockup Compare\n\n## 比較対象なし\n画面表示に関わるシナリオが無いため。\n' > "$mr/openspec/changes/none-change/mockup-compare.md"
write_meta() { # write_meta <dir> <vc> <pass> <ratio> <startedAt|->
  mkdir -p "$1/$2"
  node -e "
    const [dir, vc, pass, ratio, started] = process.argv.slice(1);
    const m = { vc, changeId: 'vc-change', mockup: 'user/x.html', appUrl: 'http://x', viewport: { width: 1440, height: 900 },
      diffRatio: Number(ratio), maxDiffRatio: 0.01, pass: pass === 'true', sizeMismatch: false, fontsTimedOut: false };
    if (started !== '-') m.startedAt = started;
    require('fs').writeFileSync(dir + '/' + vc + '/meta.json', JSON.stringify(m));
  " "$1" "$2" "$3" "$4" "$5"
}
now_iso="$(node -e 'console.log(new Date().toISOString())')"
old_iso="$(node -e 'console.log(new Date(Date.now() - 900e3).toISOString())')"
R="$mr/mockup-compare-results/vc-change"
write_meta "$R" VC-001 false 0.032 "$now_iso"
mixed_out="$(cd "$mr" && node "$MR" vc-change 2>&1)"; rc_mixed=$?
printf '%s\n' "$mixed_out" | sed 's/^/    | /'
if [ "$rc_mixed" -eq 3 ]; then ok "失敗と未実行が混在するとき exit 3"; else ng "失敗+未実行で exit $rc_mixed (期待: 3)"; fi
assert_contains "| VC-001 | user/x.html | fail | 3.20% | 1.00% |" "$mixed_out" "VC ごとの判定・差分率・許容差分率の表を出す"
assert_contains "未実行: VC-002" "$mixed_out" "未実行の VC を警告する"
if printf '%s' "$mixed_out" | grep -qF 'VC-009'; then ng "本文中の VC-009 を観点として数えた"; else ok "観点表の行だけから VC-ID を抽出する"; fi
assert_contains "実行開始(最古):" "$mixed_out" "実行開始時刻を出力する"

write_meta "$R" VC-001 true 0.004 "$now_iso"
(cd "$mr" && node "$MR" vc-change >/dev/null 2>&1); rc_gap=$?
if [ "$rc_gap" -eq 1 ]; then ok "全 pass で未実行の VC があるとき exit 1"; else ng "未実行のみで exit $rc_gap (期待: 1)"; fi
write_meta "$R" VC-002 true 0 "$now_iso"
(cd "$mr" && node "$MR" vc-change >/dev/null 2>&1); rc_clean=$?
if [ "$rc_clean" -eq 0 ]; then ok "失敗も欠落も無いとき exit 0"; else ng "問題なしで exit $rc_clean (期待: 0)"; fi
(cd "$mr" && node "$MR" no-such-change >/dev/null 2>&1); rc_noplan=$?
if [ "$rc_noplan" -eq 2 ]; then ok "mockup-compare.md が読めないとき exit 2"; else ng "入力エラーで exit $rc_noplan (期待: 2)"; fi
(cd "$mr" && node "$MR" >/dev/null 2>&1); rc_noarg=$?
if [ "$rc_noarg" -eq 2 ]; then ok "change-id が無いとき exit 2"; else ng "引数なしで exit $rc_noarg (期待: 2)"; fi
none_out="$(cd "$mr" && node "$MR" none-change 2>&1)"; rc_none=$?
if [ "$rc_none" -eq 0 ]; then ok "比較対象なしの change は exit 0"; else ng "比較対象なしで exit $rc_none (期待: 0)"; fi
assert_contains "比較対象なし" "$none_out" "比較対象なしであることを表示する"

(cd "$mr" && node "$MR" vc-change --max-age 600 >/dev/null 2>&1); rc_fresh=$?
if [ "$rc_fresh" -eq 0 ]; then ok "--max-age 内の結果は通常の終了コードになる"; else ng "新しい結果で exit $rc_fresh (期待: 0)"; fi
write_meta "$R" VC-002 true 0 "$old_iso"
stale_out="$(cd "$mr" && node "$MR" vc-change --max-age 600 2>&1)"; rc_stale=$?
if [ "$rc_stale" -eq 2 ]; then ok "900 秒前の結果に --max-age 600 で exit 2"; else ng "古い結果で exit $rc_stale (期待: 2)"; fi
if printf '%s' "$stale_out" | grep -qF '| VC-'; then ng "古い結果なのに結果表を出力した"; else ok "古い結果では結果表を出さずに中断する"; fi
assert_contains "前の周の結果を読んでいる可能性" "$stale_out" "古い結果のとき原因の説明が出る"
(cd "$mr" && node "$MR" vc-change >/dev/null 2>&1); rc_noflag=$?
if [ "$rc_noflag" -eq 0 ]; then ok "--max-age 未指定なら古い結果でも鮮度で落とさない"; else ng "--max-age 未指定で exit $rc_noflag (期待: 0)"; fi
write_meta "$R" VC-002 true 0 -
(cd "$mr" && node "$MR" vc-change --max-age 600 >/dev/null 2>&1); rc_nostart=$?
if [ "$rc_nostart" -eq 2 ]; then ok "startedAt の無い結果は検証不能として exit 2 (fail closed)"; else ng "startedAt 無しで exit $rc_nostart (期待: 2)"; fi
rm -rf "$R"
(cd "$mr" && node "$MR" vc-change --max-age 600 >/dev/null 2>&1); rc_empty=$?
if [ "$rc_empty" -eq 2 ]; then ok "結果が 1 件も無いときの --max-age は exit 2 (fail closed)"; else ng "結果なしで exit $rc_empty (期待: 2)"; fi

# ------------------------------------------------------------------ (s)
step "(s) check-test-plan.sh が mockup-compare.md と @VC-NNN を検証する"
gate="/tmp/mkit-gate"
rm -rf "$gate"; mkdir -p "$gate"; git -C "$gate" init -q -b main
node "$KIT_ROOT/install.mjs" install --target "$gate" >/dev/null 2>&1
git -C "$gate" add -A && git -C "$gate" -c user.name=t -c user.email=t@example.com commit -qm base
git -C "$gate" checkout -qb feature
gate_commit() { git -C "$gate" add -A && git -C "$gate" -c user.name=t -c user.email=t@example.com commit -qm "$1"; }
gate_run() { (cd "$gate" && bash scripts/check-test-plan.sh main 2>&1); }

nodiff_out="$(gate_run)"; rc_nodiff=$?
if [ "$rc_nodiff" -eq 0 ]; then ok "change の差分が無いとき exit 0"; else ng "差分なしで exit $rc_nodiff (期待: 0)"; fi
mkdir -p "$gate/openspec/changes/add-x" "$gate/tests/e2e"
printf '| TP-001 | a |\n' > "$gate/openspec/changes/add-x/test-plan.md"
printf "test('一覧', { tag: ['@add-x', '@TP-001'] }, async () => {});\n" > "$gate/tests/e2e/list.spec.ts"
gate_commit "plan only"
gate_out="$(gate_run)"; rc_gate=$?
if [ "$rc_gate" -eq 1 ]; then ok "mockup-compare.md が無いとき exit 1"; else ng "mockup-compare.md なしで exit $rc_gate (期待: 1)"; fi
assert_contains "::error::add-x に mockup-compare.md がありません" "$gate_out" "mockup-compare.md の不足を ::error:: で報告する"

printf '| VC-ID | x |\n|---|---|\n| VC-001 | 一覧 |\n| VC-002 | 詳細 |\n' > "$gate/openspec/changes/add-x/mockup-compare.md"
printf "test('一覧がモックと一致', { tag: ['@add-x', '@VC-001'] }, async () => {});\n" > "$gate/tests/e2e/list.mockup.spec.ts"
printf "test('別 change の VC-002', { tag: ['@other', '@VC-002'] }, async () => {});\n" > "$gate/tests/e2e/other.mockup.spec.ts"
gate_commit "vc partial"
gate_out="$(gate_run)"; rc_gate=$?
if [ "$rc_gate" -eq 1 ]; then ok "VC のテストが足りないとき exit 1"; else ng "VC 不足で exit $rc_gate (期待: 1)"; fi
assert_contains "VC-002" "$gate_out" "不足している VC-002 を報告する(別 change の @VC-002 では満たされない)"
if printf '%s' "$gate_out" | grep -q 'VC-001'; then ng "テストのある VC-001 を不足と報告した"; else ok "テストのある VC-001 は報告しない"; fi

printf "test('詳細がモックと一致', { tag: ['@add-x', '@VC-002'] }, async () => {});\n" > "$gate/tests/e2e/detail.mockup.spec.ts"
gate_commit "vc all"
gate_out="$(gate_run)"; rc_gate=$?
if [ "$rc_gate" -eq 0 ]; then ok "すべての VC にテストがあれば exit 0"; else ng "VC 充足で exit $rc_gate (期待: 0)"; printf '%s\n' "$gate_out" | sed 's/^/    | /'; fi

printf '# Mockup Compare\n\n## 比較対象なし\n画面変更なし。VC-NNN 形式の観点は無い。\n' > "$gate/openspec/changes/add-x/mockup-compare.md"
rm "$gate/tests/e2e/list.mockup.spec.ts" "$gate/tests/e2e/detail.mockup.spec.ts"
gate_commit "no vc"
gate_out="$(gate_run)"; rc_gate=$?
if [ "$rc_gate" -eq 0 ]; then ok "比較対象なしの change は VC の検証を skip して exit 0"; else ng "比較対象なしで exit $rc_gate (期待: 0)"; fi

# ------------------------------------------------------------------ (t)
step "(t) 比較ヘルパー mockup-compare.ts を Playwright で検証する"
# @playwright/test・pngjs・pixelmatch とブラウザが無い環境では skip する(openspec CLI 不在時と同じ扱い)
if (cd "$KIT_ROOT" && node -e "
  require.resolve('@playwright/test'); require.resolve('pngjs'); require.resolve('pixelmatch');
  const { chromium } = require('playwright-core');
  process.exit(require('fs').existsSync(chromium.executablePath()) ? 0 : 1);
" >/dev/null 2>&1); then
  pw="/tmp/mkit-playwright"
  rm -rf "$pw"; mkdir -p "$pw"; git -C "$pw" init -q
  cp -R "$KIT_ROOT/test/fixtures/mockup-compare/." "$pw/"
  pw_install="$(node "$KIT_ROOT/install.mjs" install --target "$pw" 2>&1)"
  assert_contains "モックルート: mockup  (HTML を含む mockup)" "$pw_install" "フィクスチャのモックルートを判別する"
  ln -s "$KIT_ROOT/node_modules" "$pw/node_modules"
  pw_out="$(cd "$pw" && npx playwright test -c playwright.selftest.config.ts 2>&1)"
  pw_rc=$?
  printf '%s\n' "$pw_out" | sed 's/^/    | /'
  if [ "$pw_rc" -eq 0 ]; then ok "Playwright の selftest がすべて成功する"; else ng "Playwright の selftest が失敗 (exit $pw_rc)"; fi
  for t in "同一の画面は合格し" "色が違う画面は VC-ID・差分率・許容値・出力先を含むメッセージで失敗する" "ダミーデータの領域をマスクすれば合格する" "高さが違っても比較は実行され" "同じモックを 2 回キャプチャすると差分率 0" "存在しないモック" "ルート外へのパスは 404"; do
    if printf '%s' "$pw_out" | grep -F -- "$t" | grep -q '✓'; then ok "ケース: ${t}"; else ng "ケース: ${t}"; fi
  done
  for f in mockup.png actual.png diff.png meta.json; do
    assert_file "$pw/mockup-compare-results/selftest-change/VC-001/$f" "合格した VC-001 にも $f が出力される"
  done
  # 出力された結果は mockup-report でそのまま読める
  mkdir -p "$pw/openspec/changes/selftest-change"
  printf '| VC-001 | a |\n| VC-002 | b |\n| VC-003 | c |\n| VC-004 | d |\n' > "$pw/openspec/changes/selftest-change/mockup-compare.md"
  pw_report="$(cd "$pw" && node scripts/mockup-report.mjs selftest-change --max-age 600 2>&1)"; rc_pw_report=$?
  printf '%s\n' "$pw_report" | sed 's/^/    | /'
  if [ "$rc_pw_report" -eq 3 ]; then ok "ヘルパーの出力を mockup-report が読み、VC-002 の失敗で exit 3"; else ng "mockup-report が exit $rc_pw_report (期待: 3)"; fi
  assert_contains "サイズ不一致" "$pw_report" "VC-004 のサイズ不一致がレポートに出る"
else
  skip "@playwright/test・pngjs・pixelmatch またはブラウザが無いため比較ヘルパーの検証を省略(npm ci && npx playwright install chromium で有効になる)"
fi

# ------------------------------------------------------------------ (u)
step "(u) devDependencies の案内(package.json は書き換えない)"
deps="/tmp/mkit-deps"
rm -rf "$deps"; mkdir -p "$deps/openspec"; git -C "$deps" init -q
printf '{ "name": "full", "devDependencies": { "@playwright/test": "1", "pngjs": "7", "pixelmatch": "7" } }\n' > "$deps/package.json"
deps_before="$(shasum "$deps/package.json")"
deps_out="$(node "$KIT_ROOT/install.mjs" install --target "$deps" 2>&1)"
if printf '%s' "$deps_out" | grep -qF 'npm i -D'; then ng "依存が揃っているのに案内を出した"; else ok "依存が揃っていれば案内を出さない"; fi
if [ "$deps_before" = "$(shasum "$deps/package.json")" ]; then ok "package.json は書き換えない"; else ng "package.json が書き換わった"; fi

# ------------------------------------------------------------------ 結果
step "結果"
printf '  PASS %d / FAIL %d\n' "$pass_count" "$fail_count"
if [ "$fail_count" -gt 0 ]; then
  printf '\n\033[31mセルフテスト失敗\033[0m\n'
  exit 1
fi
printf '\n\033[32mセルフテスト成功\033[0m\n'
