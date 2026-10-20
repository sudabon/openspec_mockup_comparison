# mockup-comparison-run Specification

## Purpose
MK ごとに、モックの HTML と実画面を同じ条件で撮影して差分を測り、ゲートと人間の承認が参照できる再現可能な結果として記録する。

## Requirements

### Requirement: Comparison helper

アドオンは、Playwright テストから呼ぶヘルパー `compareWithMockup(page, mkId, options?)` を、E2E ルートの `support/mockup.ts` として配布しなければならない（MUST）。ヘルパーは、テストの `@<change-id>` タグから change を特定し、その change の mockup-plan.md の MK 行を読まなければならない（MUST）。行が無い、タグが無い、または mockup-plan が `not-applicable` のときは、テストを失敗させなければならない（MUST）。ヘルパーは MK 行の Viewports ごとに次の処理をしなければならない（MUST）。

1. モックのファイルを、mockup root を document root とするローカルの静的サーバー（127.0.0.1、空きポート）から開く。`file://` は使わない。
2. 実画面は、テストが用意した `page` の現在の状態で撮影する。ヘルパーが Target の URL へ遷移するのは、`options.navigate` が真のときだけにする。
3. 両側で同じ処理をしてから撮影する: viewport の設定、アニメーションの停止、キャレットの非表示、`document.fonts.ready` の待機、Masks の selector の塗りつぶし。Mockup と Target に selector があれば、その要素だけを撮影する。
4. 撮影したモックの画像を期待値とし、実画面の画像と画素ごとに比べて、差分率（差のある画素数 ÷ 比較範囲の画素数）と差分画像を得る。画素ごとの色の許容差は policy の `mockup_pixel_tolerance` で決める。同じ入力画像からは、実行のたびに同じ差分率と同じ差分画像を出す。両画像の寸法が違うときは、差分率を 1 とし、寸法の違いを結果に記録する。

ヘルパーは、テストの合否を閾値で決めなければならない（MUST）。差分率が閾値を超えたとき、マスクの面積率が policy の上限を超えたとき、selector が0件または複数件に一致したときは、テストを失敗させる。

#### Scenario: Matching screen

- **WHEN** MK-001 の実画面がモックと同じ描画で、差分率が 0.002、閾値が 0.01 である
- **THEN** テストは成功し、MK-001 の結果は `pass` として記録される

#### Scenario: Missing plan row

- **WHEN** テストが `compareWithMockup(page, 'MK-009')` を呼ぶが、mockup-plan に MK-009 が無い
- **THEN** テストは比較を行わずに失敗し、行が無いことを表示する

#### Scenario: Ambiguous selector

- **WHEN** Target の selector `.card` が実画面で3要素に一致する
- **THEN** テストは失敗し、一致した件数を表示する

### Requirement: Recorded results

ヘルパーは、MK と viewport ごとの結果を実行ディレクトリに書き、`node scripts/mockup-gate.mjs record <change>` が、それを change ディレクトリの `mockup-results.json` にまとめなければならない（MUST）。各結果は次を持つ。

- MK-ID、viewport、`pass` / `diff` / `error` の status、差分率、適用した閾値、マスクの面積率
- モック画像・実画像・差分画像の sha256
- 比較に使ったモックの HTML と、そこから参照されるローカルの CSS・画像の sha256 をまとめた digest（mockup digest）
- mockup-plan.md の MK 行の digest

ファイル全体としては、実行時の git commit と、作業ツリーに未コミットの変更があったか、実行環境（OS、ブラウザ名と版、Playwright の版、コンテナ画像の名前と digest または `local`）、実行時刻を持つ。`record` は、テストを実行していない MK を `missing` として記録しなければならない（MUST）。また、既存の `mockup-results.json` を、別の commit の結果と混ぜずに置き換えなければならない（MUST）。画像ファイル自体を change ディレクトリに置いてはならない（MUST NOT）。

#### Scenario: Recording after a run

- **WHEN** Docker 画像で比較テストを実行したあとで、`mockup-gate.mjs record add-login-page` を実行する
- **THEN** `openspec/changes/add-login-page/mockup-results.json` に、全 MK・全 viewport の結果と、コンテナ画像の digest を含む環境が記録される

#### Scenario: Uncommitted changes during the run

- **WHEN** 実装ファイルを変更したままコミットせずに比較を実行する
- **THEN** 結果には未コミットの変更があったことが記録され、final ゲートはその結果を受け付けない
