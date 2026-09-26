// H5 Phase 3 · AgentGraph tests.
//
// Uses stub EmbodiedAgentSession objects so tests don't depend on
// pty-shell or any real adapter. The graph cares about id + brand +
// transports[0].label + session.state() surface, all of which are
// trivially mockable.

import { describe, test, expect } from 'bun:test';
import { AgentGraph } from '../src/agent/agent-graph.js';
import type {
  EmbodiedAgentSession,
  EmbodiedSessionStatus,
} from '../src/agent/embodiment.js';

function makeSession(
  id: string,
  brand: string,
  adapterId: string = `${brand}-pty`,
  status: EmbodiedSessionStatus = 'running',
): EmbodiedAgentSession {
  const disposeCalls: number[] = [];
  return {
    id,
    launchSpec: { brand, mode: 'pty-direct' },
    transports: Object.freeze([Object.freeze({ kind: 'pty' as const, id: `pty-${id}`, label: adapterId })]),
    state() {
      return { status, title: `${brand} [${adapterId}]`, startedAt: 0 };
    },
    async send() {},
    async interrupt() {},
    async snapshot() { return `snapshot-of-${id}`; },
    async dispose() { disposeCalls.push(Date.now()); },
  };
}

describe('AgentGraph · addSession', () => {
  test('adds a root session · brand + adapterId derived from session', () => {
    const g = new AgentGraph();
    const s = makeSession('emb-a', 'codex');
    const node = g.addSession(s);
    expect(node.sessionId).toBe('emb-a');
    expect(node.brand).toBe('codex');
    expect(node.adapterId).toBe('codex-pty');
    expect(node.parentId).toBeUndefined();
    expect(g.getNode('emb-a')).toBe(node);
  });

  test('adds child with spawn edge when parent exists', () => {
    const g = new AgentGraph();
    g.addSession(makeSession('emb-p', 'codex'));
    g.addSession(makeSession('emb-c', 'claude'), { parentId: 'emb-p' });
    const children = g.listChildren('emb-p');
    expect(children.map((n) => n.sessionId)).toEqual(['emb-c']);
    const edges = g.listEdges('emb-p');
    expect(edges).toHaveLength(1);
    expect(edges[0]!.kind).toBe('spawn');
    expect(edges[0]!.from).toBe('emb-p');
    expect(edges[0]!.to).toBe('emb-c');
  });

  test('edgeKind override + meta', () => {
    const g = new AgentGraph();
    g.addSession(makeSession('emb-p', 'codex'));
    g.addSession(makeSession('emb-c', 'claude'), {
      parentId: 'emb-p',
      edgeKind: 'handoff',
      edgeMeta: { reason: 'model-change' },
    });
    const edges = g.listEdges('emb-p');
    expect(edges[0]!.kind).toBe('handoff');
    expect(edges[0]!.meta).toEqual({ reason: 'model-change' });
  });

  test('parent not in graph · edge logged but no adjacency', () => {
    const g = new AgentGraph();
    g.addSession(makeSession('emb-c', 'claude'), { parentId: 'ghost-parent' });
    // No entry in children map
    expect(g.listChildren('ghost-parent')).toEqual([]);
    // Edge still recorded for audit
    expect(g.listEdges('emb-c')).toHaveLength(1);
  });

  test('duplicate sessionId throws', () => {
    const g = new AgentGraph();
    g.addSession(makeSession('emb-dupe', 'codex'));
    let err: unknown;
    try { g.addSession(makeSession('emb-dupe', 'claude')); } catch (e) { err = e; }
    expect((err as Error).message).toMatch(/already registered/);
  });

  test('adapterId falls back to "unknown" when transports empty', () => {
    const g = new AgentGraph();
    const s = makeSession('emb-empty', 'codex');
    // Override transports to be empty
    (s as { transports: unknown }).transports = Object.freeze([]);
    const node = g.addSession(s);
    expect(node.adapterId).toBe('unknown');
  });
});

describe('AgentGraph · descendantsOf / ancestorsOf / listChildren', () => {
  test('BFS descendants parents-before-children', () => {
    const g = new AgentGraph();
    // root → a, b · a → a1, a2 · b → b1
    g.addSession(makeSession('root', 'codex'));
    g.addSession(makeSession('a', 'claude'), { parentId: 'root' });
    g.addSession(makeSession('b', 'gemini'), { parentId: 'root' });
    g.addSession(makeSession('a1', 'claude'), { parentId: 'a' });
    g.addSession(makeSession('a2', 'claude'), { parentId: 'a' });
    g.addSession(makeSession('b1', 'gemini'), { parentId: 'b' });
    const ids = g.descendantsOf('root').map((n) => n.sessionId);
    // BFS: direct children first, then grandchildren
    expect(ids).toEqual(['a', 'b', 'a1', 'a2', 'b1']);
  });

  test('ancestors chain walks to root', () => {
    const g = new AgentGraph();
    g.addSession(makeSession('root', 'codex'));
    g.addSession(makeSession('mid', 'claude'), { parentId: 'root' });
    g.addSession(makeSession('leaf', 'gemini'), { parentId: 'mid' });
    const ids = g.ancestorsOf('leaf').map((n) => n.sessionId);
    expect(ids).toEqual(['mid', 'root']);
  });

  test('ancestors stops at ghost parent', () => {
    const g = new AgentGraph();
    g.addSession(makeSession('orphan', 'claude'), { parentId: 'ghost' });
    expect(g.ancestorsOf('orphan')).toEqual([]);
  });

  test('listChildren preserves insertion order', () => {
    const g = new AgentGraph();
    g.addSession(makeSession('p', 'codex'));
    g.addSession(makeSession('c1', 'a'), { parentId: 'p' });
    g.addSession(makeSession('c2', 'b'), { parentId: 'p' });
    g.addSession(makeSession('c3', 'c'), { parentId: 'p' });
    expect(g.listChildren('p').map((n) => n.sessionId)).toEqual(['c1', 'c2', 'c3']);
  });

  test('unknown id returns empty lists', () => {
    const g = new AgentGraph();
    expect(g.descendantsOf('nope')).toEqual([]);
    expect(g.ancestorsOf('nope')).toEqual([]);
    expect(g.listChildren('nope')).toEqual([]);
    expect(g.listEdges('nope')).toEqual([]);
  });
});

describe('AgentGraph · removeSession', () => {
  test('default (cascade=false) removes only the named session', async () => {
    const g = new AgentGraph();
    g.addSession(makeSession('p', 'codex'));
    g.addSession(makeSession('c', 'claude'), { parentId: 'p' });
    const removed = await g.removeSession('p');
    expect(removed).toEqual(['p']);
    expect(g.getNode('p')).toBeUndefined();
    // Child survives · becomes a ghost (parent no longer in graph)
    expect(g.getNode('c')).toBeDefined();
    expect(g.listRoots().map((n) => n.sessionId)).toEqual(['c']);
  });

  test('cascade=true removes whole subtree leaves-first', async () => {
    const g = new AgentGraph();
    g.addSession(makeSession('root', 'codex'));
    g.addSession(makeSession('a', 'claude'), { parentId: 'root' });
    g.addSession(makeSession('b', 'gemini'), { parentId: 'root' });
    g.addSession(makeSession('a1', 'claude'), { parentId: 'a' });
    const removed = await g.removeSession('root', { cascade: true });
    // leaves-first: a1, a, b, then root
    expect(removed[0]).toBe('a1');
    expect(removed[removed.length - 1]).toBe('root');
    expect(g.size()).toBe(0);
  });

  test('onDispose called for each removed session', async () => {
    const g = new AgentGraph();
    g.addSession(makeSession('root', 'codex'));
    g.addSession(makeSession('a', 'claude'), { parentId: 'root' });
    const disposed: string[] = [];
    await g.removeSession('root', {
      cascade: true,
      onDispose: (s) => { disposed.push(s.id); },
    });
    expect(disposed).toContain('root');
    expect(disposed).toContain('a');
  });

  test('onDispose throw does not block eviction', async () => {
    const g = new AgentGraph();
    g.addSession(makeSession('p', 'codex'));
    await g.removeSession('p', {
      onDispose: () => { throw new Error('boom'); },
    });
    expect(g.getNode('p')).toBeUndefined();
  });

  test('unknown id returns []', async () => {
    const g = new AgentGraph();
    expect(await g.removeSession('missing')).toEqual([]);
  });
});

describe('AgentGraph · edges + queries', () => {
  test('listAllEdges returns in insertion order', () => {
    const g = new AgentGraph();
    g.addSession(makeSession('p', 'codex'));
    g.addSession(makeSession('a', 'claude'), { parentId: 'p' });
    g.recordEdge({ from: 'p', to: 'a', kind: 'dependency' });
    const all = g.listAllEdges();
    expect(all).toHaveLength(2);
    expect(all[0]!.kind).toBe('spawn');
    expect(all[1]!.kind).toBe('dependency');
  });

  test('recordEdge without nodes present · edge still recorded', () => {
    const g = new AgentGraph();
    const edge = g.recordEdge({ from: 'x', to: 'y', kind: 'handoff' });
    expect(edge.from).toBe('x');
    expect(edge.to).toBe('y');
    expect(g.listAllEdges()).toHaveLength(1);
  });

  test('listRoots returns top-level nodes and orphans', () => {
    const g = new AgentGraph();
    g.addSession(makeSession('r1', 'codex'));
    g.addSession(makeSession('r2', 'claude'));
    g.addSession(makeSession('c1', 'gemini'), { parentId: 'r1' });
    g.addSession(makeSession('orphan', 'elanous'), { parentId: 'ghost-parent' });
    const roots = g.listRoots().map((n) => n.sessionId).sort();
    expect(roots).toEqual(['orphan', 'r1', 'r2']);
  });

  test('statusBreakdown aggregates state() across nodes', () => {
    const g = new AgentGraph();
    g.addSession(makeSession('a', 'codex', 'codex-pty', 'running'));
    g.addSession(makeSession('b', 'claude', 'claude-pty', 'running'));
    g.addSession(makeSession('c', 'gemini', 'gemini-pty', 'done'));
    g.addSession(makeSession('d', 'codex', 'codex-pty', 'error'));
    const brk = g.statusBreakdown();
    expect(brk.running).toBe(2);
    expect(brk.done).toBe(1);
    expect(brk.error).toBe(1);
    expect(brk.pending).toBe(0);
  });

  test('statusBreakdown counts throwing state() as error', () => {
    const g = new AgentGraph();
    const s = makeSession('bad', 'codex');
    (s as { state: unknown }).state = () => { throw new Error('boom'); };
    g.addSession(s);
    expect(g.statusBreakdown().error).toBe(1);
  });
});

describe('AgentGraph · clear', () => {
  test('clear drops all nodes + edges', () => {
    const g = new AgentGraph();
    g.addSession(makeSession('a', 'codex'));
    g.addSession(makeSession('b', 'claude'), { parentId: 'a' });
    expect(g.size()).toBe(2);
    expect(g.listAllEdges()).toHaveLength(1);
    g.clear();
    expect(g.size()).toBe(0);
    expect(g.listAllEdges()).toHaveLength(0);
    expect(g.listRoots()).toEqual([]);
  });
});
