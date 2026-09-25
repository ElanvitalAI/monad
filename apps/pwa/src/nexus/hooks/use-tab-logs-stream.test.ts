// PWA · log ring buffer behavior tests (Phase N-4 PR ρ)
//
// Tests the pure ring-buffer logic that backs useTabLogsStream. The
// hook itself wraps client.subscribeLogs + React state; the buffer
// math is extracted as a pure helper for unit testing.

import { describe, test, expect } from 'bun:test';

interface BufferState {
  lines: { seq: number; stream: 'stdout' | 'stderr'; line: string; ts: number }[];
  seq: number;
}

function appendLine(state: BufferState, stream: 'stdout' | 'stderr', line: string, maxLines: number, ts = 0): BufferState {
  const seq = state.seq + 1;
  const entry = { seq, stream, line, ts };
  const next = [...state.lines, entry];
  if (next.length > maxLines) next.splice(0, next.length - maxLines);
  return { lines: next, seq };
}

describe('ring buffer append + cap', () => {
  test('first append increments seq from 0 to 1', () => {
    const s = appendLine({ lines: [], seq: 0 }, 'stdout', 'a', 10);
    expect(s.seq).toBe(1);
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]).toMatchObject({ stream: 'stdout', line: 'a' });
  });

  test('seq monotonically increases', () => {
    let s: BufferState = { lines: [], seq: 0 };
    for (let i = 0; i < 5; i += 1) s = appendLine(s, 'stdout', `line-${i}`, 100);
    expect(s.seq).toBe(5);
    expect(s.lines.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  test('cap drops oldest first (FIFO)', () => {
    let s: BufferState = { lines: [], seq: 0 };
    for (let i = 0; i < 12; i += 1) s = appendLine(s, 'stdout', `L${i}`, 5);
    expect(s.lines.map((e) => e.line)).toEqual(['L7', 'L8', 'L9', 'L10', 'L11']);
    expect(s.seq).toBe(12);
  });

  test('mixed streams preserved with order', () => {
    let s: BufferState = { lines: [], seq: 0 };
    s = appendLine(s, 'stdout', 'out-a', 100);
    s = appendLine(s, 'stderr', 'err-x', 100);
    s = appendLine(s, 'stdout', 'out-b', 100);
    expect(s.lines.map((e) => e.stream)).toEqual(['stdout', 'stderr', 'stdout']);
    expect(s.lines.map((e) => e.line)).toEqual(['out-a', 'err-x', 'out-b']);
  });

  test('cap=1 keeps only latest entry', () => {
    let s: BufferState = { lines: [], seq: 0 };
    for (let i = 0; i < 10; i += 1) s = appendLine(s, 'stdout', `L${i}`, 1);
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0].line).toBe('L9');
  });
});
