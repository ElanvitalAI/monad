import { describe, expect, test } from 'bun:test';

import {
  reportDashboardBrowserOpenAction,
  reportDashboardBrowserRevealResult,
  runDashboardScratchClearAction,
  runDashboardScratchCopyAllAction,
  runDashboardScratchExportAction,
} from '../src/dashboard/context-menu-action-runtime.js';

function deps(lines: string[]) {
  return {
    info: (text: string) => `info:${text}`,
    warning: (text: string) => `warn:${text}`,
    pushChatLine: (line: string) => { lines.push(line); },
    setChatScrollBottom: () => { lines.push('scroll'); },
    draw: () => { lines.push('draw'); },
  };
}

describe('dashboard context-menu action runtime', () => {
  test('reports browser open/reveal actions', () => {
    const lines: string[] = [];
    reportDashboardBrowserOpenAction(deps(lines), { absPath: '/tmp/a', isDir: false } as any);
    reportDashboardBrowserRevealResult(deps(lines), { absPath: '/tmp/a' } as any, true);
    expect(lines).toEqual([
      'info:  [ctx-menu] preview: /tmp/a (action TBD)',
      'scroll',
      'draw',
      'info:  revealed in Finder: /tmp/a',
      'scroll',
      'draw',
    ]);
  });

  test('runs scratch clear/copy/export actions', async () => {
    const lines: string[] = [];
    let exported = '';
    let copied = '';
    const cleared = runDashboardScratchClearAction(deps(lines), { lineCount: 3 } as any, 5);
    await runDashboardScratchCopyAllAction(deps(lines), { lineCount: 0, totalBytes: 4 } as any, ['a', 'b'], async (text) => {
      copied = text;
      return true;
    });
    await runDashboardScratchExportAction(deps(lines), ['a'], async (text) => {
      exported = text;
      return '/tmp/file.txt';
    });
    expect(cleared).toEqual([]);
    expect(copied).toBe('a\nb');
    expect(exported).toBe('a\n');
    expect(lines).toEqual([
      'info:  [ctx-menu] scratch cleared (3 lines)',
      'scroll',
      'draw',
      'info:  copied scratch: 0 lines · 4 bytes',
      'scroll',
      'draw',
      'info:  exported scratch → /tmp/file.txt',
      'scroll',
      'draw',
    ]);
  });
});
