// In-memory ring buffer for /v1/* auth decisions. Captures the last N
// outcomes (default 100) so users can grep "why was my PWA 401" without
// the file-sink instrumentation that PR #1852/#1857/#1859 kept regressing
// the webterm event loop with.
//
// Key constraints (learned from #1852 → #1855 / #1857 → #1858 /
// #1859 → #1860 cycle):
//   - **No file I/O**: every prior attempt emitted into the debug
//     file sink, whose `setImmediate(appendFileSync)` flush
//     misaligned the keystroke / fit() / write timing under nexus
//     headless mode and oscillated the xterm. This module touches
//     only an in-memory array.
//   - **No `setImmediate` / `queueMicrotask`**: the push is fully
//     synchronous so we don't push extra microtasks into the loop.
//   - **No async**: the API is `record(entry)` — no promises, no
//     awaits. Reading is a sync `snapshot()`.
//   - **Constant cost**: ring buffer with bounded size (push +
//     possible shift). At 100 entries × ~200 bytes = ~20 KB, GC is
//     a non-event.
//
// Exposed via NEXUS HTTP `GET /v1/diag/auth-trace` (same-origin
// gated, just like /v1/tools). The PWA `Settings` panel can poll it
// to surface the recent auth decisions in the UI without dogfood
// requiring a daemon-side log tail.

export interface AuthTraceEntry {
  /** Wall-clock ms when the decision was recorded. */
  ts: number;
  /** Request method ("GET" / "POST" / etc.). */
  method: string;
  /** URL pathname (no querystring, no host). */
  path: string;
  /** Decision: did the gate pass? */
  ok: boolean;
  /** Reason from `decideAuth` — e.g. 'same-origin', 'bearer-mismatch',
   *  'no-bearer-no-headers'. */
  reason: string;
  /** Header snapshot — values that drove the decision. */
  sfs: string | null;
  origin: string | null;
  host: string | null;
  referer: string | null;
  hasBearer: boolean;
  /** Transport peer address captured by the HTTP request path; undefined when unavailable. */
  peerAddress: string | undefined;
}

const RING_CAPACITY = 100;
const ring: AuthTraceEntry[] = [];

/** Push one auth decision. Sync; no IO. Safe to call from every
 *  request because the cost is one array push (and at most one
 *  shift). */
export function record(entry: AuthTraceEntry): void {
  ring.push(entry);
  if (ring.length > RING_CAPACITY) ring.shift();
}

/** Return a snapshot of the ring buffer (newest last). The slice
 *  copy means the caller can iterate without seeing concurrent
 *  pushes during JSON serialization. */
export function snapshot(): AuthTraceEntry[] {
  return ring.slice();
}

/** Test seam — drop everything. Production code never calls this. */
export function _resetForTest(): void {
  ring.length = 0;
}

/** Test seam — current size. */
export function _sizeForTest(): number {
  return ring.length;
}
