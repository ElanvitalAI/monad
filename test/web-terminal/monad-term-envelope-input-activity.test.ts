// WT-M-1 — terminalInputActivity envelope codec round-trip.
//
// The PWA-side codec at apps/pwa/src/lib/monad-term-envelope.ts is a
// hand-mirror of the daemon codec. This file exercises the daemon
// side; the PWA side is identical wire shape and the round-trip
// asserts both encode/decode invariants we care about.

import { describe, expect, test } from 'bun:test';
import {
  formatMonadTermEnvelope,
  parseMonadTermEnvelope,
} from '../../src/acp/monad-extensions';

describe('monad/term/terminalInputActivity envelope', () => {
  test('format → parse round-trip', () => {
    const env = formatMonadTermEnvelope({
      method: 'terminalInputActivity',
      payload: {
        terminalId: 'preview-1',
        peerId: 'abc12345',
        timestamp: 1700000000000,
        bytes: 4,
      },
    });
    expect(env).toMatch(/^\[monad\/term\/terminalInputActivity\] preview-1\n/);
    const parsed = parseMonadTermEnvelope(env);
    expect(parsed?.method).toBe('terminalInputActivity');
    if (parsed?.method !== 'terminalInputActivity') throw new Error('unreachable');
    expect(parsed.payload).toEqual({
      terminalId: 'preview-1',
      peerId: 'abc12345',
      timestamp: 1700000000000,
      bytes: 4,
    });
  });

  test('rejects payload missing peerId', () => {
    const malformed = `[monad/term/terminalInputActivity] preview-1\n${JSON.stringify({
      terminalId: 'preview-1',
      timestamp: 1,
      bytes: 1,
    })}\n<<monad-term-end preview-1>>`;
    expect(parseMonadTermEnvelope(malformed)).toBeNull();
  });

  test('rejects payload missing timestamp', () => {
    const malformed = `[monad/term/terminalInputActivity] preview-1\n${JSON.stringify({
      terminalId: 'preview-1',
      peerId: 'abc',
      bytes: 1,
    })}\n<<monad-term-end preview-1>>`;
    expect(parseMonadTermEnvelope(malformed)).toBeNull();
  });

  test('still parses terminalOutput / terminalExit unchanged', () => {
    const out = formatMonadTermEnvelope({
      method: 'terminalOutput',
      payload: { terminalId: 'preview-1', data: 'hello' },
    });
    const exit = formatMonadTermEnvelope({
      method: 'terminalExit',
      payload: { terminalId: 'preview-1', code: 0 },
    });
    const o = parseMonadTermEnvelope(out);
    const e = parseMonadTermEnvelope(exit);
    expect(o?.method).toBe('terminalOutput');
    expect(e?.method).toBe('terminalExit');
    if (o?.method !== 'terminalOutput') throw new Error('unreachable');
    if (e?.method !== 'terminalExit') throw new Error('unreachable');
    expect(o.payload.data).toBe('hello');
    expect(e.payload.code).toBe(0);
  });

  test('empty peerId is allowed (legacy clients)', () => {
    const env = formatMonadTermEnvelope({
      method: 'terminalInputActivity',
      payload: {
        terminalId: 'preview-1',
        peerId: '',
        timestamp: 1,
        bytes: 1,
      },
    });
    const parsed = parseMonadTermEnvelope(env);
    expect(parsed?.method).toBe('terminalInputActivity');
    if (parsed?.method !== 'terminalInputActivity') throw new Error('unreachable');
    expect(parsed.payload.peerId).toBe('');
  });
});
