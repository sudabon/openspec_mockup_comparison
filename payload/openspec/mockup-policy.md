# Mockup Comparison Policy

モック比較アドオン（openspec-mockup-comparison）の基準。値は人間が決めて管理する。Agent はこのファイルを編集しない。
各キーは、インデント・箇条書き記号・バッククォートの無い独立した行で `key: value` と書く。環境変数では上書きできない。

## 設定

mockup_root: mockups
mockup_default_threshold: 0.01
mockup_max_threshold: 0.05
mockup_max_mask_ratio: 0.3
mockup_pixel_tolerance: 0.1
mockup_reference_environment: mcr.microsoft.com/playwright:v1.55.1-noble@sha256:2f29369043d81d6d69a815ceb80760f55e85f5020371ad06a4d996f18503ad1c
mockup_ignore_paths: [docs/**, README*, "**/*.md"]

| キー | 意味 |
|------|------|
| mockup_root | モックの HTML・CSS・画像を置くディレクトリ（repo 相対）。比較ではここを document root にした静的サーバーでモックを開く |
| mockup_default_threshold | mockup-plan の Threshold が空欄のときの許容差分率（差のある画素数 ÷ 比較範囲の画素数） |
| mockup_max_threshold | mockup-plan に書ける Threshold の上限。これを超える行は計画ゲートで失敗する |
| mockup_max_mask_ratio | マスクが比較範囲に占める面積率の上限。これを超える比較は error になる |
| mockup_pixel_tolerance | 画素ごとの色の許容差（pixelmatch の threshold）。小さいほど厳しい |
| mockup_reference_environment | 正とする実行環境。Playwright 公式 Docker 画像を `名前@sha256:digest` で書く。final ゲートはこの環境の結果だけを受け付ける |
| mockup_ignore_paths | 比較の実行後に変わっても結果を古いとみなさないパスの glob。`openspec/**` と mockup_root は常に含む |

## 人間が行うこと

- mockup-plan.md のレビュー。閾値・マスク・Viewports の妥当性は、ゲートではなく人間が判断する。
- mockup-report.md の `## 許容判断` の記入。差分画像を見て許容する結果ごとに、承認者・承認日・差分 digest を書く。
- 正とする実行環境の更新。Playwright やブラウザの版を上げると、全 MK の差分画像が変わり、既存の許容承認は無効になる。

## 正とする実行環境を更新する手順

1. 新しい画像の digest を確認する（`docker buildx imagetools inspect mcr.microsoft.com/playwright:<tag>`）。
2. このファイルの `mockup_reference_environment` と、CI の比較ジョブの `container.image` を同じ値に変える。
3. 進行中の `quality-driven-e2e-mockup` の change すべてで、比較をやり直して `node scripts/mockup-gate.mjs record <change>` を実行する。
4. 差分が出た結果は、mockup-reviewer の所見を付け直し、人間が許容判断をやり直す。
