## Purpose

E2E テスト観点とモックアップ比較観点の両方を、1 つの OpenSpec カスタムスキーマ `spec-driven-e2e-mockup` で扱えるようにする。仕様シナリオから E2E テストとモック比較テストまでを追跡できる状態にする。

## ADDED Requirements

### Requirement: アーティファクト構成と依存順序
スキーマ `spec-driven-e2e-mockup` は、アーティファクト proposal, specs, design, mockup-compare, test-plan, tasks を SHALL 定義する。依存関係は次のとおりとする。
- specs と design は proposal に依存する
- mockup-compare は specs に依存する
- test-plan は specs と mockup-compare に依存する
- tasks は specs, design, test-plan に依存する
- apply は tasks を要求する

#### Scenario: 新規 change の初期状態
- **WHEN** `schema: spec-driven-e2e-mockup` のプロジェクトで `openspec new change <name>` を実行し、続けて `openspec status --change <name>` を実行する
- **THEN** proposal が ready になる
- **AND** mockup-compare は specs 待ち、test-plan は specs と mockup-compare 待ち、tasks は specs, design, test-plan 待ちとして blocked に表示される

#### Scenario: スキーマの構造検証
- **WHEN** 導入先で `openspec schema validate spec-driven-e2e-mockup` を実行する
- **THEN** エラー無しで終了する

### Requirement: spec-driven-e2e との互換
proposal, specs, design, test-plan, tasks の instruction とテンプレートは、取り込み元の `spec-driven-e2e` と同じ内容を SHALL 維持する。差分は、モック比較に関する追記に限る。

#### Scenario: e2e 由来アーティファクトの内容
- **WHEN** 取り込み元 `spec-driven-e2e` と本スキーマの test-plan の instruction を比較する
- **THEN** 差分は mockup-compare への参照と VC-ID の扱いに関する追記だけである

### Requirement: mockup-compare アーティファクト
mockup-compare アーティファクトは `mockup-compare.md` を SHALL 生成する。仕様シナリオのうち見た目に関わるものを、モックとの比較観点に翻訳する。各観点には VC-001 からの連番 ID を振り、次の項目を記録する。
- 対応シナリオ
- 対応モックファイル（モックルート相対のパス）
- 比較状態（操作で到達する状態の意図）
- ビューポート
- 比較範囲（ページ全体または領域の意図）
- マスク・非表示の対象とその理由
- 許容差分率

モックと比較しないシナリオは、理由とともに「比較対象外」に SHALL 列挙する。

#### Scenario: 見た目に関わるシナリオの網羅
- **WHEN** specs に画面表示に関わるシナリオが 3 件あり、そのうち 1 件に対応するモックが無い状態で mockup-compare を作成する
- **THEN** 2 件は VC-001, VC-002 として観点一覧に載る
- **AND** 残り 1 件は「対応モックなし」という理由とともに比較対象外の表に載る

#### Scenario: セレクタを書かない
- **WHEN** mockup-compare の instruction を参照する
- **THEN** セレクタや URL といった実装詳細を書かないこと、そして新しい仕様を定義しないことが明記されている

#### Scenario: 画面変更が無い change
- **WHEN** specs に画面表示に関わるシナリオが無い
- **THEN** mockup-compare.md は「比較対象なし」とその理由だけを記載したファイルとして作成される

### Requirement: test-plan と tasks での VC の扱い
test-plan は mockup-compare の VC-ID を参照し、E2E 観点（TP-ID）との重複を避ける。tasks は、TP-ID ごとと VC-ID ごとに、1:1 の実装タスクを SHALL 列挙する。各タスクには `@<change-id>` と、`@TP-NNN` または `@VC-NNN` のタグ名を明記する。

#### Scenario: tasks のトレーサビリティ
- **WHEN** test-plan に TP-001〜TP-003、mockup-compare に VC-001〜VC-002 がある change で tasks を作成する
- **THEN** tasks.md には、TP 3 件と VC 2 件それぞれに対応する実装タスクが 1 件ずつ含まれ、タグ名が明記されている

### Requirement: config の context への規約の注入
導入後の `openspec instructions <artifact>` の `<project_context>` には、E2E 規約とモック比較規約の参照行が SHALL 含まれる。モック比較規約の参照行は、モックルートと `mockup-compare-review` スキルを指す。

#### Scenario: context の受け渡し
- **WHEN** 導入済みのプロジェクトで `openspec instructions mockup-compare --change <name>` を実行する
- **THEN** 出力の project_context に、モックルートのパスとモック比較タグ（`@VC-NNN`）の規約行が含まれる
