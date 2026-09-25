// ACP H3 #7 — Subagent meta helpers.
//
// Wire-level linkage between a parent session and a spawned subagent,
// carried on the ACP `_meta` blob that rides every request/update.
// Ported from Zed's `acp_thread.rs:70` canonical key so ACP peers
// that already speak Zed's subagent extension round-trip transparently
// through monad.
//
// Reference · Zed `crates/acp_thread/src/acp_thread.rs`:
//   L70  pub const SUBAGENT_SESSION_INFO_META_KEY = "subagent_session_info";
//   L74  pub struct SubagentSessionInfo { session_id, output_index }
//   L83  pub fn subagent_session_info_from_meta(meta) -> Option<_>
//   L440 AcpThread::is_subagent() guards on the info being present
//
// We extend Zed's shape minimally — we add `parentSessionId` because
// monad's namespaced id scheme (`acp-cli:<brand>:<raw>`) is not
// embedded in the child's sessionId. Zed relies on thread context for
// the parent link; we make it explicit so meta alone can reconstruct
// the graph after a cold restart.
//
// MSS M1.1 Phase B3 — both `parentSessionId` and `sessionId` narrowed
// to the `SessionUri` brand. Wire input is still raw string; the
// reader brands via the unchecked cast since the wire itself has no
// grammar to reject on. Writers can either pass a pre-branded
// SessionUri or rely on the implicit `string extends SessionUri` via
// the phantom type.

import type { SessionUri } from '../mss/uri/brand.js';
import { unsafeBrandSessionUri } from '../mss/uri/brand.js';

/** Canonical Zed key (L70). Kept on-wire exactly for round-trip
 *  compatibility with Zed-family agents. */
export const SUBAGENT_SESSION_INFO_META_KEY = 'subagent_session_info';

export interface SubagentSessionInfo {
  /** Monad-namespaced parent session id. Enables the child's consumer
   *  to navigate back without a side-table lookup. */
  parentSessionId: SessionUri;
  /** Child session id — echoed so consumers reading the meta blob
   *  don't have to infer it from request context. */
  sessionId: SessionUri;
  /** Optional — Zed uses this for tool_call slot reconstruction.
   *  Monad doesn't yet (our one-shot spawn returns the id directly),
   *  but we carry it through round-trip for forward compat. */
  outputIndex?: number;
}

/** Extract subagent info from an ACP `_meta` blob. Returns null for
 *  missing / malformed payloads — callers treat absence as "this is
 *  a root, not a subagent". Never throws on bad input.
 *
 *  Wire strings are branded via `unsafeBrandSessionUri`: the wire
 *  carries opaque ids whose grammar we do not enforce at this layer
 *  (round-trip with Zed peers that do not mint MonadUri). A stricter
 *  validator belongs in a future M1.2 where cross-peer URI grammar
 *  is negotiated. */
export function readSubagentMeta(
  meta: Record<string, unknown> | null | undefined,
): SubagentSessionInfo | null {
  if (!meta || typeof meta !== 'object') return null;
  const raw = meta[SUBAGENT_SESSION_INFO_META_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const parentSessionId = obj['parentSessionId'];
  const sessionId = obj['sessionId'];
  if (typeof parentSessionId !== 'string' || parentSessionId.length === 0) return null;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
  const info: SubagentSessionInfo = {
    parentSessionId: unsafeBrandSessionUri(parentSessionId),
    sessionId: unsafeBrandSessionUri(sessionId),
  };
  if (typeof obj['outputIndex'] === 'number') {
    info.outputIndex = obj['outputIndex'] as number;
  }
  return info;
}

/** Build an ACP `_meta` blob with subagent linkage. Caller merges the
 *  return value into whatever other meta fields the request carries. */
export function writeSubagentMeta(
  info: SubagentSessionInfo,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    parentSessionId: info.parentSessionId,
    sessionId: info.sessionId,
  };
  if (typeof info.outputIndex === 'number') payload['outputIndex'] = info.outputIndex;
  return { [SUBAGENT_SESSION_INFO_META_KEY]: payload };
}
