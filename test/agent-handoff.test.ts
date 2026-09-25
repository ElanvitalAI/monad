// H5 Phase 3 · handoff() primitive tests.
//
// Uses stub sessions + a throw-away AdapterRegistry + AgentGraph so we
// don't touch pty-shell or the process-wide defaults.

import { describe, test, expect } from 'bun:test';
import { handoff, type HandoffLookup } from '../src/agent/handoff.js';
import { AdapterRegistry } from '../src/agent/adapter-registry.js';
import { AgentGraph } from '../src/agent/agent-graph.js';
import type {
  AgentAdapter,
  AgentLaunchSpec,
  EmbodiedAgentSession,
} from '../src/agent/embodiment.js';
import type { TransportObserver } from '../src/agent/transport-observer.js';

function makeSession(
  id: string,
  brand: string,
  snapshotText = `snapshot-of-${id}`,
): EmbodiedAgentSession {
  return {
    id,
    launchSpec: { brand, mode: 'pty-direct' },
    transports: Object.freeze([
      Object.freeze({ kind: 'pty' as const, id: `pty-${id}`, label: `${brand}-pty` }),
    ]),
    state() { return { status: 'running' as const }; },
    async send() {},
    async interrupt() {},
    async snapshot() { return snapshotText; },
    async dispose() {},
  };
}

function makeStubAdapter(brand: string, onLaunch?: (spec: AgentLaunchSpec) => void): AgentAdapter {
  return {
    id: `${brand}-stub`,
    supports: (s) => s.brand === brand,
    async launch(spec) {
      onLaunch?.(spec);
      const id = `emb-${brand}-stub-${Math.random().toString(36).slice(2, 8)}`;
      return makeSession(id, brand, `target-${id}`);
    },
  };
}

function makeLookup(sessions: EmbodiedAgentSession[], observers?: Record<string, TransportObserver>): HandoffLookup {
  const map = new Map(sessions.map((s) => [s.id, s]));
  return {
    findSession: (id) => map.get(id),
    findObserver: observers ? (id) => observers[id] : undefined,
  };
}

function makeObserver(channels: Record<string, string>): TransportObserver {
  return {
    ingest: () => {},
    snapshotChannels: () => ({ ...channels }),
    activeChannels: () => Object.keys(channels),
    dispose: () => {},
  } as unknown as TransportObserver;
}

describe('handoff · basic flow', () => {
  test('builds context from raw snapshot when no observer', async () => {
    const registry = new AdapterRegistry();
    const graph = new AgentGraph();
    const launches: AgentLaunchSpec[] = [];
    registry.register(makeStubAdapter('claude', (spec) => launches.push(spec)));
    const src = makeSession('emb-src', 'codex', 'raw screen output here');
    const result = await handoff(
      { from: 'emb-src', to: { brand: 'claude' } },
      { registry, graph, lookup: makeLookup([src]) },
    );
    expect(result.fromSessionId).toBe('emb-src');
    expect(result.toSession.launchSpec.brand).toBe('claude');
    expect(result.includedChannels).toEqual([]);
    expect(launches).toHaveLength(1);
    expect(launches[0]!.prompt).toContain('raw screen output here');
    expect(launches[0]!.prompt).toContain('[handoff] from session emb-src');
  });

  test('observer present · uses per-channel accumulators', async () => {
    const registry = new AdapterRegistry();
    const graph = new AgentGraph();
    const launches: AgentLaunchSpec[] = [];
    registry.register(makeStubAdapter('gemini', (spec) => launches.push(spec)));
    const src = makeSession('emb-src2', 'codex');
    const obs = makeObserver({ reasoning: 'thought A', 'tool-call': 'ran cmd x' });
    const result = await handoff(
      { from: 'emb-src2', to: { brand: 'gemini' } },
      { registry, graph, lookup: makeLookup([src], { 'emb-src2': obs }) },
    );
    expect(result.includedChannels).toEqual(['reasoning', 'tool-call']);
    const prompt = launches[0]!.prompt!;
    expect(prompt).toContain('[reasoning]');
    expect(prompt).toContain('thought A');
    expect(prompt).toContain('[tool-call]');
    expect(prompt).toContain('ran cmd x');
  });

  test('contextChannels filters observer channels', async () => {
    const registry = new AdapterRegistry();
    const graph = new AgentGraph();
    const launches: AgentLaunchSpec[] = [];
    registry.register(makeStubAdapter('claude', (spec) => launches.push(spec)));
    const obs = makeObserver({ reasoning: 'r', 'tool-call': 't', message: 'm' });
    const src = makeSession('emb-src3', 'codex');
    const result = await handoff(
      { from: 'emb-src3', to: { brand: 'claude' }, contextChannels: ['message'] },
      { registry, graph, lookup: makeLookup([src], { 'emb-src3': obs }) },
    );
    expect(result.includedChannels).toEqual(['message']);
    const prompt = launches[0]!.prompt!;
    expect(prompt).toContain('[message]');
    expect(prompt).not.toContain('[reasoning]');
    expect(prompt).not.toContain('[tool-call]');
  });

  test('contextPrompt prefix is prepended', async () => {
    const registry = new AdapterRegistry();
    const graph = new AgentGraph();
    const launches: AgentLaunchSpec[] = [];
    registry.register(makeStubAdapter('claude', (spec) => launches.push(spec)));
    const src = makeSession('emb-src4', 'codex');
    await handoff(
      { from: 'emb-src4', to: { brand: 'claude' }, contextPrompt: 'Continue the work from codex.' },
      { registry, graph, lookup: makeLookup([src]) },
    );
    expect(launches[0]!.prompt).toContain('Continue the work from codex.');
  });

  test('maxBytes truncates from the head, keeps tail', async () => {
    const registry = new AdapterRegistry();
    const graph = new AgentGraph();
    const launches: AgentLaunchSpec[] = [];
    registry.register(makeStubAdapter('claude', (spec) => launches.push(spec)));
    const big = 'X'.repeat(500) + 'TAIL_MARKER';
    const src = makeSession('emb-big', 'codex', big);
    const result = await handoff(
      { from: 'emb-big', to: { brand: 'claude' }, maxBytes: 100 },
      { registry, graph, lookup: makeLookup([src]) },
    );
    expect(result.contextBytes).toBeLessThanOrEqual(200); // 100 + truncation prefix
    expect(launches[0]!.prompt).toContain('bytes truncated');
    expect(launches[0]!.prompt).toContain('TAIL_MARKER');
  });
});

describe('handoff · edge recording', () => {
  test('records handoff edge with kind=handoff by default', async () => {
    const registry = new AdapterRegistry();
    const graph = new AgentGraph();
    registry.register(makeStubAdapter('claude'));
    const src = makeSession('emb-from', 'codex');
    const result = await handoff(
      { from: 'emb-from', to: { brand: 'claude' } },
      { registry, graph, lookup: makeLookup([src]) },
    );
    expect(result.edge.kind).toBe('handoff');
    expect(result.edge.from).toBe('emb-from');
    expect(result.edge.to).toBe(result.toSession.id);
    expect(graph.getNode(result.toSession.id)).toBeDefined();
    expect(graph.getNode('emb-from')).toBeDefined();
  });

  test('edgeKind override applies', async () => {
    const registry = new AdapterRegistry();
    const graph = new AgentGraph();
    registry.register(makeStubAdapter('claude'));
    const src = makeSession('emb-from2', 'codex');
    const result = await handoff(
      { from: 'emb-from2', to: { brand: 'claude' }, edgeKind: 'dependency' },
      { registry, graph, lookup: makeLookup([src]) },
    );
    expect(result.edge.kind).toBe('dependency');
  });

  test('edgeMeta passes through to edge', async () => {
    const registry = new AdapterRegistry();
    const graph = new AgentGraph();
    registry.register(makeStubAdapter('claude'));
    const src = makeSession('emb-meta', 'codex');
    const result = await handoff(
      { from: 'emb-meta', to: { brand: 'claude' }, edgeMeta: { reason: 'context-switch' } },
      { registry, graph, lookup: makeLookup([src]) },
    );
    expect(result.edge.meta).toEqual({ reason: 'context-switch' });
  });

  test('source already in graph · does not duplicate', async () => {
    const registry = new AdapterRegistry();
    const graph = new AgentGraph();
    registry.register(makeStubAdapter('claude'));
    const src = makeSession('emb-pregame', 'codex');
    graph.addSession(src);
    await handoff(
      { from: 'emb-pregame', to: { brand: 'claude' } },
      { registry, graph, lookup: makeLookup([src]) },
    );
    // Still exactly one root with id emb-pregame
    expect(graph.listNodes().filter((n) => n.sessionId === 'emb-pregame')).toHaveLength(1);
  });
});

describe('handoff · error paths', () => {
  test('unknown source throws', async () => {
    const registry = new AdapterRegistry();
    const graph = new AgentGraph();
    registry.register(makeStubAdapter('claude'));
    let err: unknown;
    try {
      await handoff(
        { from: 'emb-missing', to: { brand: 'claude' } },
        { registry, graph, lookup: makeLookup([]) },
      );
    } catch (e) { err = e; }
    expect((err as Error).message).toMatch(/source session .* not found/);
  });

  test('no adapter for target brand throws via adapterRegistry', async () => {
    const registry = new AdapterRegistry();
    const graph = new AgentGraph();
    const src = makeSession('emb-src-na', 'codex');
    let err: unknown;
    try {
      await handoff(
        { from: 'emb-src-na', to: { brand: 'unsupported' } },
        { registry, graph, lookup: makeLookup([src]) },
      );
    } catch (e) { err = e; }
    expect((err as Error).message).toMatch(/No adapter supports/);
  });

  test('source.snapshot throw · falls back to placeholder', async () => {
    const registry = new AdapterRegistry();
    const graph = new AgentGraph();
    const launches: AgentLaunchSpec[] = [];
    registry.register(makeStubAdapter('claude', (spec) => launches.push(spec)));
    const src = makeSession('emb-snap-bad', 'codex');
    (src as { snapshot: unknown }).snapshot = () => { throw new Error('disposed'); };
    await handoff(
      { from: 'emb-snap-bad', to: { brand: 'claude' } },
      { registry, graph, lookup: makeLookup([src]) },
    );
    expect(launches[0]!.prompt).toContain('(source snapshot unavailable)');
  });
});
