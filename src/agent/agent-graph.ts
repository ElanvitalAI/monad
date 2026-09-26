// H5 Phase 3 · Cross-agent session graph.
//
// H3 #7 (ACP side · `src/acp/dual-role-manager.ts`) already owns a
// parent→children map for RPC-subprocess ACP sessions. This module
// adds the **PTY-backed embodied session** dimension: an in-memory
// directed graph whose nodes are `EmbodiedAgentSession` references
// and whose edges carry a `kind` ('spawn' | 'handoff' | 'dependency')
// + timestamp + optional meta blob.
//
// The two graphs intentionally stay separate because their cascade
// semantics differ — DRM cascade-close always kills ACP subprocesses,
// whereas PTY sessions default `detach: true` so a child outlives its
// spawner. `AgentGraph.removeSession({cascade:true})` is opt-in.
//
// Consumers: `src/agent/handoff.ts` records a 'handoff' edge,
// `src/agent/elanous-as-child.ts` records 'spawn' when wrapping a sub-
// elanous as an embodied session, and dashboard UI queries nodes/edges
// for multi-agent visualisation.
//
// Design ref: `내부 문서 `PLAN-h5-embodied-agent-bus-phase-3`` §4.1.

import type { EmbodiedAgentSession, EmbodiedSessionStatus } from './embodiment.js';
import { debug } from '../debug/log.js';

export type AgentGraphEdgeKind = 'spawn' | 'handoff' | 'dependency' | 'reply' | 'inject';

export interface AgentGraphNode {
  /** Session id · primary key · stable for session lifetime. */
  readonly sessionId: string;
  /** Brand taken from the session's launchSpec (codex / claude /
   *  gemini / elanous / ...). */
  readonly brand: string;
  /** Adapter id — first transport's label or a fallback. */
  readonly adapterId: string;
  /** Parent node (if spawned / handed off from another). */
  readonly parentId?: string;
  /** Creation timestamp (ms). */
  readonly createdAt: number;
  /** Back-reference · enables consumers to call methods without a
   *  separate lookup. Never stored in edges (they're descriptor-only). */
  readonly session: EmbodiedAgentSession;
}

export interface AgentGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: AgentGraphEdgeKind;
  readonly at: number;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface AgentGraphAddOpts {
  readonly parentId?: string;
  readonly edgeKind?: AgentGraphEdgeKind;
  readonly edgeMeta?: Readonly<Record<string, unknown>>;
}

export interface AgentGraphRemoveOpts {
  /** Cascade to all transitive descendants. Default **false** —
   *  PTY sessions default `detach: true` so cascade here would kill
   *  processes that the user explicitly asked to outlive the spawner.
   *  Set `true` when the caller knows the subtree is ephemeral. */
  readonly cascade?: boolean;
  /** Invoked on each removed session before eviction. Errors are
   *  swallowed so one bad dispose doesn't block graph cleanup. */
  readonly onDispose?: (session: EmbodiedAgentSession) => Promise<void> | void;
}

export class AgentGraph {
  private readonly nodes = new Map<string, AgentGraphNode>();
  /** Adjacency: parent → ordered children (insertion order). */
  private readonly childrenByParent = new Map<string, string[]>();
  /** Flat edge log · append-only for auditability. Cleared on
   *  `clear()`. Queries fan out over this list · fine at our scale
   *  (tens of sessions · hundreds of edges). */
  private readonly edges: AgentGraphEdge[] = [];

  /** Register an embodied session as a graph node. If `opts.parentId`
   *  is set, a 'spawn' edge (default · overridable via `edgeKind`) is
   *  recorded. Idempotent — re-adding the same sessionId throws to
   *  avoid silent shadowing. */
  addSession(session: EmbodiedAgentSession, opts: AgentGraphAddOpts = {}): AgentGraphNode {
    if (this.nodes.has(session.id)) {
      throw new Error(`AgentGraph: session ${session.id} already registered`);
    }
    const adapterId = session.transports[0]?.label ?? 'unknown';
    const node: AgentGraphNode = {
      sessionId: session.id,
      brand: session.launchSpec.brand,
      adapterId,
      parentId: opts.parentId,
      createdAt: Date.now(),
      session,
    };
    this.nodes.set(session.id, node);
    if (opts.parentId !== undefined) {
      if (!this.nodes.has(opts.parentId)) {
        // Permissive — parent may be outside the graph (e.g. dashboard
        // 'ghost root'). Record the edge anyway for audit but don't
        // push into children list (traversal needs both sides present).
        debug.log(
          'agent.graph.addSession',
          `parent ${opts.parentId} not in graph · edge recorded without adjacency`,
        );
      } else {
        const siblings = this.childrenByParent.get(opts.parentId) ?? [];
        siblings.push(session.id);
        this.childrenByParent.set(opts.parentId, siblings);
      }
      this.recordEdge({
        from: opts.parentId,
        to: session.id,
        kind: opts.edgeKind ?? 'spawn',
        ...(opts.edgeMeta !== undefined ? { meta: opts.edgeMeta } : {}),
      });
    }
    debug.log(
      'agent.graph.addSession',
      `add ${session.id} brand=${node.brand} parent=${opts.parentId ?? '(root)'}`,
    );
    return node;
  }

  /** Remove a session from the graph. Cascade is opt-in (see
   *  AgentGraphRemoveOpts). Returns the list of removed session ids
   *  in leaves-first order so callers can dispose the underlying
   *  processes in a safe order. */
  async removeSession(
    sessionId: string,
    opts: AgentGraphRemoveOpts = {},
  ): Promise<readonly string[]> {
    const node = this.nodes.get(sessionId);
    if (!node) return [];
    const toRemove: AgentGraphNode[] = [];
    if (opts.cascade) {
      const descendants = this.descendantsOf(sessionId);
      // leaves-first (BFS order is parents-before-children, reverse)
      for (let i = descendants.length - 1; i >= 0; i--) {
        const d = descendants[i];
        if (d) toRemove.push(d);
      }
    }
    toRemove.push(node); // root last
    const removed: string[] = [];
    for (const n of toRemove) {
      if (opts.onDispose) {
        try {
          await opts.onDispose(n.session);
        } catch (err) {
          debug.log(
            'agent.graph.removeSession',
            `onDispose threw for ${n.sessionId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      this.evict(n.sessionId);
      removed.push(n.sessionId);
    }
    return removed;
  }

  /** Look up a node by id · undefined if absent. */
  getNode(sessionId: string): AgentGraphNode | undefined {
    return this.nodes.get(sessionId);
  }

  /** Direct children of a session (insertion order). Unknown id → []. */
  listChildren(sessionId: string): readonly AgentGraphNode[] {
    const ids = this.childrenByParent.get(sessionId) ?? [];
    const out: AgentGraphNode[] = [];
    for (const id of ids) {
      const n = this.nodes.get(id);
      if (n) out.push(n);
    }
    return out;
  }

  /** BFS transitive descendants, parents-before-children order.
   *  Excludes the starting session. Callers reverse for leaf-first
   *  traversal (e.g. cascade close). */
  descendantsOf(sessionId: string): readonly AgentGraphNode[] {
    const out: AgentGraphNode[] = [];
    const queue: string[] = [sessionId];
    const seen = new Set<string>([sessionId]);
    while (queue.length > 0) {
      const id = queue.shift()!;
      const childIds = this.childrenByParent.get(id);
      if (!childIds) continue;
      for (const cid of childIds) {
        if (seen.has(cid)) continue;
        seen.add(cid);
        const n = this.nodes.get(cid);
        if (n) {
          out.push(n);
          queue.push(cid);
        }
      }
    }
    return out;
  }

  /** Walk up the parent chain · returns [immediate parent, ...] or []
   *  for roots. Stops when a parent is absent from the graph (ghost). */
  ancestorsOf(sessionId: string): readonly AgentGraphNode[] {
    const out: AgentGraphNode[] = [];
    let current = this.nodes.get(sessionId);
    const seen = new Set<string>();
    while (current?.parentId) {
      if (seen.has(current.parentId)) break; // defensive against cycles
      seen.add(current.parentId);
      const parent = this.nodes.get(current.parentId);
      if (!parent) break;
      out.push(parent);
      current = parent;
    }
    return out;
  }

  /** All edges that touch this session (either direction), in
   *  insertion order. Unknown id → []. */
  listEdges(sessionId: string): readonly AgentGraphEdge[] {
    return this.edges.filter((e) => e.from === sessionId || e.to === sessionId);
  }

  /** All edges in the graph · used by introspection UIs. */
  listAllEdges(): readonly AgentGraphEdge[] {
    return [...this.edges];
  }

  /** Record an edge without adding nodes. Useful when the ends exist
   *  in the graph already (handoff edges created by `handoff.ts`). */
  recordEdge(spec: {
    from: string;
    to: string;
    kind: AgentGraphEdgeKind;
    meta?: Readonly<Record<string, unknown>>;
  }): AgentGraphEdge {
    const edge: AgentGraphEdge = {
      from: spec.from,
      to: spec.to,
      kind: spec.kind,
      at: Date.now(),
      ...(spec.meta !== undefined ? { meta: spec.meta } : {}),
    };
    this.edges.push(edge);
    return edge;
  }

  /** Snapshot of every node · read-only copy. */
  listNodes(): readonly AgentGraphNode[] {
    return [...this.nodes.values()];
  }

  /** H6 P5 · count the number of `'reply'` edges in the chain ending
   *  at `sessionId`. BFS backward through inbound reply edges only —
   *  spawn / handoff / dependency edges don't count toward reply
   *  depth because they represent new-session creation, not message
   *  exchange. The result is the cycle depth the next reply *from*
   *  this session would see. User-initiated replies have the `'user'`
   *  ghost as `from`, so chains starting from `'user'` contribute
   *  normally to the count.
   *
   *  Returns 0 for fresh chains. Caps the walk at `maxSteps` (default
   *  32) so pathological graphs can't hang the caller. Stops early
   *  when the frontier revisits a node (cycle in the reply graph
   *  itself — rare but defended).
   */
  countReplyDepth(sessionId: string, maxSteps: number = 32): number {
    let count = 0;
    const seen = new Set<string>([sessionId]);
    let frontier: string[] = [sessionId];
    for (let step = 0; step < maxSteps; step++) {
      if (frontier.length === 0) break;
      const next: string[] = [];
      for (const id of frontier) {
        // Inbound `'reply'` edges — those with `to === id`.
        for (const edge of this.edges) {
          if (edge.kind !== 'reply') continue;
          if (edge.to !== id) continue;
          count += 1;
          if (!seen.has(edge.from)) {
            seen.add(edge.from);
            next.push(edge.from);
          }
        }
      }
      frontier = next;
    }
    return count;
  }

  /** Roots — nodes with no parent (or with an unreachable parent). */
  listRoots(): readonly AgentGraphNode[] {
    const out: AgentGraphNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.parentId === undefined || !this.nodes.has(node.parentId)) {
        out.push(node);
      }
    }
    return out;
  }

  /** Total node count · for metrics / quotas. */
  size(): number {
    return this.nodes.size;
  }

  /** Status summary of all nodes · for HUD / debug. */
  statusBreakdown(): Readonly<Record<EmbodiedSessionStatus, number>> {
    const counts: Record<EmbodiedSessionStatus, number> = {
      pending: 0,
      running: 0,
      waiting: 0,
      done: 0,
      error: 0,
    };
    for (const node of this.nodes.values()) {
      try {
        const st = node.session.state().status;
        counts[st] = (counts[st] ?? 0) + 1;
      } catch {
        // Defensive — a session whose state() throws still counts
        // as 'error' for the status summary.
        counts.error += 1;
      }
    }
    return counts;
  }

  /** Drop all nodes + edges · test isolation helper. */
  clear(): void {
    this.nodes.clear();
    this.childrenByParent.clear();
    this.edges.length = 0;
  }

  // ─── Internal ────────────────────────────────────────────────────

  private evict(sessionId: string): void {
    const node = this.nodes.get(sessionId);
    if (!node) return;
    this.nodes.delete(sessionId);
    // Detach from parent's children array.
    if (node.parentId !== undefined) {
      const siblings = this.childrenByParent.get(node.parentId);
      if (siblings) {
        const idx = siblings.indexOf(sessionId);
        if (idx >= 0) siblings.splice(idx, 1);
        if (siblings.length === 0) this.childrenByParent.delete(node.parentId);
      }
    }
    // Orphans become roots · don't clear their own children map (they
    // may still be live until their own remove). Just drop this
    // session's outgoing slot so stale ids don't linger.
    this.childrenByParent.delete(sessionId);
  }
}

/** App-wide singleton · consumed by handoff + dashboard HUD.
 *  Tests use their own `new AgentGraph()` for isolation. */
export const defaultAgentGraph = new AgentGraph();
