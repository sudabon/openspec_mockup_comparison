# Tasks

> 検証の前提: testkit（`sudabon/openspec_custom_testkit`）の PR #15 以降を、テスト用の一時 repo に導入できること。テストの helper は、testkit を `npx github:...` ではなく、ローカルの clone か pack した tgz から導入する。

## 1. パッケージの土台

- [x] 1.1 `package.json` を作る。内容は次のとおり。
  - `bin: openspec-mockup-comparison → install.mjs`
  - `engines.node >= 20`
  - `files`
  - scripts（`test`、`lint`、`test:smoke`）
  - devDependencies: `@playwright/test`、`yaml`

  `install.mjs`、`lib/cli.mjs` の骨格（USAGE と引数の解析。終了コード 2 の扱いは D10）と、`scripts/lint.mjs` も作る。`node install.mjs --help` が USAGE を表示し、未知の引数で終了コード 2 になることを `test/cli.test.mjs` で確認する
- [x] 1.2 yaml と pixelmatch を `payload/scripts/lib/mockup/vendor/` に vendor し、LICENSE を添える。`upstream/manifest.json` に版と sha256 を記録し、`scripts/build-manifest.mjs --check` が通ることを確認する
- [x] 1.3 testkit を一時 repo に導入する test helper を `test/support.mjs` に作る（ローカルの testkit のパスは環境変数で指定し、未指定なら skip せずに失敗させる）。`npm test` でその helper の動作確認テストが通ることを確認する。README に開発時の前提を書く

## 2. 導入・更新・削除と doctor（addon-installation）

- [x] 2.1 testkit の前提の判定（D9）を実装する。spec の testkit is not installed / testkit is too old のとおり、書き込みなしで終了コード 1 になることを `test/install.test.mjs` で確認する
- [x] 2.2 配布ファイルの配置、stamp `.openspec-mockup-comparison.json`、`--dry-run`、`--force`、policy の保護を、testkit と同じ規則で実装する。Re-running install / Edited policy is kept / testkit files untouched を `test/install.test.mjs` で確認する
- [x] 2.3 config.yaml の context へのマーカー付きの追記と、`--set-default` を実装する。`store:`・alias・独自 tag を含む config では止まるようにする。Default schema is kept と、マーカーが重複しないことを `test/config.test.mjs` で確認する
- [x] 2.4 `uninstall` を実装する（active change があれば中止。policy は残し、既定 schema を元に戻す）。Active change still uses the schema と、通常の削除を `test/install.test.mjs` で確認する
- [x] 2.5 `mockup-gate.mjs doctor` を実装する。前提、stamp、必須ファイルの sha256、同期のずれ、testkit による宣言の判定、policy の妥当性、`@playwright/test` の注記を見る。testkit was updated after the add-on を `test/doctor.test.mjs` で確認する
- [x] 2.6 `docs/install.md` と README の導入手順を書き、手順どおりに一時 repo で install → doctor が通ることを確認する

## 3. 派生 schema の生成（mockup-schema）

- [x] 3.1 D2 の生成処理を `lib/derive-schema.mjs` に実装する。対象は AST の編集、`mockup-plan` の挿入、tasks と apply への追記、テンプレートのコピー、生成後の自己検査。Integrated instructions are inherited verbatim（全 artifact の instruction の一致）を `test/derive-schema.test.mjs` で確認する
- [x] 3.2 `mockup-plan` の instruction、`templates/mockup-plan.md`、`templates/mockup-report.md`、tasks に追記する `## 7. Mockup Comparison` の指示、apply の追加ルール（spec の Mockup task group and apply rules）を書く。生成した schema で `openspec schema validate quality-driven-e2e-mockup` と `openspec new change demo --schema quality-driven-e2e-mockup` が通り、`openspec instructions mockup-plan --change demo` に表の列定義が出ることを `test/derive-schema.test.mjs` で確認する（OpenSpec CLI が無ければ skip せずに失敗）
- [x] 3.3 testkit の doctor と `select --json` が、生成した schema を統合系統と判定することを確認する（Generated schema is recognised by testkit）。統合 schema の instruction を書き換えてから update したときに再生成されることも確認する（Regeneration after a testkit update）

## 4. 比較ヘルパーと結果の記録（mockup-comparison-run）

- [x] 4.1 静的サーバー（D4）を `payload/tests/e2e/support/mockup-server.ts` に実装する。対象は root 外へのアクセスの拒否と、配信したファイルの記録。`../`、絶対パス、symlink で root の外に出るアクセスが 403 になり、配信したパスの一覧が返ることを `test/mockup-server.test.mjs` で確認する
- [x] 4.2 ブラウザ内での差分計算（D3）を実装する。同じ画像の組から、2回の実行で同じ差分率と同じ差分画像の sha256 が出ることと、寸法が違えば差分率が 1 になることを、Playwright の smoke（`test/smoke/compare.spec.mjs`）で確認する
- [x] 4.3 `compareWithMockup` を `payload/tests/e2e/support/mockup.ts` に実装する。対象は、タグと MK の照合、viewport ごとの撮影、安定化、マスク、selector の一意性、閾値とマスク面積率の判定、実行ディレクトリへの JSON と画像の出力。`test/smoke-app/`（モック `mockups/login.html` とローカルのアプリ）で、Matching screen / Missing plan row / Ambiguous selector を smoke として確認する
- [x] 4.4 `mockup-gate.mjs record <change>` を実装する。全 MK の集約、`missing` の記録、commit と dirty、環境の記録、mockup digest と plan 行の digest、既存結果の置き換えを行う。Recording after a run / Uncommitted changes during the run を `test/record.test.mjs` で確認する

## 5. ゲート（mockup-gate）

- [x] 5.1 `mockup-gate.mjs check` の対象選択（testkit の `selectChanges` を使い、`declaredSchema` で絞る。終了コード 2 は伝える）と、D9 の export のチェックを実装する。Mixed pull request / Switched away from the mockup schema を `test/gate-select.test.mjs` で確認する
- [x] 5.2 計画ゲートの全項目（spec の Plan checks）と、policy の読み込み（spec の Policy。環境変数の無視を含む）を実装する。Threshold over the policy limit / Mockup outside the root / Environment variable cannot relax the gate、および各失敗項目を1ケースずつ `test/gate-plan.test.mjs` で確認する
- [x] 5.3 final ゲートの結果の検査（spec の Final checks on results）を実装する。Implementation changed after the run / Result from a local machine / Mockup edited after the run と、`not-applicable` で結果を要求しないことを `test/gate-final.test.mjs` で確認する
- [x] 5.4 許容承認の検査（D7）と、所見の有無の検査を実装する。Approved intentional difference / Approval for an older diff / Reviewer says noise but no approval を `test/gate-final.test.mjs` で確認する
- [x] 5.5 `mockup-gate.mjs verify`（D8）を実装する。Results produced outside the reference environment と、組の欠落を `test/verify.test.mjs` で確認する

## 6. Agent 向けの配布物

- [x] 6.1 `payload/.claude/skills/mockup-comparison/SKILL.md` を書く。内容は、MK テストの書き方、タグ、マスクの基準、閾値を緩めないこと、モックを書き換えないこと、正の環境での実行手順。`payload/openspec/roles/mockup-reviewer.md` と `payload/.claude/agents/mockup-reviewer.md` も書く（入力は allowlist のみ、所見は分類と根拠、承認欄の記入禁止）。lint で、承認欄の記入禁止の文言が3ファイルと schema の instruction にあることを検査し、`npm run lint` が通ることを確認する
- [x] 6.2 `payload/openspec/mockup-policy.md` を書く。全キー、既定値、正の環境の記入例、環境の更新時の再照合手順を含める。doctor が配布版の policy を妥当と判定することを `test/doctor.test.mjs` で確認する

## 7. CI と文書

- [x] 7.1 `examples/ci/` に GitHub Actions の例を置く。Playwright 公式 Docker 画像での比較の実行、`MOCKUP_CONTAINER_IMAGE` の設定、`mockup-gate.mjs check --base` と `verify`、差分画像の artifact 化を含める。README で testkit の gate と並べて案内する。`actionlint` 相当の YAML 検査を lint に足し、通ることを確認する
- [x] 7.2 `docs/workflow.md` を書く。内容は、人間が行うこと（plan のレビュー、許容承認、正の環境の更新）、change の流れ、終了コード、限界（申告された環境を verify で裏付けること、ブラウザ更新時の再承認）。`docs/architecture.md` に D1 の依存関係を書く

## 8. 統合確認

- [x] 8.1 `npm test`、`npm run lint`、`npm run test:smoke`、`npm pack --dry-run` がすべて通ることを確認する
- [x] 8.2 一時 repo で testkit → アドオンの順に導入する。モック付きの change を1つ作り、plan から archive までを通す。途中で次の3点を確かめる
  - 閾値を超えた MK の承認前は final が失敗する
  - 承認後は通る
  - 再実行で差分画像が変わると、再び失敗する

  結果を `docs/verification-log.md` に残す
