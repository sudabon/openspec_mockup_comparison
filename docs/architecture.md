# 構成

`openspec-mockup-comparison` は testkit のアドオンで、導入 CLI（`install.mjs` と `lib/`）と配布物（`payload/`）からなります。installer は導入先に入りません。

## 依存の向き

```
lib/cli.mjs ──> lib/derive-schema.mjs ──> payload/schema/（追加する instruction とテンプレート）
            ──> lib/config-merge.mjs
            ──> lib/prereq.mjs ──> 導入先の scripts/lib/schema-family.mjs、e2e-root.mjs（testkit）

導入先:
scripts/mockup-gate.mjs ──> scripts/lib/mockup/*.mjs ──> scripts/lib/*.mjs（testkit。testkit.mjs が動的に読み込む）
<E2E ルート>/support/mockup.ts ──> scripts/lib/mockup/compare.mjs
```

アドオンは testkit の次の module と export を使います。起動時に `scripts/lib/mockup/testkit.mjs` が存在を確かめ、足りなければ名前を示して終了コード 2 にします。testkit の package version は比べません。

| module | export |
|--------|--------|
| select.mjs | selectChanges |
| schema-family.mjs | resolveSchemaFamily, listCompatDeclarations, readCompatDeclaration |
| frontmatter.mjs | splitFrontmatter, parseYamlText, asString, validDate, isPlainMapping |
| markdown.mjs | section, parseTable, markdownProse, hasBoundedToken |
| git.mjs | git, gitShow |
| registry.mjs | checkRegistry |
| evaluate.mjs | effectivePhase |
| tasks.mjs | parseTasks, taskState |
| e2e-root.mjs | installedE2eRoot |
| hash.mjs | sha256, sha256File |
| changes.mjs | listActiveChanges, listArchivedChanges |

## アドオンの module

| module | 持つもの |
|--------|----------|
| `constants.mjs` | schema 名、ファイル名、表の列、マーカー、MK-ID の正規表現 |
| `testkit.mjs` | testkit の module の読み込みと export の確認（`tk`） |
| `policy.mjs` | `openspec/mockup-policy.md` の解析。環境変数は無視して注記する |
| `plan.mjs` | mockup-plan の解析、セルの規則、plan 行の digest |
| `server.mjs` | モックの静的サーバー（root の外を拒否し、配信したファイルを記録） |
| `compare.mjs` | 比較ヘルパーの本体（タグの照合、撮影、ブラウザ内の差分、結果の出力） |
| `results.mjs` | glob、未コミットの変更、mockup digest、実行環境 |
| `record.mjs` | 実行結果の集約と `mockup-results.json`、所見の転記 |
| `report.mjs` | mockup-report の所見と許容判断の読み書き |
| `check.mjs` | plan / final の検査 |
| `verify.mjs` | CI の再実行との照合 |
| `doctor.mjs` | 導入状態、同期のずれ、policy の確認 |
| `base-digest.mjs` | 統合 schema の digest（stamp と doctor） |
| `yaml-safe.mjs`、`vendor/` | 同梱の yaml（ISC）と pixelmatch（ISC）。版と sha256 は `upstream/manifest.json` |

## 派生 schema の生成

`lib/derive-schema.mjs` は、導入先の `openspec/schemas/quality-driven-e2e/schema.yaml` を yaml の Document API で読み、構文木を編集します（`name` と `description` の変更、`mockup-plan` の挿入、`tasks.requires` への追加、`tasks.instruction` と `apply.instruction` への追記）。生成後に読み直し、追加と追記以外に差が無いことを機械的に確かめ、差があれば何も書きません。テンプレートは統合 schema のものをそのままコピーし、`mockup-plan.md` と `mockup-report.md` を足します。stamp には生成元の schema.yaml と各テンプレートの sha256 を記録し、doctor がずれを検出します。
