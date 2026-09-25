// NEXUS · chat backend kind ↔ ACP backend id mapping (N-1 cleanup PR b).
//
// The NEXUS chat resolver works in `ChatBackendKind` ('claude-code' /
// 'codex' / 'none'); the dashboard ACP stack (`globalAcpAgentManager`,
// backend-registry, agent.client) speaks `AcpBackendId` ('claude' /
// 'codex-app-server' / 'gemini'). The two were split for a reason —
// the NEXUS user-facing label ('claude-code') is friendlier than the
// dashboard's internal id ('claude'); the dashboard's id family also
// includes Gemini, which NEXUS hasn't surfaced yet.
//
// This module is the single point where the names cross. The mapping
// is static + total: every NEXUS kind has at most one ACP id, and
// 'none' returns null (caller treats the chat tab as inert).
//
// Lifting / extending the mapping (e.g., adding `'gemini'` to NEXUS):
//   1. add the kind to `tab-chat.ts` enumValues + isChatBackendKind
//   2. add the case below
//   3. add the new ACP_BACKENDS entry if missing.

import type { ChatBackendKind } from './backend-resolver.js';

/** ACP backend id used by `globalAcpAgentManager().getAgent(id)`.
 *  PR g.1 added 'gemini' (the dashboard ACP_BACKENDS already had the
 *  spec from session 16; NEXUS just needed the surface). */
export type AcpBackendIdLike = 'claude' | 'codex-app-server' | 'gemini';

/** Map a NEXUS chat backend kind to the ACP backend id the dashboard
 *  agent manager understands. Returns `null` for 'none' — caller must
 *  branch (no spawn · session is inert). Throws on a malformed kind so
 *  bugs surface at the call site instead of silently falling through. */
export function nexusBackendToAcpId(kind: ChatBackendKind): AcpBackendIdLike | null {
  switch (kind) {
    case 'claude-code':
      return 'claude';
    case 'codex':
      return 'codex-app-server';
    case 'gemini':
      return 'gemini';
    case 'none':
      return null;
  }
}

/** True when a backend kind has an ACP id (i.e., spawning is wanted).
 *  Convenience for callers that prefer a boolean predicate over a
 *  null check. */
export function isAttachableBackend(kind: ChatBackendKind): boolean {
  return nexusBackendToAcpId(kind) !== null;
}
