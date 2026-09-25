// H5 Phase 1 Step B · AdapterRegistry unit tests.

import { describe, test, expect } from 'bun:test';
import { AdapterRegistry } from '../src/agent/adapter-registry.js';
import type {
  AgentAdapter,
  AgentLaunchSpec,
  EmbodiedAgentSession,
} from '../src/agent/embodiment.js';

function makeSession(id = 'sess-1'): EmbodiedAgentSession {
  return {
    id,
    launchSpec: { brand: 'test' },
    transports: [],
    state: () => ({ status: 'pending' }),
    async send() {},
    async interrupt() {},
    async snapshot() { return ''; },
    async dispose() {},
  };
}

function makeAdapter(id: string, accept: (spec: AgentLaunchSpec) => boolean): AgentAdapter {
  return {
    id,
    supports: accept,
    launch: async (spec) => makeSession(`${id}::${spec.brand}`),
  };
}

describe('AdapterRegistry · register/unregister', () => {
  test('register returns disposer · list reflects membership', () => {
    const r = new AdapterRegistry();
    const a = makeAdapter('a', () => true);
    const b = makeAdapter('b', () => true);
    const offA = r.register(a);
    r.register(b);
    expect(r.list().map((x) => x.id)).toEqual(['a', 'b']);
    offA();
    expect(r.list().map((x) => x.id)).toEqual(['b']);
  });

  test('clear removes all', () => {
    const r = new AdapterRegistry();
    r.register(makeAdapter('a', () => true));
    r.register(makeAdapter('b', () => true));
    r.clear();
    expect(r.list()).toEqual([]);
  });
});

describe('AdapterRegistry · priority', () => {
  test('higher priority first · ties keep registration order', () => {
    const r = new AdapterRegistry();
    r.register(makeAdapter('low1', () => true), { priority: 0 });
    r.register(makeAdapter('high', () => true), { priority: 10 });
    r.register(makeAdapter('low2', () => true), { priority: 0 });
    expect(r.list().map((x) => x.id)).toEqual(['high', 'low1', 'low2']);
  });

  test('pick returns first matching adapter in priority order', () => {
    const r = new AdapterRegistry();
    r.register(makeAdapter('a-only', (s) => s.brand === 'a'), { priority: 0 });
    r.register(makeAdapter('any', () => true), { priority: 5 });
    // higher priority "any" wins over lower priority "a-only" even though both match
    const picked = r.pick({ brand: 'a' });
    expect(picked?.id).toBe('any');
  });
});

describe('AdapterRegistry · pick / launch', () => {
  test('pick returns undefined when no adapter matches', () => {
    const r = new AdapterRegistry();
    r.register(makeAdapter('only-x', (s) => s.brand === 'x'));
    expect(r.pick({ brand: 'y' })).toBeUndefined();
  });

  test('launch throws with registered ids listed on no-match', async () => {
    const r = new AdapterRegistry();
    r.register(makeAdapter('alpha', () => false));
    r.register(makeAdapter('beta', () => false));
    let err: unknown;
    try {
      await r.launch({ brand: 'nope' });
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toContain('No adapter');
    expect((err as Error).message).toContain('alpha');
    expect((err as Error).message).toContain('beta');
    expect((err as Error).message).toContain('brand="nope"');
  });

  test('launch passes spec through to adapter.launch', async () => {
    const r = new AdapterRegistry();
    r.register(makeAdapter('echo', () => true));
    const session = await r.launch({ brand: 'x', mode: 'pty-direct', cwd: '/tmp' });
    expect(session.id).toBe('echo::x');
  });

  test('throwing supports() is treated as non-match (not propagated)', () => {
    const r = new AdapterRegistry();
    r.register(makeAdapter('throwy', () => { throw new Error('boom'); }));
    r.register(makeAdapter('quiet', () => true));
    const picked = r.pick({ brand: 'x' });
    expect(picked?.id).toBe('quiet');
  });
});
