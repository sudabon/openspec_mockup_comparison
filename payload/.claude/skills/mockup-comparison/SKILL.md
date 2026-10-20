---
name: mockup-comparison
description: リポジトリ内の HTML/CSS モックアップと実装した画面を照合する比較テストの書き方と、mockup-plan・mockup-results・mockup-report の扱い。schema quality-driven-e2e-mockup の change で、比較テストを書く・実行する・結果を記録するときに使う。
---

# モック比較

schema `quality-driven-e2e-mockup` の change では、mockup-plan.md の MK 行ごとに、実画面をモック（`openspec/mockup-policy.md` の `mockup_root` 配下の HTML）と照合する。testkit の E2E 規約（`.claude/skills/e2e-conventions/SKILL.md`）にも従う。

## 比較テストの書き方

```ts
import { test } from '@playwright/test';
import { compareWithMockup } from '../support/mockup';

test('ログイン画面がモックと一致する', { tag: ['@add-login', '@MK-001'] }, async ({ page }) => {
  // 画面をモックが示す状態にする。前提状態は mockup-plan の Fixture 列の fixture・モックで作る
  await page.goto('/login');
  await compareWithMockup(page, 'MK-001');
});
```

- 1つのテストで比べる MK は1つだけ。タグは `@<change-id>` と `@MK-NNN` を両方付け、ヘルパーに渡す MK と一致させる。
- ヘルパーは mockup-plan の行の Viewports ごとに viewport を変えて撮影する。`{ navigate: true }` を付けると、撮影の前に Target の URL へ遷移する。ログインやデータが必要な画面では、遷移をテスト側で行い、navigate は付けない。
- 差分率が閾値を超えると、テストは失敗する。失敗しても、画像と result.json は `test-results/mockup/<change>/<MK>/<viewport>/` に残る。

## してはいけないこと

- mockup-plan の Threshold・Masks・Viewports・Mockup・Target を、実装に合わせて変える。変更が必要なら人間に提案する。
- モックの HTML・CSS・画像を書き換える。モックが誤っていると考えるときは、人間に報告する。
- 差分を消す目的で、待機・マスク・selector を変える。マスクは日時・乱数・広告など、実行ごとに変わる領域だけに使う。
- `mockup-results.json` を手で編集する。
- `mockup-report.md` の `## 許容判断`（承認者・承認日・差分 digest）を記入する。人間が実施。Agent は記入しない。

## 実行と記録

正とする環境は policy の `mockup_reference_environment`（Playwright 公式 Docker 画像）である。手元の macOS などで実行した結果は final ゲートで受け付けない。

```bash
# 正の環境で比較テストを実行する（例）
docker run --rm --platform linux/amd64 -v "$PWD":/work -w /work -e MOCKUP_CONTAINER_IMAGE="<policy の値>" <policy の画像> \
  npx playwright test --grep @MK-
node scripts/mockup-gate.mjs record <change>
```

- `--platform` は CI の比較ジョブと同じ CPU アーキテクチャにする。arm64 と amd64 では描画が変わることがあり、CI の verify で再現しなくなる。
- `record` は、作業ツリーに未コミットの変更がある状態の結果を記録できるが、final ゲートはその結果を受け付けない。実装をコミットしてから比較する。
- 実装・モック・mockup-plan を変えたら、比較をやり直して `record` を実行し直す。

## 所見と許容判断

- 閾値を超えた結果は、`record` が mockup-report.md の `## 所見` に転記する。分類と根拠は、別コンテキストの mockup-reviewer（`.claude/agents/mockup-reviewer.md`）が書く。
- 「実装の不備」は実装を直して比較をやり直す。「意図した差」「描画ノイズ」でも、人間の許容判断が無ければ final ゲートは失敗する。
