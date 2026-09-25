// UI-Core arc Phase U3 — in-process ACP transport.
//
// Wires an `AgentSideConnection` (ACP server) and a `ClientSideConnection`
// (ACP client) together **inside the same process** via a paired
// Web-stream bridge. No subprocess, no socket, no serialization over
// the wire — the two SDK-level connections just talk to each other.
//
// Why bother if it's the same process? Because this lets the TUI
// boot as an ACP *client* of the local server so the code path is
// identical to a future remote client (Web / iPhone over Tailscale).
// The transport is a strict thin seam; swapping it for a socket-based
// one in Phase U4 does not touch any consumer.
//
// Implementation note: we use a paired ReadableStream/WritableStream
// backed by an explicit queue and `enqueue()` calls. Web-standard
// TransformStream has backpressure semantics that deadlocked in
// testing — the lower-level queueing-based `ReadableStream` pattern
// below is both simpler and cheaper in-process.

function createPipe(): {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
} {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const readable = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
  });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      controller?.enqueue(chunk);
    },
    close() {
      try { controller?.close(); } catch { /* already closed */ }
    },
    abort() {
      try { controller?.close(); } catch { /* already closed */ }
    },
  });
  return { readable, writable };
}

/** Create a paired Web-stream bridge.
 *
 *  Returns two endpoints. `a` and `b`:
 *    - writing to `a.writable` emerges from `b.readable`
 *    - writing to `b.writable` emerges from `a.readable`
 *
 *  Each endpoint can be passed to `ndJsonStream(writable, readable)`
 *  which the ACP SDK expects. */
export function createInProcessAcpBridge(): {
  a: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
  b: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
} {
  const aToB = createPipe();
  const bToA = createPipe();
  return {
    a: { readable: bToA.readable, writable: aToB.writable },
    b: { readable: aToB.readable, writable: bToA.writable },
  };
}

/** Convenience — identity check that the paired bridge actually round-
 *  trips a chunk. Exported so tests can verify the pipe without
 *  dragging in the ACP SDK. */
export async function roundTripBridge(
  payload: string,
  bridge: ReturnType<typeof createInProcessAcpBridge>,
): Promise<string> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const writer = bridge.a.writable.getWriter();
  const reader = bridge.b.readable.getReader();

  await writer.write(enc.encode(payload));
  writer.releaseLock();

  const { value, done } = await reader.read();
  reader.releaseLock();
  if (done || !value) return '';
  return dec.decode(value);
}
