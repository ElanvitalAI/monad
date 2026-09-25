// Showroom v2 Arc 4 · auto-relay proposal policy.
//
// Given a room snapshot + the sessionId of the lane that just went
// idle, decide whether (and where) to propose a handoff. Pure function
// — no side effects, no I/O. The orchestrator owns timing + HITL.
//
// PLAN: 내부 문서 `PLAN-showroom-v2-arc4-auto-relay-2026-04-28` §D2.

import type {
  AgentRoomMemberInstance,
  AgentRoomRoleHint,
} from '../../agent-room/types.js';
import type { AgentRoomSnapshot } from '../../agent-room/registry.js';

/** Default chain when role hints are present. The watcher proposes
 *  the nearest forward neighbour in this order; the last role in
 *  the chain proposes nothing (terminal). */
const ROLE_CHAIN: readonly AgentRoomRoleHint[] = [
  'plan', 'exec', 'review', 'reflect',
];

export interface RelayProposal {
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly fromBrand: string;
  readonly toBrand: string;
  readonly fromRole?: AgentRoomRoleHint;
  readonly toRole?: AgentRoomRoleHint;
  readonly reason:
    | 'role-chain'           // forward in plan→exec→review→reflect
    | 'pair-mirror'          // 2-pane bidirectional
    | 'index-fallback';      // role hints absent · use lane order
}

export interface ProposeRelayOpts {
  /** When `true`, the policy will NOT recommend back to lane[0] when
   *  the last role member is idle (closes the loop). Default false. */
  readonly noLoopBack?: boolean;
}

/** Compute a single proposal for the lane that just went idle.
 *  Returns `null` when no relay should be suggested (terminal role,
 *  no compatible target, target dead, etc.).
 *
 *  The orchestrator is expected to additionally check session liveness
 *  on the candidate target before surfacing the proposal — the policy
 *  itself stays pure (no I/O). */
export function proposeRelay(
  room: AgentRoomSnapshot,
  idleSessionId: string,
  opts: ProposeRelayOpts = {},
): RelayProposal | null {
  const fromIdx = room.members.findIndex((m) => m.sessionId === idleSessionId);
  if (fromIdx < 0) return null;
  const from = room.members[fromIdx]!;

  // Pair-mirror: 2-pane room, regardless of role hints, the "other
  // lane" is the natural relay target. This handles the most common
  // 1-on-1 chat scenario (e.g. plan ↔ exec back-and-forth).
  if (room.members.length === 2) {
    const toIdx = fromIdx === 0 ? 1 : 0;
    return makeProposal(from, room.members[toIdx]!, fromIdx, toIdx, 'pair-mirror');
  }

  // Role-chain: when role hints are present, propose the nearest
  // forward neighbour in plan→exec→review→reflect. We don't require
  // every role to be present — we walk the chain past `from`'s role
  // and pick the first role that exists in the room.
  if (from.roleHint) {
    const fromRolePos = ROLE_CHAIN.indexOf(from.roleHint);
    if (fromRolePos >= 0 && fromRolePos < ROLE_CHAIN.length - 1) {
      // Look forward in the chain for the next live target.
      for (let p = fromRolePos + 1; p < ROLE_CHAIN.length; p++) {
        const targetRole = ROLE_CHAIN[p]!;
        const idx = room.members.findIndex((m) => m.roleHint === targetRole);
        if (idx >= 0 && idx !== fromIdx) {
          return makeProposal(from, room.members[idx]!, fromIdx, idx, 'role-chain');
        }
      }
      // End-of-chain: terminal, no proposal (unless caller wants loop-back).
      if (!opts.noLoopBack) {
        // Conservative default — terminal role doesn't loop back to plan.
      }
      return null;
    }
  }

  // Index-fallback: no useful role hint · suggest next lane by index
  // (chain). Last lane terminal.
  const nextIdx = fromIdx + 1;
  if (nextIdx < room.members.length) {
    return makeProposal(
      from, room.members[nextIdx]!, fromIdx, nextIdx, 'index-fallback',
    );
  }
  return null;
}

function makeProposal(
  from: AgentRoomMemberInstance,
  to: AgentRoomMemberInstance,
  fromIdx: number,
  toIdx: number,
  reason: RelayProposal['reason'],
): RelayProposal {
  return {
    fromIndex: fromIdx,
    toIndex: toIdx,
    fromBrand: from.brand,
    toBrand: to.brand,
    ...(from.roleHint ? { fromRole: from.roleHint } : {}),
    ...(to.roleHint ? { toRole: to.roleHint } : {}),
    reason,
  };
}
