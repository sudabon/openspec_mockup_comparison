# 導入・更新・削除

## 前提

- testkit（openspec-custom-testkit）を導入済みの git リポジトリ。testkit は派生 schema の削除と付け替えを検出する版以降が必要です（`scripts/lib/schema-family.mjs` が `listCompatDeclarations` を export する版）。
- Node.js 20 以上、OpenSpec CLI 1.13.1 以上。
- 比較テストを実行するには、導入先の依存に `@playwright/test` が必要です。アドオンは `package.json` を変更しません。

前提を満たさないとき、install は何も書かずに終了コード 1 で止まり、足りないものと testkit の導入・更新の手順を表示します。

## 導入

```bash
npx github:sudabon/openspec_mockup_comparison install --dry-run   # 予定の操作を確認する。何も書き込まない
npx github:sudabon/openspec_mockup_comparison install
node scripts/mockup-gate.mjs doctor
openspec schema validate quality-driven-e2e-mockup
```

install は次のものを配置します。

| 配置先 | 内容 |
|--------|------|
| `openspec/schemas/quality-driven-e2e-mockup/` | 導入先の `quality-driven-e2e` から生成した派生 schema と `testkit-compat.json` |
| `openspec/mockup-policy.md` | 閾値・マスク・正の環境などの基準。既にあれば上書きしない（`--force` でも） |
| `scripts/mockup-gate.mjs`、`scripts/lib/mockup/` | ゲート（doctor / check / record / verify）と比較の中核 |
| `<E2E ルート>/support/mockup.ts` | 比較テストから呼ぶ `compareWithMockup` |
| `.claude/skills/mockup-comparison/SKILL.md`、`.claude/agents/mockup-reviewer.md`、`openspec/roles/mockup-reviewer.md` | Agent 向けの規約と役割 |
| `.openspec-mockup-comparison.json` | 導入記録（配置したファイルの sha256、生成元の統合 schema の digest） |

`openspec/config.yaml` の `context` には、マーカー `# --- openspec-mockup-comparison ---` で囲んだ案内を追記します。

### 既定 schema

| 状況 | 既定の `schema:` |
|------|------------------|
| 初めての install（`.openspec-mockup-comparison.json` が無い）で、既定が `quality-driven-e2e`・`spec-driven`・未指定 | `quality-driven-e2e-mockup` に変え、元の値を stamp の `defaultSchemaBefore` に記録する |
| 既定が旧 `quality-driven`・`spec-driven-e2e` やその他の独自 schema | 変えない。`openspec new change <name> --schema quality-driven-e2e-mockup` で作る |
| update と、導入済みのリポジトリでの install の再実行 | 変えない（利用者が戻した既定を上書きしない） |
| `--keep-default` | 変えない |
| `--set-default` | 必ず `quality-driven-e2e-mockup` に変える（update でも、独自 schema でも） |

`--set-default` と `--keep-default` は同時に指定できません。`store:` を宣言している config や、YAML の alias・独自 tag を含む config は編集しません。既定を元に戻すときは、`schema:` の行を書き換えます（例: `schema: quality-driven-e2e`）。進行中の change は、各自の `.openspec.yaml` の schema のまま進みます。

既定が派生 schema になると、UI に触れない change も `quality-driven-e2e-mockup` で作られます。その change では、mockup-plan.md を `mockup: not-applicable` と理由（例: `reason: UI 変更なし`）にし、tasks の `## 7. Mockup Comparison` を「`- [ ] 7.1 モック比較は不要（理由）`」の1件にします。どちらも schema の instruction が Agent に指示します。UI をほとんど変えないリポジトリでは、`--keep-default` で導入し、UI の change だけ `--schema quality-driven-e2e-mockup` を付ける運用も選べます。

同じ版の再実行は、ファイル・権限・stamp の `installedAt` を変えません。利用者が編集した配布ファイルは、`--force` が無ければ上書きせず差分を表示します。

## 更新

```bash
npx github:sudabon/openspec_mockup_comparison update
node scripts/mockup-gate.mjs doctor
```

testkit を update すると統合 schema が変わることがあります。そのとき doctor は「統合 schema が派生 schema の生成後に変わっています」として失敗します。アドオンの update を実行すると、新しい統合 schema から派生 schema を生成し直します。

## 削除

```bash
npx github:sudabon/openspec_mockup_comparison uninstall
```

`quality-driven-e2e-mockup` を使う active change が残っていると、何も削除せずに終了コード 1 で止まります。先に archive するか、別の schema で作り直します。削除では、導入した内容のままのファイル、派生 schema、config のマーカー、stamp を消し、`openspec/mockup-policy.md` と編集済みのファイルは残します。既定 schema が派生 schema なら `quality-driven-e2e` に戻します。

testkit のゲートは、比較元で有効だった派生 schema の宣言が消えると、その schema を使う change を失敗させます。使っている active change が無ければ、宣言の削除（このアンインストール）は失敗しません。
