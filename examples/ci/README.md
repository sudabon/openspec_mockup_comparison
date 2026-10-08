# CI の組み込み例

[mockup-comparison.yml](mockup-comparison.yml) を `.github/workflows/` にコピーし、testkit のゲート（`openspec-custom-testkit-gate.yml`）と並べて使います。testkit の CI ジョブはアドオンのゲートを呼ばないので、両方が必要です。

| job | 内容 |
|-----|------|
| mockup-gate | `mockup-gate.mjs check --base origin/<base>`。派生 schema の change の計画、記録された結果、許容判断を検査する。比較元で派生 schema だった change の付け替えもここで失敗する |
| mockup-compare | policy の `mockup_reference_environment` と同じ Docker 画像で比較テストを実行し、差分画像を artifact に残す。続けて `verify` で、コミット済みの `mockup-results.json` が同じ画像で再現するかを確かめる |

## 守ること

- `container.image`、`MOCKUP_CONTAINER_IMAGE`、policy の `mockup_reference_environment` を同じ値（`名前@sha256:digest`）にする。値を変えるときは policy の「正とする実行環境を更新する手順」に従う。
- `verify` は、コミット済みの結果がある active change をすべて照合する。結果を記録した change は、記録後に実装やモックを変えていなければ同じ画像になる。変えたなら、正の環境で比較をやり直して `record` する。
- PR のタイトルや本文を `run:` に展開しない。比較元のブランチ名は `env:` 経由で渡す。
- `|| true` などで失敗を隠さない。
- 差分画像には画面の内容がそのまま写る。テストデータは合成データにし、artifact の保持日数は必要な期間に絞る。

## ブランチ保護

testkit と同じく、宣言の削除や schema の付け替えの検出は、比較元 ref を付けた PR の検査が前提です。main への直接 push はブランチ保護で防ぎ、`mockup-gate` と `mockup-compare` を必須のチェックにします。
