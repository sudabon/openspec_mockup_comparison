import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACCEPTANCE_COLUMNS, ACCEPTANCE_SECTION, FINDINGS_COLUMNS, FINDINGS_SECTION, REPORT_FILE } from './constants.mjs';
import { tk } from './testkit.mjs';

function cell(value) {
  return String(value ?? '').replaceAll('`', '').trim();
}

function tableRows(markdown, heading) {
  const prose = tk.markdownProse(markdown);
  const body = tk.section(prose.text, heading);
  if (body == null) return { present: false, rows: [], headers: [] };
  const table = tk.parseTable(body);
  return { present: true, headers: table.headers, rows: table.rows };
}

// The findings and acceptance tables of mockup-report.md. tk must be loaded.
export function readReport(repo, changeDir) {
  const path = `${changeDir}/${REPORT_FILE}`;
  const abs = join(repo, path);
  if (!existsSync(abs)) return { exists: false, path, findings: [], acceptances: [], problems: [] };
  const text = readFileSync(abs, 'utf8');
  const problems = [];
  const findings = tableRows(text, FINDINGS_SECTION);
  const acceptances = tableRows(text, ACCEPTANCE_SECTION);
  for (const [table, heading, columns] of [[findings, FINDINGS_SECTION, FINDINGS_COLUMNS], [acceptances, ACCEPTANCE_SECTION, ACCEPTANCE_COLUMNS]]) {
    if (!table.present) problems.push(`${path} に ${heading} がありません`);
    else if (table.headers.length && JSON.stringify(table.headers.map(cell)) !== JSON.stringify(columns)) {
      problems.push(`${path} の ${heading} の列は ${columns.join(', ')} です（実際: ${table.headers.join(', ')}）`);
    }
  }
  return {
    exists: true,
    path,
    text,
    problems,
    findings: findings.rows.map(row => ({
      mk: cell(row['MK-ID']), viewport: cell(row.Viewport), ratio: cell(row['差分率']), digest: cell(row['差分 digest']), classification: cell(row['分類']), basis: cell(row['根拠']),
    })),
    acceptances: acceptances.rows.map(row => ({
      mk: cell(row['MK-ID']), viewport: cell(row.Viewport), digest: cell(row['差分 digest']), reason: cell(row['理由']), approver: cell(row['承認者']), date: cell(row['承認日']),
    })),
  };
}

function escapeCell(value) {
  return String(value ?? '').replaceAll('|', '\\|').replace(/\r?\n/g, ' ');
}

function renderFindings(results, previous) {
  const lines = [`| ${FINDINGS_COLUMNS.join(' | ')} |`, `|${FINDINGS_COLUMNS.map(() => '------').join('|')}|`];
  for (const result of results) {
    // Classification and basis survive only while the diff image they describe is unchanged.
    const kept = previous.find(row => row.mk === result.mk && row.viewport === result.viewport && row.digest === result.diffSha);
    lines.push(`| ${[result.mk, result.viewport, result.ratio, result.diffSha, kept?.classification ?? '', kept?.basis ?? ''].map(escapeCell).join(' | ')} |`);
  }
  return lines;
}

// mockup-report.md with its findings table rewritten for `results` (the diff results). Everything else, the
// acceptance table included, is left as it is.
export function updateFindings(reportText, results, previousFindings) {
  const lines = reportText.split('\n');
  const start = lines.findIndex(line => line.trim() === FINDINGS_SECTION);
  const table = renderFindings(results, previousFindings);
  if (start === -1) return `${reportText.replace(/\s*$/, '')}\n\n${FINDINGS_SECTION}\n\n${table.join('\n')}\n`;
  let end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  if (end === -1) end = lines.length;
  const first = lines.findIndex((line, index) => index > start && index < end && /^\s*\|/.test(line));
  if (first === -1) {
    lines.splice(end, 0, ...table, '');
    return lines.join('\n');
  }
  let last = first;
  while (last + 1 < end && /^\s*\|/.test(lines[last + 1])) last++;
  lines.splice(first, last - first + 1, ...table);
  return lines.join('\n');
}
