# Tasks

> 検証コマンドは `TESTKIT_DIR=../openspec_custom_testkit` を付けて実行する。

## 1. 既定 schema の判定（config-merge）

- [x] 1.1 `lib/config-merge.mjs` の `mergeConfig` を `{ defaultMode: 'auto' | 'force' | 'keep' }` に変える（D3）。auto では `quality-driven-e2e`・`spec-driven`・未指定だけを置き換える（D2）。変えたときは元の値を返し、変えなかったときは理由付きの note を返す。`test/config.test.mjs` に、auto（置き換える既定・独自 schema・旧 schema・未指定）、force、keep のケースを追加し、既存の `setDefault` を使うテストを書き換えて、通ることを確認する
- [x] 1.2 `store:`・alias・独自 tag の config では、どのモードでも書き換えないことと、unmerge が引き続き既定を `quality-driven-e2e` に戻すことを `test/config.test.mjs` で確認する

## 2. 引数と初めての install の判定（cli）

- [x] 2.1 `lib/cli.mjs` に `--keep-default` を追加する。`--set-default` と同時に指定されたら UsageError（終了コード 2）にし、uninstall では両方とも拒否する。USAGE も更新する。`test/cli.test.mjs` で Conflicting options と USAGE の表示を確認する
- [x] 2.2 stamp の有無と引数から `defaultMode` を決め（D1）、切り替えたときは元の値を stamp の `defaultSchemaBefore` に記録して表示する。変えなかったときは理由を表示する。完了後の案内（`--schema` を付けるコマンド）は、既定が派生 schema でないときだけ出す。`test/install.test.mjs` に次のケースを追加して確認する
  - First install switches the integrated default
  - Update keeps the default the user chose
  - Custom default is kept
  - Default schema is kept（`--keep-default`）
  - 2回目の install で再実行しても何も変わらないこと（ファイル・mtime・stamp）
  - `--dry-run` で切り替えの予定が表示され、何も書かれないこと
- [x] 2.3 既存のテストのうち、既定 schema が変わらないことを前提にしたものを、新しい動きに合わせて書き換える（config.test の旧 Default schema is kept、install.test の testkit files untouched・uninstall のケースなど）。`npm test` がすべて通ることを確認する

## 3. 文書

- [x] 3.1 `README.md` の「導入」と `docs/install.md` を更新する。内容は、初めての install で既定を切り替えること、置き換える既定の範囲、`--keep-default` / `--set-default`、update では変えないこと、UI に触れない change で増える手間（mockup-plan の not-applicable、tasks の 7.1）。`npm run lint` が通ることを確認する

## 4. 統合確認

- [x] 4.1 `npm test`、`npm run lint`、`npm run test:smoke`、`npm pack --dry-run` がすべて通ることを確認する
- [x] 4.2 一時 repo に testkit → アドオンの順でオプションなしに導入し、`openspec/config.yaml` が `schema: quality-driven-e2e-mockup` になることを確認する。続けて次の3点を確かめる
  - `openspec new change demo` が `--schema` なしで派生 schema の change を作る
  - `node scripts/mockup-gate.mjs doctor` と testkit の doctor が通る
  - uninstall で既定が `quality-driven-e2e` に戻る

  結果を `docs/verification-log.md` に追記する
