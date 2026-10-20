// Names shared by the installer, the gate and the comparison helper. New rules add their constants here instead of
// spelling paths or names in the callers.

export const ADDON_NAME = 'openspec-mockup-comparison';
export const ADDON_STAMP = '.openspec-mockup-comparison.json';
export const TESTKIT_STAMP = '.openspec-custom-testkit.json';

export const BASE_SCHEMA = 'quality-driven-e2e';
export const DERIVED_SCHEMA = 'quality-driven-e2e-mockup';
export const SCHEMAS_ROOT = 'openspec/schemas';
export const BASE_SCHEMA_DIR = `${SCHEMAS_ROOT}/${BASE_SCHEMA}`;
export const DERIVED_SCHEMA_DIR = `${SCHEMAS_ROOT}/${DERIVED_SCHEMA}`;
export const COMPAT_FILE = 'testkit-compat.json';
export const COMPAT_DECLARATION = { extends: BASE_SCHEMA, compatVersion: 1 };

export const POLICY_PATH = 'openspec/mockup-policy.md';
export const PLAN_FILE = 'mockup-plan.md';
export const REPORT_FILE = 'mockup-report.md';
export const RESULTS_FILE = 'mockup-results.json';
export const RESULTS_VERSION = 1;

export const PLAN_SECTION = '## モック対応表';
export const PLAN_COLUMNS = ['MK-ID', 'Requirement', 'Scenario', 'Mockup', 'Target', 'Viewports', 'Fixture', 'Masks', 'Threshold'];
export const FINDINGS_SECTION = '## 所見';
export const FINDINGS_COLUMNS = ['MK-ID', 'Viewport', '差分率', '差分 digest', '分類', '根拠'];
export const ACCEPTANCE_SECTION = '## 許容判断';
export const ACCEPTANCE_COLUMNS = ['MK-ID', 'Viewport', '差分 digest', '理由', '承認者', '承認日'];
export const FINDING_CLASSES = ['実装の不備', '意図した差', '描画ノイズ'];

export const TASK_GROUP = '## 7. Mockup Comparison';
export const VIEWPOINT_ROW = '見た目の回帰';
export const MK_ID = /^MK-\d{3}$/;
export const MK_ID_IN_TEXT = /(?<![A-Za-z0-9._/-])MK-\d{3}(?![A-Za-z0-9._-])/g;

// Raw per-run output of the helper, relative to the repository root.
export const RUN_ROOT = 'test-results/mockup';
// Paths that never make a working tree "dirty" for a comparison run.
export const RUN_OUTPUT_PATHS = ['test-results/**', 'playwright-report/**', 'blob-report/**'];
export const CONTAINER_ENV = 'MOCKUP_CONTAINER_IMAGE';
export const MASK_COLOR = '#FF00FF';

// Config context block that the installer appends between these markers.
export const MARKER_START = '# --- openspec-mockup-comparison ---';
export const MARKER_END = '# --- /openspec-mockup-comparison ---';
export const CONTEXT_LINES = [
  `モック比較: UI に触れる change は schema ${DERIVED_SCHEMA} で作り、mockup-plan.md に MK-ID ごとの照合を書く。規約は .claude/skills/mockup-comparison/SKILL.md に従う。`,
  '比較テストには @<change-id> と @MK-NNN タグを付ける。閾値・マスク・モックを実装に合わせて変えない。mockup-report.md の許容判断は人間だけが記入する。',
];
