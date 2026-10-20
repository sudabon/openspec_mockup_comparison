import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { POLICY_PATH } from './constants.mjs';

// Keys of openspec/mockup-policy.md. Each is a standalone `key: value` line (no indentation, bullet or backticks),
// like testkit's quality-policy keys. Environment variables never override them.
export const POLICY_KEYS = {
  mockup_root: 'path',
  mockup_default_threshold: 'ratio',
  mockup_max_threshold: 'ratio',
  mockup_max_mask_ratio: 'ratio',
  mockup_pixel_tolerance: 'ratio',
  mockup_reference_environment: 'string',
  mockup_ignore_paths: 'list',
};

export const IGNORED_ENV = ['MOCKUP_MAX_THRESHOLD', 'MOCKUP_DEFAULT_THRESHOLD', 'MOCKUP_MAX_MASK_RATIO', 'MOCKUP_PIXEL_TOLERANCE', 'MOCKUP_ROOT', 'MOCKUP_REFERENCE_ENVIRONMENT', 'MOCKUP_IGNORE_PATHS'];

function keyLines(text, key) {
  const loose = new RegExp(`^[ \\t]*(?:[-*+]\\s+)?\`*${key}\\b`, 'i');
  return String(text).split(/\r?\n/).filter(line => loose.test(line));
}

function parseValue(type, raw, key) {
  const value = raw.replace(/[ \t]+#.*$/, '').trim();
  if (type === 'ratio') {
    if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(value)) return { error: `${key} は 0〜1 の数値です（実際: ${value || '空'}）` };
    return { value: Number(value) };
  }
  if (type === 'list') {
    const list = value.match(/^\[(.*)\]$/);
    if (!list) return { error: `${key} は [a, b] の形式です（実際: ${value || '空'}）` };
    const items = list[1].trim() ? list[1].split(',').map(item => item.trim().replace(/^["']|["']$/g, '')) : [];
    if (items.some(item => !item)) return { error: `${key} に空の要素があります` };
    return { value: items };
  }
  if (!value) return { error: `${key} が空です` };
  if (type === 'path') {
    const normalized = value.replace(/\/+$/, '');
    if (normalized.startsWith('/') || normalized.split('/').includes('..') || normalized === '.') {
      return { error: `${key} は repo 内の相対パスです（実際: ${value}）` };
    }
    return { value: normalized };
  }
  return { value };
}

// Parses the policy text. Returns { values, errors }; every key is required and checked.
export function parsePolicy(text) {
  const values = {};
  const errors = [];
  for (const [key, type] of Object.entries(POLICY_KEYS)) {
    const lines = keyLines(text, key);
    if (!lines.length) {
      errors.push(`${POLICY_PATH} に ${key} がありません`);
      continue;
    }
    if (lines.length > 1) {
      errors.push(`${POLICY_PATH} の ${key} が複数あります`);
      continue;
    }
    if (!lines[0].startsWith(`${key}:`)) {
      errors.push(`${POLICY_PATH} の ${key} は、インデント・箇条書き記号・バッククォートの無い独立した行で書きます`);
      continue;
    }
    const parsed = parseValue(type, lines[0].slice(key.length + 1), key);
    if (parsed.error) errors.push(`${POLICY_PATH}: ${parsed.error}`);
    else values[key] = parsed.value;
  }
  if (values.mockup_default_threshold != null && values.mockup_max_threshold != null
    && values.mockup_default_threshold > values.mockup_max_threshold) {
    errors.push(`${POLICY_PATH}: mockup_default_threshold (${values.mockup_default_threshold}) が mockup_max_threshold (${values.mockup_max_threshold}) を超えています`);
  }
  return { values, errors };
}

// Reads and parses the policy of `repo`. `notes` lists environment variables that were set but ignored.
export function readPolicy(repo, env = {}) {
  const abs = join(repo, POLICY_PATH);
  const notes = IGNORED_ENV.filter(name => env[name] != null && env[name] !== '')
    .map(name => `環境変数 ${name} は無視しました。値は ${POLICY_PATH} だけで決まります`);
  if (!existsSync(abs)) return { values: {}, errors: [`${POLICY_PATH} がありません`], notes };
  return { ...parsePolicy(readFileSync(abs, 'utf8')), notes };
}
