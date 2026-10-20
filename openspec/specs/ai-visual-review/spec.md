# ai-visual-review Specification

## Purpose
ピクセル差分で閾値を超えた VC について、AI エージェントが画像を見比べ、差分の原因を分類・説明する。人間が修正方針を素早く決められるようにする。

## Requirements

### Requirement: レビューの入力
スキル `mockup-compare-review` は、`mockup-compare-results/<change-id>/` のうち判定が失敗の VC を対象に、モック画像・実画面画像・差分画像・メタデータと、mockup-compare.md の該当観点を SHALL 読む。合格した VC はレビュー対象にしない。

#### Scenario: 失敗した VC だけをレビューする
- **WHEN** VC-001 が合格、VC-002 が失敗した結果に対してスキルを実行する
- **THEN** レビュー対象は VC-002 だけになる

#### Scenario: 結果が無い
- **WHEN** `mockup-compare-results/<change-id>/` が存在しない
- **THEN** スキルはレビューを行わず、先にモック比較テストを実行するよう案内する

### Requirement: 差分の分類
スキルは、差分ごとに次のいずれかの分類を SHALL 付ける。
- `implementation-bug`: 実装の不具合
- `mock-data`: モックのダミーデータとの差
- `intended`: 仕様で意図された差分
- `mock-outdated`: モック側が古い・誤り
- `environment`: フォントや描画環境による差

分類ごとに、該当箇所（画像上の位置の説明）、根拠、推奨アクションを書く。

#### Scenario: 色の不一致
- **WHEN** 実画面のボタン色がモックと異なる
- **THEN** その差分は、位置・根拠・推奨アクション付きで `implementation-bug` などのいずれかに分類される

### Requirement: 出力と判定の扱い
スキルは、レビュー結果を `openspec/changes/<change-id>/mockup-review.md` に SHALL 書き出す。各 VC について、差分率・分類一覧・総合所見を記載する。AI の分類は助言であり、テストの合否や閾値を変更してはならない。`mock-data` や `environment` を理由にマスクや閾値を変える場合は、mockup-compare.md の変更として人間のレビューに回すよう提案する。

#### Scenario: 閾値の変更を提案する
- **WHEN** 差分の原因がすべて `mock-data` と分類された
- **THEN** mockup-review.md に、マスク追加の提案と、mockup-compare.md の該当 VC が記載される
- **AND** テストコードや閾値は変更されない

### Requirement: 周回の追跡
同じ change でレビューを複数回行う場合、スキルは既存の mockup-review.md の前回結果を残し、周回ごとの差分率の推移を SHALL 記録する。比較結果の実行開始時刻が前回と同じ場合は、同じ結果の二重転記として警告する。

#### Scenario: 同じ結果で 2 回レビューする
- **WHEN** 実行開始時刻が前回レビュー時と同じ結果で、もう一度スキルを実行する
- **THEN** 「比較が再実行されていない」という警告が出力される
