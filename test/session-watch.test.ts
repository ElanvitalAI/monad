// `monad session watch` — live session tail. Covers the two non-trivial
// pure pieces: tool-row filtering (--debug gate) and the incremental
// byte-chunk → complete-lines split (a read can land mid-line). The
// fs.watch follow loop itself is verified by the manual CLI E2E.

import { describe, test, expect } from 'bun:test';
import { renderMessage, takeCompleteLines } from '../src/session/watch.js';
import type { SerializedMessage } from '../src/session/index.js';

const toolMsg: SerializedMessage = {
  role: 'tool', content: '⚙️ Write', toolName: 'Write',
  toolArgs: { path: '/tmp/x.txt' }, toolResult: 'wrote 2 bytes',
  ts: '2026-07-10T01:00:00.000Z',
};
const userMsg: SerializedMessage = { role: 'user', content: '파일 만들어줘', ts: '2026-07-10T01:00:00.000Z' };

/** Strip ANSI so assertions don't depend on chalk color codes. */
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

function capture(fn: (sink: (l: string) => void) => void): string {
  const out: string[] = [];
  fn((l) => out.push(plain(l)));
  return out.join('\n');
}

describe('renderMessage — tool-row --debug gate', () => {
  test('tool row is HIDDEN without debug (returns false, emits nothing)', () => {
    const out: string[] = [];
    const emitted = renderMessage(toolMsg, false, (l) => out.push(l));
    expect(emitted).toBe(false);
    expect(out).toHaveLength(0);
  });

  test('tool row is SHOWN with debug — name·args·result', () => {
    const text = capture((sink) => {
      const emitted = renderMessage(toolMsg, true, sink);
      expect(emitted).toBe(true);
    });
    expect(text).toContain('tool @');
    expect(text).toContain('⚙️  Write');
    expect(text).toContain('args:   {"path":"/tmp/x.txt"}');
    expect(text).toContain('result: wrote 2 bytes');
  });

  test('non-tool rows always render (debug off) with their content', () => {
    const text = capture((sink) => renderMessage(userMsg, false, sink));
    expect(text).toContain('user @');
    expect(text).toContain('파일 만들어줘');
  });
});

describe('takeCompleteLines — incremental jsonl chunking', () => {
  test('returns complete lines and buffers a trailing partial line', () => {
    const { lines, rest } = takeCompleteLines('{"a":1}\n{"b":2}\n{"c":');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe('{"c":'); // partial — a later chunk completes it
  });

  test('a later chunk completes the buffered partial line', () => {
    const first = takeCompleteLines('{"c":');
    expect(first.lines).toHaveLength(0);
    const second = takeCompleteLines(first.rest + '3}\n');
    expect(second.lines).toEqual(['{"c":3}']);
    expect(second.rest).toBe('');
  });

  test('skips blank lines, no trailing newline leaves a partial', () => {
    const { lines, rest } = takeCompleteLines('{"a":1}\n\n{"b":2}');
    expect(lines).toEqual(['{"a":1}']);
    expect(rest).toBe('{"b":2}');
  });
});
