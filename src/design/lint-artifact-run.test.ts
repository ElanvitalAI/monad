import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { debug } from '../debug/log.js';
import { runLintDesign } from './lint-artifact-run.js';

type CapturedLog = { category: string; event: string; data?: unknown; options?: unknown };

function captureLogs(): { logs: CapturedLog[]; restore: () => void } {
  const logs: CapturedLog[] = [];
  const originalLog = debug.log;
  (debug as { log: typeof debug.log }).log = ((category: string, event: string, data?: unknown, options?: unknown) => {
    logs.push({ category, event, data, options });
  }) as typeof debug.log;
  return { logs, restore: () => { (debug as { log: typeof debug.log }).log = originalLog; } };
}

describe('runLintDesign observability', () => {
  test('records the P0-producing result with resolved artifact paths and counts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lint-design-run-'));
    const htmlPath = join(directory, 'index.html');
    const cssPath = join(directory, 'styles.css');
    const designPath = join(directory, 'DESIGN.md');
    writeFileSync(htmlPath, '<h1>Title</h1>', 'utf8');
    writeFileSync(cssPath, '.button { background: #6366f1; }', 'utf8');
    writeFileSync(designPath, '# Design\n', 'utf8');
    const { logs, restore } = captureLogs();

    try {
      const result = runLintDesign({ htmlPath, cssPath, designPath });
      expect(result.p0Count).toBeGreaterThan(0);
      expect(logs).toContainEqual({
        category: 'design.lint',
        event: 'done',
        data: {
          htmlPath,
          cssPath,
          designPath,
          p0Count: result.p0Count,
          advisoryCount: result.advisoryCount,
          uncheckedRuleCount: result.skipped.length,
        },
        options: undefined,
      });
    } finally {
      restore();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('records the original failure and rethrows the identical exception', () => {
    const { logs, restore } = captureLogs();
    const directory = mkdtempSync(join(tmpdir(), 'lint-design-failure-'));
    const htmlPath = join(directory, 'index.html');
    const sentinel = new Error('lint sentinel failure');
    writeFileSync(htmlPath, '<h1>Title</h1>', 'utf8');
    const input = {
      htmlPath,
      get cssPath(): string { throw sentinel; },
    };

    try {
      let thrown: unknown;
      try {
        runLintDesign(input);
      } catch (error) {
        thrown = error;
      }
      const failureLog = logs.find((log) => log.category === 'design.lint' && log.event === 'failed');
      const loggedError = (failureLog?.data as { error: unknown }).error;
      expect(thrown).toBe(sentinel);
      expect(typeof loggedError).toBe('string');
      expect(loggedError).toContain(sentinel.message);
      expect(failureLog).toEqual({
        category: 'design.lint',
        event: 'failed',
        data: { htmlPath, error: loggedError },
        options: { level: 'error' },
      });
    } finally {
      restore();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
