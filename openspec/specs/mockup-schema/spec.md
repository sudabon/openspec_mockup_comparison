# mockup-schema Specification

## Purpose
testkit の統合 schema のすべての artifact とゲートを引き継いだうえで、モックとの照合を計画・実施・記録する派生 schema `quality-driven-e2e-mockup` を提供する。

## Requirements

### Requirement: Generated derived schema

アドオンは、導入先の `openspec/schemas/quality-driven-e2e/` から `openspec/schemas/quality-driven-e2e-mockup/` を生成しなければならない（MUST）。生成する schema は、次をすべて満たさなければならない（MUST）。

- 統合 schema の全 artifact の `id`・`generates`・`template`・`instruction`・`requires` を変えずに持つ。ただし tasks については、`requires` に `mockup-plan` を足し、instruction の末尾に Mockup グループの指示を追記するだけにする。
- 統合 schema の全テンプレートを同じ内容で持つ。
- `apply.requires` と `apply.tracks` は統合 schema と同じにし、`apply.instruction` は統合 schema の文面の末尾にアドオンのルールを追記したものにする。
- `name: quality-driven-e2e-mockup` で、`openspec schema validate` が通る。
- `testkit-compat.json`（`{"extends": "quality-driven-e2e", "compatVersion": 1}`）を同じディレクトリに持つ。

アドオンは、統合 schema の instruction の文面を削ったり書き換えたりしてはならない（MUST NOT）。stamp には、生成元にした統合 schema の schema.yaml とテンプレートの digest を記録しなければならない（MUST）。

#### Scenario: Generated schema is recognised by testkit

- **WHEN** install のあとで testkit の doctor を実行する
- **THEN** `quality-driven-e2e-mockup` が統合系統の派生 schema として注記され、testkit の doctor は宣言の不備で失敗しない

#### Scenario: Integrated instructions are inherited verbatim

- **WHEN** 生成した schema の `quality` artifact の instruction を、統合 schema のものと比べる
- **THEN** 文字列として完全に一致する

#### Scenario: Regeneration after a testkit update

- **WHEN** testkit の update で統合 schema の `test-plan` の instruction が変わり、そのあとでアドオンの update を実行する
- **THEN** 派生 schema の `test-plan` の instruction も新しい文面になり、stamp の生成元 digest が更新される

### Requirement: Mockup plan artifact

派生 schema は artifact `mockup-plan`（`generates: mockup-plan.md`、`requires: [specs, quality]`）を持たなければならない（MUST）。mockup-plan.md は、frontmatter に `mockup: required` または `mockup: not-applicable` を持たなければならない（MUST）。`not-applicable` のときは、空でない `reason` を持たなければならない（MUST）。`required` のときは、`## モック対応表` に MK 行を1件以上持たなければならない（MUST）。表の列は次のとおり。

| 列 | 内容 |
|---|---|
| MK-ID | `MK-` と3桁の数字。change 内で一意 |
| Requirement | specs の Requirement 名 |
| Scenario | 同じ Requirement の Scenario 名 |
| Mockup | mockup root からの相対パスの HTML。任意で `#<CSS selector>` を付けて比較範囲を絞る |
| Target | 実画面の URL パス。任意で `#<CSS selector>` を付ける |
| Viewports | `幅x高さ` を `,` 区切りで1つ以上 |
| Fixture | testkit の test-plan と同じ規則の前提状態。前提が無ければ `なし` |
| Masks | 両側で隠す CSS selector と、その理由。無ければ `なし` |
| Threshold | 許容する差分率（0〜1）。空欄なら policy の既定値 |

instruction は次のことを指示しなければならない（MUST）。

- 期待値の正本はモックの HTML で、design.md や実装を期待値にしないこと。
- 日時・乱数・広告など、実行ごとに変わる領域だけをマスクし、理由を書くこと。
- 閾値を上げることはアサーションの緩和として扱い、quality.md の承認者の承認を要すること。
- quality.md の `## Non-functional Viewpoints` の「見た目の回帰」の行が、モック比較を指す Failure Mode を参照すること。

#### Scenario: UI change with mockups

- **WHEN** ログイン画面を追加する change で、`mockups/login.html` と `/login` を `1280x800, 375x812` で比べる
- **THEN** mockup-plan.md は `mockup: required` と、その条件の MK-001 行を持つ

#### Scenario: Backend-only change

- **WHEN** API だけを変える change の mockup-plan.md が `mockup: not-applicable` と `reason: UI 変更なし` を持つ
- **THEN** MK 行が無くても計画ゲートは失敗しない

### Requirement: Mockup task group and apply rules

派生 schema の tasks の instruction は、統合 schema の6グループのあとに `## 7. Mockup Comparison` を置くよう、指示を追記しなければならない（MUST）。このグループに置くタスクは次のとおり。

- MK ごとの比較テストの実装（タグは `@<change-id>` と `@MK-NNN`）
- 正とする環境での比較の実行と `mockup-results.json` の記録
- `mockup-reviewer` による別コンテキストのレビューと `mockup-report.md` の作成
- 閾値を超えた MK を、実装の修正か、人間の許容承認で解消すること

人間の許容承認はチェックボックスにせず、「人間が実施。Agent は記入しない」と注記しなければならない（MUST）。`mockup: not-applicable` の change では、不要な理由を書いたタスク1件だけにしなければならない（MUST）。

apply の追加ルールは、Agent に次のことを禁止しなければならない（MUST）。

- mockup-plan の閾値・マスク・Viewports を、実装に合わせて変えること
- モックの HTML を、実装に合わせて書き換えること
- `mockup-report.md` の承認欄（承認者・承認日・承認 digest）を記入すること
- `mockup-results.json` を手で編集すること

#### Scenario: Agent tries to relax a threshold

- **WHEN** apply 中に MK-002 の差分率が閾値を超える
- **THEN** apply の指示に従い、Agent は閾値を変えずに実装を直すか、人間に許容承認を依頼して止まる
