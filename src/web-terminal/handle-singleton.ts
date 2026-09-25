// WT-S-1.5 — module-level singleton for the daemon-side
// `AcpServerHandle`. `runAcpServer({ onHandle })` fires the callback
// exactly once per per-connection handle; the daemon-public-server
// boot path forwards into `setGlobalAcpHandle` so dashboard / preview
// layers (which create PreviewTerminal instances out-of-band) can fan
// raw stdout to ACP peers without taking the handle through every
// constructor.
//
// Lifecycle: handles are connection-scoped — the singleton is the
// **most recent** bound handle. With a single ACP transport (the
// daemon-public-server WS) this matches "the live handle". When the
// connection closes, dashboards discover that via the next
// `terminalOutput` returning `delivered: 0`.

import type { AcpServerHandle } from '../acp/server.js';
import { debug } from '../debug/log.js';

let current: AcpServerHandle | null = null;

/** Set by daemon-public-server boot via `runAcpServer({onHandle})`. */
export function setGlobalAcpHandle(handle: AcpServerHandle | null): void {
  current = handle;
  if (debug.enabled) {
    debug.log('webterm.handle', 'set', { hasHandle: !!handle });
  }
}

/** Read by preview-tap-registry callers (dashboard / modal / VW). */
export function getGlobalAcpHandle(): AcpServerHandle | null {
  return current;
}
