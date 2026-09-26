// H6 P4 · Room builder.
//
// Orchestrates the end-to-end flow for `/agent-room <N>` and
// `AgentRoomCompose`:
//   1. Resolve each member's brandRef (with diversity post-filter).
//   2. Launch all agents in parallel via the adapter registry.
//   3. On any failure, roll everything back (D7 all-or-nothing).
//   4. Spawn a VW with the first agent as the root pane.
//   5. Split successive panes for members 2..N using equal-width
//      ratios (1/(N-i)).
//   6. Register the instance with the room registry.
//
// The public surface is a single async function so slash + LLM tool
// share one code path. The DI surface is explicit (registry, policyDecide,
// spawn functions) so tests can plug stubs without touching module
// state.

import { debug } from '../debug/log.js';
import {
  spawnEmbodiedAgentInVW,
  spawnEmbodiedAgentIntoPane,
} from '../agent/spawn-embodied-agent-in-vw.js';
// PLAN-tui-redundancy-cleanup T1 (2026-05-16) — vw-live-bridge 의존
// 제거. agent-room 의 ACP lane 은 사용자 미사용 명시 path · default
// spawnAcp* 가 throw stub. caller cascade 정리 후 ACP lane 자체 제거
// 검토 (LaneKind union 의 'acp' literal).

export type SpawnAcpLiveSessionResult = {
  sessionId: string;
  windowId: number;
  paneId: string;
  dispose: () => Promise<void>;
};

export type SpawnAcpLiveSessionInVWFn = (opts: {
  backendId: string;
  cwd?: string;
  title?: string;
}) => Promise<SpawnAcpLiveSessionResult>;

export type SpawnAcpLiveIntoPaneResult = SpawnAcpLiveSessionResult;

export type SpawnAcpLiveIntoPaneFn = (opts: {
  targetWindowId: number;
  targetPaneId: string;
  backendId: string;
  cwd?: string;
  title?: string;
  axis: 'h' | 'v';
  ratio: number;
}) => Promise<SpawnAcpLiveIntoPaneResult>;

const spawnAcpLiveSessionInVW: SpawnAcpLiveSessionInVWFn = async (opts) => {
  throw new Error(
    `agent-room ACP lane is deprecated (backend=${opts.backendId}). ` +
    `Use the chat panel's backend chip + dashboard/chat/acp-chat.ts wire instead.`,
  );
};

const spawnAcpLiveIntoPane: SpawnAcpLiveIntoPaneFn = async (opts) => {
  throw new Error(
    `agent-room ACP lane is deprecated (backend=${opts.backendId}). ` +
    `Use the chat panel's backend chip + dashboard/chat/acp-chat.ts wire instead.`,
  );
};
import { defaultAdapterRegistry } from '../agent/adapter-registry.js';
import { resolveBrand, type PolicyDecideFn, type ResolvedBrand } from './brand-resolver.js';
import { checkTransportCompat } from './transport-compat.js';
import { getDefaultAgentRoomRegistry, type AgentRoomRegistry } from './registry.js';
import {
  presetArityFor,
  validateAgentRoomSpec,
  type AgentRoomInstance,
  type AgentRoomMember,
  type AgentRoomMemberInstance,
  type AgentRoomSpec,
  type LaneKind,
} from './types.js';

/** DI surface. Tests pass stubs; `dashboard.ts::initAgentRoomBuilder`
 *  wires the prod implementations. */
export interface BuildRoomDeps {
  readonly registry?: AgentRoomRegistry;
  /** When absent, `auto` brandRefs fall back to `codex` with a warning. */
  readonly policyDecide?: PolicyDecideFn;
  /** Spawn the initial VW with member 0's PTY pane. Default =
   *  `spawnEmbodiedAgentInVW` from the H5 spawn module. Tests pass a
   *  stub that returns deterministic ids. */
  readonly spawnInitial?: typeof spawnEmbodiedAgentInVW;
  /** Mount additional agents into existing panes. Default =
   *  `spawnEmbodiedAgentIntoPane`. */
  readonly spawnIntoPane?: typeof spawnEmbodiedAgentIntoPane;
  /** PR-CL7 (C.3 · 2026-04-29) — Spawn the initial VW with an ACP-live
   *  pane (used when member 0's resolved laneKind === 'acp'). Default
   *  = `spawnAcpLiveSessionInVW` from the vw-live-bridge module. */
  readonly spawnAcpInitial?: typeof spawnAcpLiveSessionInVW;
  /** PR-CL7 — Mount additional ACP-live members into existing panes
   *  (laneKind === 'acp'). Default = `spawnAcpLiveIntoPane`. */
  readonly spawnAcpIntoPane?: typeof spawnAcpLiveIntoPane;
  /** Hook for the VW registry so we can close the VW on failure
   *  rollback. Prod path passes `virtualWindows.registry.close`;
   *  tests pass a stub. */
  readonly closeWindow?: (windowId: number) => void;
  /** Optional title mutators so the builder can stamp stable room and
   *  pane identities after launch. */
  readonly renameWindow?: (windowId: number, title: string) => boolean | void | Promise<boolean | void>;
  readonly renamePane?: (
    windowId: number,
    paneId: string,
    title: string,
  ) => boolean | void | Promise<boolean | void>;
  /** Apply the initial focused pane after all members are mounted.
   *  When absent, the builder attempts to focus through the shared
   *  dashboard VW singleton. */
  readonly focusPane?: (windowId: number, paneId: string) => boolean | void | Promise<boolean | void>;
  /** Inject clock for deterministic `createdAt` / `launchedAt`. */
  readonly now?: () => number;
}

/** Result of building — surfaced both to the slash handler (for
 *  user-facing output) and the LLM tool (for structured metadata). */
export interface BuildRoomResult {
  readonly room: AgentRoomInstance;
  readonly resolvedBrands: readonly ResolvedBrand[];
  readonly warnings: readonly string[];
}

export async function buildAgentRoom(
  spec: AgentRoomSpec,
  deps: BuildRoomDeps = {},
): Promise<BuildRoomResult> {
  validateAgentRoomSpec(spec);
  const registry = deps.registry ?? getDefaultAgentRoomRegistry();
  const spawnInitial = deps.spawnInitial ?? spawnEmbodiedAgentInVW;
  const spawnIntoPane = deps.spawnIntoPane ?? spawnEmbodiedAgentIntoPane;
  // PR-CL7 (C.3 · 2026-04-29) — ACP-lane spawn dispatchers. Default
  // wiring goes through the vw-live-bridge so production paths see the
  // real ACP client; tests inject stubs.
  const spawnAcpInitial = deps.spawnAcpInitial ?? spawnAcpLiveSessionInVW;
  const spawnAcpIntoPane = deps.spawnAcpIntoPane ?? spawnAcpLiveIntoPane;
  const renameWindow = deps.renameWindow ?? renameDashboardWindow;
  const renamePane = deps.renamePane ?? renameDashboardPane;
  const focusPane = deps.focusPane ?? focusPaneInDashboardWindow;
  const now = deps.now ?? Date.now;
  const arity = presetArityFor(spec.preset);

  // Step 1 · resolve brands sequentially so the diversity post-filter
  // (R8) can see earlier picks. Pure — no side-effects yet.
  const resolved: ResolvedBrand[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < arity; i++) {
    const m = spec.members[i]!;
    const r = resolveBrand(m.brandRef, m.roleHint, {
      ...(deps.policyDecide ? { policyDecide: deps.policyDecide } : {}),
      excludeBrands: resolved.map((x) => x.brand),
      // PR-CL7 (C.3 · 2026-04-29) — pipe member.transportPref into the
      // resolver so `resolved.laneKind` reflects the user's hint
      // narrowed against the brand's supported lanes (CL6 matrix).
      ...(m.transportPref !== undefined ? { transportPref: m.transportPref } : {}),
    });
    resolved.push(r);
    if (r.warning) warnings.push(`member[${i}]: ${r.warning}`);
    // Arc 2 (2026-04-28) · cross-check transportPref against the
    // resolved brand. Mismatches drop the hint with a warning so the
    // user sees the override, but the room still spawns via the
    // brand's natural adapter (D4 in the Arc 2 PLAN).
    if (m.transportPref !== undefined) {
      const compat = checkTransportCompat(r.brand, m.transportPref);
      if (compat.warning) warnings.push(`member[${i}]: ${compat.warning}`);
    }
  }

  // Step 2 · launch member 0 into a new VW. PR-CL7: dispatch by
  // resolved.laneKind (CL6) so an ACP-defaulting brand (codex / elanous)
  // boots the room with an acp-live pane instead of pty-tail.
  const member0 = spec.members[0]!;
  const resolved0 = resolved[0]!;
  const lane0 = effectiveLaneKind(resolved0.laneKind, member0.transportPref);
  const rootSpawn = await spawnMemberInitial({
    member: member0,
    resolved: resolved0,
    lane: lane0,
    index: 0,
    spawnInitial,
    spawnAcpInitial,
  }).catch(async (err) => {
    throw new Error(`member[0] launch failed: ${errMsg(err)}`);
  });

  // Step 3 · launch members 1..N-1 sequentially (each split depends on
  // the previous pane id). Keep concrete dispose handles so the
  // rollback path can tear down lane-specific resources in order. Each
  // entry's `dispose()` closes the underlying session (PTY adapter or
  // ACP client) — closing the VW alone does NOT cascade to those.
  const sessionHandles: Array<{ dispose: () => Promise<void>; id: string }> = [
    rootSpawn.handle,
  ];
  const memberInstances: AgentRoomMemberInstance[] = [
    {
      sessionId: rootSpawn.sessionId,
      paneId: rootSpawn.paneId,
      brand: resolved0.brand,
      ...(member0.roleHint ? { roleHint: member0.roleHint } : {}),
      launchedAt: now(),
    },
  ];
  let lastPaneId = rootSpawn.paneId;

  const rollbackAll = async (): Promise<void> => {
    // Dispose every session we successfully launched (rootSpawn +
    // anything we split in since). The VW close comes last so the
    // pty-tail panes don't race with PTY kills.
    await Promise.allSettled(sessionHandles.map((s) => safeDispose(s)));
    deps.closeWindow?.(rootSpawn.windowId);
  };

  for (let i = 1; i < arity; i++) {
    const m = spec.members[i]!;
    const r = resolved[i]!;
    const lane = effectiveLaneKind(r.laneKind, m.transportPref);
    try {
      const mounted = await spawnMemberIntoPane({
        member: m,
        resolved: r,
        lane,
        index: i,
        targetWindowId: rootSpawn.windowId,
        targetPaneId: lastPaneId,
        // Equal-width ratio pattern: at split i (0-indexed among
        // splits), the original pane keeps 1/(N-i) of its current
        // area, the new pane gets (N-i-1)/(N-i). Produces N equal
        // columns at the leaves. See PLAN §4.4 + Bundle 1 exit gate.
        ratio: 1 / (arity - (i - 1)),
        spawnIntoPane,
        spawnAcpIntoPane,
      });
      memberInstances.push({
        sessionId: mounted.sessionId,
        paneId: mounted.paneId,
        brand: r.brand,
        ...(m.roleHint ? { roleHint: m.roleHint } : {}),
        launchedAt: now(),
      });
      sessionHandles.push(mounted.handle);
      lastPaneId = mounted.paneId;
    } catch (err) {
      if (debug.enabled) {
        debug.log('agent-room.build.partial-failure', String(i), {
          brand: r.brand,
          lane,
          error: errMsg(err),
          mountedSoFar: memberInstances.length,
        });
      }
      await rollbackAll();
      throw new Error(
        `member[${i}] (${r.brand}) failed: ${errMsg(err)} · room rolled back (${memberInstances.length} agent(s) disposed)`,
      );
    }
  }

  const roomId = registry.nextId();
  await applyRoomIdentity({
    roomId,
    roomTitle: spec.roomTitle,
    windowId: rootSpawn.windowId,
    members: memberInstances,
    specMembers: spec.members,
    renameWindow,
    renamePane,
    warnings,
  });

  await applyInitialPaneFocus({
    windowId: rootSpawn.windowId,
    members: memberInstances,
    focusIndex: spec.focusIndex ?? 0,
    focusPane,
    warnings,
  });

  // Step 4 · compose the instance + register.
  const createdAt = now();
  const room: AgentRoomInstance = {
    id: roomId,
    windowId: rootSpawn.windowId,
    preset: spec.preset,
    members: memberInstances,
    createdAt,
    dispose: async () => {
      // D5 cascade: dispose every member session in parallel, then
      // close the VW. The spawn-embodied-agent-in-vw wrapper removes
      // the live-session entry inside each session.dispose(). Order:
      // sessions first so PTYs are gone before we unmount the panes
      // they were tailing — avoids "pty exited with code null" flaps
      // in the pty-tail render loop.
      await Promise.allSettled(sessionHandles.map((s) => safeDispose(s)));
      deps.closeWindow?.(rootSpawn.windowId);
    },
  };
  registry.register(room);
  if (debug.enabled) {
    debug.log('agent-room.build.success', roomId, {
      windowId: rootSpawn.windowId,
      preset: spec.preset,
      arity,
      warnings: warnings.length,
    });
  }
  return { room, resolvedBrands: resolved, warnings };
}

function mergedExtraArgs(
  r: ResolvedBrand,
  m: AgentRoomMember,
): readonly string[] | undefined {
  const a = r.extraArgs ?? [];
  const b = m.extraArgs ?? [];
  if (a.length === 0 && b.length === 0) return undefined;
  return [...a, ...b];
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function safeDispose(s: { dispose: () => Promise<void> }): Promise<void> {
  try { await s.dispose(); } catch { /* best-effort */ }
}

async function applyInitialPaneFocus(opts: {
  windowId: number;
  members: readonly AgentRoomMemberInstance[];
  focusIndex: number;
  focusPane: (windowId: number, paneId: string) => boolean | void | Promise<boolean | void>;
  warnings: string[];
}): Promise<void> {
  const primary = opts.members[opts.focusIndex] ?? opts.members[0];
  if (!primary) return;
  const focused = await tryFocusPane(opts.focusPane, opts.windowId, primary.paneId);
  if (focused) return;

  const fallback = opts.members[0];
  if (!fallback || fallback.paneId === primary.paneId) {
    opts.warnings.push(`focus pane ${primary.paneId} could not be applied`);
    return;
  }
  const fallbackFocused = await tryFocusPane(opts.focusPane, opts.windowId, fallback.paneId);
  if (fallbackFocused) {
    opts.warnings.push(
      `focusIndex ${opts.focusIndex} unavailable · fell back to pane ${fallback.paneId}`,
    );
    return;
  }
  opts.warnings.push(
    `focusIndex ${opts.focusIndex} unavailable · keeping current pane focus`,
  );
}

async function applyRoomIdentity(opts: {
  roomId: string;
  roomTitle?: string;
  windowId: number;
  members: readonly AgentRoomMemberInstance[];
  specMembers: readonly AgentRoomMember[];
  renameWindow: (windowId: number, title: string) => boolean | void | Promise<boolean | void>;
  renamePane: (windowId: number, paneId: string, title: string) => boolean | void | Promise<boolean | void>;
  warnings: string[];
}): Promise<void> {
  const roomTitle = opts.roomTitle?.trim() || opts.roomId;
  const windowRenamed = await tryRenameWindow(opts.renameWindow, opts.windowId, roomTitle);
  if (!windowRenamed) {
    opts.warnings.push(`window title '${roomTitle}' could not be applied`);
  }

  for (let i = 0; i < opts.members.length; i++) {
    const member = opts.members[i]!;
    const specMember = opts.specMembers[i]!;
    const paneTitle = resolvedMemberTitle(member.brand, specMember, i);
    const paneRenamed = await tryRenamePane(opts.renamePane, opts.windowId, member.paneId, paneTitle);
    if (!paneRenamed) {
      opts.warnings.push(`pane ${member.paneId} title '${paneTitle}' could not be applied`);
    }
  }
}

function resolvedMemberTitle(
  brand: string,
  member: AgentRoomMember,
  index: number,
): string {
  if (member.title?.trim()) return member.title.trim();
  const role = member.roleHint ? ` · ${member.roleHint}` : '';
  return `${brand}${role}`;
}

async function tryFocusPane(
  focusPane: (windowId: number, paneId: string) => boolean | void | Promise<boolean | void>,
  windowId: number,
  paneId: string,
): Promise<boolean> {
  try {
    return (await focusPane(windowId, paneId)) !== false;
  } catch {
    return false;
  }
}

async function tryRenameWindow(
  renameWindow: (windowId: number, title: string) => boolean | void | Promise<boolean | void>,
  windowId: number,
  title: string,
): Promise<boolean> {
  try {
    return (await renameWindow(windowId, title)) !== false;
  } catch {
    return false;
  }
}

async function tryRenamePane(
  renamePane: (windowId: number, paneId: string, title: string) => boolean | void | Promise<boolean | void>,
  windowId: number,
  paneId: string,
  title: string,
): Promise<boolean> {
  try {
    return (await renamePane(windowId, paneId, title)) !== false;
  } catch {
    return false;
  }
}

async function focusPaneInDashboardWindow(windowId: number, paneId: string): Promise<boolean> {
  try {
    const { getDashboardVirtualWindows } = await import('../dashboard/windowing/virtual-windows.js');
    const window = getDashboardVirtualWindows().registry.get(windowId);
    return window?.setFocus(paneId) ?? false;
  } catch {
    return false;
  }
}

async function renameDashboardWindow(windowId: number, title: string): Promise<boolean> {
  try {
    const { getDashboardVirtualWindows } = await import('../dashboard/windowing/virtual-windows.js');
    return getDashboardVirtualWindows().registry.renameWindow(windowId, title);
  } catch {
    return false;
  }
}

async function renameDashboardPane(
  windowId: number,
  paneId: string,
  title: string,
): Promise<boolean> {
  try {
    const { getDashboardVirtualWindows } = await import('../dashboard/windowing/virtual-windows.js');
    return getDashboardVirtualWindows().registry.renamePane(windowId, paneId, title);
  } catch {
    return false;
  }
}

// ─── PR-CL7 (C.3) · Lane-aware spawn helpers ───────────────────────
//
// `effectiveLaneKind` picks the lane the room-builder will spawn this
// member in. Priority:
//
//   1. CL6 brand-resolver populated `resolved.laneKind` — already
//      narrowed via `resolveLaneKind(brand, transportPref)`. When set,
//      this is the answer.
//   2. Legacy fallback — when an unknown brand is resolved as
//      'literal' the lane stays undefined; default to 'pty' so the
//      existing adapter registry handles it (no behavior change for
//      pre-CL6 callers).

function effectiveLaneKind(
  resolvedLane: LaneKind | undefined,
  transportPref: AgentRoomMember['transportPref'],
): LaneKind {
  if (resolvedLane) return resolvedLane;
  // No matrix entry — fall back to the user's hint when explicit, else
  // safe default 'pty'. This branch is only reachable for unknown
  // brands; CL6 covers every recognized brand string.
  if (transportPref === 'pty' || transportPref === 'acp') return transportPref;
  return 'pty';
}

interface MemberSpawnHandle {
  readonly sessionId: string;
  readonly windowId: number;
  readonly paneId: string;
  readonly handle: { id: string; dispose: () => Promise<void> };
}

interface SpawnMemberInitialOpts {
  member: AgentRoomMember;
  resolved: ResolvedBrand;
  lane: LaneKind;
  index: number;
  spawnInitial: typeof spawnEmbodiedAgentInVW;
  spawnAcpInitial: typeof spawnAcpLiveSessionInVW;
}

async function spawnMemberInitial(opts: SpawnMemberInitialOpts): Promise<MemberSpawnHandle> {
  const title = resolvedMemberTitle(opts.resolved.brand, opts.member, opts.index);
  if (opts.lane === 'acp') {
    const acp = await opts.spawnAcpInitial({
      backendId: opts.resolved.brand,
      ...(opts.member.cwd !== undefined ? { cwd: opts.member.cwd } : {}),
      title,
    });
    return {
      sessionId: acp.sessionId,
      windowId: acp.windowId,
      paneId: acp.paneId,
      handle: {
        id: acp.sessionId,
        dispose: () => acp.dispose(),
      },
    };
  }
  // PTY / hybrid lanes share the embodied entry — `mode` controls
  // whether RPC transports attach alongside the PTY (codex hybrid path).
  const ptyMode = opts.lane === 'hybrid'
    ? ('hybrid' as const)
    : (opts.member.mode ?? opts.resolved.mode);
  const pty = await opts.spawnInitial({
    brand: opts.resolved.brand,
    ...(ptyMode ? { mode: ptyMode } : {}),
    ...(opts.member.cwd !== undefined ? { cwd: opts.member.cwd } : {}),
    ...(mergedExtraArgs(opts.resolved, opts.member)
      ? { extraArgs: mergedExtraArgs(opts.resolved, opts.member)! }
      : {}),
    ...(opts.member.env ? { env: { ...opts.member.env } } : {}),
    title,
  });
  return {
    sessionId: pty.session.id,
    windowId: pty.windowId,
    paneId: pty.paneId,
    handle: pty.session,
  };
}

interface SpawnMemberIntoPaneOpts {
  member: AgentRoomMember;
  resolved: ResolvedBrand;
  lane: LaneKind;
  index: number;
  targetWindowId: number;
  targetPaneId: string;
  ratio: number;
  spawnIntoPane: typeof spawnEmbodiedAgentIntoPane;
  spawnAcpIntoPane: typeof spawnAcpLiveIntoPane;
}

async function spawnMemberIntoPane(opts: SpawnMemberIntoPaneOpts): Promise<MemberSpawnHandle> {
  const title = resolvedMemberTitle(opts.resolved.brand, opts.member, opts.index);
  if (opts.lane === 'acp') {
    const acp: SpawnAcpLiveIntoPaneResult = await opts.spawnAcpIntoPane({
      targetWindowId: opts.targetWindowId,
      targetPaneId: opts.targetPaneId,
      backendId: opts.resolved.brand,
      ...(opts.member.cwd !== undefined ? { cwd: opts.member.cwd } : {}),
      title,
      axis: 'h',
      ratio: opts.ratio,
    });
    return {
      sessionId: acp.sessionId,
      windowId: acp.windowId,
      paneId: acp.paneId,
      handle: {
        id: acp.sessionId,
        dispose: () => acp.dispose(),
      },
    };
  }
  const ptyMode = opts.lane === 'hybrid'
    ? ('hybrid' as const)
    : (opts.member.mode ?? opts.resolved.mode);
  const pty = await opts.spawnIntoPane({
    targetWindowId: opts.targetWindowId,
    targetPaneId: opts.targetPaneId,
    brand: opts.resolved.brand,
    ...(ptyMode ? { mode: ptyMode } : {}),
    ...(opts.member.cwd !== undefined ? { cwd: opts.member.cwd } : {}),
    ...(mergedExtraArgs(opts.resolved, opts.member)
      ? { extraArgs: mergedExtraArgs(opts.resolved, opts.member)! }
      : {}),
    ...(opts.member.env ? { env: { ...opts.member.env } } : {}),
    title,
    axis: 'h',
    ratio: opts.ratio,
  });
  return {
    sessionId: pty.session.id,
    windowId: pty.windowId,
    paneId: pty.paneId,
    handle: pty.session,
  };
}

// ─── Bootstrap helpers ─────────────────────────────────────────────

/** Wire the prod adapter registry for tests that want to use
 *  `defaultAdapterRegistry` indirectly via `buildAgentRoom`. No-op in
 *  most tests since they pass their own `spawnInitial`/`spawnIntoPane`
 *  stubs. */
export function _getDefaultAdapterRegistryForTesting(): typeof defaultAdapterRegistry {
  return defaultAdapterRegistry;
}
