---
mockup: required
reason: ""
---

# Mockup Plan

期待値の正本は mockup root（openspec/mockup-policy.md の mockup_root）配下の HTML モックです。design.md や実装を期待値にしません。
`mockup: not-applicable` のときは reason を書き、下の表に MK 行を置きません。

## モック対応表

Mockup と Target は、`#` の後に CSS selector を書くと、その要素だけを比較します（例: `login.html#.login-form`）。
Masks は、バッククォートで囲んだ selector と理由の組を `;` で区切って書きます（例: `` `.clock`: 現在時刻 ``）。無ければ `なし` と書きます。
Threshold が空欄なら policy の既定値を使います。上限を超える値はゲートで失敗します。

| MK-ID | Requirement | Scenario | Mockup | Target | Viewports | Fixture | Masks | Threshold |
|-------|-------------|----------|--------|--------|-----------|---------|-------|-----------|
| MK-001 | | | | | 1280x800 | なし | なし | |

## 補足
