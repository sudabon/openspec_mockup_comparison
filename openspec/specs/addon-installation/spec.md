# addon-installation Specification

## Purpose
testkit を導入済みのリポジトリへ、モック比較アドオンを安全に導入・更新・削除できるようにする。testkit の配布物とプロジェクト固有の設定は変えずに、前提の版と同期の状態を doctor で確認できるようにする。

## Requirements

### Requirement: testkit prerequisite

install と update は、導入先が次の条件をすべて満たすことを MUST 確認する。

- testkit の stamp（`.openspec-custom-testkit.json`）が読める
- `scripts/lib/schema-family.mjs` が `listCompatDeclarations` を export している（派生 schema の削除と付け替えを検出する版）
- `openspec/schemas/quality-driven-e2e/schema.yaml` がある

満たさないときは何も書き込まず、終了コード 1 で終わらなければならない（MUST）。メッセージには、足りない前提と、testkit の install / update の手順を含める。

#### Scenario: testkit is not installed

- **WHEN** testkit の stamp が無い git リポジトリで install を実行する
- **THEN** ファイルを一つも書かずに終了コード 1 で終わり、testkit を先に導入するよう案内する

#### Scenario: testkit is too old

- **WHEN** 導入先の `scripts/lib/schema-family.mjs` が無いか、`listCompatDeclarations` を export していない
- **THEN** 書き込まずに終了コード 1 で終わり、testkit の update を案内する

### Requirement: Idempotent and non-destructive installation

install は、配布ファイル・生成した派生 schema・stamp を配置しなければならない（MUST）。同じ入力で再実行したときは、ファイルの内容・権限・stamp の `installedAt` を変えてはならない（MUST NOT）。`--dry-run` は何も書かず、予定の操作だけを表示しなければならない（MUST）。install は次のものを作成・変更・削除してはならない（MUST NOT）。

- 導入先の `package.json`
- 既存の Playwright 設定
- testkit が配布したファイル（`openspec/schemas/quality-driven-e2e/`、`openspec/quality-policy.md`、testkit の `scripts/` など）
- 既存の `openspec/mockup-policy.md`

利用者が編集した配布ファイルは、`--force` が無ければ上書きせず、差分を表示しなければならない（MUST）。`--force` でも `openspec/mockup-policy.md` は上書きしない。

#### Scenario: Re-running install

- **WHEN** 導入直後に、同じ版で install をもう一度実行する
- **THEN** どのファイルの内容も mtime も stamp の `installedAt` も変わらない

#### Scenario: Edited policy is kept

- **WHEN** 利用者が `openspec/mockup-policy.md` の閾値を編集したあとで、`update --force` を実行する
- **THEN** policy は変わらず、配布版との差分が表示される

#### Scenario: testkit files untouched

- **WHEN** アドオンを install する
- **THEN** testkit の stamp に記録されたファイルの sha256 は、install の前後で一致する

### Requirement: Config handling

install は `openspec/config.yaml` の `context` の末尾に、マーカー `# --- openspec-mockup-comparison ---` で囲んだアドオンの案内（skill のパスと MK タグの規約）を追記しなければならない（MUST）。既存のマーカーは置き換えて、重複させない。

既定の `schema:` は、次のように扱わなければならない（MUST）。

- 初めての install（アドオンの stamp が無いとき）で、既定 schema が `quality-driven-e2e`・`spec-driven`・未指定のどれかなら、`quality-driven-e2e-mockup` に変え、元の値を stamp に記録する。
- 既定 schema がそれ以外の schema なら変えず、`openspec new change <name> --schema quality-driven-e2e-mockup` を案内する。
- update と、stamp がある状態の install では、既定 schema を変えない。
- `--keep-default` が指定されたら、どの場合も変えない。
- `--set-default` が指定されたら、update でも、既定が独自 schema でも、`quality-driven-e2e-mockup` に変える。
- `--set-default` と `--keep-default` を同時に指定したら、何も書かずに終了コード 2 で終わる。

既定 schema を変えたとき、変えなかったときのどちらでも、install はその結果と元の値を表示しなければならない（MUST）。`--dry-run` は、変える予定かどうかを表示し、何も書いてはならない（MUST NOT）。`store:` を宣言している config や、YAML の alias・独自 tag を含む config は自動で編集してはならない（MUST NOT）。

#### Scenario: First install switches the integrated default

- **WHEN** 既定 schema が `quality-driven-e2e` で、アドオンの stamp が無い repo で、オプションなしに install する
- **THEN** `schema:` は `quality-driven-e2e-mockup` になり、stamp に元の値 `quality-driven-e2e` が記録され、切り替えたことが表示される

#### Scenario: Update keeps the default the user chose

- **WHEN** 導入後に利用者が `schema:` を `quality-driven-e2e` に戻し、そのあとで update を実行する
- **THEN** `schema:` は `quality-driven-e2e` のまま変わらない

#### Scenario: Custom default is kept

- **WHEN** 既定 schema が `team-custom` の repo で、オプションなしに初めての install をする
- **THEN** `schema:` は変わらず、派生 schema で change を作るコマンドが表示される

#### Scenario: Default schema is kept

- **WHEN** 既定 schema が `quality-driven-e2e` の repo で、`--keep-default` を付けて初めての install をする
- **THEN** `schema:` は変わらず、派生 schema で change を作るコマンドが表示される

#### Scenario: Conflicting options

- **WHEN** `--set-default` と `--keep-default` を両方付けて install する
- **THEN** 何も書かずに終了コード 2 で終わる

### Requirement: Doctor reports readiness and drift

`node scripts/mockup-gate.mjs doctor` は、次のいずれかに当てはまるとき失敗しなければならない（MUST）。

- testkit の前提を満たさない
- アドオンの stamp が壊れているか、無い
- stamp に記録した必須ファイルが無いか、内容が違う
- 派生 schema の生成元に使った統合 schema の digest が、現在の `openspec/schemas/quality-driven-e2e/schema.yaml` と違う（同期のずれ）
- testkit の `resolveSchemaFamily` が派生 schema を有効と判定しない
- `openspec/mockup-policy.md` が無いか不正

`@playwright/test` が導入先に無いときは、失敗ではなく注記で案内しなければならない（MUST）。

#### Scenario: testkit was updated after the add-on

- **WHEN** testkit の update で統合 schema が変わり、アドオンの update をまだ実行していない
- **THEN** doctor は同期のずれとして失敗し、アドオンの update を案内する

### Requirement: Safe uninstall

`uninstall` は、`quality-driven-e2e-mockup` を `.openspec.yaml` で宣言する active change が一つでもあれば、何も削除せずに終了コード 1 で終わらなければならない（MUST）。そのときは対象の change を一覧で示す。active change が無ければ、アドオンが配置して内容が変わっていないファイル、生成した派生 schema、config のマーカー、stamp を削除し、`openspec/mockup-policy.md` は残さなければならない（MUST）。既定 schema が派生 schema のときは、`quality-driven-e2e` に戻さなければならない（MUST）。

#### Scenario: Active change still uses the schema

- **WHEN** 派生 schema を使う進行中の change `add-login-page` がある状態で uninstall を実行する
- **THEN** 何も削除せず、`add-login-page` を archive するか作り直すよう案内して終了コード 1 で終わる
