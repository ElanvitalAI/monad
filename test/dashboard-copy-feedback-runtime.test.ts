import { describe, expect, test } from 'bun:test';

import {
  runDashboardAssistantCodeCopy,
  runDashboardAssistantCopy,
  runDashboardAutoCopyQa,
  runDashboardLogCopy,
} from '../src/dashboard/copy-feedback-runtime.js';
import {
  buildDashboardAutoCopyQaPayload,
  buildDashboardLogCopyPayload,
} from '../src/dashboard/clipboard-message-runtime.js';

function baseDeps(chatLines: string[]) {
  return {
    chatLines,
    setChatScrollBottom: () => { chatLines.push('scroll'); },
    draw: () => { chatLines.push('draw'); },
    muted: (text: string) => `muted:${text}`,
    warning: (text: string) => `warn:${text}`,
  };
}

describe('runDashboardAssistantCopy', () => {
  test('copies raw assistant text and reports success', async () => {
    const chatLines: string[] = [];
    await runDashboardAssistantCopy({
      ...baseDeps(chatLines),
      state: {
        lastAssistantRaw: 'answer',
        lastAssistantRange: { start: 0, end: 1 },
        lastAssistantMode: 'rendered',
      },
      stripAnsi: (line) => line,
      writeClipboard: async () => true,
    });
    expect(chatLines).toEqual([
      'muted:(copied 1 lines, raw markdown)',
      'scroll',
      'draw',
    ]);
  });
});

describe('runDashboardAssistantCodeCopy', () => {
  test('copies fenced code only and reports success', async () => {
    const chatLines: string[] = [];
    let copied = '';
    await runDashboardAssistantCodeCopy({
      ...baseDeps(chatLines),
      state: {
        lastAssistantRaw: '설명\n```ts\nconst x = 1;\nconsole.log(x);\n```\n끝',
        lastAssistantRange: { start: 0, end: 1 },
        lastAssistantMode: 'rendered',
      },
      writeClipboard: async (plain) => {
        copied = plain;
        return true;
      },
    });
    expect(copied).toBe('const x = 1;\nconsole.log(x);');
    expect(chatLines).toEqual([
      'muted:(copied 2 code lines)',
      'scroll',
      'draw',
    ]);
  });

  test('warns when no code block exists', async () => {
    const chatLines: string[] = [];
    await runDashboardAssistantCodeCopy({
      ...baseDeps(chatLines),
      state: {
        lastAssistantRaw: 'plain answer',
        lastAssistantRange: { start: 0, end: 1 },
        lastAssistantMode: 'rendered',
      },
      writeClipboard: async () => true,
    });
    expect(chatLines).toEqual([
      'warn:(no code block to copy)',
      'scroll',
      'draw',
    ]);
  });
});

describe('runDashboardLogCopy', () => {
  test('warns when the log is empty', async () => {
    const chatLines: string[] = [];
    await runDashboardLogCopy({
      ...baseDeps(chatLines),
      stripAnsi: (line) => line,
      writeClipboard: async () => true,
    });
    expect(chatLines).toEqual([
      'warn:(log is empty — nothing to copy)',
      'scroll',
      'draw',
    ]);
  });

  test('log payload keeps raw text when lines mention paths', () => {
    expect(buildDashboardLogCopyPayload(['경로는 /tmp/demotxt 입니다.'], (line) => line)).toEqual({
      plain: '경로는 /tmp/demotxt 입니다.',
      lineCount: 1,
    });
  });
});

describe('runDashboardAutoCopyQa', () => {
  test('formats success feedback from detailed clipboard writes', async () => {
    const chatLines: string[] = [];
    await runDashboardAutoCopyQa({
      ...baseDeps(chatLines),
      question: 'Q',
      answer: 'A',
      writeClipboardDetailed: async () => ({ ok: true, via: 'osc52' }),
    });
    expect(chatLines).toEqual([
      'muted:(auto-copied Q&A via remote clipboard)',
      'scroll',
      'draw',
    ]);
  });

  test('q&a payload keeps raw text when answer mentions paths', () => {
    expect(buildDashboardAutoCopyQaPayload('Q', '경로는 /tmp/demotxt 입니다.')).toBe([
      'Q:',
      'Q',
      '',
      'A:',
      '경로는 /tmp/demotxt 입니다.',
    ].join('\n'));
  });
});
