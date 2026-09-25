import { describe, expect, test } from 'bun:test';

import { toggleDashboardAssistantRenderState } from '../src/dashboard/assistant-render-state-runtime.js';

describe('toggleDashboardAssistantRenderState', () => {
  test('returns unchanged state when no assistant turn exists', () => {
    const state = {
      lastAssistantRaw: null,
      lastAssistantRange: null,
      lastAssistantMode: 'rendered' as const,
    };
    const result = toggleDashboardAssistantRenderState({
      state,
      termCols: 80,
      wrapEnabled: true,
      chatLines: [],
      formatResponse: () => [],
      text: (line) => line,
    });
    expect(result).toEqual({ nextState: state, applied: false });
  });

  test('toggles from rendered to raw and updates the range', () => {
    const chatLines = ['head', 'rendered line'];
    const result = toggleDashboardAssistantRenderState({
      state: {
        lastAssistantRaw: 'raw line 1\nraw line 2',
        lastAssistantRange: { start: 1, end: 2 },
        lastAssistantMode: 'rendered',
      },
      termCols: 80,
      wrapEnabled: true,
      chatLines,
      formatResponse: () => ['rendered line'],
      text: (line) => `txt:${line}`,
    });
    expect(result.applied).toBe(true);
    expect(chatLines).toEqual(['head', 'txt:raw line 1', 'txt:raw line 2']);
    expect(result.nextState.lastAssistantMode).toBe('raw');
    expect(result.nextState.lastAssistantRange).toEqual({ start: 1, end: 3 });
  });
});
