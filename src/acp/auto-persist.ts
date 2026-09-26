// ACP follow-up #1 — Auto-persist on turn-end.
//
// The H2 #5 session-persistence primitive shipped without a live
// caller — `AcpSessionList` always returned an empty array. This
// module wires the primitive up to both `DualRoleManager` (client
// session turn-end) and `BackgroundManager` (background session
// terminal state) so that persistence happens naturally as
// conversations complete.
//
// Mode:
//   'auto' (default) — subscribe both managers; persist on
//                      end_turn + BG terminal states.
//   'off'            — no subscription; primitive stays available
//                      for manual `globalAcpSessionPersistence()`
//                      callers.
//
// The decision was punted out of H2 #5 (see session-persistence.ts
// L24-27: "Deliberately NOT integrated into DualRoleManager's send
// path — that hook belongs in a follow-up arc with its own test
// coverage"). This arc delivers that test coverage + wiring.
//
// Why broadcast (DRM.onTurnEnd) instead of a direct callback on
// `ClientSessionSendOpts`? Multiple consumers may want turn-end
// hooks (auto-persist, telemetry, future replay tooling). Broadcast
// keeps the DRM neutral · the skill-tool caller doesn't need to
// forward a callback they don't own.
//
// History shape: for MVP, we persist user-message blocks + a single
// concatenated agent-text block. planSnapshot + toolCalls are empty
// by default — DashboardAcpChat is the only owner of those richer
// snapshots and can call `persistence.persist(...)` directly when
// it wants to enrich. This keeps the module free of UI-layer
// coupling.

import type { ContentBlock, StopReason } from '@agentclientprotocol/sdk';
import type { DualRoleManager, TurnEndEvent } from './dual-role-manager.js';
import type {
  BackgroundManager,
  BackgroundSessionRecord,
  BackgroundState,
} from './background-manager.js';
import { TERMINAL_BACKGROUND_STATES } from './background-manager.js';
import type { AcpSessionPersistence } from './session-persistence.js';
import { debug } from '../debug/log.js';

export type AcpAutoPersistMode = 'auto' | 'off';

export interface WireAutoPersistOpts {
  drm: DualRoleManager;
  bg: BackgroundManager;
  persistence: AcpSessionPersistence;
  mode?: AcpAutoPersistMode;
  /** Override the env-sourced mode; test seam. */
  now?: () => number;
}

export interface AutoPersistHandle {
  dispose(): void;
  readonly mode: AcpAutoPersistMode;
}

/** Resolve the default auto-persist mode from the environment.
 *  `ELANOUS_ACP_PERSIST_MODE=off` opts out; anything else (or unset)
 *  keeps `'auto'`. Exported so consumers can audit + re-use in tests. */
export function defaultAcpAutoPersistMode(env: NodeJS.ProcessEnv = process.env): AcpAutoPersistMode {
  const raw = env['ELANOUS_ACP_PERSIST_MODE'];
  if (raw === 'off') return 'off';
  return 'auto';
}

/** Subscribe auto-persist to both session managers. Idempotent at
 *  the caller level: re-wiring after disposing the old handle is
 *  safe; concurrent handles each subscribe independently (listeners
 *  are keyed by the function identity we pass in, and `dispose()`
 *  unsubscribes exactly those). */
export function wireAutoPersist(opts: WireAutoPersistOpts): AutoPersistHandle {
  const mode = opts.mode ?? defaultAcpAutoPersistMode();
  if (mode === 'off') {
    if (debug.enabled) debug.log('acp.auto-persist.mode', 'off');
    return { mode, dispose: () => {} };
  }

  if (debug.enabled) debug.log('acp.auto-persist.mode', 'auto');

  const unsubDrm = opts.drm.onTurnEnd((ev) => {
    try {
      onDrmTurnEnd(ev, opts.persistence);
    } catch (err) {
      if (debug.enabled) {
        debug.log('acp.auto-persist.drm-error', ev.record.id, {
          message: (err as Error)?.message,
        }, { level: 'error' });
      }
    }
  });

  const unsubBg = opts.bg.onStateChange((record, prev) => {
    try {
      onBgStateChange(record, prev, opts.persistence);
    } catch (err) {
      if (debug.enabled) {
        debug.log('acp.auto-persist.bg-error', record.id, {
          message: (err as Error)?.message,
        }, { level: 'error' });
      }
    }
  });

  return {
    mode,
    dispose: () => {
      try { unsubDrm(); } catch { /* ignore */ }
      try { unsubBg(); } catch { /* ignore */ }
    },
  };
}

/** DRM turn-end handler — persist only when the agent reported a
 *  clean finish (`end_turn`). `cancelled` / `max_tokens` / `max_turn_
 *  requests` are intermediate states · persisting them would muddy
 *  the resumable list. */
function onDrmTurnEnd(
  ev: TurnEndEvent,
  persistence: AcpSessionPersistence,
): void {
  if (!shouldPersistStopReason(ev.stopReason)) return;
  const protocolVersion = resolveProtocolVersion(ev.record);
  persistence.persist({
    sessionId: ev.record.id,
    backendSessionId: ev.record.backendSessionId,
    backendId: ev.record.backendId,
    cwd: ev.record.cwd,
    protocolVersion,
    history: ev.history,
    planSnapshot: null,
    toolCalls: [],
    createdAt: ev.record.createdAt,
  });
}

/** BG state-change handler — persist on transitions into any
 *  terminal state. `cancelled` persists too (history is still
 *  informative — unlike the DRM case where the user explicitly
 *  aborted a specific turn, a BG cancel still represents real work
 *  the user might want to revisit). */
function onBgStateChange(
  record: BackgroundSessionRecord,
  prev: BackgroundState,
  persistence: AcpSessionPersistence,
): void {
  if (!TERMINAL_BACKGROUND_STATES.includes(record.state)) return;
  if (TERMINAL_BACKGROUND_STATES.includes(prev)) return; // already persisted on first entry
  const history: ContentBlock[] = [];
  if (record.initialMessage.length > 0) {
    history.push({ type: 'text', text: record.initialMessage });
  }
  if (record.fullOutput.length > 0) {
    history.push({ type: 'text', text: record.fullOutput });
  }
  // BG sessions don't know their peer's protocolVersion — use the
  // SDK baseline (the agent is guaranteed to match one known version
  // because initialize() was gated by H2 #4).
  const SDK_PROTOCOL_VERSION = 1 as const;
  persistence.persist({
    sessionId: record.id,
    backendSessionId: record.backendSessionId,
    backendId: record.backendId,
    cwd: record.cwd,
    protocolVersion: SDK_PROTOCOL_VERSION,
    history,
    planSnapshot: null,
    toolCalls: [],
    createdAt: record.startedAt,
    ...(record.origin !== undefined ? { origin: record.origin } : {}),
  });
}

function shouldPersistStopReason(reason: StopReason): boolean {
  return String(reason) === 'end_turn';
}

function resolveProtocolVersion(record: { agent: { getCapabilities(): { protocolVersion?: unknown } | null } }): number {
  const caps = record.agent.getCapabilities();
  const v = caps?.protocolVersion;
  return typeof v === 'number' ? v : 1;
}
