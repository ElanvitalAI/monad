// Showroom v2 Arc 4 · auto-relay orchestrator.
//
// Wires lane-watcher idle events → relay-policy → HITL approver →
// `executeHandoffSlash` dispatch. One orchestrator per active room
// (v1 limit · single concurrent room watch).
//
// Pipeline on each lane idle event:
//   1. policy.proposeRelay(room, idleSessionId) → proposal | null
//   2. if proposal && approver(yes) → handoff dispatch (skip nested approver)
//   3. emit `auto-relay.dispatch.outcome` debug log + audit trail
//
// PLAN: 내부 문서 `PLAN-showroom-v2-arc4-auto-relay-2026-04-28` §D3-D11.

import { debug } from '../../debug/log.js';
import { findSessionObserver } from '../../agent/observer-registry.js';
import { findLiveSessionById } from '../../agent/spawn-embodied-agent-in-vw.js';
import {
  getDefaultAgentRoomRegistry,
  type AgentRoomRegistry,
  type AgentRoomSnapshot,
} from '../../agent-room/registry.js';
import {
  requestConfirmation,
  type ConfirmOpts,
  type ConfirmResult,
} from '../../hitl/confirm.js';
import { executeHandoffSlash } from '../handoff-slash.js';
import { proposeRelay, type RelayProposal } from './policy.js';
import { startLaneWatcher, type LaneIdleEvent, type LaneWatcher } from './lane-watcher.js';

export interface OrchestratorDeps {
  readonly registry?: AgentRoomRegistry;
  /** Override the HITL approver (tests pass a stub). */
  readonly approver?: (req: ConfirmOpts) => Promise<ConfirmResult>;
  /** Inject the handoff dispatcher (tests pass a stub so we don't
   *  exercise the real inject pipeline). */
  readonly dispatchHandoff?: (args: ReadonlyArray<string>) => Promise<{ ok: boolean; message?: string }>;
  /** Override observer lookup (tests). */
  readonly findObserver?: (sessionId: string) => ReturnType<typeof findSessionObserver>;
  /** Override session lookup (tests). */
  readonly findSession?: (sessionId: string) => ReturnType<typeof findLiveSessionById>;
  /** Replace `startLaneWatcher` so tests can drive idle events
   *  deterministically without running real timers. The stub still
   *  must return a `LaneWatcher`-shaped object. */
  readonly startWatcher?: typeof startLaneWatcher;
  /** Forwarded to lane-watcher for stub clocks. */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly idleMs?: number;
  readonly pollMs?: number;
}

export interface OrchestratorStatus {
  readonly active: boolean;
  readonly roomId?: string;
  readonly watcherCount: number;
  readonly proposalsSeen: number;
  readonly dispatched: number;
  readonly denied: number;
}

export interface AutoRelayOrchestrator {
  start(roomId?: string): Promise<{ ok: boolean; message: string }>;
  stop(): Promise<{ ok: boolean; message: string }>;
  status(): OrchestratorStatus;
}

export function createAutoRelayOrchestrator(
  deps: OrchestratorDeps = {},
): AutoRelayOrchestrator {
  let activeRoomId: string | undefined;
  let watchers: LaneWatcher[] = [];
  let registrySub: { dispose(): void } | null = null;
  // Single in-flight proposal lock — when one lane's idle is being
  // adjudicated, queue (drop · simplify v1) the others until it
  // resolves. v1 just drops competing proposals; v2 may queue.
  let proposalInFlight = false;

  const stats = {
    proposalsSeen: 0,
    dispatched: 0,
    denied: 0,
  };

  const registry = deps.registry ?? getDefaultAgentRoomRegistry();
  const approver = deps.approver ?? requestConfirmation;
  const dispatchHandoff = deps.dispatchHandoff ?? defaultDispatchHandoff;
  const findObs = deps.findObserver ?? findSessionObserver;
  const findSess = deps.findSession ?? findLiveSessionById;
  const startWatcher = deps.startWatcher ?? startLaneWatcher;

  return {
    async start(roomId?: string) {
      if (activeRoomId) {
        return {
          ok: false,
          message: `auto-relay already watching room ${activeRoomId} · stop first`,
        };
      }
      const targetRoom = roomId
        ? registry.list().find((r) => r.id === roomId)
        : pickLatestRoom(registry);
      if (!targetRoom) {
        return {
          ok: false,
          message: roomId
            ? `auto-relay: no live room with id '${roomId}'`
            : 'auto-relay: no live agent room · spawn one with /showroom first',
        };
      }
      activeRoomId = targetRoom.id;

      // Attach a watcher to every lane that has a live observer.
      // Lanes without observers (transport: 'acp' only with no
      // observer attached) are silently skipped — orchestrator stays
      // useful in mixed rooms.
      let attached = 0;
      let skipped: string[] = [];
      for (const m of targetRoom.members) {
        const observer = findObs(m.sessionId);
        if (!observer) {
          skipped.push(m.sessionId);
          continue;
        }
        const sessEntry = findSess(m.sessionId);
        const watcher = startWatcher({
          sessionId: m.sessionId,
          observer,
          ...(sessEntry?.session ? { session: sessEntry.session } : {}),
          onIdle: (ev) => { void handleIdle(targetRoom.id, ev); },
          ...(deps.idleMs !== undefined ? { idleMs: deps.idleMs } : {}),
          ...(deps.pollMs !== undefined ? { pollMs: deps.pollMs } : {}),
          ...(deps.now ? { now: deps.now } : {}),
          ...(deps.sleep ? { sleep: deps.sleep } : {}),
        });
        watchers.push(watcher);
        attached += 1;
      }

      // Hook room dispose for auto-cleanup.
      registrySub = registry.subscribe((event) => {
        if (event.type === 'dispose' && event.roomId === activeRoomId) {
          if (debug.enabled) {
            debug.log('auto-relay.lifecycle.room-disposed', activeRoomId);
          }
          void teardown();
        }
      });

      if (debug.enabled) {
        debug.log('auto-relay.lifecycle.start', activeRoomId, {
          attached, skipped: skipped.length,
        });
      }
      return {
        ok: true,
        message: skipped.length === 0
          ? `auto-relay watching ${targetRoom.id} · ${attached} lane(s)`
          : `auto-relay watching ${targetRoom.id} · ${attached} lane(s) · ${skipped.length} skipped (no observer)`,
      };
    },

    async stop() {
      if (!activeRoomId) {
        return { ok: false, message: 'auto-relay: nothing to stop' };
      }
      const id = activeRoomId;
      await teardown();
      return { ok: true, message: `auto-relay stopped · was watching ${id}` };
    },

    status(): OrchestratorStatus {
      return {
        active: activeRoomId !== undefined,
        ...(activeRoomId ? { roomId: activeRoomId } : {}),
        watcherCount: watchers.length,
        ...stats,
      };
    },
  };

  // ─── internals ──────────────────────────────────────────────────

  async function teardown(): Promise<void> {
    if (registrySub) { registrySub.dispose(); registrySub = null; }
    await Promise.allSettled(watchers.map((w) => w.stop()));
    watchers = [];
    activeRoomId = undefined;
    proposalInFlight = false;
  }

  async function handleIdle(roomId: string, ev: LaneIdleEvent): Promise<void> {
    if (!activeRoomId || activeRoomId !== roomId) return;
    if (proposalInFlight) {
      if (debug.enabled) {
        debug.log('auto-relay.proposal.skipped-busy', ev.sessionId, {});
      }
      return;
    }
    const room = registry.list().find((r) => r.id === roomId);
    if (!room) return;

    const proposal = proposeRelay(room, ev.sessionId);
    if (!proposal) {
      if (debug.enabled) {
        debug.log('auto-relay.policy.no-proposal', ev.sessionId, {});
      }
      return;
    }
    stats.proposalsSeen += 1;
    if (debug.enabled) {
      debug.log('auto-relay.policy.propose', ev.sessionId, {
        from: proposal.fromIndex, to: proposal.toIndex,
        reason: proposal.reason,
      });
    }

    proposalInFlight = true;
    try {
      const result = await runProposal(room, proposal, ev);
      if (result.dispatched) stats.dispatched += 1;
      else stats.denied += 1;
    } finally {
      proposalInFlight = false;
    }
  }

  async function runProposal(
    room: AgentRoomSnapshot,
    proposal: RelayProposal,
    ev: LaneIdleEvent,
  ): Promise<{ dispatched: boolean }> {
    const idleSec = Math.round(ev.idleMs / 100) / 10;
    const fromLabel = proposal.fromRole
      ? `${proposal.fromBrand} (lane ${proposal.fromIndex} · ${proposal.fromRole})`
      : `${proposal.fromBrand} (lane ${proposal.fromIndex})`;
    const toLabel = proposal.toRole
      ? `${proposal.toBrand} (lane ${proposal.toIndex} · ${proposal.toRole})`
      : `${proposal.toBrand} (lane ${proposal.toIndex})`;

    const approval = await approver({
      prompt: `${fromLabel} idle for ${idleSec}s. Relay to ${toLabel}?`,
      detail: `auto-relay · room ${room.id} · reason ${proposal.reason}`,
      yesLabel: 'Relay',
      noLabel: 'Skip',
      timeoutMs: 120_000,
    });

    if (debug.enabled) {
      debug.log('auto-relay.hitl.result', ev.sessionId, {
        answer: approval.answer,
        channel: approval.channel,
        fromIdx: proposal.fromIndex,
        toIdx: proposal.toIndex,
      });
    }

    if (!approval.answer) {
      return { dispatched: false };
    }

    const result = await dispatchHandoff([
      String(proposal.fromIndex), String(proposal.toIndex),
      '--room', room.id,
    ]);
    if (debug.enabled) {
      debug.log('auto-relay.dispatch.outcome', ev.sessionId, {
        ok: result.ok,
        message: result.message ?? '',
      });
    }
    return { dispatched: result.ok };
  }
}

// ─── helpers ──────────────────────────────────────────────────────

function pickLatestRoom(registry: AgentRoomRegistry): AgentRoomSnapshot | undefined {
  const rooms = registry.list();
  if (rooms.length === 0) return undefined;
  let latest = rooms[0]!;
  for (const r of rooms) if (r.createdAt > latest.createdAt) latest = r;
  return latest;
}

async function defaultDispatchHandoff(
  args: ReadonlyArray<string>,
): Promise<{ ok: boolean; message?: string }> {
  // Real dispatch via /lane slash — but with skipApprover so the
  // auto-relay HITL gate doesn't double-up with the inject HITL gate.
  const r = await executeHandoffSlash(
    { name: 'lane', args: [...args] },
    { skipApprover: true },
  );
  return {
    ok: r?.ok ?? false,
    ...(r?.message ? { message: r.message } : {}),
  };
}

// ─── singleton (one orchestrator per process · v1 limit) ─────────

let _singleton: AutoRelayOrchestrator | null = null;

export function getDefaultAutoRelayOrchestrator(): AutoRelayOrchestrator {
  if (!_singleton) _singleton = createAutoRelayOrchestrator();
  return _singleton;
}

/** Test seam · reset the process-wide orchestrator. */
export function _resetAutoRelayOrchestratorForTesting(): void {
  _singleton = null;
}
