モック比較のルール（派生 schema quality-driven-e2e-mockup の追加。すべて MUST）:
M1. mockup-plan.md の Threshold・Masks・Viewports・Mockup・Target を、実装に合わせて変えない。変更が必要なら人間に提案して止まる。
M2. mockup root 配下のモック（HTML・CSS・画像）を書き換えない。モックが誤っていると考えるときは、人間に報告して止まる。
M3. mockup-results.json を手で編集しない。結果は `node scripts/mockup-gate.mjs record <change>` だけで作る。
M4. mockup-report.md の `## 許容判断` の承認者・承認日・差分 digest を記入しない。人間が実施。Agent は記入しない。
M5. `## 所見` は、別コンテキストの mockup-reviewer に書かせる。入力は openspec/roles/mockup-reviewer.md の allowlist に限る。
M6. 閾値を超えた MK を「描画ノイズ」と判断しても、それだけで完了にしない。実装を直して再比較するか、人間の許容承認を待つ。
M7. 比較テストで、待機・マスク・スクリーンショットの範囲を、差分を消す目的で変えない。
