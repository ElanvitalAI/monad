// src/autopilot/terminal-forwarder.ts
//
// ROADMAP-terminal-agency-cascade-2026-05-16 §G1 — daemon-internal
// helper that lets the autopilot loop driver forward bytes into the
// **user's** SwiftTerm/PreviewTerminal pty instead of the ACP backend's
// own subshell. Same byte-level interface as the ACP `terminal/input`
// handler, but tagged with a `source: 'autopilot'` audit marker so the
// surrounding visual feedback (Phase H1) can distinguish autopilot
// keystrokes from user keystrokes.
//
// Why a separate function instead of calling the ACP server handler:
//   - the handler is HTTP/IPC-shaped (Request → Response), and we'd
//     rather not wrap the autopilot driver behind a network hop;
//   - the audit log lives here, decoupled from the request-handler
//     boundary so future surfaces (PWA agent · CDP) reuse it;
//   - the safety guards (Phase I1) and visual feedback (Phase H1) hook
//     into this function — not into every ACP handler.
//
// Not in this PR (G1 scope):
//   - actual wiring to AutopilotLoopDriver (G2)
//   - screenshot-in-loop reflection (G3)
//   - raw byte key primitive (G4)
//   - visual feedback / takeover (H1, H2)
//   - safety expansion (I1)

import { lookupPreviewTerminal } from '../web-terminal/preview-tap-registry.js';
import { debug } from '../debug/log.js';

export type ForwardSource = 'autopilot' | 'user' | 'cli' | 'pwa';

export interface ForwardResult {
  delivered: boolean;
  bytes: number;
  reason?: string;
}

export interface ForwardInput {
  /** ACP sessionId of the daemon side — usually the autopilot run's session. */
  sessionId: string;
  /** Target SwiftTerm/PreviewTerminal terminalId (caller resolves it
   *  via `terminal/list` ext method or sticky user-session config). */
  terminalId: string;
  /** UTF-8 bytes to write to the pty stdin. Caller is responsible for
   *  encoding control codes (e.g. `''` for ESC, `''` for
   *  Ctrl-C). The pty writes are passthrough — no shell-escape applied. */
  data: string;
  /** Audit marker — propagated to the daemon-internal log so future
   *  visual feedback (Phase H1) can distinguish autopilot bytes from
   *  user keystrokes when both are landing on the same pty. */
  source: ForwardSource;
  /** Optional opaque label for the log line (e.g. mission id, plan step
   *  id). Helps post-hoc correlation in `~/.elanous/debug-tap/<date>.jsonl`. */
  origin?: string;
}

/**
 * Forward a byte sequence into the user's PreviewTerminal pty. Returns
 * `{ delivered: false, reason: 'unknown_terminal' }` when no terminal
 * matches the (sessionId, terminalId) tuple — caller decides whether
 * to retry, surface as an autopilot `error` termination, or skip.
 *
 * Audit log line shape (debug category `autopilot.terminal-forwarder`):
 *   `{ sessionId, terminalId, bytes, source, origin?, delivered }`
 */
export function forwardToUserTerminal(input: ForwardInput): ForwardResult {
  const { sessionId, terminalId, data, source, origin } = input;
  if (!sessionId || !terminalId) {
    return { delivered: false, bytes: 0, reason: 'missing-ids' };
  }
  if (typeof data !== 'string') {
    return { delivered: false, bytes: 0, reason: 'data-not-string' };
  }
  const pt = lookupPreviewTerminal(sessionId, terminalId);
  if (!pt) {
    debug.log('autopilot.terminal-forwarder', 'unknown-terminal', {
      sessionId,
      terminalId,
      source,
      origin,
    });
    return { delivered: false, bytes: 0, reason: 'unknown_terminal' };
  }
  try {
    pt.write(data);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    debug.log('autopilot.terminal-forwarder', 'write-error', {
      sessionId,
      terminalId,
      source,
      origin,
      reason,
    }, { level: 'error' });
    return { delivered: false, bytes: 0, reason };
  }
  debug.log('autopilot.terminal-forwarder', 'delivered', {
    sessionId,
    terminalId,
    bytes: data.length,
    source,
    origin,
  });
  return { delivered: true, bytes: data.length };
}

/**
 * Convenience — forward a sequence of byte chunks one after another.
 * Stops on the first non-delivered chunk and returns its result. Useful
 * for sending multi-segment input like `"" + ":wq" + "\n"` where
 * a single failure should abort the rest.
 */
export function forwardSequence(
  base: Omit<ForwardInput, 'data'>,
  chunks: readonly string[],
): ForwardResult {
  let total = 0;
  for (const chunk of chunks) {
    const r = forwardToUserTerminal({ ...base, data: chunk });
    if (!r.delivered) return { ...r, bytes: total + r.bytes };
    total += r.bytes;
  }
  return { delivered: true, bytes: total };
}
