# openspec-mockup-comparison

[openspec-custom-testkit](https://github.com/sudabon/openspec_custom_testkit) のアドオンです。リポジトリ内の HTML/CSS モックアップと実装した画面をピクセル単位で照合し、差分を OpenSpec の change ごとにゲートで検査します。

testkit の統合 schema `quality-driven-e2e` を引き継いだ派生 schema `quality-driven-e2e-mockup` を生成して配布します。testkit の人間承認・Oracle seal・独立反証・E2E ゲートはそのまま働き、そこにモック照合が加わります。

## 導入

testkit を導入済みの git リポジトリで実行します。詳細は [docs/install.md](docs/install.md) にあります。

```bash
npx github:sudabon/openspec_mockup_comparison install
node scripts/mockup-gate.mjs doctor
openspec new change <name>
```

初めての install では、`openspec/config.yaml` の既定 schema が `quality-driven-e2e`・`spec-driven`・未指定なら `quality-driven-e2e-mockup` に書き換えます。以後の change は `--schema` を付けなくても、モック比較つきで作られます。既定を変えたくないときは `--keep-default` を付けます。UI に触れない change では、mockup-plan.md を `mockup: not-applicable` と理由にし、tasks の `## 7. Mockup Comparison` を不要の理由を書いた1件にします（schema の instruction が Agent に指示します）。

## 開発

Node.js 20 以上、OpenSpec CLI 1.13.1 以上、Playwright の Chromium を使います。テストは testkit を一時リポジトリへ導入して動かすので、testkit の clone を `TESTKIT_DIR` で指定します。未指定のときテストは skip せずに失敗します。

```bash
npm install
npx playwright install chromium
TESTKIT_DIR=../openspec_custom_testkit npm test
npm run lint
TESTKIT_DIR=../openspec_custom_testkit npm run test:smoke
npm pack --dry-run
```

testkit は派生 schema の削除と付け替えを検出する版（`scripts/lib/schema-family.mjs` が `listCompatDeclarations` を export する版）以降が必要です。
