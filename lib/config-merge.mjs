import { parseYamlText } from '../payload/scripts/lib/mockup/yaml-safe.mjs';
import { BASE_SCHEMA, CONTEXT_LINES, DERIVED_SCHEMA, MARKER_END, MARKER_START } from '../payload/scripts/lib/mockup/constants.mjs';

// Line-based edits of openspec/config.yaml, so that comments and the user's formatting stay as they are.
// Every function returns { text, notes, warnings, blocked } and never throws for a config it cannot edit.

function topLevelKey(lines, key) {
  const re = new RegExp(`^${key}:(.*)$`);
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(re);
    if (match) return { index: i, rest: match[1] };
  }
  return null;
}

// The [start, end) line range of the block scalar that follows `context:` at `index`, and its indentation.
function blockRange(lines, index) {
  let end = index + 1;
  let indent = null;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === '') {
      end++;
      continue;
    }
    const lead = line.match(/^(\s*)/)[1];
    if (!lead.length) break;
    if (indent == null) indent = lead;
    end++;
  }
  // Trailing blank lines belong to whatever follows.
  while (end > index + 1 && lines[end - 1].trim() === '') end--;
  return { start: index + 1, end, indent: indent ?? '  ' };
}

function markerRange(lines) {
  const start = lines.findIndex(line => line.trim() === MARKER_START);
  if (start === -1) return null;
  const end = lines.findIndex((line, index) => index > start && line.trim() === MARKER_END);
  return end === -1 ? { start, end: null } : { start, end };
}

function unsafe(text) {
  const parsed = parseYamlText(text);
  if (parsed.errors.length) return `YAML を解釈できません (${parsed.errors[0]})`;
  if (parsed.alias) return 'YAML alias を含むため自動編集しません';
  if (parsed.tagged) return '独自 tag を含むため自動編集しません';
  if (parsed.data != null && (typeof parsed.data !== 'object' || Array.isArray(parsed.data))) return 'mapping ではありません';
  if (parsed.data?.store != null) return 'store: を宣言しているため自動編集しません（store には対応していません）';
  return null;
}

function blocked(text, reason) {
  return { text, notes: [], warnings: [`openspec/config.yaml を変更しません: ${reason}`], blocked: true, switched: false };
}

// Default schemas a first install may replace: the integrated schema testkit sets, OpenSpec's own default, and none.
// Any other default (legacy or custom) was chosen on purpose and is kept, as testkit keeps custom defaults.
export const REPLACEABLE_DEFAULTS = new Set([BASE_SCHEMA, 'spec-driven', null]);

// Adds (or refreshes) the marked context block and decides the default schema by `defaultMode`:
// 'auto' replaces a replaceable default, 'force' always switches to the derived schema, 'keep' never changes it.
// `switched` tells whether the default changed; `previousDefault` is the value before (null when there was none).
export function mergeConfig(original, { defaultMode = 'auto' } = {}) {
  const text = original ?? '';
  const reason = unsafe(text);
  if (reason) return blocked(original, reason);
  const lines = text.split('\n');
  const notes = [];
  const warnings = [];

  const marker = markerRange(lines);
  if (marker && marker.end == null) return blocked(original, `${MARKER_START} の終わりの ${MARKER_END} がありません`);
  if (marker) {
    const indent = lines[marker.start].match(/^(\s*)/)[1];
    const block = [MARKER_START, ...CONTEXT_LINES, MARKER_END].map(line => `${indent}${line}`);
    const current = lines.slice(marker.start, marker.end + 1);
    if (current.join('\n') !== block.join('\n')) {
      lines.splice(marker.start, marker.end - marker.start + 1, ...block);
      notes.push('context のアドオンの記述を更新');
    }
  } else {
    const context = topLevelKey(lines, 'context');
    if (!context) {
      while (lines.length && lines.at(-1) === '') lines.pop();
      lines.push('', 'context: |', ...[MARKER_START, ...CONTEXT_LINES, MARKER_END].map(line => `  ${line}`), '');
      notes.push('context を追加し、アドオンの記述を追記');
    } else if (/^\s*[|>][-+0-9]*\s*(#.*)?$/.test(context.rest)) {
      const range = blockRange(lines, context.index);
      lines.splice(range.end, 0, ...[MARKER_START, ...CONTEXT_LINES, MARKER_END].map(line => `${range.indent}${line}`));
      notes.push('context の末尾にアドオンの記述を追記');
    } else {
      warnings.push('openspec/config.yaml の context がブロック形式（context: |）ではないため、アドオンの記述を追記しません。手で追記してください');
    }
  }

  const schema = topLevelKey(lines, 'schema');
  const current = schema ? schema.rest.replace(/\s+#.*$/, '').replace(/^\s*["']?|["']?\s*$/g, '') : null;
  const shown = current ?? '(なし)';
  let switched = false;
  if (current === DERIVED_SCHEMA) {
    notes.push(`既定 schema は ${DERIVED_SCHEMA} です`);
  } else if (defaultMode === 'force' || (defaultMode === 'auto' && REPLACEABLE_DEFAULTS.has(current))) {
    if (schema) lines[schema.index] = `schema: ${DERIVED_SCHEMA}`;
    else lines.unshift(`schema: ${DERIVED_SCHEMA}`);
    switched = true;
    notes.push(`既定 schema: ${shown} → ${DERIVED_SCHEMA}（${defaultMode === 'force' ? '--set-default' : '初めての導入'}。戻すときは schema: ${current ?? BASE_SCHEMA} に書き換えます）`);
  } else {
    const why = defaultMode === 'keep'
      ? '既定 schema は変更しません（--keep-default、または導入済みのため）'
      : `既定 schema ${shown} は独自に選ばれた schema なので変更しません`;
    notes.push(`${why}。モック比較の change は openspec new change <name> --schema ${DERIVED_SCHEMA} で作ります。既定にするなら --set-default を付けます`);
  }
  return { text: lines.join('\n'), notes, warnings, blocked: false, switched, previousDefault: current, defaultSchema: switched ? DERIVED_SCHEMA : current };
}

// Removes the marked block and, when the default schema is the derived one, restores quality-driven-e2e.
export function unmergeConfig(original) {
  const text = original ?? '';
  const reason = unsafe(text);
  if (reason) return blocked(original, reason);
  const lines = text.split('\n');
  const notes = [];
  const marker = markerRange(lines);
  if (marker?.end != null) {
    lines.splice(marker.start, marker.end - marker.start + 1);
    notes.push('context のアドオンの記述を削除');
    // A context that held only the add-on block is removed with it.
    const context = topLevelKey(lines, 'context');
    if (context) {
      const range = blockRange(lines, context.index);
      if (/^\s*\|\s*$/.test(context.rest) && range.end === range.start) {
        lines.splice(context.index, 1);
        while (lines.length && lines.at(-1) === '' && lines.at(-2) === '') lines.pop();
      }
    }
  }
  const schema = topLevelKey(lines, 'schema');
  if (schema && schema.rest.trim() === DERIVED_SCHEMA) {
    lines[schema.index] = `schema: ${BASE_SCHEMA}`;
    notes.push(`schema: ${DERIVED_SCHEMA} → ${BASE_SCHEMA}`);
  }
  return { text: lines.join('\n'), notes, warnings: [], blocked: false };
}
