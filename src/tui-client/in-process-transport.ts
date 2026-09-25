// UI-Core arc Phase U3b Step 3 (scaffold) — in-process transport.
//
// Bridges the ACP server (`runAcpServer`) to an ACP client inside
// the same process. The server side gets plumbed as a normal
// `AcpTransportServer` via `transportFactory`; the client side
// returns a paired Web-stream pair the caller hands to
// `ClientSideConnection`.
//
// This is the final missing piece before the dashboard can talk to
// the core as an ACP client. The previous U3 landing shipped
// `createInProcessAcpBridge` (byte-level stream pair) and this
// module lifts it to the transport-factory shape `runAcpServer`
// expects, so the same code path handles stdio, unix-socket,
// websocket, AND in-process dashboards.
//
// IMPORTANT: the in-process transport accepts EXACTLY ONE
// connection — the dashboard pair created at boot. If someone tries
// to open a second connection via the factory after the first,
// we throw; real multi-peer transports handle fan-out, but the
// in-process case has no such need (no other peer exists).

import {
  createInProcessAcpBridge,
} from './acp-transport-local.js';
import type {
  AcpConnectionHandler,
  AcpTransportConnection,
  AcpTransportServer,
} from '../acp/transport/index.js';

export interface InProcessTransportPair {
  /** Hand this to `runAcpServer({ transportFactory })`. */
  transportFactory: (
    onConnection: AcpConnectionHandler,
  ) => Promise<AcpTransportServer>;
  /** The client-side byte streams. Pair with `ndJsonStream(writable,
   *  readable)` to build an `ClientSideConnection`. */
  clientStreams: {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
  };
}

/** Create a paired server/client transport that lives entirely in
 *  memory. Intended for the dashboard-as-ACP-client boot path
 *  (U3b Step 3); tests reuse it to drive a full turn through
 *  `runAcpServer` without spinning up a socket. */
export function createInProcessTransportPair(): InProcessTransportPair {
  const bridge = createInProcessAcpBridge();
  // bridge.a = server side (runAcpServer consumes it)
  // bridge.b = client side (caller consumes it)
  let handedOff = false;
  let handlerResolved: ((v: void) => void) | null = null;
  const handlerFired = new Promise<void>((r) => { handlerResolved = r; });

  let streamClosed = false;
  const closeBridgeOnce = async (): Promise<void> => {
    if (streamClosed) return;
    streamClosed = true;
    try { await bridge.a.writable.close(); } catch { /* already closed */ }
  };
  const transportFactory: InProcessTransportPair['transportFactory'] = async (onConnection) => {
    if (handedOff) {
      // In-process transport only accepts one connection.
      throw new Error('in-process transport already consumed');
    }
    handedOff = true;
    const conn: AcpTransportConnection = {
      readable: bridge.a.readable,
      writable: bridge.a.writable,
      peerId: 'in-process',
      close: closeBridgeOnce,
    };
    // Fire-and-forget — the connection handler is a long-lived loop.
    Promise.resolve(onConnection(conn)).catch(() => { /* swallow */ });
    handlerResolved?.();
    return {
      kind: 'in-process',
      address: 'in-process',
      close: closeBridgeOnce,
    };
  };

  // Expose handlerFired via a side channel — test code can `await`
  // it to know the server-side connection was wired, before it
  // starts sending from the client. (Not part of the public
  // interface; accessed via the symbol below for test seams.)
  (transportFactory as unknown as { __handlerFired: Promise<void> }).__handlerFired = handlerFired;

  return {
    transportFactory,
    clientStreams: bridge.b,
  };
}
