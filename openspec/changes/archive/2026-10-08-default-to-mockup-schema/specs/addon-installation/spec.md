# Spec Delta

## MODIFIED Requirements

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
