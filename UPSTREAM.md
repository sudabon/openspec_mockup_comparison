# 上流 (openspec_e2e_test) からの取り込み記録

本 kit は [sudabon/openspec_e2e_test](https://github.com/sudabon/openspec_e2e_test) の payload を
取り込んだ fork である。上流の変更は自動では反映されないため、以下の手順で手動で取り込む。

## 取り込み元

| 項目 | 値 |
|------|----|
| リポジトリ | https://github.com/sudabon/openspec_e2e_test |
| ブランチ | main |
| コミット | `53e354fa366f02cf412e9ce93419463a37e8255c` |
| 上流バージョン | openspec-e2e-kit v0.2.0 |
| 取り込み日 | 2026-10-20 |

## 取り込んだファイル

| 上流のパス | 本 kit での扱い |
|-----------|----------------|
| `install.mjs` | 本 kit 用に改変(スキーマ名・記録ファイル・マーカー・モックルート判別・移行処理) |
| `payload/.claude/skills/e2e-conventions/SKILL.md` | 上流と同一に保つ |
| `payload/scripts/e2e-report.mjs` | 上流と同一に保つ |
| `payload/scripts/check-test-plan.sh` | mockup-compare.md と `@VC-NNN` の検証を追記。change 差分が無いとき `pipefail` で exit 1 になる不具合を修正 |
| `payload/playwright.config.example.ts` | 上流と同一に保つ |
| `payload/tests/e2e/fixtures/README.md` | 上流と同一に保つ |
| `payload/openspec/schemas/spec-driven-e2e/` | `payload/openspec/schemas/spec-driven-e2e-mockup/` へ転記し、mockup-compare を追加。上流のものは配布しない |
| `test/selftest.sh`, `test/fixtures/sample-results.json` | 本 kit 用に拡張 |
| `.github/workflows/openspec-e2e-gate.yml` | `openspec-e2e-mockup-gate.yml` として拡張 |
| `.gitignore` | `payload/.claude/` の追跡と `mockup-compare-results/` の除外を追記 |

「上流と同一に保つ」ファイルは、パスも内容も上流と一致させる。e2e kit から移行するリポジトリで
「内容が同じなのでスキップ」になり、利用者の変更検出がそのまま機能するようにするためである。

## 取り込み手順

1. 上流の最新を取得し、前回の取り込みコミットからの差分を確認する
   ```bash
   git clone https://github.com/sudabon/openspec_e2e_test /tmp/upstream-e2e
   git -C /tmp/upstream-e2e diff <上表のコミット>..origin/main --stat
   ```
2. 「上流と同一に保つ」ファイルはそのままコピーする
3. 改変・拡張したファイル(`install.mjs`、`check-test-plan.sh`、`schema.yaml`、テンプレート、
   `selftest.sh`、workflow)は、上流の差分を読んで手で反映する。スキーマは
   `payload/openspec/schemas/spec-driven-e2e-mockup/` の該当箇所へ転記する
4. `test/upstream/` のスナップショットを上流の内容で更新する。selftest はこれを使って
   上流との差分チェック(スキーマ)と e2e kit からの移行シナリオ(check-test-plan.sh)を検証する
   - `test/upstream/spec-driven-e2e/` ← 上流 `payload/openspec/schemas/spec-driven-e2e/`
   - `test/upstream/scripts/check-test-plan.sh` ← 上流 `payload/scripts/check-test-plan.sh`
   - `test/upstream/openspec-e2e-gate.yml` ← 上流 `.github/workflows/openspec-e2e-gate.yml`(参照用)
5. `npm test` を実行する
6. 上表のコミットと取り込み日を更新する
