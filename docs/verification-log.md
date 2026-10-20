# 検証記録

## 2026-10-08 — 正の環境での通し確認（tasks 8.2）

ホストは macOS（Apple silicon）、Docker の画像は `mcr.microsoft.com/playwright:v1.55.1-noble@sha256:2f29369043d81d6d69a815ceb80760f55e85f5020371ad06a4d996f18503ad1c`（このホストでは linux/arm64 で動く）。testkit は `sudabon/openspec_custom_testkit` の main（PR #15 のマージ後、`2761ff5`）。

一時リポジトリに testkit → アドオンの順で導入した。`test/smoke-app` のアプリとモックを置き、`quality-driven-e2e-mockup` の change `add-login` を作った（MK-001: 一致する画面、viewport 2つで時計をマスク。MK-002: フォームを下げた画面、閾値 0.01）。

| 手順 | 結果 |
|------|------|
| 1. `check`（plan） | exit 0 |
| 2. Docker 画像で比較テスト | MK-001 は pass。MK-002 は `diff 差分率 0.025943（閾値 0.01）` でテストが失敗（想定どおり） |
| 3. `record add-login` | exit 0。`pass 2 / diff 1`、環境は画像の digest・linux・arm64・chromium 140.0.7339.186・Playwright 1.55.1 |
| 4. `check --phase final`（承認前） | exit 1。所見の分類・根拠の欠落と、閾値超過に許容判断が無いことを表示 |
| 5. 所見を記入し、人間の許容判断（差分 digest 付き）を追記して final | exit 0 |
| 6. 同じ画像でもう一度比較し、`verify --results` | exit 0。3組すべて status・差分率・3画像の sha256 が一致（同じ環境で再現する） |
| 7. 実装（`app/public/login-shifted.html`）を変えてコミットし final | exit 1。比較の実行後に変わったファイルとして表示 |
| 8. 比較をやり直して record し、古い許容判断のまま final | exit 1。「許容判断の差分 digest が現在の差分画像と一致しません（比較をやり直したため承認は無効です）」 |
| 9. 許容判断をやり直し、全タスクを完了にして check（phase は final） | exit 0 |
| 10. `openspec archive add-login --yes` | exit 0 |
| 11. archive への移動を `check --base <移動前>` で検査 | exit 0。`add-login (archived/final)` として最終検査された |

手順 7 の失敗一覧には、検証スクリプトが `.gitignore` に入れ忘れた Playwright の出力先（`run2-output/`）も出た。アドオンの不具合ではない。

### 分かったこと

- 同じ画像は manifest list で、ホストの CPU に合わせて arm64 と amd64 のどちらでも動く。Apple silicon の手元で作った結果と、amd64 の CI の再実行では、描画が変わる可能性がある。結果には `environment.arch` を記録し、`verify` は再実行との違いを警告する。正の結果は CI と同じアーキテクチャ（`docker run --platform linux/amd64`、または CI 上）で作る。

## 2026-10-08 — 自動テスト

| コマンド | 結果 |
|----------|------|
| `TESTKIT_DIR=../openspec_custom_testkit npm test` | 83 件 pass |
| `npm run lint` | ok |
| `node scripts/build-manifest.mjs --check` | up to date |
| `TESTKIT_DIR=../openspec_custom_testkit npm run test:smoke` | Playwright 6 件 pass、record / check / verify の確認 ok |
| `npm pack --dry-run` | 44 files |

## 2026-10-08 — 既定 schema の切り替え（change default-to-mockup-schema、tasks 4.2）

一時リポジトリに testkit（`2761ff5`）→ アドオンの順で、オプションなしに導入した。

| 手順 | 結果 |
|------|------|
| testkit 導入直後の既定 | `schema: quality-driven-e2e` |
| アドオンの install（オプションなし） | `既定 schema: quality-driven-e2e → quality-driven-e2e-mockup（初めての導入。…）` と表示。config は `schema: quality-driven-e2e-mockup`。完了時の案内は `openspec new change <name>（既定 schema が派生 schema です）` |
| `openspec new change demo`（`--schema` なし） | `.openspec.yaml` は `schema: quality-driven-e2e-mockup` |
| `node scripts/mockup-gate.mjs doctor` | `doctor: ok` |
| `node scripts/testkit-gate.mjs doctor` | exit 0。派生 schema を統合系統として扱う注記 |
| uninstall | `schema: quality-driven-e2e-mockup → quality-driven-e2e`、マーカーを削除 |
| 再 install のあとに testkit を update | testkit は「派生 schema なので変更しません」と表示し、既定は `quality-driven-e2e-mockup` のまま |

自動テスト: `npm test` 95 件 pass、`npm run lint` ok、`build-manifest --check` ok、`npm run test:smoke` ok、`npm pack --dry-run` 45 files。
