# Tasks

## 1. 上流の取り込みと骨格

- [x] 1.1 `openspec_e2e_test` の現行 main を取得する。`install.mjs`、`payload/`、`test/`、`.github/workflows/`、`.gitignore` をコピーし、取り込み元のコミットハッシュと取り込み手順を `UPSTREAM.md` に記録する（検証: コピー直後の `npm test` が上流と同じく全ステップ成功する）
- [x] 1.2 `package.json` を作成する（name `openspec-e2e-mockup-kit`、bin `openspec-e2e-mockup-kit`、version 0.1.0、engines node>=20、files に install.mjs / payload / README.md / UPSTREAM.md）。e2e 由来の名称を本 kit の名称へ置き換える（検証: `node install.mjs --help` が新しい usage を表示する）

## 2. 合成スキーマ

- [x] 2.1 `payload/openspec/schemas/spec-driven-e2e-mockup/schema.yaml` を作成する。name / description を変更し、mockup-compare アーティファクト（requires: specs）を追加する。test-plan の requires を [specs, mockup-compare] に変更する（検証: サンドボックスで `openspec schema validate spec-driven-e2e-mockup` が成功する）
- [x] 2.2 mockup-compare の instruction を書く。内容は、VC-ID の採番、記録項目（対応シナリオ、モックパス、状態、ビューポート、比較範囲、マスク・非表示と理由、許容差分率）、比較対象外の表、比較対象なしの場合の書き方、セレクタや URL の禁止、ダミーデータ領域のマスク方針（検証: `openspec instructions mockup-compare` の出力に各項目が含まれる）
- [x] 2.3 `templates/mockup-compare.md` を作成する（観点一覧の表、比較対象外の表、タグ対応）。test-plan と tasks の instruction・テンプレートに、VC 参照と `@VC-NNN` の 1:1 タスク規約を追記する（検証: 上流テンプレートとの diff が追記行だけである）
- [x] 2.4 instruction 内のモックルートのパスを、リテラル `mockup` で記述する。インストーラの置換対象に登録する（検証: 4.3 のテストでルート置換が反映される）

## 3. モック比較ランタイム

- [x] 3.1 `payload/tests/e2e/support/mockup-compare.ts` に、node:http の静的サーバ（遅延起動、空きポート、ワーカー単位、MIME 判定、ルート外へのパス・トラバーサルの拒否）を実装する（検証: 3.6 のテストで相対参照の CSS/JS が適用される。`../` を含むパスで 404 になる）
- [x] 3.2 決定化を実装する。clock の固定、シード付き `Math.random`、reducedMotion、`mockupQuery`（既定 `noload=1`）、fonts と networkidle の待機（タイムアウト時は `fontsTimedOut` を記録）、viewport と deviceScaleFactor の統一（検証: 同じモックを 2 回キャプチャして差分率 0）
- [x] 3.3 `steps`、`hide`、`mask`、要素単位の比較範囲（`target`）を実装する（検証: 3.6 のマスクケースが合格する）
- [x] 3.4 pngjs と pixelmatch による差分率の算出、サイズ不一致時の余白を透明にした比較、判定と失敗メッセージ（VC-ID・差分率・許容値・出力先）を実装する（検証: 3.6 の色変更ケースが期待どおりのメッセージで失敗する）
- [x] 3.5 `mockup-compare-results/<change-id>/<VC-ID>/` への 4 ファイル出力と、meta.json のスキーマ（vc, changeId, mockup, appUrl, viewport, diffRatio, maxDiffRatio, pass, sizeMismatch, fontsTimedOut, startedAt）を実装する（検証: 合格時も 4 ファイルが出力される）
- [x] 3.6 selftest 用のフィクスチャ（最小のモックと静的アプリ）と Playwright テストを作成する。同一で合格・色変更で失敗・マスクで合格・高さ違いで比較実行の 4 ケースを用意する。Playwright が無い環境では skip する（検証: `npm test` でこの 4 ケースが期待どおりの結果になる）

## 4. インストーラ

- [x] 4.1 SCHEMA_NAME を `spec-driven-e2e-mockup`、REPLACEABLE_SCHEMAS を {spec-driven, spec-driven-e2e} に変更する。記録ファイルを `.openspec-e2e-mockup-kit.json` に変更する（検証: selftest で `spec-driven-e2e` の config が切り替わる）
- [x] 4.2 `--mockup-root` を追加する。判別順（明示指定 → 記録値 → 深さ 3 までの mockup/mockups/mock のうち HTML を含む最浅 → 既定 `mockup`）、複数候補の表示、ルート変更時の警告を実装する（検証: selftest の `requirements/mockup` ケースと複数候補ケース）
- [x] 4.3 モックルートの置換対象ファイル（schema.yaml、mockup-compare-review の SKILL.md、mockup-compare.ts、config の context 行）への反映を実装する（検証: 判別したルートが各ファイルに反映される）
- [x] 4.4 config.yaml のマーカーを `openspec-e2e-mockup-kit` に変更する。context 行にモック比較規約（モックルート、`@VC-NNN`、レビュースキル）を追加する。`openspec-e2e-kit` のマーカーブロックを本 kit のブロックへ置き換える移行処理を実装する（検証: selftest で、マーカー外の行が保持されたまま置き換わる）
- [x] 4.5 `.openspec-e2e-kit.json` を検出したときの移行メッセージと、devDependencies 不足の案内（package.json は書き換えない）を実装する（検証: selftest の出力に両メッセージが出る。package.json は不変）

## 5. レポータと CI ゲート

- [x] 5.1 `payload/scripts/mockup-report.mjs` を実装する。mockup-compare.md から VC-ID を抽出し、meta.json と突き合わせて表と欠落一覧を出す。終了コードは 0/1/2/3、`--max-age` は fail closed（検証: selftest で 4 系統の終了コードと鮮度判定）
- [x] 5.2 `check-test-plan.sh` に、mockup-compare.md の存在検証と、VC-ID ごとの `@VC-NNN` タグ検証（比較対象なしの場合はスキップ）を追加する（検証: selftest で、不足時に exit 1、比較対象なしで exit 0）
- [ ] 5.3 `.github/workflows/openspec-e2e-mockup-gate.yml` を作成する（存在検証 → change スコープの Playwright → mockup-report をジョブサマリーへ → mockup-compare-results を artifact へ）（検証: actionlint が通る。本リポジトリの PR からの dry 呼び出し、または `act` で実行できる）

## 6. AI レビュースキル

- [x] 6.1 `payload/.claude/skills/mockup-compare-review/SKILL.md` を作成する。入力（失敗した VC だけ）、5 分類の定義、mockup-review.md のテンプレート、周回の推移、同一 startedAt の警告、閾値とテストの変更禁止、マスク変更は mockup-compare.md の変更として提案すること、を記載する（検証: 3.6 の失敗結果に対してスキルを実行し、mockup-review.md が仕様どおりの構成で生成される）

## 7. 統合検証とドキュメント

- [x] 7.1 selftest に e2e kit からの移行シナリオ（e2e kit を導入済みのサンドボックスに本 kit を install）と、上流スキーマとの差分チェックを追加する（検証: `npm test` が全ステップ成功する）
- [x] 7.2 selftest (i) 相当の change フロー検証を更新する。status で mockup-compare / test-plan / tasks の blocked 表示、instructions mockup-compare の context にモック規約行があること、を確認する（検証: `npm test`）
- [x] 7.3 enjinfarm のモック（`requirements/mockup`）をモックルートにした実地確認を行う。`?noload=1` を付けた 2 画面を 2 回ずつキャプチャして差分率 0、`.samplebar` を非表示にできること、を確認する（検証: 結果ディレクトリの meta.json と画像を目視する）
- [x] 7.4 README を全面的に書き直す（導入、更新、ルート判別、導入されるもの、開発フロー、比較ヘルパーの使い方、レビュースキル、CI ゲート、e2e kit からの移行、上流の取り込み手順）（検証: README の手順どおりにサンドボックスへ導入できる）
