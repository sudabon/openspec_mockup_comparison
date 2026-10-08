// Mockup comparison helper (openspec-mockup-comparison). Do not edit: the add-on's doctor checks this file.
//
// Use it at the end of a test that has put the screen into the state its mockup shows:
//
//   import { compareWithMockup } from '../support/mockup';
//   test('ログイン画面がモックと一致する', { tag: ['@<change-id>', '@MK-NNN'] }, async ({ page }) => {
//     await page.goto('/login');
//     await compareWithMockup(page, 'MK-NNN');
//   });
//
// The helper reads the MK row of the change's mockup-plan.md, opens the mockup from a local static server at each
// viewport, screenshots both sides under the same conditions, and fails the test when a viewport is not `pass`.
// Images and result.json go to test-results/mockup/<change>/<MK>/<viewport>/ for `mockup-gate.mjs record`.
import { test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface CompareOptions {
  /** Navigate to the plan row's Target before each screenshot. By default the page is compared as the test left it. */
  navigate?: boolean;
}

function repositoryRoot(): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

export async function compareWithMockup(page: Page, mkId: string, options: CompareOptions = {}) {
  const repo = repositoryRoot();
  const core = await import(pathToFileURL(join(repo, 'scripts/lib/mockup/compare.mjs')).href);
  return core.compareWithMockup(page, mkId, { ...options, testInfo: test.info(), repo });
}
