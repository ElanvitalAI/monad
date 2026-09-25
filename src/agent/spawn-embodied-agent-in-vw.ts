// H5 Phase 1 Step E · Spawn embodied agent into a VW pane via the
// adapter bus.
//
// `/acp-vw <brand>` routes here for clc / gem / lll. The adapter
// registry produces an EmbodiedAgentSession owning the PTY handle;
// we then create a VW window whose initial content is a `pty-tail`
// pane subscribed to that handle. Mount is driven from here (not
// from pty-binding.ts) because mounting into a VW is a display
// concern — the binding primitive stays pure.
//
// Bootstrap: call `initSpawnEmbodiedAgentInVW(registry)` once at
// dashboard startup. That also registers the default codex-pty
// adapter into `defaultAdapterRegistry` (lazy, idempotent). Tests
// reset via `_resetSpawnEmbodiedAgentInVWForTesting()`.

import { defaultAdapterRegistry } from './adapter-registry.js';
import { registerDefaultCodexPtyAdapter } from './adapters/codex-pty.js';
import { registerDefaultClaudePtyAdapter } from './adapters/claude-pty.js';
import { registerDefaultGeminiPtyAdapter } from './adapters/gemini-pty.js';
import { registerDefaultLocalLlmPtyAdapter } from './adapters/local-llm-pty.js';
import { registerDefaultLocalLlmSshPtyAdapter } from './adapters/local-llm-ssh-pty.js';
import { registerDefaultLocalLlmOllamaPtyAdapter } from './adapters/local-llm-ollama-pty.js';
import { registerDefaultLocalLlmOllamaSshPtyAdapter } from './adapters/local-llm-ollama-ssh-pty.js';
import { registerDefaultMonadAsChildAdapter } from './adapters/monad-as-child.js';
import { attachTransports } from './attach-transport.js';
import type { WindowRegistry } from '../virtual-windows/window-registry.js';
import {
  createPaneContent,
  type PaneFactoryDeps,
} from '../virtual-windows/pane-content.js';
import type {
  AgentLaunchMode,
  EmbodiedAgentSession,
} from './embodiment.js';
import { globalAcpAgentManager } from '../acp/agent-manager.js';

let _registry: WindowRegistry | null = null;
let _paneDeps: PaneFactoryDeps | null = null;
let _adapterDisposers: Array<() => void> = [];

/** H5 P2 · process-wide record of live sessions so tools like
 *  SnapshotPtyState can look a session up by id (or by the pane id
 *  the VW assigned when it mounted the PTY). Populated by
 *  `spawnEmbodiedAgentInVW` and pruned on session dispose. */
interface LiveSessionEntry {
  readonly session: EmbodiedAgentSession;
  readonly paneId: string;
  readonly windowId: number;
  readonly ptyId: string;
}
const _liveSessions = new Map<string, LiveSessionEntry>();

export function initSpawnEmbodiedAgentInVW(
  registry: WindowRegistry,
  paneDeps?: PaneFactoryDeps,
): void {
  _registry = registry;
  // H6 P4 · paneDeps optional for back-compat — legacy callers only
  // use `spawnEmbodiedAgentInVW` (pty-tail doesn't need paneDeps).
  // Agent-room's `spawnEmbodiedAgentIntoPane` also uses pty-tail so
  // an empty deps object works; callers that want llm-chat/terminal
  // panes inside rooms can supply the real deps.
  _paneDeps = paneDeps ?? {};
  if (_adapterDisposers.length === 0) {
    // Register one adapter per brand. Order matters only for display
    // (first registered wins when supports() overlaps) — these four
    // have disjoint brand sets so the order is cosmetic.
    _adapterDisposers.push(registerDefaultCodexPtyAdapter(defaultAdapterRegistry));
    _adapterDisposers.push(registerDefaultClaudePtyAdapter(defaultAdapterRegistry));
    _adapterDisposers.push(registerDefaultGeminiPtyAdapter(defaultAdapterRegistry));
    // H6 P2 Bundle 2 A · local-llm-pty (brand 'local-llm' / 'lll') ·
    // spawns `lms chat <model>` as a PTY. Model comes in via
    // spec.extraArgs[0] from spawn-local-llm-in-vw.ts.
    _adapterDisposers.push(registerDefaultLocalLlmPtyAdapter(defaultAdapterRegistry));
    // H6 P2 Bundle 2 A2 · local-llm-ssh-pty (brand 'local-llm-remote' /
    // 'lll-remote') · spawns `ssh -t <node> lms chat <model>` as a PTY.
    // nodeId + modelId arrive via spec.extraArgs from spawn-local-llm-in-vw.ts.
    _adapterDisposers.push(registerDefaultLocalLlmSshPtyAdapter(defaultAdapterRegistry));
    // H6 P2 Bundle 2 D · local-llm-ollama-pty (brand 'local-llm-ollama' /
    // 'llo') · spawns `ollama run <model>` as a PTY. Selected by
    // spawn-local-llm-in-vw.ts when the cached model runtime is 'ollama'.
    _adapterDisposers.push(registerDefaultLocalLlmOllamaPtyAdapter(defaultAdapterRegistry));
    // H6 P2 Bundle 2 D · local-llm-ollama-ssh-pty (brand 'local-llm-
    // ollama-remote' / 'llo-remote') · spawns `ssh -t <node> ollama run
    // <model>` as a PTY. Remote counterpart to the above.
    _adapterDisposers.push(registerDefaultLocalLlmOllamaSshPtyAdapter(defaultAdapterRegistry));
    // H5 P3 · monad-as-child adapter (brand 'monad' / 'monad-child').
    // NOT a PTY adapter — spawns sub-monad with --acp-server and wraps
    // as ACP transport. Lives in the same registry because the handoff
    // tool treats all embodied launches uniformly.
    _adapterDisposers.push(registerDefaultMonadAsChildAdapter(defaultAdapterRegistry));
  }
}

export function _resetSpawnEmbodiedAgentInVWForTesting(): void {
  _registry = null;
  _paneDeps = null;
  for (const d of _adapterDisposers) {
    try { d(); } catch { /* swallow · test-reset best-effort */ }
  }
  _adapterDisposers = [];
  defaultAdapterRegistry.clear();
  _liveSessions.clear();
}

/** Read-only snapshot of currently tracked sessions · exported for
 *  the session-lookup bridge that feeds H5 P2 snapshot tools. */
export function listLiveEmbodiedSessions(): readonly LiveSessionEntry[] {
  return [..._liveSessions.values()];
}

export function findLiveSessionById(id: string): LiveSessionEntry | undefined {
  return _liveSessions.get(id);
}

export function findLiveSessionByPaneId(paneId: string): LiveSessionEntry | undefined {
  for (const e of _liveSessions.values()) {
    if (e.paneId === paneId) return e;
  }
  return undefined;
}

export interface SpawnEmbodiedAgentOpts {
  brand: string;
  mode?: AgentLaunchMode;
  cwd?: string;
  extraArgs?: readonly string[];
  env?: Record<string, string>;
  title?: string;
  _hybridDeps?: HybridAttachDeps;
}

export interface SpawnEmbodiedAgentResult {
  readonly session: EmbodiedAgentSession;
  readonly windowId: number;
  readonly paneId: string;
  readonly ptyId: string;
}

export async function spawnEmbodiedAgentInVW(
  opts: SpawnEmbodiedAgentOpts,
): Promise<SpawnEmbodiedAgentResult> {
  if (!_registry) {
    throw new Error(
      'spawnEmbodiedAgentInVW not wired · call initSpawnEmbodiedAgentInVW(registry) first',
    );
  }
  const baseSession = await defaultAdapterRegistry.launch({
    brand: opts.brand,
    mode: opts.mode ?? 'hybrid',
    cwd: opts.cwd,
    extraArgs: opts.extraArgs,
    env: opts.env,
  });
  const session = await attachHybridTransportsIfNeeded(baseSession, opts, opts._hybridDeps);
  const ptyTransport = session.transports.find((t) => t.kind === 'pty');
  if (!ptyTransport) {
    // Adapter matched but didn't produce a PTY · clean up and fail
    // with a clear error so the slash caller surfaces it to the user.
    await session.dispose();
    throw new Error(
      `adapter ${session.id} did not produce a PTY transport · cannot mount into VW`,
    );
  }
  const title = opts.title ?? `${opts.brand} [${basenameSafe(opts.cwd ?? '')}]`;
  const window = _registry.spawn({
    title,
    initialContent: {
      kind: 'pty-tail',
      title,
      ptyId: ptyTransport.id,
    },
  });
  const entry: LiveSessionEntry = {
    session,
    paneId: window.focused,
    windowId: window.id,
    ptyId: ptyTransport.id,
  };
  _liveSessions.set(session.id, entry);
  // Prune on dispose · don't accumulate dead sessions in the lookup.
  const origDispose = session.dispose.bind(session);
  (session as { dispose: () => Promise<void> }).dispose = async () => {
    _liveSessions.delete(session.id);
    await origDispose();
  };
  return {
    session,
    windowId: window.id,
    paneId: window.focused,
    ptyId: ptyTransport.id,
  };
}

function basenameSafe(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p ?? 'cwd';
}

// ─── H6 P4 · Agent Room variant ──────────────────────────────────
//
// `spawnEmbodiedAgentIntoPane` mounts a newly-launched agent's PTY
// into an *existing* VW by splitting a target pane. The legacy
// `spawnEmbodiedAgentInVW` always creates a new VW (1 VW = 1 agent);
// this variant is the building block agent-room uses for N-pane
// rooms.
//
// Why a separate entry point (vs. extending the legacy one):
//   - Back-compat: every existing caller of spawnEmbodiedAgentInVW
//     relies on the "new VW per call" contract. An optional
//     `targetWindowId` flag would bifurcate internal flow and make
//     the happy path harder to reason about.
//   - The agent-room path needs tighter control over axis + ratio
//     (N-pane equal-width requires specific ratios; see PLAN §D7).
//
// Axis/ratio convention: `axis='h'` produces a side-by-side split
// (a | b) — matches `three-pane-split` preset. `ratio` is the
// fraction the *existing* pane keeps (a gets `ratio`, new pane gets
// `1-ratio`). See `src/virtual-windows/layout-tree.ts::splitPane`.

export interface SpawnEmbodiedAgentIntoPaneOpts {
  /** Existing VW id to mount into. */
  targetWindowId: number;
  /** Existing pane to split. The new pane appears to the right (axis
   *  'h') or below (axis 'v') this pane. */
  targetPaneId: string;
  brand: string;
  mode?: AgentLaunchMode;
  cwd?: string;
  extraArgs?: readonly string[];
  env?: Record<string, string>;
  title?: string;
  /** Default 'h' (horizontal split = side-by-side). */
  axis?: 'h' | 'v';
  /** Default 0.5. Fraction the original pane keeps; new pane gets
   *  1-ratio. Room-builder computes per-index ratios for equal
   *  widths (see src/agent-room/room-builder.ts). */
  ratio?: number;
  _hybridDeps?: HybridAttachDeps;
}

export interface SpawnEmbodiedAgentIntoPaneResult {
  readonly session: EmbodiedAgentSession;
  readonly windowId: number;
  readonly paneId: string;
  readonly ptyId: string;
}

/** Launch an embodied agent and mount its PTY into an existing VW
 *  by splitting `targetPaneId`. Returns the session plus the newly
 *  assigned paneId. Failure semantics: (a) adapter launch throws →
 *  no VW mutation; (b) no PTY transport → session disposed + throw;
 *  (c) splitPaneAt throws (depth/size limits) → session disposed +
 *  throw. Callers (room-builder) wrap this in Promise.allSettled for
 *  parallel launch + all-or-nothing rollback. */
export async function spawnEmbodiedAgentIntoPane(
  opts: SpawnEmbodiedAgentIntoPaneOpts,
): Promise<SpawnEmbodiedAgentIntoPaneResult> {
  if (!_registry) {
    throw new Error(
      'spawnEmbodiedAgentIntoPane not wired · call initSpawnEmbodiedAgentInVW(registry, paneDeps) first',
    );
  }
  const window = _registry.get(opts.targetWindowId);
  if (!window) {
    throw new Error(`spawnEmbodiedAgentIntoPane: window ${opts.targetWindowId} not found`);
  }
  const baseSession = await defaultAdapterRegistry.launch({
    brand: opts.brand,
    mode: opts.mode ?? 'hybrid',
    cwd: opts.cwd,
    extraArgs: opts.extraArgs,
    env: opts.env,
  });
  const session = await attachHybridTransportsIfNeeded(baseSession, opts, opts._hybridDeps);
  const ptyTransport = session.transports.find((t) => t.kind === 'pty');
  if (!ptyTransport) {
    await session.dispose();
    throw new Error(
      `adapter ${session.id} did not produce a PTY transport · cannot mount into pane`,
    );
  }
  const title = opts.title ?? `${opts.brand} [${basenameSafe(opts.cwd ?? '')}]`;
  const paneContent = createPaneContent(
    { kind: 'pty-tail', title, ptyId: ptyTransport.id },
    _paneDeps ?? {},
  );
  let newPaneId: string;
  try {
    newPaneId = window.splitPaneAt(
      opts.targetPaneId,
      opts.axis ?? 'h',
      paneContent,
      opts.ratio ?? 0.5,
    );
  } catch (err) {
    // splitPane can throw (depth, min-size, etc). Clean up agent +
    // pane-content so we don't leak a PTY behind the scenes.
    try { paneContent.dispose(); } catch { /* ignore */ }
    await session.dispose();
    throw err;
  }
  const entry: LiveSessionEntry = {
    session,
    paneId: newPaneId,
    windowId: window.id,
    ptyId: ptyTransport.id,
  };
  _liveSessions.set(session.id, entry);
  const origDispose = session.dispose.bind(session);
  (session as { dispose: () => Promise<void> }).dispose = async () => {
    _liveSessions.delete(session.id);
    await origDispose();
  };
  return {
    session,
    windowId: window.id,
    paneId: newPaneId,
    ptyId: ptyTransport.id,
  };
}

interface HybridAttachDeps {
  acquireCodexRpcTransport?: (
    cwd: string | undefined,
  ) => Promise<{ kind: 'rpc'; id: string; label: string } | null>;
}

async function attachHybridTransportsIfNeeded(
  session: EmbodiedAgentSession,
  opts: { brand: string; mode?: AgentLaunchMode; cwd?: string },
  deps?: HybridAttachDeps,
): Promise<EmbodiedAgentSession> {
  const mode = opts.mode ?? 'hybrid';
  if (opts.brand !== 'codex' || (mode !== 'hybrid' && mode !== 'auto')) {
    return session;
  }
  try {
    const descriptor = deps?.acquireCodexRpcTransport
      ? await deps.acquireCodexRpcTransport(opts.cwd)
      : await acquireCodexRpcTransport(opts.cwd);
    if (!descriptor) return session;
    return attachTransports(session, [descriptor]);
  } catch {
    return session;
  }
}

async function acquireCodexRpcTransport(
  cwd: string | undefined,
): Promise<{ kind: 'rpc'; id: string; label: string } | null> {
  const agent = await globalAcpAgentManager().getAgent('codex-app-server', { cwd });
  const maybe = agent as unknown as {
    getRpcTransportDescriptor?: () => { kind: 'rpc'; id: string; label: string };
  };
  return maybe.getRpcTransportDescriptor ? maybe.getRpcTransportDescriptor() : null;
}
