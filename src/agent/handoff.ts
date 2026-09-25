// H5 Phase 3 · Agent handoff primitive.
//
// Takes the source session's current state (full screen snapshot OR
// per-channel accumulators), optionally filters by channel tags, caps
// the context size, then launches a target agent via the adapter
// registry with the built context as the initial prompt. The source
// session stays alive — handoff is NOT a migration; it's a scoped
// context transfer between agents.
//
// Graph semantics: every successful handoff records a 'handoff' edge
// from `fromSessionId` to the newly-minted target session so
// `agent-graph` consumers can visualise the lineage.
//
// Design ref: `내부 문서 `PLAN-h5-embodied-agent-bus-phase-3`` §4.2.
//
// Consumers: `src/skill-tool-agent-handoff.ts` (LLM tool wrapper) and
// dashboard `/handoff <from> <toBrand>` slash.

import { defaultAdapterRegistry, type AdapterRegistry } from './adapter-registry.js';
import { defaultAgentGraph, type AgentGraph, type AgentGraphEdge } from './agent-graph.js';
import { debug } from '../debug/log.js';
import type {
  AgentLaunchMode,
  AgentLaunchSpec,
  EmbodiedAgentSession,
} from './embodiment.js';
import type { TransportObserver } from './transport-observer.js';

/** Lookup functions provided by the bootstrap so handoff doesn't own
 *  the live-session registry (which lives in
 *  `src/agent/spawn-embodied-agent-in-vw.ts`). Tests inject their own. */
export interface HandoffLookup {
  /** Resolve a session id to its live `EmbodiedAgentSession`. Returns
   *  undefined if the id isn't tracked (e.g. already disposed). */
  findSession(sessionId: string): EmbodiedAgentSession | undefined;
  /** Optional · find the TransportObserver attached to a session so
   *  handoff can honour `contextChannels` filtering. When absent,
   *  handoff falls back to the raw PTY snapshot. */
  findObserver?(sessionId: string): TransportObserver | undefined;
}

export interface HandoffOpts {
  readonly from: string;
  readonly to: Pick<AgentLaunchSpec, 'brand' | 'mode' | 'cwd' | 'env' | 'extraArgs'>;
  /** Only include these channels from the source. When empty/undefined
   *  AND an observer is present, all active channels are used; when
   *  no observer, the raw screen snapshot is used. */
  readonly contextChannels?: readonly string[];
  /** Optional prefix prompt · emitted as the first line of the built
   *  context, before the source extract. */
  readonly contextPrompt?: string;
  /** Max bytes of context to carry. Default 8 KB — most target agents
   *  have token budgets that dislike more than a few KB of context.
   *  When exceeded, the tail is kept (most recent is usually most
   *  relevant). */
  readonly maxBytes?: number;
  /** Edge kind to record · default 'handoff'. Callers can record as
   *  'dependency' when the source owns the target long-term. */
  readonly edgeKind?: 'handoff' | 'dependency';
  /** Extra metadata on the graph edge · shows up in `listEdges`. */
  readonly edgeMeta?: Readonly<Record<string, unknown>>;
}

export interface HandoffResult {
  readonly fromSessionId: string;
  readonly toSession: EmbodiedAgentSession;
  readonly edge: AgentGraphEdge;
  readonly contextBytes: number;
  /** Channels actually included in the context · empty when falling
   *  back to raw screen snapshot. */
  readonly includedChannels: readonly string[];
}

export interface HandoffDeps {
  readonly registry?: AdapterRegistry;
  readonly graph?: AgentGraph;
  readonly lookup: HandoffLookup;
}

const DEFAULT_MAX_BYTES = 8 * 1024;

/** Build context + launch target + record edge. Returns the new
 *  session; caller is responsible for disposing when done (or for
 *  handing ownership off to the VW mount code). */
export async function handoff(opts: HandoffOpts, deps: HandoffDeps): Promise<HandoffResult> {
  const registry = deps.registry ?? defaultAdapterRegistry;
  const graph = deps.graph ?? defaultAgentGraph;
  const source = deps.lookup.findSession(opts.from);
  if (!source) {
    throw new Error(`handoff · source session ${opts.from} not found`);
  }
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  // ─── Build context ──────────────────────────────────────────────
  const { text: ctxBody, includedChannels } = await collectHandoffContext(
    source,
    opts.contextChannels,
    deps.lookup.findObserver?.(opts.from),
  );

  const prefix = opts.contextPrompt?.trim();
  const header = buildHandoffHeader(source, includedChannels);
  const assembled = [header, prefix, ctxBody].filter((s) => typeof s === 'string' && s.length > 0).join('\n\n');
  const context = capToBytes(assembled, maxBytes);

  // ─── Launch target ──────────────────────────────────────────────
  const launchSpec: AgentLaunchSpec = {
    brand: opts.to.brand,
    mode: opts.to.mode ?? 'hybrid',
    ...(opts.to.cwd !== undefined ? { cwd: opts.to.cwd } : {}),
    ...(opts.to.env !== undefined ? { env: opts.to.env } : {}),
    ...(opts.to.extraArgs !== undefined ? { extraArgs: opts.to.extraArgs } : {}),
    prompt: context,
  };
  const toSession = await registry.launch(launchSpec);

  // ─── Record edge ────────────────────────────────────────────────
  // If the source isn't yet in the graph (e.g. it was spawned outside
  // spawnEmbodiedAgentInVW's registration path) we add a ghost node for
  // it so the edge has two real endpoints. Target is always added.
  if (!graph.getNode(source.id)) {
    try { graph.addSession(source); } catch { /* race · another path added first */ }
  }
  if (!graph.getNode(toSession.id)) {
    graph.addSession(toSession, {
      parentId: source.id,
      edgeKind: opts.edgeKind ?? 'handoff',
      ...(opts.edgeMeta !== undefined ? { edgeMeta: opts.edgeMeta } : {}),
    });
  }
  const edges = graph.listEdges(toSession.id);
  const edge = edges[edges.length - 1];
  if (!edge) {
    // Shouldn't happen — addSession records an edge when parentId is set.
    throw new Error('handoff · edge not recorded · graph state corrupt');
  }

  debug.log(
    'agent.handoff',
    `${opts.from} → ${toSession.id} brand=${opts.to.brand} ctx=${context.length}B channels=${includedChannels.join(',') || '(raw)'}`,
  );

  return {
    fromSessionId: opts.from,
    toSession,
    edge,
    contextBytes: context.length,
    includedChannels,
  };
}

// ─── Context builders ─────────────────────────────────────────────

async function collectHandoffContext(
  source: EmbodiedAgentSession,
  requestedChannels: readonly string[] | undefined,
  observer: TransportObserver | undefined,
): Promise<{ text: string; includedChannels: readonly string[] }> {
  if (observer) {
    const channels = observer.snapshotChannels();
    const names = requestedChannels && requestedChannels.length > 0
      ? requestedChannels.filter((c) => channels[c])
      : Object.keys(channels);
    if (names.length > 0) {
      const parts: string[] = [];
      for (const name of names) {
        const body = channels[name];
        if (!body) continue;
        parts.push(`[${name}]\n${body.trim()}`);
      }
      return { text: parts.join('\n\n'), includedChannels: names };
    }
    // Observer present but empty / no requested channels match ·
    // fall through to raw snapshot
  }
  // No observer or no matching channels · use raw PTY snapshot. Guard
  // because snapshot() may throw for disposed sessions.
  try {
    const raw = await source.snapshot();
    return { text: raw, includedChannels: [] };
  } catch {
    return { text: '(source snapshot unavailable)', includedChannels: [] };
  }
}

function buildHandoffHeader(source: EmbodiedAgentSession, channels: readonly string[]): string {
  const parts = [
    `[handoff] from session ${source.id} (${source.launchSpec.brand})`,
  ];
  if (channels.length > 0) {
    parts.push(`channels: ${channels.join(', ')}`);
  }
  return parts.join(' · ');
}

function capToBytes(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text;
  const cut = text.length - maxBytes;
  return `[... ${cut} bytes truncated]\n${text.slice(cut)}`;
}
