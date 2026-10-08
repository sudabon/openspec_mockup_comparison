# ワークフロー

モック比較の change は schema `quality-driven-e2e-mockup` で作ります。testkit の統合 schema `quality-driven-e2e` の流れ（proposal → specs → quality → design と test-plan → tasks、人間の承認、Oracle seal、独立反証、evidence、QA handoff）はそのまま残り、モック照合が加わります。

```bash
openspec new change add-login --schema quality-driven-e2e-mockup
```

## 成果物

| 成果物 | 作る人 | 内容 |
|--------|--------|------|
| mockup-plan.md | Agent（人間がレビュー） | MK-ID ごとに、どのモックを、どの画面・状態・viewport と比べるか。マスクと閾値 |
| 比較テスト | Agent | MK ごとの Playwright テスト。画面を所定の状態にしてから `compareWithMockup(page, 'MK-NNN')` を呼ぶ |
| mockup-results.json | `mockup-gate.mjs record` | 正の環境で比較した結果。差分率、閾値、画像の sha256、モックと plan 行の digest、commit、実行環境 |
| mockup-report.md の `## 所見` | record（転記）と mockup-reviewer | 閾値を超えた結果ごとの分類（実装の不備 / 意図した差 / 描画ノイズ）と根拠 |
| mockup-report.md の `## 許容判断` | 人間だけ | 許容する結果ごとの理由、承認者、承認日、差分 digest |

mockup-plan は specs と quality のあとに作ります。tasks は mockup-plan に依存し、`## 6. QA Handoff` のあとに `## 7. Mockup Comparison` を置きます。

## 人間が行うこと

- mockup-plan.md のレビュー。モックの選び方、Viewports、マスクの妥当性、閾値はゲートでは判断しません。
- 閾値を超えた結果の許容判断。差分画像（`test-results/mockup/<change>/<MK>/<viewport>/diff.png`、CI では artifact）を見て、許容するなら `## 許容判断` に1行書きます。差分 digest は `## 所見` の値を写します。
- 正とする実行環境の更新（`openspec/mockup-policy.md` の手順）。

Agent は、閾値・マスク・モック・`mockup-results.json` を変えず、許容判断を記入しません。schema の apply ルール（M1〜M7）、skill、mockup-reviewer の定義がこれを禁止しています。

## 流れ

1. mockup-plan.md を作り、人間がレビューする。UI に触れない change は `mockup: not-applicable` と理由を書く。
2. 実装し、MK ごとに比較テストを書く（タグは `@<change-id>` と `@MK-NNN`）。
3. 実装をコミットし、正の環境（policy の Docker 画像）で比較テストを実行する。
4. `node scripts/mockup-gate.mjs record <change>` で `mockup-results.json` を作り、閾値を超えた結果を所見に転記する。
5. mockup-reviewer（別コンテキスト）が所見の分類と根拠を書く。
6. 実装の不備は直して 3 に戻る。許容する差は、人間が許容判断を書く。
7. `mockup-results.json` と `mockup-report.md` をコミットする。CI は同じ画像で比較をやり直し、`verify` で再現を確かめる。

## ゲート

```bash
node scripts/mockup-gate.mjs check [--phase plan|final] [--base <ref>] [<change>...]
node scripts/mockup-gate.mjs record <change>
node scripts/mockup-gate.mjs verify --results <dir> [<change>...]
node scripts/mockup-gate.mjs doctor
```

対象の選び方と phase の決め方は testkit と同じです（`selectChanges` を使い、宣言上の schema が `quality-driven-e2e-mockup` の change を検査し、全タスクの完了と archive で final になります）。

| phase | 主な検査 |
|-------|----------|
| plan | mockup-plan の frontmatter と表、MK-ID、Requirement / Scenario の実在、モックの実在と mockup root の内側、Viewports、Fixture の登録、Masks の理由、Threshold の上限、`## 7. Mockup Comparison`、quality の「見た目の回帰」との整合、MK のテストの有無（plan では警告） |
| final | 上に加えて、結果の有無、正の環境、未コミットの変更なし、実行 commit からの変更（無視するパス以外）なし、モックと plan 行の digest の一致、missing / error なし、diff の所見と許容判断（差分 digest の一致、承認者、承認日）、MK のテストの有無 |

比較元で `quality-driven-e2e-mockup` だった change の schema を付け替えると、mockup-gate は失敗します（統合系統の外への付け替えや、派生 schema の宣言の削除は testkit のゲートも失敗させます）。

### 終了コード

| コード | 意味 |
|--------|------|
| 0 | 成功 |
| 1 | 検査の失敗 |
| 2 | 引数・入力・前提の不正（testkit の版の不一致、比較元 ref の不正、存在しない change など） |
| 3 | 内部エラー（スタックトレース付き） |

## 比較の仕組み

- モックは mockup root を document root にした静的サーバー（127.0.0.1、空きポート）から開きます。root の外へのアクセスは 403 で、外部 URL への要求は遮断して error にします。実際に読み込まれたファイルの sha256 から mockup digest を作ります。
- 両側で同じ viewport、アニメーションの停止、キャレットの非表示、フォントの読み込み待ち、マスク（同じ色で塗りつぶす）をしてから撮影します。Mockup / Target に selector があれば、その要素だけを撮影します。selector は1要素に一致しなければなりません。
- 差分はブラウザ内で、同梱の pixelmatch（policy の `mockup_pixel_tolerance`）で数えます。差分率は「差のある画素数 ÷ 比較範囲の画素数」です。寸法が違えば差分率は 1 です。
- 比較範囲は viewport（または selector の要素）です。ページ全体のスクロール領域は比べません。下の方を比べるときは、selector で要素を指定します。

## 限界

- 実行環境はテストの実行側が申告する値です（`MOCKUP_CONTAINER_IMAGE`）。手元で作った結果の環境欄を書き換えると final ゲートは通りますが、CI の `verify` が正の環境で比較をやり直して画像の sha256 を照合するので、そこで失敗します。`verify` を必須のチェックにしてください。
- 同じ Docker 画像でも、arm64（Apple silicon の手元など）と amd64（多くの CI）で描画が変わることがあります。結果には CPU アーキテクチャ（`environment.arch`）を記録し、`verify` は違いを警告します。正の結果は CI と同じアーキテクチャで作ります（手元なら `docker run --platform linux/amd64`）。
- ブラウザや Playwright の版を上げると、全 MK の画像が変わり、許容判断はすべて無効になります。policy の手順で正の環境を更新し、照合と許容判断をやり直します。
- モックとの意味の差（文言の誤り、要素の順序など）でも、画素の差が閾値以下なら pass になります。閾値は小さく保ち、意味の検査は E2E の Oracle で行います。
- AI の所見は合否を決めません。許容は人間の判断です。
