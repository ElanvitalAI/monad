// UI-Core arc Phase U3b Step 3 (scaffold) — in-process transport test.
//
// Verifies createInProcessTransportPair delivers a single wired
// connection to the onConnection handler and rejects a second
// call. The byte-pipe itself is covered by roundTripBridge in the
// existing tui-client tests.

import { describe, expect, test } from 'bun:test';
import type { AcpTransportConnection } from '../src/acp/transport/index.js';
import { createInProcessTransportPair } from '../src/tui-client/in-process-transport.js';

describe('createInProcessTransportPair', () => {
  test('factory hands one connection to the handler', async () => {
    const pair = createInProcessTransportPair();
    const seen: AcpTransportConnection[] = [];
    const transport = await pair.transportFactory(async (conn) => {
      seen.push(conn);
    });
    expect(transport.kind).toBe('in-process');
    expect(transport.address).toBe('in-process');
    // Microtask for Promise.resolve(onConnection(conn)) callback.
    await new Promise((r) => setTimeout(r, 1));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.peerId).toBe('in-process');
    expect(seen[0]!.readable).toBeInstanceOf(ReadableStream);
    expect(seen[0]!.writable).toBeInstanceOf(WritableStream);
  });

  test('factory rejects a second call (in-process is single-peer)', async () => {
    const pair = createInProcessTransportPair();
    await pair.transportFactory(async () => { /* noop */ });
    await expect(pair.transportFactory(async () => { /* noop */ })).rejects.toThrow(
      /already consumed/,
    );
  });

  test('__handlerFired resolves once onConnection is invoked', async () => {
    const pair = createInProcessTransportPair();
    const fired = (pair.transportFactory as unknown as { __handlerFired?: Promise<void> })
      .__handlerFired;
    expect(fired).toBeInstanceOf(Promise);
    await pair.transportFactory(async () => { /* noop */ });
    await expect(fired).resolves.toBeUndefined();
  });

  test('clientStreams are a ReadableStream/WritableStream pair', () => {
    const pair = createInProcessTransportPair();
    expect(pair.clientStreams.readable).toBeInstanceOf(ReadableStream);
    expect(pair.clientStreams.writable).toBeInstanceOf(WritableStream);
  });

  test('transport.close is idempotent', async () => {
    const pair = createInProcessTransportPair();
    const transport = await pair.transportFactory(async () => { /* noop */ });
    await transport.close();
    await transport.close(); // must not throw
  });
});
