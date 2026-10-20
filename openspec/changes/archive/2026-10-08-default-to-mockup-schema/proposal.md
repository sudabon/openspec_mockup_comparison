# Proposal

## Why

今は install のあとも、既定の schema が `quality-driven-e2e` のまま残ります。そのため、change を作るたびに `openspec new change <name> --schema quality-driven-e2e-mockup` と指定する必要があります。指定を忘れると、モック比較の無い統合 schema で change が作られます。アドオンのゲートはその change を対象外として扱うので、モックとの照合が抜けたことに誰も気付きません。

既定 schema を派生 schema にする仕組みは、既に `--set-default` として実装してあります。ただ、オプションを付け忘れると同じことが起きます。アドオンを入れる目的はモック照合を標準の流れにすることなので、初めて install したときは、既定 schema を派生 schema に切り替えるのを標準の動きにします。

## What Changes

- **初めての install** のとき、`openspec/config.yaml`（無ければ `config.yml`）の既定 schema が次のどれかなら、`schema: quality-driven-e2e-mockup` に書き換えます。元の値は stamp に記録します。
  - `quality-driven-e2e`
  - `spec-driven`
  - `schema:` の行が無い
- 既定 schema がそれ以外（旧 `quality-driven`・`spec-driven-e2e`、その他の独自 schema）のときは書き換えません。`--schema` を付けて change を作るよう案内します。testkit が独自の既定 schema を変えないのと同じ方針です。
- **update と 2回目以降の install** では、既定 schema を変えません。利用者が意図して `quality-driven-e2e` に戻した設定を、update のたびに上書きしないためです。
- 新しいオプション `--keep-default` を追加します。付けると、初めての install でも既定 schema を変えません。
- 既存の `--set-default` は残します。付けると、update でも、既定が独自 schema でも、派生 schema に切り替えます（明示した指定として優先します）。`--set-default` と `--keep-default` を両方付けると、使い方の誤りとして終了コード 2 にします。
- `--dry-run` は、既定 schema を切り替える予定かどうかを表示します。
- uninstall は、これまでどおり既定 schema が派生 schema なら `quality-driven-e2e` に戻します。
- README と `docs/install.md` に、既定を切り替えることと、UI に触れない change では mockup-plan を `not-applicable` と理由にし、tasks の 7 を1件にする手間が増えることを書きます。

## Capabilities

### New Capabilities

（なし）

### Modified Capabilities
- `addon-installation`: 「Config handling」の既定 schema の扱いを、「`--set-default` のときだけ変える」から「初めての install で、置き換えてよい既定なら変える（`--keep-default` で変えない）」に改めます。

## Impact

- コード: `lib/config-merge.mjs`（置き換えてよい既定の判定）、`lib/cli.mjs`（引数、初めての install の判定、表示、stamp）
- テスト: `test/config.test.mjs`、`test/install.test.mjs`、`test/cli.test.mjs`。既定 schema が変わらないことを前提にした既存のテスト（Default schema is kept など）を書き換えます。
- 文書: `README.md`、`docs/install.md`
- 互換性:
  - 既に導入済みのリポジトリは、update では既定 schema が変わらないので、影響はありません。
  - これから install するリポジトリでは、既定 schema が派生 schema になります。進行中の change は各自の `.openspec.yaml` の schema のまま進みます。
