// BACKLOG #1 — replay-preview rendering tests.
//
// `renderReplayPreviewLines` centralizes the "Preview of last 5"
// block shown after a session is replayed (boot resume · /resume
// mid-flight swap · /session load). This test pins the rendering
// contract: markdown is preserved (matches the streaming path's
// `formatResponse`), role prefixes are stable, and per-message line
// caps + continuation markers behave.

import { describe, expect, test } from 'bun:test';
import { stripVTControlCharacters } from 'node:util';

import {
  extractReplayText,
  renderReplayPreviewLines,
  type ReplayPreviewMessage,
} from '../src/dashboard/replay-preview.js';

const stripAnsi = (s: string): string => stripVTControlCharacters(s);

describe('extractReplayText', () => {
  test('returns string content unchanged', () => {
    expect(extractReplayText('hello **world**')).toBe('hello **world**');
  });

  test('joins ACP-style text blocks', () => {
    const blocks = [
      { type: 'text', text: 'a' },
      { type: 'image', text: 'ignored' },
      { type: 'text', text: 'b' },
    ];
    expect(extractReplayText(blocks)).toBe('ab');
  });

  test('returns empty string for unknown shapes', () => {
    expect(extractReplayText(null)).toBe('');
    expect(extractReplayText(42)).toBe('');
    expect(extractReplayText(undefined)).toBe('');
  });
});

describe('renderReplayPreviewLines', () => {
  test('renders bold markdown via formatResponse, not as raw asterisks', () => {
    const messages: ReplayPreviewMessage[] = [
      { role: 'assistant', content: 'this is **bold** text' },
    ];
    const lines = renderReplayPreviewLines(messages, { maxWidth: 80 });
    expect(lines.length).toBeGreaterThan(0);
    const joined = lines.map(stripAnsi).join('\n');
    // The literal `**` markers shouldn't survive — `formatResponse`
    // strips them and applies ANSI bold.
    expect(joined).not.toContain('**bold**');
    expect(joined).toContain('bold');
  });

  test('uses you / asst / sys role prefixes', () => {
    const messages: ReplayPreviewMessage[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'system', content: 's1' },
    ];
    const lines = renderReplayPreviewLines(messages, { maxWidth: 80 });
    const joined = lines.map(stripAnsi).join('\n');
    expect(joined).toContain('you');
    expect(joined).toContain('asst');
    expect(joined).toContain('sys');
  });

  test('caps to last `tail` messages (default 5)', () => {
    const messages: ReplayPreviewMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const lines = renderReplayPreviewLines(messages, { maxWidth: 80 });
    const joined = lines.map(stripAnsi).join('\n');
    // First 5 messages should be omitted from the preview.
    for (let i = 0; i < 5; i += 1) {
      expect(joined).not.toContain(`msg-${i}`);
    }
    // Last 5 must all be present.
    for (let i = 5; i < 10; i += 1) {
      expect(joined).toContain(`msg-${i}`);
    }
  });

  test('honors custom tail size', () => {
    const messages: ReplayPreviewMessage[] = Array.from({ length: 6 }, (_, i) => ({
      role: 'user',
      content: `m${i}`,
    }));
    const lines = renderReplayPreviewLines(messages, { maxWidth: 80, tail: 2 });
    const joined = lines.map(stripAnsi).join('\n');
    expect(joined).toContain('m4');
    expect(joined).toContain('m5');
    expect(joined).not.toContain('m0');
    expect(joined).not.toContain('m3');
  });

  test('caps per-message lines and shows "more lines" footer', () => {
    // Force multi-line output by giving a list with several items.
    const longBody = '- item1\n- item2\n- item3\n- item4\n- item5\n- item6';
    const messages: ReplayPreviewMessage[] = [{ role: 'assistant', content: longBody }];
    const lines = renderReplayPreviewLines(messages, {
      maxWidth: 40,
      perMessageLines: 2,
    });
    const joined = lines.map(stripAnsi).join('\n');
    // First 2 list items rendered, and a continuation footer must appear.
    expect(joined).toContain('item1');
    expect(joined).toContain('item2');
    expect(joined).toMatch(/more line/);
    // Items past the cap are NOT in the preview block.
    expect(joined).not.toContain('item6');
  });

  test('skips empty content messages cleanly', () => {
    const messages: ReplayPreviewMessage[] = [
      { role: 'user', content: '' },
      { role: 'assistant', content: 'real content' },
    ];
    const lines = renderReplayPreviewLines(messages, { maxWidth: 80 });
    const joined = lines.map(stripAnsi).join('\n');
    expect(joined).toContain('real content');
    // Empty messages don't produce a stray prefix-only line.
    const youLines = lines.filter((l) => stripAnsi(l).trim().startsWith('you'));
    expect(youLines.length).toBe(0);
  });

  test('handles ACP-style block content via extractReplayText', () => {
    const messages: ReplayPreviewMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'text', text: ' world' },
        ],
      },
    ];
    const lines = renderReplayPreviewLines(messages, { maxWidth: 80 });
    const joined = lines.map(stripAnsi).join('\n');
    expect(joined).toContain('hello world');
  });
});
