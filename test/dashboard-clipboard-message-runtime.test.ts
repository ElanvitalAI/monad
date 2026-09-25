import { describe, expect, test } from 'bun:test';

import {
  buildDashboardAutoCopyQaStatus,
  buildDashboardBrowserOpenPayload,
  buildDashboardCopiedHudText,
  buildDashboardEditorOpenPayload,
  buildDashboardLogCopyPayload,
  buildDashboardScratchDumpLines,
  buildDashboardScratchCopyPayload,
  buildDashboardScratchExportPayload,
} from '../src/dashboard/clipboard-message-runtime.js';

describe('buildDashboardLogCopyPayload', () => {
  test('returns null for empty logs', () => {
    expect(buildDashboardLogCopyPayload([], (line) => line)).toBeNull();
  });

  test('joins ansi-stripped log lines', () => {
    expect(buildDashboardLogCopyPayload(['a', 'b'], (line) => `s:${line}`)).toEqual({
      plain: 's:a\ns:b',
      lineCount: 2,
    });
  });
});

describe('buildDashboardAutoCopyQaStatus', () => {
  test('formats success status by transport', () => {
    expect(buildDashboardAutoCopyQaStatus({ ok: true, via: 'osc52' })).toEqual({
      kind: 'success',
      message: '(auto-copied Q&A via remote clipboard)',
    });
  });

  test('formats failure status with note', () => {
    expect(buildDashboardAutoCopyQaStatus({ ok: false, note: 'missing helper' })).toEqual({
      kind: 'failure',
      message: '(auto-copy Q&A failed — missing helper)',
    });
  });
});

describe('buildDashboardScratchExportPayload', () => {
  test('file-write sink keeps raw scratch text when paths are present', () => {
    expect(buildDashboardScratchExportPayload(['see /tmp/demo.txt', 'and /Users/me/project'])).toBe(
      'see /tmp/demo.txt\nand /Users/me/project\n',
    );
  });
});

describe('buildDashboardScratchCopyPayload', () => {
  test('clipboard sink keeps raw scratch text when paths are present', () => {
    expect(buildDashboardScratchCopyPayload(['see /tmp/demo.txt', 'and /Users/me/project'])).toBe(
      'see /tmp/demo.txt\nand /Users/me/project',
    );
  });
});

describe('buildDashboardScratchDumpLines', () => {
  test('log sink keeps raw scratch lines when paths are present', () => {
    expect(buildDashboardScratchDumpLines(['see /tmp/demo.txt', 'and /Users/me/project'])).toEqual([
      'see /tmp/demo.txt',
      'and /Users/me/project',
    ]);
  });
});

describe('buildDashboardEditorOpenPayload', () => {
  test('editor-open sink keeps the raw path', () => {
    expect(buildDashboardEditorOpenPayload('/Users/me/project/src/index.ts')).toBe(
      '/Users/me/project/src/index.ts',
    );
  });
});

describe('buildDashboardBrowserOpenPayload', () => {
  test('browser-open sink keeps the raw path', () => {
    expect(buildDashboardBrowserOpenPayload('/Users/me/project/src/index.ts')).toBe(
      '/Users/me/project/src/index.ts',
    );
  });

  test('browser-open sink keeps the raw url', () => {
    expect(buildDashboardBrowserOpenPayload('https://example.com/docs?id=42')).toBe(
      'https://example.com/docs?id=42',
    );
  });
});

describe('buildDashboardCopiedHudText', () => {
  test('hud-phase sink keeps short copied text readable', () => {
    expect(buildDashboardCopiedHudText('copied 3 lines via OSC 52')).toBe('copied 3 lines via OSC 52');
  });
});
