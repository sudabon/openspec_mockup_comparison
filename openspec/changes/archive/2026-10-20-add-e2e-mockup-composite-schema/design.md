# Design

## Context

動機は proposal.md の Why を参照。前提となる現状は次のとおり。

- 本リポジトリは `openspec init` 直後の状態で、実装は無い
- 取り込み元 `openspec_e2e_test` v0.2.0 の構成:
  - Node 標準ライブラリだけで書かれた `install.mjs`（646 行）
  - `payload/`（スキーマ、e2e-conventions スキル、`e2e-report.mjs`、`check-test-plan.sh`、Playwright 設定例、fixtures README）
  - `test/selftest.sh`（/tmp サンドボックスでの導入・冪等性・validate・レポータの検証）
  - reusable workflow
- 対象とするモックの実例（`enjinfarm/requirements/mockup`）の特徴:
  - 画面 ID 付きの HTML（`user/sc-mr-02_case-new.html` など）が、`../css` と `../js` を相対参照する
  - 共通 JS がダミーデータ、localStorage、`new Date()`、`Math.random()` を使う
  - `loading.js` が 700ms のスケルトン表示とカウントアップを行う。`?noload=1` または `data-load-ms="0"` で無効化でき、prefers-reduced-motion にも従う
  - Google Fonts（Material Symbols）を外部から読み込む
  - モック専用の説明バー（`.samplebar`）がある

## Goals / Non-Goals

**Goals:**
- e2e kit を導入済みのプロジェクトも、未導入のプロジェクトも、1 コマンドで合成スキーマへ到達できる
- モック比較を Playwright テストとして書ける。合否はピクセル差分で決定的に判定する
- 失敗時の証跡（3 画像と JSON）を、AI や人間がそのまま読める形で残す

**Non-Goals:**
- Figma や静止画像のモックへの対応
- AI 判定を CI ゲートに使うこと
- 実画面とモックのデータを自動で揃えること（マスクで扱う）
- e2e kit との同時導入（移行のみ扱う）
- pnpm / yarn 向けの reusable workflow（e2e kit と同じく npm ci 前提）

## Decisions

### D1. e2e kit を fork して内包する。上流は手動で取り込む
`payload/` に e2e kit の payload をそのままコピーし、取り込み元のコミットハッシュを `UPSTREAM.md` に記録する。
- 却下した案「導入時に e2e kit を npx で呼び、スキーマだけを差し替える」: 2 段の導入になり、e2e kit の update がスキーマを `spec-driven-e2e` に戻す、または警告を出し続ける
- 却下した案「git submodule」: npx の配布物に含めにくい

e2e 由来のファイルは、パスも内容も上流と同一に保つ。こうすると移行時に「内容が同じなのでスキップ」になり、利用者の変更検出もそのまま機能する。差分を入れるのは、`check-test-plan.sh`（VC 検証の追加）とスキーマだけにする。

### D2. スキーマはファイル分割せず、1 つの schema.yaml にする
`payload/openspec/schemas/spec-driven-e2e-mockup/` に schema.yaml とテンプレートを置く。OpenSpec に include の仕組みが無いため、e2e 部分は上流 schema.yaml から転記する。selftest で上流との差分が想定範囲内かを機械チェックする（D8）。

依存順序は `proposal → specs → {design, mockup-compare} → test-plan → tasks` とする。mockup-compare を test-plan より前に置くことで、test-plan は見た目の観点を VC に任せ、TP を振る舞いに集中させられる（TP と VC の重複を避ける）。

### D3. 比較は Playwright テスト内のヘルパーで行う
`<e2eRoot>/support/mockup-compare.ts` を配布する。テストは次のように書く。

```ts
test('一覧画面がモックと一致 @add-x @VC-001', async ({ page }) => {
  await compareWithMockup(page, test.info(), {
    vc: 'VC-001', changeId: 'add-x',
    mockup: 'user/sc-mr-11_case-list-by-facility.html',
    app: '/cases/by-facility',
    viewport: { width: 1440, height: 900 },
    clock: '2026-10-01T10:00:00+09:00',
    hide: { mockup: ['.samplebar'] },
    mask: ['table tbody'],
    maxDiffRatio: 0.01,
    steps: { mockup: async p => {...}, app: async p => {...} },
  });
});
```

- モックは、同じテストの `browser.newContext()` で開いた別ページでキャプチャする。実画面の context（認証状態など）を汚さないようにするため
- 却下した案「Playwright の `toHaveScreenshot` を流用し、モック画像をベースラインとして置く」: ベースラインの更新フロー（`--update-snapshots`）と意味が衝突する。また、差分画像の出力先や VC 単位のメタデータを制御できない
- 却下した案「独立 CLI でキャプチャする」: 認証、fixture、手順を E2E と共有できない

### D4. モックの配信には node:http の静的サーバを使う
ヘルパーがワーカー単位で、モックルートを `127.0.0.1:<空きポート>` で配信する（遅延起動し、テスト終了で停止）。file:// は CORS や Storage の挙動がブラウザごとに異なるため使わない。外部パッケージは使わない。

### D5. 決定化の手段
- `page.clock.install({ time })`: Date とタイマーを固定する
- `addInitScript` で、`Math.random` をシード付き擬似乱数（mulberry32 系、シードは VC-ID から導出）に置き換える
- `reducedMotion: 'reduce'` と、読み込み演出の無効化クエリ（既定 `noload=1`）を付ける。クエリは `mockupQuery` で上書きでき、空にすれば付けない
- `document.fonts.ready` と `networkidle` を待ってからキャプチャする。外部フォントが取れない環境向けに、キャプチャ前の fonts 待ちにはタイムアウト（既定 5s）を設ける。タイムアウトした場合はメタデータに `fontsTimedOut: true` を残す（判定は変えない）

### D6. 差分計算に pngjs と pixelmatch を使う
- 差分率 = 差分ピクセル数 ÷ 比較領域のピクセル数（マスク領域を含む面積）
- サイズが違う場合は、大きい方のキャンバスに左上合わせで配置し、余白を透明にしてから比較する
- pixelmatch の threshold（色差の感度）は既定 0.1 で、VC ごとに上書きできる
- 却下した案「自前実装」: アンチエイリアス検出を再実装する価値は無い

依存は導入先の devDependencies に置く。kit 自体（install.mjs）は無依存を保つ。

### D7. 結果のレイアウトとレポータ
`mockup-compare-results/<change-id>/<VC-ID>/{mockup.png, actual.png, diff.png, meta.json}` に出力する。

`scripts/mockup-report.mjs` は、mockup-compare.md の観点表から VC-ID を抽出し、meta.json 群と突き合わせる。終了コードと `--max-age`（meta.json の `startedAt` の最古値で判定。値が無ければ fail closed）は、e2e-report.mjs と同じ体系にする。出力先ディレクトリは `.gitignore` への追記を案内する（自動では追記しない）。

### D8. selftest は e2e kit の構成を踏襲する
`test/selftest.sh` に次を追加する。
- モックルート判別（`requirements/mockup` 型の深い配置、複数候補）
- e2e kit からの移行（config.yaml のマーカー置換、同一ファイルのスキップ）
- 上流スキーマとの差分チェック（mockup-compare の追加、test-plan と tasks の requires の変更、追記された instruction 行以外の差分が無いこと）
- 実際の change フローでの status と instructions の確認
- mockup-report の終了コード 4 系統と鮮度判定

比較ヘルパー自体は、サンドボックスに作った最小のモックと静的アプリに対して Playwright で実行する。同一モックの 2 回キャプチャで差分率 0、意図的に色を変えて失敗、マスクで合格、の 3 ケースを見る。Playwright が無い環境ではこのステップを skip する（e2e kit の openspec CLI 不在時と同じ扱い）。

### D9. AI レビューはスキルとして配布し、CI には載せない
`.claude/skills/mockup-compare-review/SKILL.md` を配布する。手順、分類の定義、mockup-review.md のテンプレート、禁止事項（閾値とテストの変更禁止）を記載する。Codex 等からも読めるよう、パスは e2e-conventions と同じ `.claude/skills/` に揃える。CI では画像を artifact に上げるだけにする。

## Risks / Trade-offs

- [上流 e2e kit の変更に追従が漏れる] → `UPSTREAM.md` に取り込み元コミットを記録し、README に取り込み手順を書く。selftest の上流差分チェックは、転記ミスを検出できる
- [モックと実画面でデータが違うため、差分が恒常的に大きくなる] → マスクと、要素単位の比較範囲を前提にする。mockup-compare の instruction で、ダミーデータ領域のマスク方針を必ず書かせる
- [フォントや OS の描画差で CI とローカルの結果が揺れる] → CI ではモックと実画面を同じブラウザ・同じジョブでキャプチャするため、差は相対的に相殺される。閾値の既定値は 1% とし、VC ごとに調整できるようにする
- [モック JS が `noload` 以外の方法で演出を制御している] → `mockupQuery` と、VC ごとの `steps.mockup` で吸収する。手順書（SKILL）に調整方法を書く
- [e2e kit 由来ファイルの所有権が曖昧になる] → 移行時に「以後は e2e kit の update を実行しない」と表示し、README にも明記する

## Migration Plan

- e2e kit 導入済みのリポジトリ: 本 kit の install を実行すると、config の schema とマーカーが置き換わる。`.openspec-e2e-kit.json` は削除せず残し、移行済みであることを表示する。進行中の change は、各自の `.openspec.yaml` に記録されたスキーマのまま動く
- ロールバック: config.yaml の schema を `spec-driven-e2e` に戻し、e2e kit の update を実行する

## Open Questions

- reusable workflow を呼ぶときのブランチ参照（`@main` か、タグ付きリリースか）は、初回リリース時に決める
