## Purpose

合成スキーマと、それに付随するスキル・スクリプト・テスト補助を、1 コマンドで OpenSpec プロジェクトへ冪等に導入・更新する。既存の設定や利用者の変更を壊さないことを最優先にする。

## ADDED Requirements

### Requirement: 導入と更新のコマンド
インストーラは `npx github:sudabon/openspec_mockup_comparison [install|update] [--force] [--dry-run] [--target <dir>] [--e2e-root <path>] [--mockup-root <path>] [--language <lang>]` を SHALL 受け付ける。未知の引数を受け取った場合は、usage を表示して 0 以外の終了コードで終了する。

#### Scenario: 初回導入
- **WHEN** `openspec init` 済みのリポジトリのルートで install を実行する
- **THEN** スキーマ、スキル、スクリプト、テスト補助が配置される
- **AND** 導入した kit のバージョン・モックルート・E2E ルート・導入時刻を記録したファイル `.openspec-e2e-mockup-kit.json` が作成される

#### Scenario: dry-run
- **WHEN** `--dry-run` を付けて実行する
- **THEN** ファイルは 1 つも書き込まれず、配置予定・判別したルート・config の変更予定が表示される

#### Scenario: 不明な引数
- **WHEN** `--unknown` を付けて実行する
- **THEN** usage が表示され、終了コードは 0 以外になる

### Requirement: 冪等性と利用者変更の保護
update は、内容が同じファイルを黙ってスキップする。導入先で内容が変わっているファイルは上書きせず、unified diff を表示してスキップする。スキップしたファイルは最後に一覧で SHALL 表示する。`--force` を付けた場合だけ、kit 側の内容で上書きする。

#### Scenario: 2 回目の導入
- **WHEN** install を 2 回続けて実行する
- **THEN** 2 回目では、配置ファイルにも config.yaml にも変更が生じない

#### Scenario: 利用者が編集したファイル
- **WHEN** 導入先で `.claude/skills/mockup-compare-review/SKILL.md` を編集した後に update を実行する
- **THEN** そのファイルは上書きされず、diff と「スキップ」の一覧が表示される

### Requirement: ルートの自動判別
インストーラは E2E ルートを、取り込み元 kit と同じ優先順で SHALL 判別する（明示指定、記録値、Playwright の testDir、既存ディレクトリ、既定値 `tests/e2e`）。

モックルートは次の優先順で SHALL 判別する。
1. `--mockup-root` の明示指定
2. `.openspec-e2e-mockup-kit.json` の記録値
3. 深さ 3 までで、HTML ファイルを含む `mockup` / `mockups` / `mock` という名前のディレクトリのうち、最も浅いもの
4. 既定値 `mockup`

判別したルートは、配置先パスと配布ファイルの内容の両方に反映する。

#### Scenario: 深い位置のモック
- **WHEN** 導入先に `requirements/mockup/index.html` があり、ほかに候補が無い状態で install を実行する
- **THEN** モックルートは `requirements/mockup` と判別・表示され、スキーマの instruction と config の context に反映される

#### Scenario: 候補が複数ある
- **WHEN** `mockup/` と `docs/mockups/` の両方に HTML がある
- **THEN** 最も浅い `mockup` が採用され、対象外にした候補が表示される

#### Scenario: ルートの変更
- **WHEN** 前回と異なるモックルートを `--mockup-root` で指定して update を実行する
- **THEN** 古い配置は削除されず、警告が表示される

### Requirement: config.yaml のマージ
インストーラは `openspec/config.yaml` を冪等に SHALL マージする。
- `schema:` が無い場合、または値が `spec-driven` か `spec-driven-e2e` の場合は、`spec-driven-e2e-mockup` に設定する
- それ以外の値の場合は変更せず、警告と、change 単位で指定する方法を表示する
- kit の context 行は `context: |` の内側に置き、マーカー `# --- openspec-e2e-mockup-kit ---` で囲む。update ではマーカーの間だけを書き換える
- config.yaml が無い場合は新規に作成し、`--language` が指定されていれば context に言語行を加える

#### Scenario: e2e kit からの移行
- **WHEN** `schema: spec-driven-e2e` と、`openspec-e2e-kit` のマーカーブロックを持つ config.yaml がある状態で install を実行する
- **THEN** schema は `spec-driven-e2e-mockup` になり、`openspec-e2e-kit` のマーカーブロックは本 kit のマーカーブロックへ置き換わる
- **AND** マーカーの外にある行は保持される

#### Scenario: 別スキーマが設定済み
- **WHEN** `schema: quality-driven` の config.yaml がある
- **THEN** schema は変更されず、手動で変更する方法と `--schema spec-driven-e2e-mockup` の案内が表示される

### Requirement: e2e kit との共存の扱い
導入先に `.openspec-e2e-kit.json` がある場合、インストーラは移行として扱う。e2e kit が配置したファイルと同じパスのファイルは本 kit の管理下に置き、今後は e2e kit の update を実行しないよう SHALL 案内する。

#### Scenario: e2e kit 導入済みのリポジトリ
- **WHEN** e2e kit 導入済みのリポジトリで install を実行する
- **THEN** 内容が同じ e2e 由来のファイルはスキップされる
- **AND** 「以後は openspec_e2e_test の update を実行しないこと」が表示される

### Requirement: 依存パッケージの案内
インストーラは導入先の package.json を書き換えない。モック比較に必要な devDependencies（`@playwright/test`、`pngjs`、`pixelmatch`）のうち、package.json に無いものについて、インストールコマンドを SHALL 表示する。

#### Scenario: pixelmatch が無い
- **WHEN** package.json に `pixelmatch` が無い状態で install を実行する
- **THEN** package.json は変更されず、`npm i -D pngjs pixelmatch` を含む案内が表示される
