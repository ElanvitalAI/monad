// summarizeFileWithLLM tests.
//
// All deps are injected — no fs, no LLM call. Verifies (a) binary skip,
// (b) hard size cap, (c) read failure surfacing, (d) truncation
// envelope around the user prompt, (e) successful summary path.

import { describe, expect, test } from 'bun:test';
import {
  summarizeFileWithLLM,
  looksBinary,
  DEFAULT_SUMMARY_MAX_BYTES,
} from '../src/dashboard/browser-llm-summary.js';
import type { LLMMessage } from '../src/llm.js';

interface LLMCapture {
  messages: LLMMessage[];
  maxTokens: number | undefined;
}

type StreamLLMShape = (
  messages: LLMMessage[],
  onChunk: (delta: string, full: string) => void,
  opts?: { maxTokens?: number },
) => Promise<string>;

function makeLLM(reply: string): {
  llm: StreamLLMShape;
  capture: LLMCapture[];
} {
  const capture: LLMCapture[] = [];
  const llm = (async (messages, onChunk, opts) => {
    capture.push({ messages, maxTokens: opts?.maxTokens });
    onChunk(reply, reply);
    return reply;
  }) as StreamLLMShape;
  return { llm, capture };
}

describe('looksBinary', () => {
  test('detects png/pdf/wasm/etc.', () => {
    expect(looksBinary('/tmp/img.png')).toBe(true);
    expect(looksBinary('/tmp/doc.PDF')).toBe(true);
    expect(looksBinary('/tmp/a.wasm')).toBe(true);
    expect(looksBinary('/tmp/x.zip')).toBe(true);
  });

  test('text-like extensions are not binary', () => {
    expect(looksBinary('/tmp/x.ts')).toBe(false);
    expect(looksBinary('/tmp/README.md')).toBe(false);
    expect(looksBinary('/tmp/no-ext-file')).toBe(false);
    expect(looksBinary('/tmp/a.json')).toBe(false);
  });
});

describe('summarizeFileWithLLM', () => {
  test('rejects binary files before stat/read', async () => {
    let statCalled = 0, readCalled = 0;
    const { llm, capture } = makeLLM('unused');
    const r = await summarizeFileWithLLM('/tmp/cat.png', {
      stat: async () => { statCalled += 1; return { size: 10 }; },
      readFile: async () => { readCalled += 1; return ''; },
      streamLLM: llm,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('binary');
    expect(statCalled).toBe(0);
    expect(readCalled).toBe(0);
    expect(capture).toHaveLength(0);
  });

  test('rejects files larger than the hard cap (5x maxBytes)', async () => {
    const { llm, capture } = makeLLM('unused');
    const hardCap = DEFAULT_SUMMARY_MAX_BYTES * 5;
    const r = await summarizeFileWithLLM('/tmp/huge.log', {
      stat: async () => ({ size: hardCap + 1 }),
      readFile: async () => '',
      streamLLM: llm,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('too large');
    expect(capture).toHaveLength(0);
  });

  test('surfaces stat failures', async () => {
    const { llm } = makeLLM('unused');
    const r = await summarizeFileWithLLM('/tmp/missing.ts', {
      stat: async () => { throw new Error('ENOENT: not found'); },
      streamLLM: llm,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('not readable');
  });

  test('surfaces read failures', async () => {
    const { llm } = makeLLM('unused');
    const r = await summarizeFileWithLLM('/tmp/locked.ts', {
      stat: async () => ({ size: 100 }),
      readFile: async () => { throw new Error('EACCES'); },
      streamLLM: llm,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('read failed');
  });

  test('successful path: returns accumulated summary + size + not-truncated', async () => {
    const { llm, capture } = makeLLM('- bullet 1\n- bullet 2\n- bullet 3');
    const r = await summarizeFileWithLLM('/tmp/small.ts', {
      stat: async () => ({ size: 500 }),
      readFile: async () => 'export function foo() {}',
      streamLLM: llm,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.summary).toBe('- bullet 1\n- bullet 2\n- bullet 3');
      expect(r.sizeBytes).toBe(500);
      expect(r.truncated).toBe(false);
    }
    expect(capture).toHaveLength(1);
    expect(capture[0]!.maxTokens).toBe(600);
  });

  test('truncates content past maxBytes and marks truncated:true', async () => {
    const big = 'x'.repeat(DEFAULT_SUMMARY_MAX_BYTES + 5_000);
    const { llm, capture } = makeLLM('summary');
    const r = await summarizeFileWithLLM('/tmp/medium.ts', {
      stat: async () => ({ size: big.length }),
      readFile: async () => big,
      streamLLM: llm,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.truncated).toBe(true);
    // The user-message content should end with the truncation marker.
    const userMsg = capture[0]!.messages[0]!;
    const content = typeof userMsg.content === 'string' ? userMsg.content : '';
    expect(content).toContain('[…truncated…]');
    // And the embedded payload must NOT exceed maxBytes + the marker
    // (sanity check — truncation actually trimmed).
    expect(content.length).toBeLessThan(big.length);
  });

  test('LLM throw is converted to {ok:false}', async () => {
    const r = await summarizeFileWithLLM('/tmp/x.ts', {
      stat: async () => ({ size: 100 }),
      readFile: async () => 'hello',
      streamLLM: async () => { throw new Error('rate limited'); },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('LLM call failed');
  });

  test('honors custom maxTokens override', async () => {
    const { llm, capture } = makeLLM('ok');
    await summarizeFileWithLLM('/tmp/x.ts', {
      stat: async () => ({ size: 50 }),
      readFile: async () => 'x',
      streamLLM: llm,
    }, { maxTokens: 1000 });
    expect(capture[0]!.maxTokens).toBe(1000);
  });

  test('respects custom maxBytes — truncates earlier when set lower', async () => {
    const text = 'y'.repeat(2_000);
    const { llm, capture } = makeLLM('ok');
    const r = await summarizeFileWithLLM('/tmp/x.ts', {
      stat: async () => ({ size: text.length }),
      readFile: async () => text,
      streamLLM: llm,
    }, { maxBytes: 500 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.truncated).toBe(true);
    const content = typeof capture[0]!.messages[0]!.content === 'string'
      ? capture[0]!.messages[0]!.content as string
      : '';
    expect(content).toContain('[…truncated…]');
  });
});
