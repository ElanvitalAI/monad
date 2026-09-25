// H5 Phase 3 · AgentHandoff LLM tool tests.

import { describe, test, expect, afterEach } from 'bun:test';
import {
  buildAgentHandoffTool,
  dispatchAgentHandoff,
  initAgentHandoffTool,
  _resetAgentHandoffToolForTesting,
} from '../src/skills/tools/agent-handoff.js';
import { defaultAdapterRegistry } from '../src/agent/adapter-registry.js';
import { defaultAgentGraph } from '../src/agent/agent-graph.js';
import type { AgentAdapter, EmbodiedAgentSession } from '../src/agent/embodiment.js';

function makeSession(id: string, brand: string, snapshotText = `snap-${id}`): EmbodiedAgentSession {
  return {
    id,
    launchSpec: { brand, mode: 'pty-direct' },
    transports: Object.freeze([
      Object.freeze({ kind: 'pty' as const, id: `pty-${id}`, label: `${brand}-pty` }),
    ]),
    state: () => ({ status: 'running' as const }),
    send: async () => {},
    interrupt: async () => {},
    snapshot: async () => snapshotText,
    dispose: async () => {},
  };
}

function makeStubAdapter(brand: string): AgentAdapter {
  return {
    id: `${brand}-stub`,
    supports: (s) => s.brand === brand,
    async launch(spec) {
      const id = `emb-${brand}-stub-${Math.random().toString(36).slice(2, 8)}`;
      return makeSession(id, brand, `${spec.prompt ?? ''} // target`);
    },
  };
}

afterEach(() => {
  _resetAgentHandoffToolForTesting();
  defaultAdapterRegistry.clear();
  defaultAgentGraph.clear();
});

describe('buildAgentHandoffTool', () => {
  test('spec has required fields + descriptions', () => {
    const t = buildAgentHandoffTool();
    expect(t.name).toBe('AgentHandoff');
    expect(t.parameters.required).toEqual(['from_session_id', 'to_brand']);
    expect(Object.keys(t.parameters.properties!)).toContain('context_channels');
    expect(Object.keys(t.parameters.properties!)).toContain('max_bytes');
  });
});

describe('dispatchAgentHandoff', () => {
  test('happy path · raw snapshot · returns ids + bytes', async () => {
    const src = makeSession('emb-source', 'codex', 'important screen data');
    initAgentHandoffTool({ findSession: (id) => (id === 'emb-source' ? src : undefined) });
    defaultAdapterRegistry.register(makeStubAdapter('claude'));
    const r = await dispatchAgentHandoff({
      from_session_id: 'emb-source',
      to_brand: 'claude',
    });
    expect(r.from_session_id).toBe('emb-source');
    expect(r.to_session_id).toMatch(/^emb-claude-stub-/);
    expect(r.context_bytes).toBeGreaterThan(0);
    expect(r.edge_kind).toBe('handoff');
    expect(r.included_channels).toEqual([]);
    expect(r.output).toContain('handoff emb-source → emb-claude-stub');
    expect(r.output).toContain('raw-snapshot');
  });

  test('context_prompt forwarded (small body · no truncation)', async () => {
    const launches: Array<{ prompt?: string }> = [];
    const adapter: AgentAdapter = {
      id: 'capture',
      supports: (s) => s.brand === 'capture',
      async launch(spec) {
        launches.push(spec);
        return makeSession('emb-capture-1', 'capture');
      },
    };
    defaultAdapterRegistry.register(adapter);
    const src = makeSession('emb-x', 'codex', 'small body');
    initAgentHandoffTool({ findSession: (id) => (id === 'emb-x' ? src : undefined) });
    await dispatchAgentHandoff({
      from_session_id: 'emb-x',
      to_brand: 'capture',
      context_prompt: 'prefix text',
    });
    expect(launches).toHaveLength(1);
    expect(launches[0]!.prompt).toContain('prefix text');
    expect(launches[0]!.prompt).toContain('small body');
  });

  test('max_bytes truncates body · tail preserved', async () => {
    const launches: Array<{ prompt?: string }> = [];
    const adapter: AgentAdapter = {
      id: 'capture2',
      supports: (s) => s.brand === 'capture2',
      async launch(spec) {
        launches.push(spec);
        return makeSession('emb-capture-2', 'capture2');
      },
    };
    defaultAdapterRegistry.register(adapter);
    const body = 'X'.repeat(10000) + 'TAIL_SENTINEL';
    const src = makeSession('emb-big', 'codex', body);
    initAgentHandoffTool({ findSession: (id) => (id === 'emb-big' ? src : undefined) });
    const r = await dispatchAgentHandoff({
      from_session_id: 'emb-big',
      to_brand: 'capture2',
      max_bytes: 512,
    });
    expect(r.context_bytes).toBeLessThanOrEqual(700);
    expect(launches[0]!.prompt).toContain('TAIL_SENTINEL');
    expect(launches[0]!.prompt).toContain('bytes truncated');
  });

  test('edge_kind dependency forwarded', async () => {
    const src = makeSession('emb-dep', 'codex');
    initAgentHandoffTool({ findSession: (id) => (id === 'emb-dep' ? src : undefined) });
    defaultAdapterRegistry.register(makeStubAdapter('claude'));
    const r = await dispatchAgentHandoff({
      from_session_id: 'emb-dep',
      to_brand: 'claude',
      edge_kind: 'dependency',
    });
    expect(r.edge_kind).toBe('dependency');
  });

  test('invalid edge_kind silently ignored · uses default', async () => {
    const src = makeSession('emb-bad-edge', 'codex');
    initAgentHandoffTool({ findSession: (id) => (id === 'emb-bad-edge' ? src : undefined) });
    defaultAdapterRegistry.register(makeStubAdapter('claude'));
    const r = await dispatchAgentHandoff({
      from_session_id: 'emb-bad-edge',
      to_brand: 'claude',
      edge_kind: 'garbage',
    });
    expect(r.edge_kind).toBe('handoff');
  });

  test('context_channels array of strings passes through', async () => {
    const launches: Array<{ prompt?: string }> = [];
    const adapter: AgentAdapter = {
      id: 'cap2',
      supports: (s) => s.brand === 'cap2',
      async launch(spec) {
        launches.push(spec);
        return makeSession('emb-cap2', 'cap2');
      },
    };
    defaultAdapterRegistry.register(adapter);
    const src = makeSession('emb-y', 'codex');
    initAgentHandoffTool({
      findSession: (id) => (id === 'emb-y' ? src : undefined),
      findObserver: () => ({
        ingest: () => {},
        snapshotChannels: () => ({ reasoning: 'R', 'tool-call': 'T', message: 'M' }),
        activeChannels: () => ['reasoning', 'tool-call', 'message'],
        dispose: () => {},
      } as unknown as import('../src/agent/transport-observer.js').TransportObserver),
    });
    const r = await dispatchAgentHandoff({
      from_session_id: 'emb-y',
      to_brand: 'cap2',
      context_channels: ['reasoning', 'message'],
    });
    expect(r.included_channels).toEqual(['reasoning', 'message']);
    expect(launches[0]!.prompt).toContain('[reasoning]');
    expect(launches[0]!.prompt).toContain('[message]');
    expect(launches[0]!.prompt).not.toContain('[tool-call]');
  });

  test('missing from_session_id throws', async () => {
    initAgentHandoffTool({ findSession: () => undefined });
    let err: unknown;
    try { await dispatchAgentHandoff({ to_brand: 'claude' }); } catch (e) { err = e; }
    expect((err as Error).message).toMatch(/from_session_id is required/);
  });

  test('missing to_brand throws', async () => {
    initAgentHandoffTool({ findSession: () => undefined });
    let err: unknown;
    try {
      await dispatchAgentHandoff({ from_session_id: 'emb-x' });
    } catch (e) { err = e; }
    expect((err as Error).message).toMatch(/to_brand is required/);
  });

  test('tool not wired throws', async () => {
    let err: unknown;
    try {
      await dispatchAgentHandoff({ from_session_id: 'emb-x', to_brand: 'claude' });
    } catch (e) { err = e; }
    expect((err as Error).message).toMatch(/not wired/);
  });

  test('non-numeric max_bytes silently ignored (default used)', async () => {
    const launches: Array<{ prompt?: string }> = [];
    const adapter: AgentAdapter = {
      id: 'cap3',
      supports: (s) => s.brand === 'cap3',
      async launch(spec) {
        launches.push(spec);
        return makeSession('emb-cap3', 'cap3');
      },
    };
    defaultAdapterRegistry.register(adapter);
    const src = makeSession('emb-maxbad', 'codex');
    initAgentHandoffTool({ findSession: (id) => (id === 'emb-maxbad' ? src : undefined) });
    const r = await dispatchAgentHandoff({
      from_session_id: 'emb-maxbad',
      to_brand: 'cap3',
      max_bytes: 'not a number',
    });
    expect(r.context_bytes).toBeGreaterThan(0);
  });
});
