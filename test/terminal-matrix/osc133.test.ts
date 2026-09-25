import { describe, test, expect } from 'bun:test';

import {
  createOsc133Detector,
  interpretPayload,
} from '../../src/terminal-matrix/osc133.js';

// ESC = \x1b, BEL = \x07. Building sequences by string concatenation
// reads clearer than escaped hex for the reader skimming the test.
const ESC = '\x1b';
const BEL = '\x07';
const ST = '\x1b\\';

const osc = (payload: string, term: string = BEL) => `${ESC}]133;${payload}${term}`;

describe('interpretPayload', () => {
  test('A → prompt-start', () => {
    const ev = interpretPayload('A', 100);
    expect(ev).toEqual({ kind: 'prompt-start', source: 'osc-133', at: 100 });
  });

  test('B;42 → cmd-end exitCode=42', () => {
    const ev = interpretPayload('B;42', 200);
    expect(ev).toEqual({ kind: 'cmd-end', source: 'osc-133', at: 200, exitCode: 42 });
  });

  test('B alone (no exit) → cmd-end without exitCode', () => {
    const ev = interpretPayload('B', 300);
    expect(ev).toEqual({ kind: 'cmd-end', source: 'osc-133', at: 300 });
  });

  test('D;0 also emits cmd-end (alternate shell)', () => {
    const ev = interpretPayload('D;0', 400);
    expect(ev?.kind).toBe('cmd-end');
    expect(ev?.exitCode).toBe(0);
  });

  test('C → null (command-start is not a boundary)', () => {
    expect(interpretPayload('C', 500)).toBeNull();
    expect(interpretPayload('C;cmd=ls', 500)).toBeNull();
  });

  test('metadata-prefixed exit code — picks last integer token', () => {
    const ev = interpretPayload('B;aid=abc123;7', 600);
    expect(ev?.exitCode).toBe(7);
  });

  test('non-integer details → no exit code', () => {
    const ev = interpretPayload('B;weird', 700);
    expect(ev?.kind).toBe('cmd-end');
    expect(ev?.exitCode).toBeUndefined();
  });

  test('out-of-range exit (>255) is rejected', () => {
    const ev = interpretPayload('B;99999', 800);
    expect(ev?.exitCode).toBeUndefined();
  });
});

describe('createOsc133Detector', () => {
  test('single BEL-terminated prompt-start in one chunk', () => {
    const d = createOsc133Detector(() => 1000);
    const evs = d.consume(osc('A'));
    expect(evs).toHaveLength(1);
    expect(evs[0]?.kind).toBe('prompt-start');
  });

  test('cmd-end with exit code via BEL', () => {
    const d = createOsc133Detector(() => 1000);
    const evs = d.consume(osc('B;0'));
    expect(evs[0]).toEqual({ kind: 'cmd-end', source: 'osc-133', at: 1000, exitCode: 0 });
  });

  test('ST terminator (ESC\\\\) works just like BEL', () => {
    const d = createOsc133Detector(() => 2000);
    const evs = d.consume(osc('B;3', ST));
    expect(evs[0]?.exitCode).toBe(3);
  });

  test('sentinel split across two chunks — second chunk completes it', () => {
    const d = createOsc133Detector(() => 3000);
    expect(d.consume(`${ESC}]133;B;`)).toEqual([]);
    expect(d.pendingLength).toBeGreaterThan(0);
    const evs = d.consume(`42${BEL}`);
    expect(evs).toHaveLength(1);
    expect(evs[0]?.exitCode).toBe(42);
    expect(d.pendingLength).toBe(0);
  });

  test('split in the middle of ESC] prefix', () => {
    const d = createOsc133Detector(() => 4000);
    expect(d.consume(ESC)).toEqual([]);
    expect(d.consume(`]133;A${BEL}`)).toHaveLength(1);
  });

  test('multiple sentinels in one chunk — all emit in order', () => {
    const d = createOsc133Detector(() => 5000);
    const stream = `${osc('A')}user-prompt $ ls${osc('B;0')}`;
    const evs = d.consume(stream);
    expect(evs.map(e => e.kind)).toEqual(['prompt-start', 'cmd-end']);
    expect(evs[1]?.exitCode).toBe(0);
  });

  test('non-133 bytes around a sentinel are ignored', () => {
    const d = createOsc133Detector(() => 6000);
    const evs = d.consume(`regular output\n${osc('B;1')}more text`);
    expect(evs).toHaveLength(1);
    expect(evs[0]?.exitCode).toBe(1);
  });

  test('pending buffer caps to keep tail, not head (partial sentinel at end preserved)', () => {
    const d = createOsc133Detector(() => 7000);
    // Flood with filler. The filler has no ESC so it cannot form a
    // partial sentinel; the only "pending" should be at the tail.
    d.consume('x'.repeat(5000));
    expect(d.pendingLength).toBeLessThanOrEqual(1024);
    // Now send a real partial at the tail and verify it completes.
    d.consume(`${ESC}]133;B`);
    const evs = d.consume(`;9${BEL}`);
    expect(evs).toHaveLength(1);
    expect(evs[0]?.exitCode).toBe(9);
  });

  test('reset clears pending', () => {
    const d = createOsc133Detector(() => 8000);
    d.consume(`${ESC}]133;B;`);
    expect(d.pendingLength).toBeGreaterThan(0);
    d.reset();
    expect(d.pendingLength).toBe(0);
    // And the pending was not secretly finished inside reset.
    const evs = d.consume(`5${BEL}`);
    expect(evs).toHaveLength(0);
  });

  test('C (command-start) swallowed; does not interrupt subsequent B detection', () => {
    const d = createOsc133Detector(() => 9000);
    const evs = d.consume(`${osc('C;cmd=ls -la')}${osc('B;0')}`);
    expect(evs).toHaveLength(1);
    expect(evs[0]?.kind).toBe('cmd-end');
  });
});
