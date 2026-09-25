import { describe, expect, test } from 'bun:test';

import {
  buildDashboardAssistantCodeCopyPayload,
  buildDashboardAssistantCopyPayload,
} from '../src/dashboard/assistant-copy-runtime.js';

describe('buildDashboardAssistantCopyPayload', () => {
  test('prefers the raw assistant response when present', () => {
    expect(buildDashboardAssistantCopyPayload({
      lastAssistantRaw: 'a\nb',
      lastAssistantRange: { start: 1, end: 3 },
      lastAssistantMode: 'rendered',
    }, ['ignored'], (line) => line)).toEqual({
      plain: 'a\nb',
      lineCount: 2,
    });
  });

  test('falls back to chat lines after the last prompt', () => {
    expect(buildDashboardAssistantCopyPayload({
      lastAssistantRaw: null,
      lastAssistantRange: null,
      lastAssistantMode: 'rendered',
    }, ['❯ hi', '', 'answer', 'tail'], (line) => line)).toEqual({
      plain: 'answer\ntail',
      lineCount: 2,
    });
  });

  test('clipboard sink keeps raw text when assistant mentions paths', () => {
    expect(buildDashboardAssistantCopyPayload({
      lastAssistantRaw: '경로는 /tmp/demotxt 입니다.',
      lastAssistantRange: { start: 0, end: 1 },
      lastAssistantMode: 'rendered',
    }, ['ignored'], (line) => line)).toEqual({
      plain: '경로는 /tmp/demotxt 입니다.',
      lineCount: 1,
    });
  });

  test('returns null when there is nothing to copy', () => {
    expect(buildDashboardAssistantCopyPayload({
      lastAssistantRaw: null,
      lastAssistantRange: null,
      lastAssistantMode: 'rendered',
    }, [], (line) => line)).toBeNull();
  });

  test('builds code-only payload from fenced assistant response', () => {
    expect(buildDashboardAssistantCodeCopyPayload({
      lastAssistantRaw: '설명\n```ts\nconst x = 1;\nconsole.log(x);\n```\n끝',
      lastAssistantRange: { start: 0, end: 1 },
      lastAssistantMode: 'rendered',
    })).toEqual({
      plain: 'const x = 1;\nconsole.log(x);',
      lineCount: 2,
    });
  });

  test('returns null when no code block exists', () => {
    expect(buildDashboardAssistantCodeCopyPayload({
      lastAssistantRaw: 'plain answer',
      lastAssistantRange: { start: 0, end: 1 },
      lastAssistantMode: 'rendered',
    })).toBeNull();
  });
});
