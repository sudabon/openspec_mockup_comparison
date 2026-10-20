# Proposal

## Why

本リポジトリは「モックアップとの UI 比較を行う OpenSpec カスタムスキーマ」を目的としているが、実体はまだ無い。
一方、E2E テスト導線は `openspec_e2e_test`（スキーマ `spec-driven-e2e`）として別 kit で配布されている。
OpenSpec はプロジェクトごとに 1 スキーマしか有効にできず、スキーマの継承・合成機能も無い。
そのため 2 つの kit を同じプロジェクトに入れると `schema:` を取り合い、片方が効かなくなる。
そこで本リポジトリを、E2E とモックアップ比較を 1 つに合成したスキーマ `spec-driven-e2e-mockup` を
単独で配布する kit として実装する。

モックアップは静的な画像ではなく、HTML/CSS/JS で動く「動的モック」を前提にする
（例: 画面 ID ごとの HTML、共通 JS のダミーデータ、スケルトン表示、ドロワー開閉などの状態遷移を持つもの）。
実装画面とモックの見た目の乖離を、レビューで目で見るのではなく、仕様と結び付いた観点として検出・説明できるようにする。

## What Changes

- 合成カスタムスキーマ `spec-driven-e2e-mockup` を新設する。
  - `spec-driven-e2e` のアーティファクト（proposal → specs → design → test-plan → tasks）を内包する
  - モック比較観点のアーティファクト `mockup-compare.md` を追加する。対応モック、状態、ビューポート、マスク、閾値を VC-ID（VC-001〜）で定義する
  - tasks は TP-ID と VC-ID の両方について、1:1 の実装タスクを必須にする
- `npx github:sudabon/openspec_mockup_comparison` で導入・更新できる、冪等なインストーラを実装する。
  - `openspec_e2e_test` の payload（e2e-conventions スキル、e2e-report、check-test-plan、Playwright 設定例、fixtures README）を内包して配布する
  - E2E ルートに加え、モックアップのルートも自動判別する
  - `openspec/config.yaml` の `schema:` が `spec-driven` または `spec-driven-e2e` なら、`spec-driven-e2e-mockup` へ切り替える（e2e kit からの移行）
- モック比較ランタイムを配布する。
  - Playwright テスト内で、モックと実画面を同じ状態・同じビューポートでキャプチャする。モック側の非決定要素（時計、乱数、アニメーション、読み込み演出）は固定する
  - ピクセル差分率を閾値で機械判定し、モック画像・実画面画像・差分画像・メタデータを change 単位で出力する
  - VC-ID 別の結果表を出すレポータ `scripts/mockup-report.mjs`（終了コードは e2e-report と同じ体系）
- AI 目視レビューのスキル `mockup-compare-review` を配布する。閾値を超えた VC について画像を見比べ、差分の原因を分類した `mockup-review.md` を書かせる。AI の判定は非決定的なので、CI ゲートには使わない
- CI ゲートの reusable workflow を配布する。e2e-gate に、mockup-compare.md の存在チェックと `@VC-*` テストの実行を加え、差分画像を artifact としてアップロードする

## Capabilities

### New Capabilities
- `composite-schema`: 合成スキーマ `spec-driven-e2e-mockup` のアーティファクト構成、依存順序、各アーティファクトの instruction とテンプレート
- `kit-installer`: install / update / dry-run / force、E2E ルートとモックアップルートの自動判別、config.yaml のマージ、e2e kit からの移行
- `mockup-visual-comparison`: モックと実画面のキャプチャ、決定化、マスク、ピクセル差分判定、結果出力、VC 別レポートと終了コード
- `ai-visual-review`: 閾値超過 VC に対する AI 目視レビューの入力・分類・出力形式
- `ci-gate`: PR 時の test-plan / mockup-compare の存在検証と、change スコープの E2E・モック比較の実行

### Modified Capabilities
（なし。既存 spec は存在しない）

## Impact

- 本リポジトリ: `install.mjs`、`package.json`、`payload/`（スキーマ、スキル、スクリプト、テスト補助）、`test/selftest.sh`、`.github/workflows/`、README を新規に追加する
- 導入先リポジトリ: devDependencies に `pngjs` と `pixelmatch` が必要になる。インストーラは package.json を書き換えず、案内だけを出す
- `openspec_e2e_test` との関係: 本 kit は e2e kit の payload を取り込んだ fork になる。取り込み元のコミットを記録し、上流の変更は手動で取り込む。同じプロジェクトでの 2 kit 併用はサポートしない（移行のみサポートする）
- `spec-driven` の fork なので、OpenSpec 本体のスキーマ形式が変わったときは追従が必要になる（e2e kit と同じ制約）
