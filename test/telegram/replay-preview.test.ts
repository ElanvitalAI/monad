// Tier 1 telegram fan-out arc — PR 3 · replay preview helper tests.

import { describe, expect, test } from 'bun:test';

import { renderTelegramReplayPreviewHtml } from '../../src/telegram/replay-preview.js';
import type { LLMMessage } from '../../src/llm.js';

describe('renderTelegramReplayPreviewHtml', () => {
  test('returns empty array for empty history', () => {
    expect(renderTelegramReplayPreviewHtml([])).toEqual([]);
  });

  test('returns empty array when no preview-able roles present', () => {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'system prompt' },
    ];
    expect(renderTelegramReplayPreviewHtml(messages)).toEqual([]);
  });

  test('renders user + assistant messages with role gutter prefix', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'what is 2+2?' },
      { role: 'assistant', content: '4' },
    ];
    const out = renderTelegramReplayPreviewHtml(messages);
    expect(out).toHaveLength(1);
    expect(out[0]!.role).toBe('user');
    expect(out[0]!.html).toContain('what is 2+2?');
    expect(out[0]!.html).toContain('4');
    expect(out[0]!.html).toContain('👤');
    expect(out[0]!.html).toContain('🤖');
  });

  test('honors `limit` opt — only the most recent N entries', () => {
    const messages: LLMMessage[] = [];
    for (let i = 0; i < 12; i++) {
      messages.push({ role: 'user', content: `q${i}` });
      messages.push({ role: 'assistant', content: `a${i}` });
    }
    const out = renderTelegramReplayPreviewHtml(messages, { limit: 3 });
    expect(out).toHaveLength(1);
    // Most recent 3 messages: a10, q11, a11 (in chronological order
    // after the unshift loop). The earlier q0/a0 must NOT appear.
    expect(out[0]!.html).not.toContain('q0');
    expect(out[0]!.html).not.toContain('a0');
    expect(out[0]!.html).toContain('a11');
    expect(out[0]!.html).toContain('q11');
  });

  test('escapes html-special characters in message content', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'check <script>alert(1)</script> & this' },
    ];
    const out = renderTelegramReplayPreviewHtml(messages);
    expect(out[0]!.html).not.toContain('<script>');
    expect(out[0]!.html).toContain('&lt;script&gt;');
    expect(out[0]!.html).toContain('&amp;');
  });

  test('caps multi-line message bodies and reports remaining count', () => {
    const longBody = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
    const messages: LLMMessage[] = [{ role: 'assistant', content: longBody }];
    const out = renderTelegramReplayPreviewHtml(messages, { linesPerMessage: 5 });
    expect(out[0]!.html).toContain('line 1');
    expect(out[0]!.html).toContain('line 5');
    expect(out[0]!.html).not.toContain('line 6');
    expect(out[0]!.html).toContain('+15 more lines');
  });

  test('prepends header when provided', () => {
    const messages: LLMMessage[] = [{ role: 'user', content: 'hi' }];
    const out = renderTelegramReplayPreviewHtml(messages, {
      header: '↩ Resumed <code>monad-session-3</code> — last turns:',
    });
    expect(out[0]!.html).toContain('Resumed');
    expect(out[0]!.html).toContain('monad-session-3');
  });

  test('appends more-footer when input exceeds limit and prefix supplied', () => {
    const messages: LLMMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push({ role: 'user', content: `m${i}` });
    }
    const out = renderTelegramReplayPreviewHtml(messages, {
      limit: 3,
      moreFooterPrefix: '_…earlier turns omitted, total:_',
    });
    // 10 eligible messages, 3 shown → 7 omitted.
    expect(out[0]!.html).toContain('omitted');
    expect(out[0]!.html).toContain('7');
  });

  test('omits more-footer when prefix not supplied even if entries truncated', () => {
    const messages: LLMMessage[] = [];
    for (let i = 0; i < 10; i++) messages.push({ role: 'user', content: `m${i}` });
    const out = renderTelegramReplayPreviewHtml(messages, { limit: 3 });
    expect(out[0]!.html).not.toContain('omitted');
  });

  test('splits long output across multiple chunks under perMessageHtmlMax', () => {
    // Build a single huge message that, after html conversion, will
    // exceed a tight per-message cap. Use 200-char-per-line to make
    // the math obvious.
    const bigLine = 'x'.repeat(200);
    const body = Array.from({ length: 20 }, () => bigLine).join('\n');
    const messages: LLMMessage[] = [{ role: 'assistant', content: body }];
    const out = renderTelegramReplayPreviewHtml(messages, {
      perMessageHtmlMax: 500,
      linesPerMessage: 100, // don't truncate by lines, force chunk by size
    });
    expect(out.length).toBeGreaterThanOrEqual(1);
    for (const chunk of out) {
      expect(chunk.html.length).toBeLessThanOrEqual(500);
    }
  });

  test('skips empty / whitespace-only message content', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: '   ' },
      { role: 'assistant', content: '\n\t\n' },
      { role: 'user', content: 'real question' },
    ];
    const out = renderTelegramReplayPreviewHtml(messages);
    expect(out).toHaveLength(1);
    expect(out[0]!.html).toContain('real question');
  });

  test('handles array-shaped content blocks (extracts text type only)', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'caption text' },
          { type: 'image', mediaType: 'image/png', base64: 'IGNORED_DATA' },
        ],
      },
    ] as unknown as LLMMessage[];
    const out = renderTelegramReplayPreviewHtml(messages);
    expect(out[0]!.html).toContain('caption text');
    expect(out[0]!.html).not.toContain('IGNORED_DATA');
  });

  test('preview entries each fit within Telegram default cap (4000)', () => {
    // Spec sanity — every chunk must stay under the default cap so
    // sendMessage doesn't 400 on parse_entity overflow.
    const messages: LLMMessage[] = Array.from({ length: 5 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'x'.repeat(2000),
    }));
    const out = renderTelegramReplayPreviewHtml(messages, { linesPerMessage: 100 });
    for (const c of out) {
      expect(c.html.length).toBeLessThanOrEqual(4000);
    }
  });
});
