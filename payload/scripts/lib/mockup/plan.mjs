import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './base-digest.mjs';
import { MK_ID, PLAN_COLUMNS, PLAN_FILE, PLAN_SECTION } from './constants.mjs';
import { tk } from './testkit.mjs';

const MAX_SIDE = 10000;

function unquote(value) {
  return String(value ?? '').replaceAll('`', '').trim();
}

// `path#selector` → { path, selector }. The first `#` separates them, so an id selector is written `page.html##main`.
export function splitReference(cell) {
  const text = String(cell ?? '').trim().replace(/^`|`$/g, '');
  const index = text.indexOf('#');
  if (index === -1) return { path: text.trim(), selector: null };
  const selector = text.slice(index + 1).trim();
  return { path: text.slice(0, index).trim(), selector: selector || null };
}

export function parseViewports(cell) {
  const problems = [];
  const viewports = [];
  const parts = unquote(cell).split(/[,、]/).map(part => part.trim());
  if (!parts.some(Boolean)) return { viewports, problems: ['Viewports が空です'] };
  for (const part of parts) {
    const match = part.match(/^(\d+)x(\d+)$/);
    if (!match) {
      problems.push(`Viewports の ${part || '(空)'} は 幅x高さ ではありません`);
      continue;
    }
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height || width > MAX_SIDE || height > MAX_SIDE) {
      problems.push(`Viewports の ${part} は 1〜${MAX_SIDE} の範囲外です`);
      continue;
    }
    const label = `${width}x${height}`;
    if (viewports.some(item => item.label === label)) problems.push(`Viewports の ${label} が重複しています`);
    else viewports.push({ width, height, label });
  }
  return { viewports, problems };
}

export function parseMasks(cell) {
  const text = String(cell ?? '').trim();
  if (text === 'なし') return { masks: [], problems: [] };
  if (!text) return { masks: [], problems: ['Masks が空です。マスクが無いときは なし と書きます'] };
  const masks = [];
  const problems = [];
  for (const entry of text.split(/[;；]/).map(part => part.trim()).filter(Boolean)) {
    const match = entry.match(/^`([^`]+)`\s*[:：]\s*(.+)$/);
    if (!match) {
      problems.push(`Masks の「${entry}」は \`selector\`: 理由 の形式ではありません（理由は必須です）`);
      continue;
    }
    masks.push({ selector: match[1].trim(), reason: match[2].trim() });
  }
  return { masks, problems };
}

export function parseThreshold(cell) {
  const text = unquote(cell);
  if (!text) return { threshold: null, problems: [] };
  if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?|\.\d+)$/.test(text)) return { threshold: null, problems: [`Threshold の ${text} は 0〜1 の数値ではありません`] };
  return { threshold: Number(text), problems: [] };
}

// A stable digest of one plan row: the cells in column order. Any edit to a mask, threshold, viewport or
// reference changes it, so results recorded before the edit no longer match.
export function planRowDigest(raw) {
  return sha256(JSON.stringify(PLAN_COLUMNS.map(column => String(raw[column] ?? '').trim())));
}

function parseRow(raw) {
  const mk = unquote(raw['MK-ID']);
  const problems = [];
  if (!MK_ID.test(mk)) problems.push(`MK-ID ${mk || '(空)'} は MK- と3桁の数字ではありません`);
  const mockup = splitReference(raw.Mockup);
  const target = splitReference(raw.Target);
  if (!mockup.path) problems.push('Mockup が空です');
  if (!target.path) problems.push('Target が空です');
  if (!String(raw.Fixture ?? '').trim()) problems.push('Fixture が空です。前提状態が無いときは なし と書きます');
  const viewports = parseViewports(raw.Viewports);
  const masks = parseMasks(raw.Masks);
  const threshold = parseThreshold(raw.Threshold);
  problems.push(...viewports.problems, ...masks.problems, ...threshold.problems);
  return {
    raw,
    mk,
    requirement: unquote(raw.Requirement),
    scenario: unquote(raw.Scenario),
    mockup,
    target,
    viewports: viewports.viewports,
    fixture: String(raw.Fixture ?? '').trim(),
    masks: masks.masks,
    threshold: threshold.threshold,
    digest: planRowDigest(raw),
    problems,
  };
}

// Reads <changeDir>/mockup-plan.md. tk must be loaded.
export function readPlan(repo, changeDir) {
  const path = `${changeDir}/${PLAN_FILE}`;
  const abs = join(repo, path);
  if (!existsSync(abs)) return { exists: false, path, problems: [], rows: [] };
  const front = tk.splitFrontmatter(readFileSync(abs, 'utf8'));
  const problems = [];
  if (front.error) problems.push(`${path} の frontmatter を解釈できません: ${front.error}`);
  const data = front.data ?? {};
  const mockup = data.mockup;
  if (!front.error && mockup !== 'required' && mockup !== 'not-applicable') {
    problems.push(`${path} の mockup は required か not-applicable です（実際: ${mockup === undefined ? '(なし)' : JSON.stringify(mockup)}）`);
  }
  const reason = tk.asString(data.reason).trim();
  const prose = tk.markdownProse(front.body);
  if (prose.unclosedFence) problems.push(`${path} に閉じていないコードフェンスがあります`);
  const body = tk.section(prose.text, PLAN_SECTION);
  let rows = [];
  if (body != null) {
    const table = tk.parseTable(body);
    if (table.headers.length) {
      const headers = table.headers.map(header => header.trim());
      if (JSON.stringify(headers) !== JSON.stringify(PLAN_COLUMNS)) {
        problems.push(`${path} の ${PLAN_SECTION} の列は ${PLAN_COLUMNS.join(', ')} です（実際: ${headers.join(', ')}）`);
      }
      rows = table.rows.map(parseRow);
    }
  }
  return { exists: true, path, mockup, reason, hasSection: body != null, rows, problems };
}
