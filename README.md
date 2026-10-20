# openspec_mockup_comparison

OpenSpec プロジェクトに「仕様シナリオ → E2E テスト観点・モック比較観点 → Playwright テスト → PR での実行」の
導線を 1 コマンドで組み込む bootstrap kit(パッケージ名 `openspec-e2e-mockup-kit`)。

OpenSpec はプロジェクトごとに 1 つのスキーマしか有効にできず、スキーマの継承や合成もできない。
そこで E2E テスト計画の kit [openspec_e2e_test](https://github.com/sudabon/openspec_e2e_test)(スキーマ
`spec-driven-e2e`)を取り込み、モックアップ比較を加えた合成スキーマ **`spec-driven-e2e-mockup`** として単独で配布する。

モックは静止画像ではなく、HTML/CSS/JS で動く**動的モック**を前提にする(画面 ID ごとの HTML、共通 JS の
ダミーデータ、スケルトン表示、ドロワーの開閉などを持つもの)。実画面とモックを同じ状態・同じ条件で
キャプチャし、ピクセル差分率で機械的に判定する。

`openspec update` で再生成される `.claude/commands/opsx/` などの生成物には触れないので、
OpenSpec 本体をアップグレードしても設定は消えない。

## 導入

```bash
npx github:sudabon/openspec_mockup_comparison
```

`openspec init` の前でも後でも導入できる。

```bash
# openspec init の前に導入する場合
npx github:sudabon/openspec_mockup_comparison --language Japanese
openspec init --tools claude          # --language は付けない

# openspec init の後に導入する場合
openspec init --tools claude --language Japanese
npx github:sudabon/openspec_mockup_comparison
```

kit が `openspec/config.yaml` を作成した後に `openspec init --language` を実行すると、**エラーで中断する**
(OpenSpec は既存の config を `--language` で上書きしない)。言語は kit の `--language` で指定する。

モック比較には、導入先の devDependencies に次のパッケージが必要になる。インストーラは package.json を
**書き換えず**、足りないパッケージのインストールコマンドだけを表示する。

```bash
npm i -D @playwright/test pngjs pixelmatch
```

> `pixelmatch` v6 以降は ESM のみで配布されている。CommonJS のプロジェクトでは Node.js 20.19 / 22.12 以降
> (`require(esm)` 対応版)を使う。

対象リポジトリのルートで実行する。別ディレクトリを対象にするときは `--target` を使う。

```bash
npx github:sudabon/openspec_mockup_comparison install --target /path/to/repo
npx github:sudabon/openspec_mockup_comparison --dry-run      # 書き込まず、配置予定・判別したルート・config の変更予定を表示
```

## 更新

```bash
npx github:sudabon/openspec_mockup_comparison update
```

内容が同じファイルは黙ってスキップする。導入先で内容が変わっているファイルは**上書きせず**、unified diff を
表示してスキップし、最後に一覧で表示する。kit 側の内容で揃えたいときだけ `--force` を付ける。

```
usage: openspec-e2e-mockup-kit [install|update] [--force] [--dry-run] [--target <dir>] [--e2e-root <path>] [--mockup-root <path>] [--language <lang>]
```

## ルートの自動判別

インストーラは **E2E ルート**と**モックルート**の 2 つを判別し、配置先のパスと配布ファイルの中身の両方に反映する。

### E2E ルート

取り込み元の e2e kit と同じ優先順で判別する。

1. `--e2e-root <path>` の明示指定
2. `.openspec-e2e-mockup-kit.json` の記録値(無ければ、移行元 `.openspec-e2e-kit.json` の記録値)
3. Playwright 設定の `testDir`(深さ 3 まで `playwright.config.*` を探す)
4. 既存ディレクトリ(`e2e/`、`tests/e2e/`、`playwright/`)
5. 既定値 `tests/e2e`

### モックルート

1. `--mockup-root <path>` の明示指定
2. `.openspec-e2e-mockup-kit.json` の記録値
3. 深さ 3 までにある `mockup` / `mockups` / `mock` という名前のディレクトリのうち、HTML を含む最も浅いもの
4. 既定値 `mockup`

```
$ npx github:sudabon/openspec_mockup_comparison --dry-run
E2E ルート: tests/e2e  (既定値(検出できず))
モックルート: requirements/mockup  (HTML を含む requirements/mockup)
```

判別したモックルートは、スキーマの instruction、mockup-compare テンプレート、レビュースキル、比較ヘルパーの
`MOCKUP_ROOT`、config.yaml の context 行に書き込まれる。候補が複数あれば、採用したものと対象外にしたものを表示する。
前回と違うルートにした場合は、古い場所のファイルを削除せず警告だけを出す。配布ファイルの内容が新しいルートで
変わるため、差分ありでスキップされたファイルは `--force` で更新する。

## 導入されるもの

| 配置先 | 内容 |
|--------|------|
| `openspec/schemas/spec-driven-e2e-mockup/` | 合成スキーマ。`spec-driven-e2e` に `mockup-compare` アーティファクトを追加したもの |
| `.claude/skills/e2e-conventions/SKILL.md` | Playwright E2E の実装規約(e2e kit と同一) |
| `.claude/skills/mockup-compare-review/SKILL.md` | 差分超過した VC を AI が見比べて分類する手順 |
| `<e2eRoot>/support/mockup-compare.ts` | モック比較ヘルパー `compareWithMockup` |
| `<e2eRoot>/fixtures/README.md` | シード fixture の対応表テンプレート(e2e kit と同一) |
| `scripts/e2e-report.mjs` | Playwright JSON レポートから TP-ID 別の結果表を出す(e2e kit と同一) |
| `scripts/mockup-report.mjs` | モック比較の結果から VC-ID 別の結果表を出す |
| `scripts/check-test-plan.sh` | PR の change について test-plan.md・mockup-compare.md とタグ付きテストの存在を検証する(CI 用) |
| `playwright.config.ts` | 推奨設定。リポジトリ内に既存の設定があるときは `playwright.config.example.ts` として置き、既存設定は上書きしない |
| `openspec/config.yaml` | `schema: spec-driven-e2e-mockup` の設定と、context 内へのマーカー付きブロックの追記 |
| `.openspec-e2e-mockup-kit.json` | 導入した kit のバージョン、E2E ルート、モックルート、導入時刻 |

`schema:` が無い場合、または `spec-driven`(`openspec init` の既定値)か `spec-driven-e2e`(e2e kit)の場合は、
`spec-driven-e2e-mockup` へ自動で切り替える。進行中の change は各自の `.openspec.yaml` に記録されたスキーマのまま動く。
それ以外の値(例: `quality-driven`)は変更せず、警告と change 単位で指定する方法(`--schema spec-driven-e2e-mockup`)を表示する。

### config.yaml の context

kit の行は `context: |` の**内側**にマーカーで囲んで置き、update ではマーカーの間だけを書き換える。
マーカーの外(`Language:` や他のツールの行)には触らない。

```yaml
context: |
  Language: Japanese
  # --- openspec-e2e-mockup-kit ---
  E2Eテスト: Playwright。実装規約は .claude/skills/e2e-conventions/SKILL.md に従う。
  テストには必ず @<change-id> と @TP-NNN タグを付ける。
  モック比較: モックルートは mockup/。比較テストは tests/e2e/support/mockup-compare.ts の compareWithMockup で書き、@<change-id> と @VC-NNN タグを付ける。
  モック比較の差分超過は .claude/skills/mockup-compare-review/SKILL.md の手順でレビューする(閾値やテストは変更しない)。
  # --- /openspec-e2e-mockup-kit ---
```

`mockup-compare-results/` は比較のたびに作り直される出力なので、導入先の `.gitignore` に追加しておく
(インストーラは自動では追記しない)。

```gitignore
mockup-compare-results/
```

## 導入後の開発フロー

1. **propose** — change を起票する。アーティファクトは
   `proposal → specs → {design, mockup-compare} → test-plan → tasks` の順に作る。
   - `mockup-compare.md`: 画面表示に関わる specs のシナリオを、モックとの比較観点(VC-001 から連番)に翻訳したもの。
     対応シナリオ、モックファイル(モックルート相対)、比較状態、ビューポート、比較範囲、マスク・非表示とその理由、
     許容差分率を記録する。モックと比較しないシナリオは理由とともに「比較対象外」に書く。画面変更の無い change は
     「比較対象なし」とその理由だけを書く
   - `test-plan.md`: E2E 観点(TP-001 から連番)。見た目の一致は VC に任せ、TP は振る舞いに集中する
2. **レビュー** — 人間のレビューポイント。とくに、モックのダミーデータが写る領域がマスク対象になっているか、
   モック専用の要素(説明バーなど)が非表示対象になっているかを見る。データの差を許容差分率で吸収してはならない
3. **apply** — `tasks.md` の TP-ID・VC-ID にそれぞれ 1:1 で対応する実装タスクを消化する。
   すべての比較テストに `@<change-id>` と `@VC-NNN` タグを付ける
4. **レビューと修正の周回** — change スコープのテストを実行し、`scripts/e2e-report.mjs` と
   `scripts/mockup-report.mjs` の出力を転記する。差分超過した VC は `mockup-compare-review` スキルでレビューする

## 比較ヘルパーの使い方

```ts
import { test } from '@playwright/test';
import { compareWithMockup } from './support/mockup-compare';

test('施設別の症例一覧がモックと一致する', { tag: ['@add-case-list', '@VC-001'] }, async ({ page }, testInfo) => {
  await compareWithMockup(page, testInfo, {
    vc: 'VC-001',
    changeId: 'add-case-list',
    mockup: 'user/sc-mr-11_case-list-by-facility.html',   // モックルート相対
    app: '/cases/by-facility',                             // baseURL 相対または絶対 URL
    viewport: { width: 1440, height: 900 },
    clock: '2026-10-01T10:00:00+09:00',
    hide: { mockup: ['.samplebar'] },                      // モック専用の説明バー
    mask: ['table tbody'],                                 // ダミーデータの領域
    maxDiffRatio: 0.01,
    steps: {
      mockup: async p => { await p.getByRole('row').nth(1).click(); },
      app: async p => { await p.getByRole('row').nth(1).click(); },
    },
  });
});
```

| オプション | 既定値 | 内容 |
|-----------|--------|------|
| `vc` / `changeId` | (必須) | VC-ID と change-id。結果の出力先になる |
| `mockup` | (必須) | モックルート相対のパス。`?tab=a` のようにクエリを付けてもよい |
| `app` | (必須) | 実画面の URL |
| `viewport` | 1440x900 | 両方のビューポート |
| `deviceScaleFactor` | 実画面の値 | 実画面と違う値は指定できない(`test.use({ deviceScaleFactor })` で揃える) |
| `clock` | モック側のみ `2026-01-01T10:00:00+09:00` | 固定する現在時刻。指定すると実画面側も固定する |
| `seed` | `vc` | モック側の `Math.random` のシード |
| `mockupQuery` | `noload=1` | モックの読み込み演出を止めるクエリ。`''` で付けない |
| `hide` | なし | `{ mockup, app }` ごとに `display: none` にするセレクタ |
| `mask` | なし | 両方の画像で同じ単色に塗るセレクタ。`{ mockup, app }` で別々に指定してもよい |
| `target` | ページ全体 | 比較範囲にする要素のセレクタ |
| `fullPage` | `true` | ページ全体のとき、スクロール領域まで含めるか |
| `maxDiffRatio` | `0.01` | 許容差分率(差分ピクセル数 ÷ 比較領域のピクセル数) |
| `threshold` | `0.1` | pixelmatch の色差の感度 |
| `steps` | なし | `{ mockup, app }` ごとの到達手順。実行後にキャプチャする |
| `settleTimeout` | 5000 | Web フォントの読み込みとネットワークの静止を待つ上限(ms) |

`hide` / `mask` / `target` はモックと実画面の両方に当てるため、CSS セレクタで書く。e2e-conventions の
ロケーター規約(`page.locator()` の禁止)は、到達手順 `steps` の中の操作に適用する。

ヘルパーは次のように動く。

- モックルートを、ワーカーごとに `127.0.0.1` の空きポートで配信する(相対参照の CSS/JS/画像と Web Storage がそのまま動く。
  ルートの外を指すパスは 404 にする)
- モックは実画面とは**別の browser context** で開く。実画面の context(認証状態など)には影響しない
- モック側では時刻・`Math.random`・読み込み演出を固定し、両方を reduced motion にする。キャプチャの前に Web フォントと
  ネットワークの静止を待つ。外部フォントが取れずにタイムアウトした場合は、判定はそのままにして `fontsTimedOut: true` を記録する
- 画像のサイズが違う場合は、大きい方に合わせて左上に寄せ、余白を透明にして比較する(`sizeMismatch: true` を記録する)
- 合否にかかわらず、`mockup-compare-results/<change-id>/<VC-ID>/` に `mockup.png`・`actual.png`・`diff.png`・`meta.json` を出力する
- 差分率が許容値を超えると、VC-ID・差分率・許容差分率・出力先を含むメッセージでテストを失敗させる

### `scripts/mockup-report.mjs`

```bash
node scripts/mockup-report.mjs <change-id> [results-dir] [--max-age <seconds>]
```

mockup-compare.md の観点表から VC-ID を拾い、meta.json と突き合わせて VC 別の表と未実行の VC を出力する。
終了コードは `e2e-report.mjs` と同じ体系にしている。

| コード | 意味 |
|--------|------|
| 0 | 失敗も欠落もなし(「比較対象なし」の change を含む) |
| 1 | 未実行の VC がある |
| 2 | 引数エラー、入力を読めない、または `--max-age` 超過 |
| 3 | 失敗した VC がある(欠落の有無は問わない) |

`--max-age` は、meta.json の `startedAt` の最も古い値で判定する。実行開始時刻が無い結果や、結果が 1 件も無い場合も
検証不能として exit 2 にする(fail closed)。前の周の結果を今回の結果として読んでしまう事故を防ぐため、
周回ごとに呼ぶ自動化ではこのオプションを付ける。

## AI 目視レビュー(mockup-compare-review)

ピクセル差分は「違う」ことしか教えてくれない。`.claude/skills/mockup-compare-review/SKILL.md` は、差分超過した
VC について AI エージェントに画像を見比べさせ、差分の原因を次の 5 つに分類して
`openspec/changes/<change-id>/mockup-review.md` に書かせる。

| 分類 | 意味 |
|------|------|
| `implementation-bug` | 実装の不具合 |
| `mock-data` | モックのダミーデータとの差 |
| `intended` | 仕様で意図された差分 |
| `mock-outdated` | モック側が古い・誤り |
| `environment` | フォントや描画環境による差 |

- 対象は失敗した VC だけ。周回ごとに差分率の推移を残し、前回と同じ実行開始時刻の結果なら「比較が再実行されていない」と警告する
- AI の分類は助言であり、**テストや閾値は変更させない**。マスクや閾値を変えたい場合は mockup-compare.md の変更として
  人間のレビューに回す
- AI の判定は非決定的なので、CI のゲートには使わない

## CI ゲート

reusable workflow を呼び出すスタブを、対象リポジトリの `.github/workflows/` に置く。

```yaml
name: e2e-mockup-gate
on: [pull_request]
jobs:
  gate:
    uses: sudabon/openspec_mockup_comparison/.github/workflows/openspec-e2e-mockup-gate.yml@main
    with:
      e2e-base-url: http://localhost:3000
      # package.json と playwright.config.* がルートに無い構成では指定する
      # working-directory: frontend
```

ゲートは次の順に処理する。

1. `scripts/check-test-plan.sh` — PR に差分のある change(archive を除く)について、`test-plan.md` と
   `mockup-compare.md` があること、`@<change-id>` タグのテストがあること、mockup-compare.md の VC-ID ごとに
   `@<change-id>` と `@VC-NNN` を持つテストファイルがあることを検証する。「比較対象なし」の change は VC の検証をスキップする
2. change スコープの Playwright 実行 — `--grep "@(<change-ids>)|@smoke"`。change の差分が無い PR では `@smoke` だけを実行する
3. `scripts/mockup-report.mjs` の出力をジョブサマリーに転記する(テストが失敗しても出す。失敗や未実行の VC があればジョブを失敗にする)
4. `mockup-compare-results/` を artifact `mockup-compare-results` としてアップロードする

reusable workflow は呼び出し側リポジトリの文脈で動くため、kit が導入済みであること、`working-directory` に
`package-lock.json` があること(`npm ci` を使う)が前提になる。pnpm / yarn のリポジトリでは、この workflow を使わずに
同等のジョブを呼び出し側で組む。

## e2e kit (openspec_e2e_test) からの移行

e2e kit を導入済みのリポジトリでも、本 kit の install を実行するだけで移行できる。

```bash
npx github:sudabon/openspec_mockup_comparison install
```

- `.openspec-e2e-kit.json` を検出すると移行として扱い、その E2E ルートを引き継ぐ
- `schema: spec-driven-e2e` は `spec-driven-e2e-mockup` に切り替わる。config.yaml の `openspec-e2e-kit` のマーカーブロックは
  本 kit のマーカーブロックに置き換わり、マーカーの外の行は残る
- e2e kit と内容が同じファイル(e2e-conventions、e2e-report.mjs、fixtures README、playwright.config.ts)はスキップし、
  以後は本 kit の管理下に置く
- `scripts/check-test-plan.sh` は本 kit で VC の検証を追加しているため、差分ありとして表示されスキップされる。
  手を加えていなければ、内容を確認したうえで `update --force` で更新する
- `openspec/schemas/spec-driven-e2e/` と `.openspec-e2e-kit.json` は削除しない(進行中の change が使い続けられるようにするため)

**移行後は openspec_e2e_test の update を実行しないこと。** schema と config.yaml の context が e2e kit の内容に戻る。
2 つの kit を同じプロジェクトで併用することはサポートしない。

ロールバックするときは、config.yaml の `schema:` を `spec-driven-e2e` に戻し、e2e kit の update を実行する。

## OpenSpec をアップグレードしたとき

`spec-driven-e2e-mockup` はビルトインスキーマ `spec-driven` の fork なので、OpenSpec 本体のスキーマ形式が変わったら
追従が必要になる。アップグレード後は、対象リポジトリで validate と実際の change フローを確認する。

```bash
openspec schema validate spec-driven-e2e-mockup
openspec new change tmp-upgrade-check
openspec status --change tmp-upgrade-check
#   [-] mockup-compare (blocked by: specs)
#   [-] test-plan (blocked by: specs, mockup-compare)
#   [-] tasks (blocked by: specs, design, test-plan)
openspec instructions mockup-compare --change tmp-upgrade-check | head -30
#   <project_context> にモックルートと @VC-NNN の規約行が入っていること
```

## 上流 (openspec_e2e_test) の取り込み

本 kit は e2e kit の payload を取り込んだ fork で、上流の変更は自動では反映されない。取り込み元のコミットと手順は
[UPSTREAM.md](UPSTREAM.md) に記録している。`test/upstream/` には上流のスキーマ・`check-test-plan.sh`・workflow の
スナップショットを置いており、selftest が「上流から変えた行が想定どおりか(name / description 以外は追記だけか)」を検査する。

## kit 自体の開発

```bash
npm ci
npx playwright install chromium   # 比較ヘルパーの selftest に使う
npm test                          # test/selftest.sh
```

`npm test` は `/tmp` にサンドボックスを作り、導入・冪等性・ルート判別・e2e kit からの移行・スキーマの validate と
change フロー・上流スキーマとの差分・レポータ・check-test-plan・比較ヘルパー(Playwright)を検証する。
`openspec` CLI が無い環境ではスキーマ関連のステップを、Playwright や pngjs / pixelmatch・ブラウザが無い環境では
比較ヘルパーのステップを skip する。

インストーラ(`install.mjs`)は Node 標準ライブラリだけで書いており、外部依存を持たない。
devDependencies は selftest 専用で、配布物には含まれない。
