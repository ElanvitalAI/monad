import { describe, expect, test } from 'bun:test';

import {
  commitDashboardAssistantRenderState,
  runDashboardTurnTailAutoCopy,
} from '../src/dashboard/turn-tail-runtime.js';

describe('commitDashboardAssistantRenderState', () => {
  test('captures the final assistant render slice', () => {
    expect(commitDashboardAssistantRenderState('answer', 10, 14)).toEqual({
      lastAssistantRaw: 'answer',
      lastAssistantRange: { start: 10, end: 14 },
      lastAssistantMode: 'rendered',
    });
  });
});

describe('runDashboardTurnTailAutoCopy', () => {
  test('runs auto-copy only when enabled', async () => {
    const calls: string[] = [];
    await runDashboardTurnTailAutoCopy({
      enabled: true,
      userText: 'q',
      fullResponse: 'a',
      autoCopyTurnQaToClipboard: async (userText, fullResponse) => {
        calls.push(`${userText}:${fullResponse}`);
      },
      onWarning: () => { calls.push('warn'); },
    });
    expect(calls).toEqual(['q:a']);
  });

  test('surfaces copy failures as warnings', async () => {
    const calls: string[] = [];
    await runDashboardTurnTailAutoCopy({
      enabled: true,
      userText: 'q',
      fullResponse: 'a',
      autoCopyTurnQaToClipboard: async () => {
        throw new Error('copy failed');
      },
      onWarning: (message) => { calls.push(message); },
    });
    expect(calls).toEqual(['(auto-copy Q&A error: copy failed)']);
  });
});
