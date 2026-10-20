# Proposal

## Why

`openspec-custom-testkit` には「見た目の回帰」の観点がある。しかしそれは `toHaveScreenshot` で、過去の自分自身と比べるものである。デザイナーがリポジトリに置いた HTML/CSS の静的モックアップと、実装した画面がずれていても検出できない。モックとの照合は人が目で見ているのが実情で、差分を見落としたり、許容した理由が残らなかったりする。

testkit に派生 schema の互換宣言（`testkit-compat.json`）と、宣言の削除や schema の付け替えを検出する仕組み（testkit PR #14・#15）が入った。これで、testkit の人間ゲート・Oracle seal・反証・E2E ゲートを一つも失わずに、モック比較を足した派生 schema をアドオンとして配布できるようになった。

## What Changes

- このリポジトリを、testkit と同じ形の導入 CLI（`npx github:sudabon/openspec_mockup_comparison install`）を持つアドオン kit にする。testkit を導入済みの git リポジトリへ追加で導入する。
- install の流れは次のとおり。
  - 導入先の `openspec/schemas/quality-driven-e2e/` から、派生 schema `quality-driven-e2e-mockup` を生成する。
  - 統合 schema の artifact と instruction はそのまま引き継ぎ、artifact `mockup-plan`、tasks の `## 7. Mockup Comparison` グループ、apply の追加ルールを足す。
  - 互換宣言 `testkit-compat.json` を置く。
  - testkit を update して統合 schema が変わったら、アドオンの update で再生成する。doctor がずれを検出する。
- **mockup-plan.md**: change ごとに、どのモック（`mockups/` 配下の HTML）を、どの画面・状態・viewport と比べるかを MK-ID の表で書く。マスクする領域と閾値もここに書く。UI に触れない change は `mockup: not-applicable` と理由を書く。
- **比較テスト**: E2E の TP と同じく、Agent が MK-ID ごとに Playwright テストを書く。画面を所定の状態にしてから、アドオンのヘルパー `compareWithMockup(page, 'MK-001')` を呼ぶ。ヘルパーは次の処理をする。
  - モックをローカルの静的サーバーで同じ viewport に描画する。
  - 実画面とモックの両方を、同じマスクと同じ安定化（アニメーション停止・フォントの読み込み待ち）で撮影する。
  - 画素ごとに比べて、差分率と差分画像を出す（同梱する pixelmatch 互換の比較処理を、ブラウザ内で実行する）。
- **結果の記録**: 比較結果を `mockup-results.json` として change ディレクトリにコミットする。記録する内容は、差分率、閾値、マスク面積率、画像の digest、モックと plan の digest、実行 commit、実行環境である。画像そのものは CI の artifact にする。
  - 正とする環境は、policy で指定した Playwright 公式 Docker 画像とする。それ以外の環境の結果は、final ゲートで受け付けない。
- **AI レビュー**: 別コンテキストの `mockup-reviewer` が、差分画像・モック・plan だけを入力に、差分を「実装の不備 / 意図した差 / 描画ノイズ」に分類し、`mockup-report.md` に所見を書く。所見は参考情報で、ゲートの合否は決めない。
- **ゲート**: `scripts/mockup-gate.mjs check [--phase plan|final] [--base <ref>]` が次を検査する。
  - plan: mockup-plan の構造、モックファイルの実在、policy の上限を超える閾値やマスク
  - final: 結果の鮮度、正の環境、全 MK の結果の有無
  - 閾値を超えた MK は、`mockup-report.md` に人間の許容承認（承認者・承認日・承認した差分画像の digest）が無ければ失敗する。比較を再実行して差分画像が変われば、承認は無効になる。承認欄は人間だけが記入する。
- **policy**: `openspec/mockup-policy.md` に、既定の閾値、閾値の上限、マスク面積率の上限、正とする実行環境、鮮度の判定から外すパスを置く。install は既存の policy を上書きしない。
- **既存の設定を変えない**: install は `package.json` に依存を足さない。既存の Playwright 設定や testkit の配布物、config.yaml の既定 schema も変えない。既定 schema の切り替えは `--set-default` を付けたときだけ行う。`uninstall` は、派生 schema を使う active change が残っていれば中止する。
- CI の組み込み例として、testkit の gate に加えて `mockup-gate.mjs check --base` と、Docker 画像で比較テストを実行する手順を示す。

## Capabilities

### New Capabilities
- `addon-installation`: testkit を前提にした install / update / uninstall / doctor。前提版の判定、冪等性、既存ファイルを上書きしないこと、stamp。
- `mockup-schema`: 派生 schema `quality-driven-e2e-mockup` の生成と同期、`mockup-plan` artifact、tasks の Mockup グループ、apply ルール。
- `mockup-comparison-run`: 比較ヘルパーの振る舞い（モックの描画、撮影条件、差分の計算）と、`mockup-results.json` の内容と実行環境の記録。
- `mockup-gate`: plan / final の検査、閾値とマスクの上限、結果の鮮度と正の環境、差分画像の digest に紐づく人間の許容承認、AI レビューの位置付け、fail closed の条件。

### Modified Capabilities

（なし。このリポジトリには既存の spec が無い）

## Impact

- このリポジトリの新規ファイル: `install.mjs`、`lib/`（installer）、`payload/`（schema 生成元の差分定義、`scripts/mockup-gate.mjs`、`scripts/lib/`、比較ヘルパー、policy、skill、agent、role）、`test/`、`docs/`、`examples/ci/`、`package.json`
- 導入先に配置するもの:
  - `openspec/schemas/quality-driven-e2e-mockup/`
  - `openspec/mockup-policy.md`
  - `scripts/mockup-gate.mjs` と `scripts/lib/mockup/`
  - E2E ルートの `support/mockup.ts`（ヘルパー）
  - `.claude/skills/mockup-comparison/SKILL.md`
  - `.claude/agents/mockup-reviewer.md`
  - `openspec/roles/mockup-reviewer.md`
  - `.openspec-mockup-comparison.json`（stamp）
- 依存:
  - 導入先: testkit の `listCompatDeclarations` を持つ版（PR #15 以降）。比較の実行には `@playwright/test`（導入先の既存依存）が要る。
  - アドオン自体: Node.js 20 以上、OpenSpec CLI 1.13.1 以上。実行時の npm 依存は持たない。
- testkit 側は変更しない。testkit の CI ジョブ（`ci-job.mjs`）はアドオンのゲートを呼ばないので、CI に `mockup-gate.mjs` を別のステップとして足す必要がある。
