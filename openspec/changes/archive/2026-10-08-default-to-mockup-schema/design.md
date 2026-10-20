# Design

## Context

動機は proposal.md の Why を参照。現状の実装は次のとおり。

- `lib/config-merge.mjs` の `mergeConfig(original, { setDefault })` は、`setDefault` が真のときだけ `schema:` を `quality-driven-e2e-mockup` に変え、`previousDefault` を返す。偽のときは案内の note を出す。
- `lib/cli.mjs` は `--set-default` を読み、stamp の `defaultSchemaBefore` に元の値を記録する。uninstall は既定 schema が派生 schema なら `quality-driven-e2e` に戻す。
- testkit の install は、既定 schema が `spec-driven` のときだけ統合 schema に変え、それ以外の独自 schema は変えない（`REPLACEABLE`）。

## Goals / Non-Goals

**Goals:**
- 初めての install で、既定 schema を派生 schema にするのを標準の動きにする。
- 利用者が意図して選んだ既定 schema（独自 schema、戻した `quality-driven-e2e`）を上書きしない。

**Non-Goals:**
- 進行中の change の `.openspec.yaml` を書き換えること。
- uninstall で、元の値（`spec-driven` など）に戻すこと。今と同じく `quality-driven-e2e` に戻す。testkit が導入済みなので、統合 schema が正しい戻り先である。

## Decisions

### D1. 「初めての install」は、アドオンの stamp の有無で判定する

- stamp が無ければ初めての install とみなし、あれば update か再実行とみなす。uninstall は stamp を消すので、uninstall のあとの install も初めての install として扱い、既定を切り替える。これは、新しく導入したときと同じ結果になるので自然である。
- 不採用: `install` と `update` のコマンド名で区別する方式。`install` を2回実行するのはよくある操作で、2回目で利用者の選んだ既定を上書きしてしまう。
- 不採用: stamp の `defaultSchemaBefore` の有無で判定する方式。`--keep-default` で導入したリポジトリが、次の install で切り替わってしまう。

### D2. 置き換えてよい既定 schema は `quality-driven-e2e`・`spec-driven`・未指定に限る

testkit の方針（`spec-driven` だけを置き換え、独自 schema は変えない）に揃える。`quality-driven-e2e` は、testkit が設定する標準の既定なので置き換えの対象に加える。旧 `quality-driven`・`spec-driven-e2e` を既定にしているリポジトリは、移行の途中にある可能性があるので変えない。

### D3. `mergeConfig` は既定 schema の扱いを3つのモードで受け取る

`mergeConfig(original, { defaultMode })` に変える。`defaultMode` は次のどれかにする。

| モード | 動き |
|--------|------|
| `'auto'` | 置き換えてよい既定なら変える |
| `'force'` | 必ず変える |
| `'keep'` | 変えない |

`lib/cli.mjs` が、引数と stamp の有無からモードを決める。

- `--set-default` なら force
- `--keep-default` なら keep
- stamp があれば keep
- それ以外は auto

返り値の `previousDefault` は、変えたときだけ元の値（未指定なら `null` ではなく `'(なし)'` と区別できる値）を持つ。判定とメッセージは config-merge の中に閉じ、cli は表示と stamp への記録だけを担う。

## Risks / Trade-offs

- [UI に触れない change でも、mockup-plan を `not-applicable` にする手間が増える] → schema の instruction が Agent に指示するので手間は小さい。README と docs/install.md に、この手間と `--keep-default` の選択肢を書く。
- [既存の利用者が `install` を再実行しても、既定が変わらないことに気付かない] → stamp があるときの install でも、既定 schema が派生 schema でなければ「既定 schema は変更しません（変えるには --set-default）」と表示する。
