// H6 P5 · 'reply' edge kind + countReplyDepth back-walk.

import { describe, test, expect } from 'bun:test';
import { AgentGraph } from '../src/agent/agent-graph.js';
import type { EmbodiedAgentSession } from '../src/agent/embodiment.js';

function makeSession(id: string): EmbodiedAgentSession {
  return {
    id,
    launchSpec: { brand: 'stub' },
    transports: [{ kind: 'pty', id: `pty-${id}` }],
    state: () => ({ status: 'running' }),
    async send() {},
    async interrupt() {},
    async snapshot() { return ''; },
    async dispose() {},
  };
}

describe('agent-graph · reply edge kind', () => {
  test('recordEdge accepts reply kind · surfaces in listEdges', () => {
    const g = new AgentGraph();
    g.addSession(makeSession('a'));
    g.addSession(makeSession('b'));
    const edge = g.recordEdge({
      from: 'a',
      to: 'b',
      kind: 'reply',
      meta: { elapsedMs: 150 },
    });
    expect(edge.kind).toBe('reply');
    expect(edge.meta).toEqual({ elapsedMs: 150 });
    const edges = g.listEdges('b');
    expect(edges.map((e) => e.kind)).toContain('reply');
  });

  test('reply edges coexist with handoff/spawn · distinct kinds', () => {
    const g = new AgentGraph();
    g.addSession(makeSession('a'));
    g.addSession(makeSession('b'), { parentId: 'a', edgeKind: 'handoff' });
    g.recordEdge({ from: 'b', to: 'a', kind: 'reply' });
    const kinds = g.listAllEdges().map((e) => e.kind).sort();
    expect(kinds).toEqual(['handoff', 'reply']);
  });
});

describe('countReplyDepth · BFS back-walk', () => {
  test('no inbound reply edges · depth 0', () => {
    const g = new AgentGraph();
    g.addSession(makeSession('a'));
    expect(g.countReplyDepth('a')).toBe(0);
  });

  test('single chain a → b (reply) · depth at b = 1', () => {
    const g = new AgentGraph();
    g.addSession(makeSession('a'));
    g.addSession(makeSession('b'));
    g.recordEdge({ from: 'a', to: 'b', kind: 'reply' });
    expect(g.countReplyDepth('b')).toBe(1);
    // a has no inbound reply edges
    expect(g.countReplyDepth('a')).toBe(0);
  });

  test('three-hop chain a → b → c → d · depth at d = 3', () => {
    const g = new AgentGraph();
    for (const id of ['a', 'b', 'c', 'd']) g.addSession(makeSession(id));
    g.recordEdge({ from: 'a', to: 'b', kind: 'reply' });
    g.recordEdge({ from: 'b', to: 'c', kind: 'reply' });
    g.recordEdge({ from: 'c', to: 'd', kind: 'reply' });
    expect(g.countReplyDepth('d')).toBe(3);
    expect(g.countReplyDepth('c')).toBe(2);
    expect(g.countReplyDepth('b')).toBe(1);
  });

  test('handoff + spawn edges do NOT contribute to reply depth', () => {
    const g = new AgentGraph();
    for (const id of ['a', 'b', 'c']) g.addSession(makeSession(id));
    g.recordEdge({ from: 'a', to: 'b', kind: 'spawn' });
    g.recordEdge({ from: 'a', to: 'b', kind: 'handoff' });
    g.recordEdge({ from: 'b', to: 'c', kind: 'reply' });
    // a→b was handoff+spawn (not reply) so b's reply depth is 0;
    // c inherits one reply from b.
    expect(g.countReplyDepth('c')).toBe(1);
    expect(g.countReplyDepth('b')).toBe(0);
  });

  test('cycle in reply graph · bounded walk (seen set prevents hang)', () => {
    const g = new AgentGraph();
    for (const id of ['a', 'b']) g.addSession(makeSession(id));
    g.recordEdge({ from: 'a', to: 'b', kind: 'reply' });
    g.recordEdge({ from: 'b', to: 'a', kind: 'reply' });
    // Back-walk from b: b ← a (count 1) then a ← b (already seen as frontier source) · won't revisit
    // Walk returns a finite count without hanging.
    const depth = g.countReplyDepth('b', 16);
    expect(depth).toBeGreaterThan(0);
    expect(depth).toBeLessThan(100);
  });

  test('maxSteps bounds the walk for pathological graphs', () => {
    const g = new AgentGraph();
    for (const id of ['a', 'b', 'c']) g.addSession(makeSession(id));
    g.recordEdge({ from: 'a', to: 'b', kind: 'reply' });
    g.recordEdge({ from: 'b', to: 'c', kind: 'reply' });
    // maxSteps=1 means only one BFS level, so c sees just b→c edge.
    expect(g.countReplyDepth('c', 1)).toBe(1);
  });
});
