// H6 P5 · sendReply main flow tests (with stubs).

import { describe, test, expect } from 'bun:test';
import {
  sendReply,
  ReplyCycleExceededError,
  USER_GHOST_SESSION_ID,
  type ReplyDeps,
} from '../src/agent/reply.js';
import { AgentGraph } from '../src/agent/agent-graph.js';
import type { EmbodiedAgentSession } from '../src/agent/embodiment.js';

// ─── Stubs ─────────────────────────────────────────────────────────

function makeSession(id: string, opts: { withPty?: boolean; onSend?: (m: string) => void } = {}): EmbodiedAgentSession {
  const transports = opts.withPty === false
    ? [{ kind: 'acp' as const, id: `acp-${id}` }]
    : [{ kind: 'pty' as const, id: `pty-${id}` }];
  return {
    id,
    launchSpec: { brand: 'stub' },
    transports,
    state: () => ({ status: 'running' }),
    async send(m) { opts.onSend?.(m); },
    async interrupt() {},
    async snapshot() { return ''; },
    async dispose() {},
  };
}

class FakeObserver {
  state: Record<string, string> = {};
  set(channel: string, value: string) { this.state[channel] = value; }
  append(channel: string, chunk: string) {
    this.state[channel] = (this.state[channel] ?? '') + chunk;
  }
  snapshotChannels() { return { ...this.state }; }
}

function fakeDeps(opts: {
  sessions: Record<string, EmbodiedAgentSession>;
  observers?: Record<string, FakeObserver>;
  graph?: AgentGraph;
  scheduled?: Array<(observer: FakeObserver) => void>;
  maxDepth?: number;
}): ReplyDeps & { graph: AgentGraph } {
  const graph = opts.graph ?? new AgentGraph();
  let clockAt = 1000;
  const now = () => clockAt;
  // Fake sleep applies scheduled mutations to mimic async output.
  let tick = 0;
  const sleep = async (ms: number) => {
    clockAt += ms;
    const fn = opts.scheduled?.[tick];
    if (fn) {
      // Pick the observer attached to the first session (tests use one target).
      const firstObs = Object.values(opts.observers ?? {})[0];
      if (firstObs) fn(firstObs);
    }
    tick += 1;
  };
  return {
    lookup: { findSession: (id) => opts.sessions[id] },
    observerLookup: (id) => opts.observers?.[id] as never,
    graph,
    now,
    sleep,
    ...(opts.maxDepth !== undefined ? { maxDepth: opts.maxDepth } : {}),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('sendReply · happy path', () => {
  test('user → target · captures message channel delta · records reply edge', async () => {
    const target = makeSession('t1');
    const observer = new FakeObserver();
    const deps = fakeDeps({
      sessions: { t1: target },
      observers: { t1: observer },
      scheduled: [
        (o) => o.append('message', 'hello back'),
        // subsequent ticks: no change → idle triggers
      ],
    });
    const result = await sendReply(
      { toSessionId: 't1', message: 'hi', idleMs: 100, timeoutMs: 5000 },
      deps,
    );
    expect(result.fromSessionId).toBeNull();
    expect(result.toSessionId).toBe('t1');
    expect(result.replyText).toBe('hello back');
    expect(result.channels.message).toBe('hello back');
    expect(result.cycleDepth).toBe(1);
    // Edge recorded with user ghost as from.
    const edges = deps.graph.listAllEdges();
    expect(edges).toHaveLength(1);
    expect(edges[0]!.from).toBe(USER_GHOST_SESSION_ID);
    expect(edges[0]!.to).toBe('t1');
    expect(edges[0]!.kind).toBe('reply');
  });

  test('source → target records source id on edge', async () => {
    const source = makeSession('s1');
    const target = makeSession('t1');
    const observer = new FakeObserver();
    const deps = fakeDeps({
      sessions: { s1: source, t1: target },
      observers: { t1: observer },
      scheduled: [(o) => o.append('message', 'ok')],
    });
    deps.graph.addSession(source);
    deps.graph.addSession(target);
    const result = await sendReply(
      { fromSessionId: 's1', toSessionId: 't1', message: 'ping', idleMs: 100 },
      deps,
    );
    expect(result.fromSessionId).toBe('s1');
    const edges = deps.graph.listEdges('t1');
    expect(edges.some((e) => e.from === 's1' && e.kind === 'reply')).toBe(true);
  });

  test('edge meta carries preview + elapsedMs + cycleDepth', async () => {
    const target = makeSession('t1');
    const observer = new FakeObserver();
    const deps = fakeDeps({
      sessions: { t1: target },
      observers: { t1: observer },
      scheduled: [(o) => o.append('message', 'reply body content here')],
    });
    const result = await sendReply(
      { toSessionId: 't1', message: 'ask me something interesting', idleMs: 100 },
      deps,
    );
    expect(result.edge.meta).toBeDefined();
    const meta = result.edge.meta as Record<string, unknown>;
    expect(meta.messagePreview).toContain('ask me');
    expect(meta.replyPreview).toContain('reply body');
    expect(typeof meta.elapsedMs).toBe('number');
    expect(meta.cycleDepth).toBe(1);
  });
});

describe('sendReply · error paths', () => {
  test('missing toSessionId throws', async () => {
    const deps = fakeDeps({ sessions: {} });
    await expect(sendReply({ toSessionId: '', message: 'hi' }, deps)).rejects.toThrow(/toSessionId/);
  });

  test('target not found throws with clear message', async () => {
    const deps = fakeDeps({ sessions: {} });
    await expect(
      sendReply({ toSessionId: 'missing', message: 'hi' }, deps),
    ).rejects.toThrow(/not found/);
  });

  test('target has no PTY transport throws · ACP-only monad-as-child example', async () => {
    const target = makeSession('monad-1', { withPty: false });
    const deps = fakeDeps({ sessions: { 'monad-1': target } });
    await expect(
      sendReply({ toSessionId: 'monad-1', message: 'hi' }, deps),
    ).rejects.toThrow(/no PTY transport/);
  });

  test('target.send() throwing is wrapped with context', async () => {
    const target = makeSession('t1', {
      onSend: () => { throw new Error('pipe broken'); },
    });
    const observer = new FakeObserver();
    const deps = fakeDeps({
      sessions: { t1: target },
      observers: { t1: observer },
    });
    await expect(
      sendReply({ toSessionId: 't1', message: 'hi', idleMs: 100 }, deps),
    ).rejects.toThrow(/target\.send failed/);
  });
});

describe('sendReply · observer fallback', () => {
  test('no observer · falls back to screen snapshot · warning surfaces', async () => {
    const snapshots = ['pre-state', 'pre-statereply body'];
    let i = 0;
    const target: EmbodiedAgentSession = {
      ...makeSession('t1'),
      async snapshot() { return snapshots[Math.min(i++, snapshots.length - 1)]!; },
    };
    const deps: ReplyDeps = {
      lookup: { findSession: (id) => (id === 't1' ? target : undefined) },
      // observerLookup omitted entirely
      graph: new AgentGraph(),
      now: () => 1000,
      sleep: async () => {},
    };
    const result = await sendReply(
      { toSessionId: 't1', message: 'hi', idleMs: 10 },
      deps,
    );
    expect(result.warnings).toContain('observer-missing');
    expect(result.replyText).toBe('reply body');
  });
});

describe('sendReply · cycle depth cap', () => {
  test('depth below cap allowed', async () => {
    const graph = new AgentGraph();
    const target = makeSession('t1');
    const observer = new FakeObserver();
    // Pre-seed 5 inbound reply edges on source 's1'
    graph.addSession(makeSession('s1'));
    graph.addSession(target);
    for (let i = 0; i < 5; i++) {
      graph.recordEdge({ from: `prev-${i}`, to: 's1', kind: 'reply' });
    }
    const deps = fakeDeps({
      sessions: { s1: makeSession('s1'), t1: target },
      observers: { t1: observer },
      graph,
      scheduled: [(o) => o.append('message', 'ok')],
      maxDepth: 8,
    });
    const result = await sendReply(
      { fromSessionId: 's1', toSessionId: 't1', message: 'hi', idleMs: 100 },
      deps,
    );
    // Existing depth 5 + this edge = 6 · under cap 8
    expect(result.cycleDepth).toBe(6);
  });

  test('depth at cap throws ReplyCycleExceededError', async () => {
    const graph = new AgentGraph();
    const source = makeSession('s1');
    const target = makeSession('t1');
    graph.addSession(source);
    graph.addSession(target);
    // 8 inbound reply edges on s1 → new edge would be depth 9, over cap 8
    for (let i = 0; i < 8; i++) {
      graph.recordEdge({ from: `prev-${i}`, to: 's1', kind: 'reply' });
    }
    const deps = fakeDeps({
      sessions: { s1: source, t1: target },
      observers: { t1: new FakeObserver() },
      graph,
      maxDepth: 8,
    });
    await expect(
      sendReply({ fromSessionId: 's1', toSessionId: 't1', message: 'hi' }, deps),
    ).rejects.toBeInstanceOf(ReplyCycleExceededError);
  });
});

describe('sendReply · channel filtering', () => {
  test('default filter = message channel only', async () => {
    const target = makeSession('t1');
    const observer = new FakeObserver();
    const deps = fakeDeps({
      sessions: { t1: target },
      observers: { t1: observer },
      scheduled: [
        (o) => {
          o.append('message', 'visible');
          o.append('reasoning', 'hidden think');
        },
      ],
    });
    const result = await sendReply(
      { toSessionId: 't1', message: 'hi', idleMs: 100 },
      deps,
    );
    expect(result.channels.message).toBe('visible');
    expect(result.channels.reasoning).toBeUndefined();
  });

  test('empty includeChannels array · everything included', async () => {
    const target = makeSession('t1');
    const observer = new FakeObserver();
    const deps = fakeDeps({
      sessions: { t1: target },
      observers: { t1: observer },
      scheduled: [
        (o) => {
          o.append('message', 'm');
          o.append('reasoning', 'r');
          o.append('tool-call', 't');
        },
      ],
    });
    const result = await sendReply(
      { toSessionId: 't1', message: 'hi', includeChannels: [], idleMs: 100 },
      deps,
    );
    expect(Object.keys(result.channels).sort()).toEqual(['message', 'reasoning', 'tool-call']);
  });

  test('explicit includeChannels list filters by name', async () => {
    const target = makeSession('t1');
    const observer = new FakeObserver();
    const deps = fakeDeps({
      sessions: { t1: target },
      observers: { t1: observer },
      scheduled: [(o) => { o.append('message', 'm'); o.append('reasoning', 'r'); }],
    });
    const result = await sendReply(
      {
        toSessionId: 't1',
        message: 'hi',
        includeChannels: ['reasoning'],
        idleMs: 100,
      },
      deps,
    );
    expect(result.channels.reasoning).toBe('r');
    expect(result.channels.message).toBeUndefined();
  });
});
