モック比較（派生 schema quality-driven-e2e-mockup の追加。MUST）:
- `## 6. QA Handoff` のあとに `## 7. Mockup Comparison` を置く。このグループの見出しと番号を変えない。
- `mockup: required` の change では、次のタスクを置く。
  (a) mockup-plan の MK ごとに Playwright テストを書くタスク。画面を所定の状態にしてから `compareWithMockup(page, 'MK-NNN')` を呼び、タグは `@<change-id>` と `@MK-NNN`。
      完了条件は、全 MK にテストがあり、`node scripts/mockup-gate.mjs check --phase plan` に MK のテスト欠落の警告が無いこと。
  (b) policy の mockup_reference_environment（Playwright 公式 Docker 画像）で比較を実行し、`node scripts/mockup-gate.mjs record <change>` で mockup-results.json を作るタスク。
  (c) 別コンテキストの mockup-reviewer が、mockup-report.md の `## 所見` に、diff の結果ごとの分類と根拠を書くタスク。
  (d) 閾値を超えた MK を、実装を直して再比較するか、人間の許容承認を依頼するタスク。
  さらに、次の注記をチェックボックスにせずに置く: 「`## 許容判断` の承認者・承認日・差分 digest は人間が記入する。人間が実施。Agent は記入しない」
- `mockup: not-applicable` の change では、`- [ ] 7.1 モック比較は不要（<reason>）` の1件だけにする。

例:
```
## 7. Mockup Comparison

- [ ] 7.1 MK-001 と MK-002 の比較テストを @add-login と @MK-NNN で実装し、計画ゲートに欠落の警告が無いことを確認
- [ ] 7.2 正の環境で比較を実行し、`node scripts/mockup-gate.mjs record add-login` で mockup-results.json を作る
- [ ] 7.3 mockup-reviewer（別コンテキスト）が mockup-report.md の所見を書く
- [ ] 7.4 閾値を超えた MK を、修正して再比較するか、人間に許容承認を依頼する

`## 許容判断` の承認者・承認日・差分 digest は人間が記入する。人間が実施。Agent は記入しない。
```
