import { describe, expect, test } from 'bun:test';

import { appendDashboardAssistantSampleOutput } from '../src/dashboard/assistant-sample-runtime.js';

describe('appendDashboardAssistantSampleOutput', () => {
  test('appends rendered assistant sample lines and updates assistant state', () => {
    const chatLines = ['existing'];
    const state = appendDashboardAssistantSampleOutput({
      chatLines,
      text: '![sample](https://example.com/sample.png)',
      termCols: 100,
      wrapEnabled: true,
      formatResponse: (full) => [full],
      renderTextLine: (line) => `rendered:${line}`,
    });

    expect(chatLines).toEqual([
      'existing',
      'rendered:![sample](https://example.com/sample.png)',
    ]);
    expect(state).toEqual({
      lastAssistantRaw: '![sample](https://example.com/sample.png)',
      lastAssistantRange: { start: 1, end: 2 },
      lastAssistantMode: 'rendered',
    });
  });
});
