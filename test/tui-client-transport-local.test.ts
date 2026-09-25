// Unit tests for the in-process paired ACP transport
// (UI-Core arc Phase U3).

import { describe, expect, test } from 'bun:test';

import {
  createInProcessAcpBridge,
  roundTripBridge,
} from '../src/tui-client/acp-transport-local.js';

describe('createInProcessAcpBridge', () => {
  test('a.write → b.read', async () => {
    const bridge = createInProcessAcpBridge();
    const out = await roundTripBridge('hello\n', bridge);
    expect(out).toBe('hello\n');
  });

  test('b.write → a.read (reverse direction)', async () => {
    const bridge = createInProcessAcpBridge();
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    const writer = bridge.b.writable.getWriter();
    const reader = bridge.a.readable.getReader();

    await writer.write(enc.encode('pong\n'));
    writer.releaseLock();

    const { value } = await reader.read();
    reader.releaseLock();
    expect(dec.decode(value!)).toBe('pong\n');
  });

  test('two independent bridges do not leak into each other', async () => {
    const br1 = createInProcessAcpBridge();
    const br2 = createInProcessAcpBridge();
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    const w1 = br1.a.writable.getWriter();
    await w1.write(enc.encode('one'));
    w1.releaseLock();

    const w2 = br2.a.writable.getWriter();
    await w2.write(enc.encode('two'));
    w2.releaseLock();

    const r1 = br1.b.readable.getReader();
    const r2 = br2.b.readable.getReader();
    const v1 = await r1.read();
    const v2 = await r2.read();
    r1.releaseLock();
    r2.releaseLock();

    expect(dec.decode(v1.value!)).toBe('one');
    expect(dec.decode(v2.value!)).toBe('two');
  });
});
