import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { compareWithMockup } from './support/mockup';

const result = (mk: string, viewport: string) =>
  JSON.parse(readFileSync(`test-results/mockup/add-login/${mk}/${viewport}/result.json`, 'utf8'));

test('Matching screen: MK-001 passes at both viewports with the clock masked', { tag: ['@add-login', '@MK-001'] }, async ({ page }) => {
  const outcomes = await compareWithMockup(page, 'MK-001', { navigate: true });
  expect(outcomes.map((item: { status: string }) => item.status)).toEqual(['pass', 'pass']);
  expect(result('MK-001', '375x812').maskRatio).toBeGreaterThan(0);
});

test('A shifted form is a diff and the run is deterministic', { tag: ['@add-login', '@MK-002'] }, async ({ page }) => {
  await expect(compareWithMockup(page, 'MK-002', { navigate: true })).rejects.toThrow(/MK-002 1280x800: diff/);
  const first = result('MK-002', '1280x800');
  await expect(compareWithMockup(page, 'MK-002', { navigate: true })).rejects.toThrow(/diff/);
  const second = result('MK-002', '1280x800');
  expect(first.ratio).toBeGreaterThan(0.01);
  expect(second.ratio).toBe(first.ratio);
  expect(second.diffSha).toBe(first.diffSha);
  expect(second.mockupSha).toBe(first.mockupSha);
  expect(first.mockupFiles.map((file: { path: string }) => file.path)).toEqual(['assets/app.css', 'login.html']);
});

test('Ambiguous selector: three .card elements fail the comparison', { tag: ['@add-login', '@MK-003'] }, async ({ page }) => {
  await expect(compareWithMockup(page, 'MK-003', { navigate: true })).rejects.toThrow(/\.card が 3 件に一致しました/);
});

test('Different sizes count as a full difference', { tag: ['@add-login', '@MK-004'] }, async ({ page }) => {
  await expect(compareWithMockup(page, 'MK-004', { navigate: true })).rejects.toThrow(/MK-004 800x600: diff 差分率 1/);
  expect(result('MK-004', '800x600').notes.join()).toMatch(/寸法が違います（モック 200x100、実画面 240x100）/);
});

test('Missing plan row: MK-009 is not compared', { tag: ['@add-login', '@MK-009'] }, async ({ page }) => {
  await expect(compareWithMockup(page, 'MK-009')).rejects.toThrow(/MK-009 の行がありません/);
});

test('The MK tag must name the MK being compared', { tag: ['@add-login', '@MK-001'] }, async ({ page }) => {
  await expect(compareWithMockup(page, 'MK-002')).rejects.toThrow(/@MK-002 タグがありません/);
});
