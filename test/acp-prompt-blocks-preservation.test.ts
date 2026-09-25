// Step 2 of platform-evolution arc · PR α — ContentBlock[] preservation
// from ACP PromptRequest through to LLM message content.
//
// Validates the core mapping helper (acpPromptToLlmContent +
// flattenLlmContent) and the daemon-runtime path that keeps image /
// resource_link blocks intact. Text-only path collapses back to
// `content: string` so the legacy jsonl shape is preserved for
// pre-Step 2 messages.

import { describe, expect, test } from 'bun:test';
import type { ContentBlock as AcpContentBlock } from '@agentclientprotocol/sdk';

import {
  acpPromptToLlmContent,
  flattenLlmContent,
} from '../src/acp/content-blocks.js';
import { DaemonSessionHistory } from '../src/boot/daemon-runtime.js';
import {
  appendUserPromptBlocksAndBuildMessages,
  appendUserAndBuildMessages,
} from '../src/boot/daemon-history-helper.js';

describe('acpPromptToLlmContent', () => {
  test('text block round-trips as { type: text }', () => {
    const out = acpPromptToLlmContent([{ type: 'text', text: 'hello' }]);
    expect(out).toEqual([{ type: 'text', text: 'hello' }]);
  });

  test('image block maps mimeType→mediaType, data→base64', () => {
    const out = acpPromptToLlmContent([
      { type: 'image', data: 'iVBORw0KGgo...', mimeType: 'image/png' },
    ]);
    expect(out).toEqual([
      { type: 'image', mediaType: 'image/png', base64: 'iVBORw0KGgo...' },
    ]);
  });

  test('audio block preserves native bytes and MIME type', () => {
    const originalBytes = Buffer.from([0x52, 0x49, 0x46, 0x46]);
    const base64 = originalBytes.toString('base64');
    const out = acpPromptToLlmContent([
      { type: 'audio', data: base64, mimeType: 'audio/ogg' },
    ] as AcpContentBlock[]);
    expect(out).toEqual([{ type: 'audio', base64, mediaType: 'audio/ogg' }]);
  });

  test('resource_link becomes [file: <name>] placeholder text', () => {
    const out = acpPromptToLlmContent([
      { type: 'resource_link', uri: 'file:///x/report.pdf', name: 'report.pdf' },
    ]);
    expect(out).toEqual([{ type: 'text', text: '[file: report.pdf]' }]);
  });

  test('multi-block prompt — text + image + resource_link', () => {
    const out = acpPromptToLlmContent([
      { type: 'text', text: 'analyze this' },
      { type: 'image', data: 'AAA', mimeType: 'image/jpeg' },
      { type: 'resource_link', uri: 'file:///doc.txt', name: 'doc.txt' },
    ]);
    expect(out).toEqual([
      { type: 'text', text: 'analyze this' },
      { type: 'image', mediaType: 'image/jpeg', base64: 'AAA' },
      { type: 'text', text: '[file: doc.txt]' },
    ]);
  });

  test('unknown block types are silently dropped', () => {
    const out = acpPromptToLlmContent([
      { type: 'text', text: 'kept' },
      // @ts-expect-error — synthetic future block kind
      { type: 'future_block', data: 'XXX' },
    ]);
    expect(out).toEqual([{ type: 'text', text: 'kept' }]);
  });
});

describe('flattenLlmContent', () => {
  test('all-text → joined string', () => {
    const out = flattenLlmContent([
      { type: 'text', text: 'one' },
      { type: 'text', text: 'two' },
    ]);
    expect(out).toBe('one\ntwo');
  });

  test('empty → empty string', () => {
    expect(flattenLlmContent([])).toBe('');
  });

  test('mixed (text + image) → preserves array', () => {
    const blocks = [
      { type: 'text', text: 'caption' } as const,
      { type: 'image', mediaType: 'image/png', base64: 'AAA' } as const,
    ];
    expect(flattenLlmContent(blocks)).toEqual(blocks);
  });
});

describe('appendUserPromptBlocksAndBuildMessages', () => {
  test('text-only blocks collapse to string content (legacy shape)', () => {
    const history = new DaemonSessionHistory();
    const msgs = appendUserPromptBlocksAndBuildMessages(
      history, 'sess-1',
      [{ type: 'text', text: 'plain text' }],
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.role).toBe('user');
    expect(msgs[0]!.content).toBe('plain text');
    // History persistence shape matches the legacy helper.
    const stored = history.get('sess-1');
    expect(stored).toEqual([{ role: 'user', content: 'plain text' }]);
  });

  test('image block preserves ContentBlock[] in stored content', () => {
    const history = new DaemonSessionHistory();
    const msgs = appendUserPromptBlocksAndBuildMessages(
      history, 'sess-1',
      [
        { type: 'text', text: 'whats in this?' },
        { type: 'image', data: 'BASE64', mimeType: 'image/png' },
      ],
    );
    expect(msgs[0]!.content).toEqual([
      { type: 'text', text: 'whats in this?' },
      { type: 'image', mediaType: 'image/png', base64: 'BASE64' },
    ]);
    // Persisted history retains the multimodal shape.
    expect(history.get('sess-1')[0]!.content).toEqual([
      { type: 'text', text: 'whats in this?' },
      { type: 'image', mediaType: 'image/png', base64: 'BASE64' },
    ]);
  });

  test('systemPrompt is prepended only on first turn', () => {
    const history = new DaemonSessionHistory();
    const m1 = appendUserPromptBlocksAndBuildMessages(
      history, 'sess-1',
      [{ type: 'text', text: 'first' }],
      'You are concise.',
    );
    expect(m1.map((m) => m.role)).toEqual(['system', 'user']);
    const m2 = appendUserPromptBlocksAndBuildMessages(
      history, 'sess-1',
      [{ type: 'text', text: 'second' }],
      'You are concise.',
    );
    expect(m2.map((m) => m.role)).toEqual(['user', 'user']); // second turn — system NOT re-injected
  });

  test('parity with appendUserAndBuildMessages on text-only input', () => {
    const h1 = new DaemonSessionHistory();
    const h2 = new DaemonSessionHistory();
    const a = appendUserAndBuildMessages(h1, 'sess', 'hi there');
    const b = appendUserPromptBlocksAndBuildMessages(
      h2, 'sess',
      [{ type: 'text', text: 'hi there' }],
    );
    expect(a).toEqual(b);
    expect(h1.get('sess')).toEqual(h2.get('sess'));
  });
});
