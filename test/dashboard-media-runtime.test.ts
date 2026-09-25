import { describe, expect, test } from 'bun:test';

import { createDashboardMediaRuntime } from '../src/dashboard/media-runtime.js';

describe('createDashboardMediaRuntime', () => {
  test('opens the last assistant media preview through the current assistant state', async () => {
    const chatLines: string[] = [];
    const opened: string[] = [];
    const runtime = createDashboardMediaRuntime({
      chatLines,
      setChatScrollBottom: () => { chatLines.push('scroll'); },
      draw: () => { chatLines.push('draw'); },
      muted: (text) => `muted:${text}`,
      warning: (text) => `warn:${text}`,
      getAssistantState: () => ({
        lastAssistantRaw: '![architecture](https://example.com/arch.png)',
        lastAssistantRange: { start: 0, end: 1 },
        lastAssistantMode: 'rendered',
      }),
      openTarget: async (url) => { opened.push(url); },
    });

    await runtime.openLastAssistantMediaPreview();

    expect(opened).toEqual(['https://example.com/arch.png']);
    expect(chatLines).toEqual([
      'muted:(opened picture preview: architecture)',
      'scroll',
      'draw',
    ]);
  });
});
