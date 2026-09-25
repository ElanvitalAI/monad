import { describe, expect, test } from 'bun:test';

import {
  bootDashboardPlanModeRuntime,
  cleanupDashboardWorktreeSessions,
  createDashboardPlanModeHandoff,
} from '../src/dashboard/plan-mode-runtime-boot.js';
import type { LLMMessage } from '../src/llm.js';

describe('cleanupDashboardWorktreeSessions', () => {
  test('reports only when stale sessions were removed', () => {
    const removed: number[] = [];
    cleanupDashboardWorktreeSessions({
      cleanupStaleWorktreeSessions: () => ({ removed: 2 }),
      onRemoved: (count) => { removed.push(count); },
    });
    cleanupDashboardWorktreeSessions({
      cleanupStaleWorktreeSessions: () => ({ removed: 0 }),
      onRemoved: (count) => { removed.push(count); },
    });
    expect(removed).toEqual([2]);
  });
});

describe('createDashboardPlanModeHandoff', () => {
  test('compacts, reseeds chat history, clears UI state, and draws', async () => {
    const history: LLMMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'old user' },
    ];
    const events: string[] = [];
    const handoff = createDashboardPlanModeHandoff({
      compactConversation: async () => ({ summary: 'summary body' }),
      appendCompactToMemory: async (summary) => { events.push(`append:${summary}`); },
      chatHistory: history,
      resetChatLines: () => { events.push('reset-chat-lines'); },
      clearAttachmentRows: () => { events.push('clear-attachments'); },
      clearLogSearch: () => { events.push('clear-log-search'); },
      pushSuccessLine: (message) => { events.push(`success:${message}`); },
      pushWarningLine: (message) => { events.push(`warning:${message}`); },
      setChatScrollBottom: () => { events.push('scroll-bottom'); },
      draw: () => { events.push('draw'); },
    });

    await handoff('plan body', '/tmp/plan.md', 'sess-1');

    expect(events).toEqual([
      'append:summary body',
      'reset-chat-lines',
      'clear-attachments',
      'clear-log-search',
      'success:[compact] plan sess-1 loaded — implementation phase starts now.',
      'scroll-bottom',
      'draw',
    ]);
    expect(history).toEqual([
      { role: 'system', content: 'system prompt' },
      {
        role: 'user',
        content: 'Previous plan (saved to /tmp/plan.md, session sess-1):\n\nplan body\n\nImplement this now.',
      },
    ]);
  });
});

describe('bootDashboardPlanModeRuntime', () => {
  test('wires exit-plan deps with coordinator, termSize, and handoff', () => {
    let installed:
      | { coordinator: unknown; termSize: () => { cols: number; rows: number }; onHandoff: (a: string, b: string, c: string) => Promise<void> }
      | undefined;
    const handoff = async () => {};
    bootDashboardPlanModeRuntime({
      setExitPlanModeDeps: (deps) => { installed = deps; },
      coordinator: { kind: 'display' },
      termSize: () => ({ cols: 120, rows: 40 }),
      onHandoff: handoff,
    });
    expect(installed?.coordinator).toEqual({ kind: 'display' });
    expect(installed?.termSize()).toEqual({ cols: 120, rows: 40 });
    expect(installed?.onHandoff).toBe(handoff);
  });
});
