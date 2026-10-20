## Purpose

PR 上で、change の計画アーティファクトと、対応する E2E テスト・モック比較テストの存在を検証して実行する。仕様とテストの乖離をマージ前に止める。

## ADDED Requirements

### Requirement: アーティファクトとタグの存在検証
`scripts/check-test-plan.sh` は、PR で差分のある change（archive を除く）について次を SHALL 検証する。
- `test-plan.md` があること
- `mockup-compare.md` があること
- `@<change-id>` タグ付きのテストが E2E ルートにあること
- mockup-compare.md に定義された VC-ID ごとに、`@VC-NNN` タグ付きのテストがあること

どれか 1 つでも欠けていれば、0 以外の終了コードで終了する。

#### Scenario: mockup-compare.md が無い
- **WHEN** change に test-plan.md はあるが mockup-compare.md が無い
- **THEN** `::error::` 形式で不足を報告し、終了コード 1 で終了する

#### Scenario: VC のテストが無い
- **WHEN** mockup-compare.md に VC-001 と VC-002 があり、`@VC-002` タグのテストが無い
- **THEN** VC-002 の不足が報告され、終了コード 1 で終了する

#### Scenario: 比較対象なしの change
- **WHEN** mockup-compare.md が「比較対象なし」で、VC が 1 件も無い
- **THEN** VC についての検証はスキップされる

#### Scenario: change の差分が無い
- **WHEN** PR に `openspec/changes/` の差分が無い
- **THEN** 検証をスキップして終了コード 0 で終了する

### Requirement: reusable workflow
kit リポジトリは reusable workflow `openspec-e2e-mockup-gate.yml` を SHALL 提供する。workflow は次の順で処理する。
1. 存在検証
2. change スコープの Playwright 実行（`--grep "@(<change-ids>)|@smoke"`）
3. `scripts/mockup-report.mjs` の出力をジョブサマリーに転記する
4. `mockup-compare-results/` を artifact としてアップロードする

入力として、`e2e-base-url` と `working-directory` を受け付ける。

#### Scenario: モック比較の失敗
- **WHEN** PR の change の VC-001 が差分超過で失敗する
- **THEN** ジョブは失敗し、ジョブサマリーに VC 別の表が出る
- **AND** 差分画像は artifact としてダウンロードできる

#### Scenario: change の差分が無い PR
- **WHEN** PR に change の差分が無い
- **THEN** `@smoke` だけが実行され、モック比較レポートはスキップされる
