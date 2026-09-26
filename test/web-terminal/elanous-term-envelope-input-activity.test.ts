// WT-M-1 — terminalInputActivity envelope codec round-trip.
//
// The PWA-side codec at apps/pwa/src/lib/elanous-term-envelope.ts is a
// hand-mirror of the daemon codec. This file exercises the daemon
// side; the PWA side is identical wire shape and the round-trip
// asserts both encode/decode invariants we care about.

import { describe, expect, test } from 'bun:test';
import {
  formatElanousTermEnvelope,
  parseElanousTermEnvelope,
} from '../../src/acp/elanous-extensions';

describe('elanous/term/terminalInputActivity envelope', () => {
  test('format → parse round-trip', () => {
    const env = formatElanousTermEnvelope({
      method: 'terminalInputActivity',
      payload: {
        terminalId: 'preview-1',
        peerId: 'abc12345',
        timestamp: 1700000000000,
        bytes: 4,
      },
    });
    expect(env).toMatch(/^\[elanous\/term\/terminalInputActivity\] preview-1\n/);
    const parsed = parseElanousTermEnvelope(env);
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
    const malformed = `[elanous/term/terminalInputActivity] preview-1\n${JSON.stringify({
      terminalId: 'preview-1',
      timestamp: 1,
      bytes: 1,
    })}\n<<elanous-term-end preview-1>>`;
    expect(parseElanousTermEnvelope(malformed)).toBeNull();
  });

  test('rejects payload missing timestamp', () => {
    const malformed = `[elanous/term/terminalInputActivity] preview-1\n${JSON.stringify({
      terminalId: 'preview-1',
      peerId: 'abc',
      bytes: 1,
    })}\n<<elanous-term-end preview-1>>`;
    expect(parseElanousTermEnvelope(malformed)).toBeNull();
  });

  test('still parses terminalOutput / terminalExit unchanged', () => {
    const out = formatElanousTermEnvelope({
      method: 'terminalOutput',
      payload: { terminalId: 'preview-1', data: 'hello' },
    });
    const exit = formatElanousTermEnvelope({
      method: 'terminalExit',
      payload: { terminalId: 'preview-1', code: 0 },
    });
    const o = parseElanousTermEnvelope(out);
    const e = parseElanousTermEnvelope(exit);
    expect(o?.method).toBe('terminalOutput');
    expect(e?.method).toBe('terminalExit');
    if (o?.method !== 'terminalOutput') throw new Error('unreachable');
    if (e?.method !== 'terminalExit') throw new Error('unreachable');
    expect(o.payload.data).toBe('hello');
    expect(e.payload.code).toBe(0);
  });

  test('empty peerId is allowed (legacy clients)', () => {
    const env = formatElanousTermEnvelope({
      method: 'terminalInputActivity',
      payload: {
        terminalId: 'preview-1',
        peerId: '',
        timestamp: 1,
        bytes: 1,
      },
    });
    const parsed = parseElanousTermEnvelope(env);
    expect(parsed?.method).toBe('terminalInputActivity');
    if (parsed?.method !== 'terminalInputActivity') throw new Error('unreachable');
    expect(parsed.payload.peerId).toBe('');
  });
});
