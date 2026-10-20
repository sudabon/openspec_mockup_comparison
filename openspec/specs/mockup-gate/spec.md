# mockup-gate Specification

## Purpose
派生 schema の change について、モック照合の計画・結果・人間の許容承認を、CI で決定的に検査する。AI の所見や Agent の記入では、合格にならないようにする。

## Requirements

### Requirement: Change selection follows testkit

`mockup-gate.mjs check [--phase plan|final] [--base <ref>] [<change>...]` は、testkit の配布する `selectChanges` を使って change を選ばなければならない（MUST）。選んだ change のうち、宣言上の schema（`declaredSchema`）が `quality-driven-e2e-mockup` のものを検査対象にする。比較元で `quality-driven-e2e-mockup` だった change が、HEAD で別の schema に変わっているときは、対象外にせず失敗させなければならない（MUST）。testkit の選択が入力エラーになったとき（終了コード 2）は、同じく終了コード 2 で終わらなければならない（MUST）。phase の決め方（全タスクの完了と archive で final）は、testkit と同じにしなければならない（MUST）。

#### Scenario: Mixed pull request

- **WHEN** 差分に、統合 schema の change と派生 schema の change が1つずつある
- **THEN** mockup-gate は派生 schema の change だけを検査し、統合 schema の change は対象外として表示する

#### Scenario: Switched away from the mockup schema

- **WHEN** 比較元で `quality-driven-e2e-mockup` だった change を、PR で `quality-driven-e2e` に付け替える
- **THEN** mockup-gate はその change を対象外にせず、付け替えを理由に失敗する

### Requirement: Plan checks

計画ゲートは、検査対象の change について、次のいずれかに当てはまるとき失敗しなければならない（MUST）。

- mockup-plan.md が無いのに、tasks.md がある、または final である（tasks.md も無い計画途中の change では「未作成」の注記にとどめる。testkit が未作成の test-plan を扱うのと同じ）
- frontmatter の `mockup` が欠けているか不正
- `not-applicable` なのに `reason` が無いか、MK 行がある
- `required` なのに MK 行が0件
- MK-ID の形式違いか重複
- Requirement / Scenario が change の specs に無い
- Mockup のファイルが mockup root に無いか、mockup root の外を指している
- Viewports が `幅x高さ` でない
- Fixture が testkit の fixture・mock 登録の規則に反する
- Masks に理由が無い
- Threshold が 0〜1 でないか、policy の上限を超えている
- tasks.md に `## 7. Mockup Comparison` が無い
- quality.md の `## Non-functional Viewpoints` の「見た目の回帰」の行が「該当なし」なのに、`mockup: required` である

`required` なのに、比較テストの中に `@<change-id>` と `@MK-NNN` を付けたものが無い MK があれば、計画ゲートは警告を出す。final ゲートでは失敗にしなければならない（MUST）。

#### Scenario: Threshold over the policy limit

- **WHEN** policy の `mockup_max_threshold` が 0.05 で、MK-001 の Threshold が 0.2 である
- **THEN** 計画ゲートは、上限を超える閾値として失敗する

#### Scenario: Mockup outside the root

- **WHEN** MK-002 の Mockup が `../secrets/page.html` である
- **THEN** 計画ゲートは、mockup root の外を指すパスとして失敗する

### Requirement: Final checks on results

final ゲートは、`mockup: required` の change について、`mockup-results.json` が次をすべて満たすことを確かめなければならない（MUST）。満たさないものがあれば失敗する。

- JSON として読め、全 MK・全 viewport の結果を持ち、`missing` と `error` が無い
- 実行環境が policy の `mockup_reference_environment`（コンテナ画像の名前と digest）と一致する
- 未コミットの変更が無い状態で実行されている
- 実行した commit が HEAD の祖先か HEAD である
- 実行した commit から HEAD までの差分が、`openspec/`、mockup root、policy の `mockup_ignore_paths` に一致するパスだけである
- 各結果の mockup digest と plan 行の digest が、現在のモックと mockup-plan から計算した値と一致する

`not-applicable` の change には、結果を要求してはならない（MUST NOT）。

#### Scenario: Implementation changed after the run

- **WHEN** 比較を実行したあとで `src/pages/login.tsx` を変更してコミットし、結果を再記録していない
- **THEN** final ゲートは結果が古いとして失敗し、変わったパスを表示する

#### Scenario: Result from a local machine

- **WHEN** `mockup-results.json` の環境が `local`（macOS）である
- **THEN** final ゲートは、正の環境でない結果として失敗する

#### Scenario: Mockup edited after the run

- **WHEN** 比較のあとで `mockups/login.html` が変わった
- **THEN** mockup digest が一致しないとして失敗する

### Requirement: Human acceptance bound to the diff

final ゲートは、`diff` の各結果（MK と viewport の組）について、`mockup-report.md` の `## 許容判断` 表に、承認者・承認日（YYYY-MM-DD）・承認 digest を持つ行があることを確かめなければならない（MUST）。承認 digest は、その結果の差分画像の sha256 と一致しなければならない（MUST）。行が無い、欄が空、日付が不正、または digest が一致しないときは、失敗しなければならない（MUST）。比較を再実行して差分画像が変われば、以前の承認では合格にしてはならない（MUST NOT）。承認欄は人間だけが記入する。schema の instruction、apply のルール、skill、agent の定義は、Agent が記入することを禁止しなければならない（MUST）。

#### Scenario: Approved intentional difference

- **WHEN** MK-003 の 375x812 が差分率 0.04（閾値 0.01）で、mockup-report の許容判断に、承認者・承認日と、その差分画像の sha256 がある
- **THEN** final ゲートはその結果を許容済みとして通す

#### Scenario: Approval for an older diff

- **WHEN** 承認したあとで実装を変えて比較を再実行し、差分画像の sha256 が変わった
- **THEN** final ゲートは承認 digest の不一致として失敗する

### Requirement: Reproduction check in CI

結果に記録された実行環境は、実行した側の申告にすぎない。そのため、`mockup-gate.mjs verify --results <path> [<change>...]` は、CI が正の環境で比較テストをやり直した結果を、コミット済みの `mockup-results.json` と照らし合わせなければならない（MUST）。照合で一致を求めるのは、MK と viewport の組、status、差分率、モック画像・実画像・差分画像の sha256 である。一つでも違えば、該当の組と項目を示して失敗しなければならない（MUST）。やり直した結果に、コミット済みの組が欠けているときも失敗とする。CI の組み込み例は、final 対象の change がある PR で verify を必須のステップにしなければならない（MUST）。

#### Scenario: Results produced outside the reference environment

- **WHEN** 手元の macOS で作った結果の環境欄を Docker 画像の値に書き換えてコミットし、CI が Docker 画像で比較をやり直す
- **THEN** 画像の sha256 が一致しないため、verify は失敗する

### Requirement: AI review is advisory

`mockup-reviewer` は別コンテキストで動き、入力は mockup-plan、`mockup-results.json`、モック・実画像・差分画像、role 定義だけに限らなければならない（MUST）。design.md や実装の会話を入力にしてはならない（MUST NOT）。reviewer は、`mockup-report.md` の `## 所見` 表に、`diff` の結果ごとに分類（実装の不備 / 意図した差 / 描画ノイズ）と根拠を書く。ゲートは所見の有無だけを検査し、分類の内容を合否に使ってはならない（MUST NOT）。`diff` の結果に所見が無ければ、final ゲートは失敗しなければならない（MUST）。

#### Scenario: Reviewer says noise but no approval

- **WHEN** reviewer が MK-004 の差分を「描画ノイズ」と分類したが、許容判断の行が無い
- **THEN** final ゲートは承認の欠落として失敗する

### Requirement: Policy

`openspec/mockup-policy.md` は、次のキー行を持たなければならない（MUST）。

- `mockup_root`（既定 `mockups`）
- `mockup_default_threshold`
- `mockup_max_threshold`
- `mockup_max_mask_ratio`
- `mockup_pixel_tolerance`（画素ごとの色の許容差。0〜1）
- `mockup_reference_environment`（コンテナ画像の名前と digest）
- `mockup_ignore_paths`（glob の一覧）

ゲートと doctor は、キーの欠落・型の不正・`default > max` を失敗にしなければならない（MUST）。環境変数で policy の値を変えたり、検査を外したりできてはならない（MUST NOT）。

#### Scenario: Environment variable cannot relax the gate

- **WHEN** 環境変数で `MOCKUP_MAX_THRESHOLD=1` を指定してゲートを実行する
- **THEN** ゲートは policy の値で検査し、環境変数を無視したことを注記する
