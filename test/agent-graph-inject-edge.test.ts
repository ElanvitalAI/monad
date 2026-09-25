// H6 P7 · 'inject' edge kind recording on AgentGraph.

import { describe, test, expect } from 'bun:test';
import { AgentGraph } from '../src/agent/agent-graph.js';

describe("AgentGraph 'inject' edge kind", () => {
  test("recordEdge accepts kind: 'inject' and returns edge", () => {
    const g = new AgentGraph();
    const e = g.recordEdge({
      from: 'user',
      to: 't1',
      kind: 'inject',
      meta: { sourceId: 'vw-pane:1/p1', as: 'attached-block', bytes: 42 },
    });
    expect(e.kind).toBe('inject');
    expect(e.from).toBe('user');
    expect(e.to).toBe('t1');
    expect((e.meta as Record<string, unknown>).sourceId).toBe('vw-pane:1/p1');
  });

  test("listEdges on target includes 'inject' edges", () => {
    const g = new AgentGraph();
    g.recordEdge({ from: 'user', to: 't1', kind: 'inject', meta: { sourceId: 's1' } });
    g.recordEdge({ from: 'user', to: 't1', kind: 'inject', meta: { sourceId: 's2' } });
    const edges = g.listEdges('t1');
    expect(edges.filter((e) => e.kind === 'inject')).toHaveLength(2);
  });

  test("countReplyDepth ignores 'inject' edges (cycle cap only counts reply)", () => {
    // Inject is explicit user/LLM action · no cycle cap · 10 inject
    // edges into a single target must NOT bump reply-depth (which is
    // how AgentReply enforces its 8-cap).
    const g = new AgentGraph();
    for (let i = 0; i < 10; i++) {
      g.recordEdge({
        from: 'user', to: 't1', kind: 'inject', meta: { sourceId: `s${i}` },
      });
    }
    expect(g.countReplyDepth('t1')).toBe(0);
  });

  test("listAllEdges returns both 'reply' and 'inject' edges", () => {
    const g = new AgentGraph();
    g.recordEdge({ from: 'user', to: 't1', kind: 'reply', meta: {} });
    g.recordEdge({ from: 'user', to: 't1', kind: 'inject', meta: { sourceId: 'x' } });
    const all = g.listAllEdges();
    expect(all.map((e) => e.kind).sort()).toEqual(['inject', 'reply']);
  });

  test("edge at is monotonic · inject edges gain timestamps", () => {
    const g = new AgentGraph();
    const before = Date.now();
    const e = g.recordEdge({ from: 'u', to: 't', kind: 'inject', meta: {} });
    const after = Date.now();
    expect(e.at).toBeGreaterThanOrEqual(before);
    expect(e.at).toBeLessThanOrEqual(after);
  });
});
