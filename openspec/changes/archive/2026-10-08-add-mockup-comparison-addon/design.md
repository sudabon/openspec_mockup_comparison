# Design

## Context

動機は proposal.md の Why を参照。前提として依存する、testkit（PR #15 時点）の事実は次のとおり。

- 導入先には、testkit の `scripts/lib/` 一式がコピーされている。testkit は、`schema-family.mjs` をアドオン向けの公開モジュールとして宣言している。`select.mjs` の `selectChanges` は、`declaredSchema` と、系統で正規化した `schema` を返す。
- 宣言の削除と、統合系統の外への付け替えは、testkit のゲートが `--base` 付きの検査で失敗させる。testkit は派生 schema が追加した artifact やタスクグループを検査しない。それはアドオンの責務である。
- testkit の install は、payload 以外のファイルに触れない。`config-merge.mjs` は、既定 schema が有効な派生 schema であれば書き換えない。
- OpenSpec 1.13 の schema.yaml には継承が無いので、派生 schema は丸ごとのコピーとして生成するしかない。
- testkit の e2e-conventions は、見た目の回帰（baseline と比べる `toHaveScreenshot`）について、CI と同じコンテナで baseline を作ることと、閾値を緩めることをアサーションの緩和として扱うことを定めている。

このリポジトリは、README と LICENSE だけの状態から始める。

## Goals / Non-Goals

**Goals:**
- 統合 schema の文面とゲートを一字も弱めずに引き継ぎ、モック照合を足す。
- 差分の合否を決定的にし、許容は人間の承認を、特定の差分画像に結び付けて残す。
- 導入先に npm 依存を足さない（`@playwright/test` は導入先の既存依存を使う）。

**Non-Goals:**
- Figma などリポジトリ外のデザインや、画像（PNG）のモックとの比較。HTML/CSS の静的モックだけを扱う。
- DOM 構造やスタイル値（色・余白）の比較。今回はピクセル差分だけを扱う。
- testkit の `ci-job.mjs` へのプラグイン機構。CI には別のステップとして足す。
- モックの作成支援やモックの lint。
- E2E の TP として coverage に数えること。MK は testkit の TP とは別の ID 体系にする。

## Decisions

### D1. パッケージ構成は testkit と同じにし、実行時は導入先の testkit モジュールを使う

- `install.mjs`（bin）、`lib/`（installer。導入先には入れない）、`payload/`（配布物）、`test/`、`docs/`、`examples/ci/` を置く。Node 20 以上で、実行時の npm 依存は持たない。
- 導入先の `scripts/mockup-gate.mjs` と `scripts/lib/mockup/*.mjs` は、testkit の `scripts/lib/` から次を相対 import する。
  - `select.mjs`（`selectChanges`）
  - `schema-family.mjs`
  - `frontmatter.mjs`、`markdown.mjs`、`git.mjs`、`entry.mjs`
  - fixture と mock の登録検査（`registry.mjs`）
- 選択と phase の判定を自前で持つと、testkit と食い違う原因になる。testkit を使うことで、付け替えや宣言の削除の扱いも testkit と揃う。
- 不採用: testkit の lib をアドオン側にコピーして同梱する方式。testkit を update したときに判定がずれる。
- リスク: testkit の非公開モジュールに依存する。doctor と gate の起動時に、使う export の存在を確かめ、無ければ「testkit の版が合わない」として終了コード 2 にする（D9）。

### D2. 派生 schema は YAML の Document API で生成し、生成後に自己検査する

- installer は、yaml（ISC。testkit と同じく vendor して同梱する）の Document API で、統合 schema の schema.yaml を読む。そのうえで次を変える。
  - `name` と `description`
  - artifact `mockup-plan` を `test-plan` の直後に挿入する
  - `tasks.requires` に `mockup-plan` を追加する
  - `tasks.instruction` と `apply.instruction` の末尾に、アドオンの文面を追記する
- ブロックスカラーの書式を保つため、文字列の置換ではなく AST を編集する。
- 生成後は、出力を再び読み込んで、spec の「Generated derived schema」の不変条件を機械的に検査する。追加・追記以外の差分が一つでもあれば、書き込まずに失敗する。testkit の `resolveSchemaFamily` も呼び、有効と判定されることを確かめる。
- テンプレートは、統合 schema の `templates/` を丸ごとコピーし、`mockup-plan.md` と `mockup-report.md` を足す。
- stamp には、生成元の `schema.yaml` と各テンプレートの sha256 を記録する。doctor は、現在の統合 schema と比べてずれを検出する。
- 不採用: アドオンが完成品の schema.yaml を同梱する方式。testkit の instruction を更新しても派生側が古いまま残り、統合 schema の文面を引き継げない。

### D3. 差分の計算はブラウザ内で、同梱の pixelmatch 互換処理で行う

- 不採用 (a) `toHaveScreenshot` / `toMatchSnapshot` にモック画像を期待値として渡す方式: 期待値が snapshot のパスと `--update-snapshots` の運用に縛られる。期待値の更新を誤ると、モック照合が自分自身との比較に化ける。
- 不採用 (b) Playwright 内部の comparator を使う方式: 非公開 API で、版ごとに変わる。
- 不採用 (c) Node 側で PNG を復号する方式: PNG デコーダを自作するか、依存を足す必要がある。
- 採用: 撮影した2枚の PNG を、比較用の空ページ（`about:blank`）で `createImageBitmap` → `OffscreenCanvas.getImageData` に通す。vendor した pixelmatch（ISC）で画素差を数え、差分画像を `convertToBlob({ type: 'image/png' })` で得る。
  - 正の環境ではブラウザの版が固定されるので、差分画像のバイト列も決まり、承認 digest（D7）と verify（D8）の前提になる。
  - 画素ごとの許容差は、policy の `mockup_pixel_tolerance`（pixelmatch の `threshold`）にする。アンチエイリアスの検出は、既定で有効にする。

### D4. モックはローカルの静的サーバーで描画し、実際に読まれたファイルで digest を取る

- テストの worker 内で、Node の `http` を `127.0.0.1:0` に listen する。document root は mockup root で、`..` や絶対パスと、symlink で root の外に出るアクセスは 403 にする。
- 開く方法として `file://` は採用しない。`/assets/...` のような root 相対パスが使えず、ブラウザごとに挙動が違うためである。
- サーバーが実際に返したファイルのパスを記録し、そのファイルの sha256 を、パス順に連結したものの sha256 を mockup digest とする。HTML の静的な解析より正確で、CSS の `@import` や画像も漏れない。外部 URL への要求は、描画前に `page.route` で遮断し、結果に記録する（モックが外部に依存しないことを保つ）。

### D5. 実画面の状態は MK ごとのテストが作り、ヘルパーは撮影と比較だけを担う

ログインやデータの準備は、testkit の fixture と mock の登録をそのまま使う。ヘルパーは、`testInfo.tags` から `@<change-id>` と `@MK-NNN` を取り、change ディレクトリ（active か archive）の mockup-plan を読む。MK を引数とタグの両方で指定させ、一致しなければ失敗させる。こうすることで、別の MK の行で比べる取り違えを防ぐ。

### D6. 結果の記録と鮮度

- ヘルパーは、MK と viewport ごとの JSON と画像3枚を `test-results/mockup/<change>/<MK>/<viewport>/` に書く。`record` はそれらをまとめて `mockup-results.json` を作る。
- `commit` は `git rev-parse HEAD`、`dirty` は `git status --porcelain` で取る。`dirty` の判定からは、`test-results/` と、change の `mockup-results.json` / `mockup-report.md` を除く。
- 実行環境は次で取る。
  - コンテナ画像の名前と digest は、CI が渡す環境変数 `MOCKUP_CONTAINER_IMAGE` から取る。
  - ブラウザの版は `browser.version()`、Playwright の版は `@playwright/test/package.json` から取る。
- final ゲートの鮮度判定は、`git diff --name-only <commit> HEAD` のパスがすべて `openspec/**`、mockup root、`mockup_ignore_paths` のどれかに一致するかで決める。一致しないパスがあれば、古い結果として失敗させる。厳しめだが、実装が変わったのに照合を省くことが起きない。

### D7. 許容承認は、差分画像の sha256 に結び付ける

`mockup-report.md` の `## 許容判断` 表の列は、MK-ID、Viewport、差分 digest、理由、承認者、承認日にする。差分 digest は `record` が `## 所見` 表に転記する。人間は、確認した画像の digest をそのまま写す。比較をやり直して画像が1バイトでも変われば、承認は無効になる。マスクや閾値の変更は、mockup-plan の行の digest で検出する（D6 の鮮度判定と別に、行の digest の一致も求める）。

### D8. 実行環境の申告は、CI での再実行で裏付ける（verify）

`MOCKUP_CONTAINER_IMAGE` は誰でも設定できる。そこで CI では、正の画像で比較テストを実行し直し、`mockup-gate.mjs verify --results <dir>` でコミット済みの結果と照合する。画像の sha256 まで一致しなければ失敗する。コミットした結果は「人間が承認した対象の記録」であり、CI の再実行は「その記録が正の環境で再現する」ことの証明になる。この2つで承認と強制を分ける。

### D9. testkit の版の判定

- install と doctor は、`scripts/lib/schema-family.mjs` を動的に import し、`listCompatDeclarations` と `resolveSchemaFamily` があることを確かめる。
- gate の起動時は、D1 で使う全 export を確かめる。足りなければ、どの export が無いかを表示して終了コード 2 にする。
- testkit の stamp の版番号は、比較に使わない。testkit の package version は 0.1.0 のままなので、機能の有無で判定する。

### D10. 終了コード

testkit と揃える。

| 終了コード | 意味 |
|---|---|
| 0 | 成功 |
| 1 | 検査の失敗 |
| 2 | 引数・入力・前提の不正 |
| 3 | 内部エラー（スタックトレース付き） |

install も 0 / 1 / 2 にする。

## Risks / Trade-offs

- [ブラウザの版の更新で、全 MK の差分画像が変わり、承認がまとめて無効になる] → 正の環境は policy で digest 付きに固定する。更新は policy の変更（人間の承認）として行い、そのときに全 change を再照合する手順を docs に書く。
- [厳しい鮮度判定で、文書だけの変更でも再記録が要る] → `mockup_ignore_paths` で除外できるようにする。既定値は `docs/**`、`**/*.md`（openspec 以外）、`README*`。
- [モックが実装と異なるフォントやアセットを使う] → 描画ノイズとして差分に出る。モック側をプロジェクトのアセットに合わせる運用を skill に書く。閾値の引き上げで吸収しない。
- [pixelmatch を vendor すると、上流の修正を取り込むのに手間がかかる] → 版と sha256 を `upstream/manifest.json` に記録し、testkit と同じ扱いにする。
- [testkit の非公開モジュールに依存する] → D9 の起動時チェックで、黙って誤動作しないようにする。testkit 側に公開 API を増やす要望は、必要になった時点で別の change にする。
- [AI の所見が、人間の判断を誘導する] → 所見は合否に使わない。承認者は差分画像を見て、digest を写す手順にする（画像を開かないと digest が得られない運用ではないが、手順として明記する）。

## Migration Plan

1. 導入先で testkit を PR #15 以降の版に update する。
2. `npx github:sudabon/openspec_mockup_comparison install`（必要なら `--set-default`）を実行し、`node scripts/mockup-gate.mjs doctor` が通ることを確かめる。
3. CI に、Docker 画像で比較テストを実行するステップと、`mockup-gate.mjs check --base` / `verify` を足す（`examples/ci/` を参照）。
4. 既存の change は元の schema のまま完了させる。新しい UI の change から `--schema quality-driven-e2e-mockup` で作る。
5. ロールバックは `uninstall` で行う。派生 schema を使う active change があれば中止されるので、先に archive する。

## Open Questions

- pixelmatch の既定の `threshold`（0.1）と、`mockup_default_threshold`（0.01 を想定）の初期値は、サンプル画面で実測してから決める。決まっていなくても、spec とタスクの分け方は変わらない。
