// PR-CL5 (C.1 · 2026-04-29) — Single entry point for spawning a pane
// in a virtual window.
//
// The repository has accumulated three separate spawn entries:
//
//   - `spawnEmbodiedAgentInVW`     (PTY-based · codex / claude / gemini /
//                                   local-llm / elanous-as-child)
//   - `spawnLocalLlmInVW`          (raw `lll:<spec>` parser · delegates
//                                   to the embodied path)
//   - `spawnAcpLiveSessionInVW`    (ACP client session · acp-live pane)
//
// Callers (room-builder, slash handlers, future PFC `SummonClient`) had
// to know the brand × lane matrix to pick the right entry. Track A
// (#1046) standardized `PaneContent.acceptBroadcast` so a unified spawn
// surface no longer needs broadcast wiring metadata — this module is
// the unified surface.
//
// **Additive only**: the existing three entries stay in place and keep
// working. `spawnPane` is a thin facade that:
//
//   1. Receives a discriminated `SpawnPaneOpts` (lane: pty / acp / hybrid).
//   2. Delegates to the existing entry that owns that lane.
//   3. Wraps the result in a unified `SpawnPaneResult` whose `dispose()`
//      runs the lane-correct cleanup matrix (CAPABILITY-bridge §6 +
//      roadmap §3 PR-CL5 ownership matrix).
//
// Future work (sprint 21+ · separate PRs):
//   - Migrate slash handlers + room-builder to call `spawnPane` directly,
//     then thin out the legacy entries.
//   - Add a `lane: 'hybrid'` path that fuses PTY transcript + ACP
//     stream into a single MessageBlock view (currently `'hybrid'`
//     resolves to the codex `mode: 'hybrid'` PTY path).

import {
  spawnEmbodiedAgentInVW,
  type SpawnEmbodiedAgentResult,
} from '../agent/spawn-embodied-agent-in-vw.js';
import {
  spawnLocalLlmInVW,
  type SpawnLocalLlmOpts,
} from '../agent/spawn-local-llm-in-vw.js';
// PLAN-tui-redundancy-cleanup T1 (2026-05-16) — vw-live-bridge trim.
// ACP lane 의 spawn 자체는 사용자 미사용 명시 path (ACP resident window
// 안 씀) · spawnAcpLane 본체 throw stub 으로 변경 · 호출처는 dispatcher
// 의 lane='acp' branch (caller cascade 정리 후 type union 도 제거 검토).
import {
  globalAcpEventRouter,
  type AcpEventRouter,
} from '../acp/event-router.js';
import {
  globalAcpSendingState,
  type AcpSendingState,
} from '../acp/sending-state.js';
import type { LaneKind } from '../agent-room/types.js';
import type { AgentLaunchMode } from '../agent/embodiment.js';
import { debug } from '../debug/log.js';

// ── Test injection seam ─────────────────────────────────────────────
//
// Production dispose pulls the singleton accessors directly so callers
// don't have to thread plumbing. Tests inject deterministic deps via
// `_setPaneSpawnerDepsForTests` so router / sending-state cleanup can
// be observed without hitting the actual singletons. The ACP client
// close path runs through `spawnAcpLiveSessionInVW`'s own dispose
// handle (which honors `_setAcpLiveBridgeDepsForTests`) — no separate
// hook needed here.

interface PaneSpawnerDeps {
  router(): AcpEventRouter;
  sendingState(): AcpSendingState;
}

let _deps: PaneSpawnerDeps = {
  router: () => globalAcpEventRouter(),
  sendingState: () => globalAcpSendingState(),
};

export function _setPaneSpawnerDepsForTests(deps: Partial<PaneSpawnerDeps> | null): void {
  if (!deps) {
    _deps = {
      router: () => globalAcpEventRouter(),
      sendingState: () => globalAcpSendingState(),
    };
    return;
  }
  _deps = { ..._deps, ...deps };
}

/** Common fields every spawn lane shares. */
interface SpawnPaneOptsBase {
  /** Display title for the new VW. Defaults are lane-specific. */
  readonly title?: string;
  /** Working directory for the underlying agent / session. */
  readonly cwd?: string;
}

/** PTY lane — covers codex / claude / gemini / elanous-as-child / local-llm.
 *  When `brand` starts with `lll:` the local-llm parser path is used so
 *  callers can pass the raw slash form directly. */
export interface SpawnPanePtyOpts extends SpawnPaneOptsBase {
  readonly lane: 'pty';
  readonly brand: string;
  /** Defaults to 'pty' for non-codex brands; codex defaults to 'hybrid'
   *  to keep parity with `spawnEmbodiedAgentInVW`. Caller can override
   *  e.g. `mode: 'pty'` to force a non-hybrid codex spawn. */
  readonly mode?: AgentLaunchMode;
  readonly extraArgs?: readonly string[];
  readonly env?: Record<string, string>;
}

/** ACP lane — codex-app-server / claude-code-acp once wired / elanous. */
export interface SpawnPaneAcpOpts extends SpawnPaneOptsBase {
  readonly lane: 'acp';
  readonly backendId: string;
}

/** Hybrid lane — currently realised as codex `mode: 'hybrid'` PTY (PTY
 *  + RPC transport attached). Sprint 21+ will broaden this to "PTY
 *  transcript + ACP structured stream fused on the same MessageBlock
 *  view"; the surface stays the same so callers don't churn. */
export interface SpawnPaneHybridOpts extends SpawnPaneOptsBase {
  readonly lane: 'hybrid';
  readonly brand: string;
  readonly extraArgs?: readonly string[];
  readonly env?: Record<string, string>;
}

export type SpawnPaneOpts =
  | SpawnPanePtyOpts
  | SpawnPaneAcpOpts
  | SpawnPaneHybridOpts;

/** Unified result. `lane` echoes the requested lane so a caller that
 *  drove the matrix automatically (e.g. via `LANE_MATRIX_BY_BRAND`)
 *  can branch on the actual outcome. `sessionId` is the underlying
 *  session id (PTY id for pty lane · ACP session id for acp lane).
 *  `dispose()` is idempotent and cleans up in lane-correct order. */
export interface SpawnPaneResult {
  readonly lane: LaneKind;
  readonly sessionId: string;
  readonly windowId: number;
  readonly paneId: string;
  /** Best-effort cleanup. Repeated calls return without error. */
  dispose(): Promise<void>;
}

/** PR-CL5 single entry — dispatches to the right legacy spawner and
 *  wraps the result in a unified `SpawnPaneResult`. */
export async function spawnPane(opts: SpawnPaneOpts): Promise<SpawnPaneResult> {
  switch (opts.lane) {
    case 'pty':
      return spawnPtyLane(opts);
    case 'acp':
      return spawnAcpLane(opts);
    case 'hybrid':
      return spawnHybridLane(opts);
  }
}

// ── PTY lane ────────────────────────────────────────────────────────

async function spawnPtyLane(opts: SpawnPanePtyOpts): Promise<SpawnPaneResult> {
  if (debug.enabled) {
    debug.log('pane-spawner.pty.start', opts.brand, {
      mode: opts.mode ?? 'default',
      cwd: opts.cwd ?? '',
    });
  }
  // `lll:<spec>` ↔ delegates to `spawnLocalLlmInVW` so the canonical
  // raw-spec parser handles node × runtime × model selection. Other
  // brand strings go straight to the adapter registry.
  const result: SpawnEmbodiedAgentResult = opts.brand.startsWith('lll:')
    ? await spawnLocalLlmInVW(localLlmOpts(opts))
    : await spawnEmbodiedAgentInVW({
        brand: opts.brand,
        mode: opts.mode,
        cwd: opts.cwd,
        extraArgs: opts.extraArgs,
        env: opts.env,
        title: opts.title,
      });
  return {
    lane: 'pty',
    sessionId: result.session.id,
    windowId: result.windowId,
    paneId: result.paneId,
    dispose: makeIdempotent(() => result.session.dispose()),
  };
}

function localLlmOpts(opts: SpawnPanePtyOpts): SpawnLocalLlmOpts {
  const built: { rawSpec: string; cwd?: string; title?: string } = {
    rawSpec: opts.brand,
  };
  if (opts.cwd !== undefined) built.cwd = opts.cwd;
  if (opts.title !== undefined) built.title = opts.title;
  return built as SpawnLocalLlmOpts;
}

// ── ACP lane ────────────────────────────────────────────────────────
//
// PLAN-tui-redundancy-cleanup T1 (2026-05-16) — vw-live-bridge 의존
// 제거. ACP lane 자체는 deprecated · backend chip 의 ACP 선택 + chat
// panel main wire (dashboard/chat/acp-chat.ts) 가 동일 capability.
// Function body 는 throw stub · caller cascade 정리 후 dispatcher 의
// `lane === 'acp'` branch + SpawnPaneAcpOpts type 제거 검토.

async function spawnAcpLane(opts: SpawnPaneAcpOpts): Promise<SpawnPaneResult> {
  if (debug.enabled) {
    debug.log('pane-spawner.acp.start', opts.backendId, {
      cwd: opts.cwd ?? '',
    });
  }
  throw new Error(
    `pane-spawner ACP lane is deprecated (backend=${opts.backendId}). ` +
    `Use the chat panel's backend chip + dashboard/chat/acp-chat.ts wire instead.`,
  );
}

// ── Hybrid lane ─────────────────────────────────────────────────────

async function spawnHybridLane(
  opts: SpawnPaneHybridOpts,
): Promise<SpawnPaneResult> {
  if (debug.enabled) {
    debug.log('pane-spawner.hybrid.start', opts.brand, {
      cwd: opts.cwd ?? '',
    });
  }
  // Currently realized as the codex `mode: 'hybrid'` PTY path —
  // attaches an RPC transport alongside the PTY for parity with how
  // `spawnEmbodiedAgentInVW` already handles hybrid. When sprint 21+
  // brings a true PTY-transcript + ACP-stream fusion the same call
  // shape will broaden to additional brands.
  const result = await spawnEmbodiedAgentInVW({
    brand: opts.brand,
    mode: 'hybrid',
    cwd: opts.cwd,
    extraArgs: opts.extraArgs,
    env: opts.env,
    title: opts.title,
  });
  return {
    lane: 'hybrid',
    sessionId: result.session.id,
    windowId: result.windowId,
    paneId: result.paneId,
    dispose: makeIdempotent(() => result.session.dispose()),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Idempotency wrapper — repeated `dispose()` calls drop into a
 *  no-op promise that resolves with the same outcome (or rejection)
 *  as the first invocation. Matches the dispose ownership matrix
 *  contract: "double-dispose race 0". */
function makeIdempotent(fn: () => Promise<void> | void): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return () => {
    if (pending) return pending;
    pending = (async () => {
      try {
        await fn();
      } catch (err) {
        // Surface to debug log but don't reject — dispose is best-effort
        // by contract; a partial failure of one cleanup step shouldn't
        // mask a successful step's outcome.
        if (debug.enabled) {
          debug.log('pane-spawner.dispose.error', '', {
            error: err instanceof Error ? err.message : String(err),
          }, { level: 'error' });
        }
      }
    })();
    return pending;
  };
}
