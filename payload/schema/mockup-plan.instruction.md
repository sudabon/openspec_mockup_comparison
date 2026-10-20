この change で、実装した画面をリポジトリ内の HTML/CSS モックアップとどう照合するかを定義する。
期待値の正本はモックの HTML である。design.md や既存実装を期待値にしない。新しい仕様は定義しない。

入力: proposal.md、specs/**/*.md、quality.md、openspec/mockup-policy.md、mockup root（policy の mockup_root）配下のモック。

frontmatter:
- `mockup: required` または `mockup: not-applicable` だけを書く。
- `not-applicable` は空でない `reason` を必須にし、`## モック対応表` に MK 行を置かない。
- quality.md の `## Non-functional Viewpoints` で「見た目の回帰」を「該当なし」にしたのに `mockup: required` にしてはならない。
  required の change では、「見た目の回帰」の行がモック比較を指す Failure Mode を参照し、その Failure Mode の Test Layer を E2E にする。

`## モック対応表` の列は MK-ID, Requirement, Scenario, Mockup, Target, Viewports, Fixture, Masks, Threshold。列名と順序を変えない。
- MK-ID: `MK-` と3桁の数字。change 内で重複させない。TP-ID とは別の番号体系である。
- Requirement / Scenario: specs に存在する名前をそのまま書く。
- Mockup: mockup root からの相対パスの HTML。比較範囲を要素に絞るときは `#` の後に CSS selector を書く（例: `login.html#.login-form`、id なら `login.html##main`）。
- Target: 実画面の URL パス。要素に絞るときは同じく `#` の後に selector を書く。
- Viewports: `幅x高さ` を `,` 区切りで書く（例: `1280x800, 375x812`）。
- Fixture: testkit の test-plan と同じ規則（`seed:...`、`mock:<name>`、前提が無ければ `なし`）。fixture 名は E2E ルートの `fixtures/README.md` に `<change-id>:MK-NNN` で登録する。
- Masks: 日時・乱数・広告など、実行ごとに変わる領域だけを、バッククォートで囲んだ selector と理由の組で `;` 区切りに書く（例: `` `.clock`: 現在時刻; `#ad`: 広告 ``）。無ければ `なし`。モックとの差を隠すためにマスクしない。
- Threshold: 許容する差分率（0〜1）。空欄なら policy の mockup_default_threshold。policy の mockup_max_threshold を超えてはならない。
  閾値を上げることはアサーションの緩和であり、quality.md の承認者の承認なしに変えない。

UI に触れる Scenario は、モックがある限り MK に割り当てる。モックが無い画面は、表に載せず、その理由を `## 補足` に書く。
mockup-plan.md の作成後は、人間にレビューを依頼する。
