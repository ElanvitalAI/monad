import { describe, expect, test } from 'bun:test';

import { createDashboardCopyRuntime } from '../src/dashboard/copy-runtime.js';

describe('createDashboardCopyRuntime', () => {
  test('delegates assistant copy through the current assistant state', async () => {
    const chatLines: string[] = [];
    const runtime = createDashboardCopyRuntime({
      chatLines,
      setChatScrollBottom: () => { chatLines.push('scroll'); },
      draw: () => { chatLines.push('draw'); },
      muted: (text) => `muted:${text}`,
      warning: (text) => `warn:${text}`,
      getAssistantState: () => ({
        lastAssistantRaw: 'answer',
        lastAssistantRange: { start: 0, end: 1 },
        lastAssistantMode: 'rendered',
      }),
      stripAnsi: (line) => line,
      writeClipboard: async () => true,
      writeClipboardDetailed: async () => ({ ok: true }),
    });

    await runtime.copyLastAssistantTurnToClipboard();
    expect(chatLines).toEqual([
      'muted:(copied 1 lines, raw markdown)',
      'scroll',
      'draw',
    ]);
  });

  test('delegates assistant code copy through the current assistant state', async () => {
    const chatLines: string[] = [];
    let copied = '';
    const runtime = createDashboardCopyRuntime({
      chatLines,
      setChatScrollBottom: () => { chatLines.push('scroll'); },
      draw: () => { chatLines.push('draw'); },
      muted: (text) => `muted:${text}`,
      warning: (text) => `warn:${text}`,
      getAssistantState: () => ({
        lastAssistantRaw: '```ts\nconst x = 1;\n```',
        lastAssistantRange: { start: 0, end: 1 },
        lastAssistantMode: 'rendered',
      }),
      stripAnsi: (line) => line,
      writeClipboard: async (plain) => {
        copied = plain;
        return true;
      },
      writeClipboardDetailed: async () => ({ ok: true }),
    });

    await runtime.copyLastAssistantCodeToClipboard();
    expect(copied).toBe('const x = 1;');
    expect(chatLines).toEqual([
      'muted:(copied 1 code lines)',
      'scroll',
      'draw',
    ]);
  });

  test('delegates log copy and q&a copy', async () => {
    const chatLines = ['❯ hi', 'answer'];
    const runtime = createDashboardCopyRuntime({
      chatLines,
      setChatScrollBottom: () => { chatLines.push('scroll'); },
      draw: () => { chatLines.push('draw'); },
      muted: (text) => `muted:${text}`,
      warning: (text) => `warn:${text}`,
      getAssistantState: () => ({
        lastAssistantRaw: null,
        lastAssistantRange: null,
        lastAssistantMode: 'rendered',
      }),
      stripAnsi: (line) => line,
      writeClipboard: async () => true,
      writeClipboardDetailed: async () => ({ ok: true, via: 'osc52' }),
    });

    await runtime.copyLogPaneToClipboard();
    await runtime.autoCopyTurnQaToClipboard('Q', 'A');
    expect(chatLines.slice(2)).toEqual([
      'muted:(copied 2 log lines)',
      'scroll',
      'draw',
      'muted:(auto-copied Q&A via remote clipboard)',
      'scroll',
      'draw',
    ]);
  });
});
