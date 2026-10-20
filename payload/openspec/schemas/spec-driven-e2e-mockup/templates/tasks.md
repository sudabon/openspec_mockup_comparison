## 1. <!-- Task Group Name -->

- [ ] 1.1 <!-- Task description -->
- [ ] 1.2 <!-- Task description -->

## 2. <!-- Task Group Name -->

- [ ] 2.1 <!-- Task description -->
- [ ] 2.2 <!-- Task description -->

## E2Eテスト実装タスク(必須)
- test-plan.md の各 TP-ID に対して、対応する E2E 実装タスクを 1:1 で列挙すること
- 各タスクには TP-ID とタグ名(@<change-id>, @TP-NNN)を明記すること
- E2E 実装タスクの前に、必要なシード fixture の追加タスクを置くこと
- 実装規約は .claude/skills/e2e-conventions/SKILL.md に従うこと

## モック比較テスト実装タスク(必須)
- mockup-compare.md の各 VC-ID に対して、対応するモック比較テストの実装タスクを 1:1 で列挙すること
- 各タスクには VC-ID とタグ名(@<change-id>, @VC-NNN)を明記すること
- 比較テストは tests/e2e/support/mockup-compare.ts の compareWithMockup で実装すること
- mockup-compare.md が「比較対象なし」の場合、この節は不要
