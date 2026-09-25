// H6 P2 Bundle 1 · node-registry tests.
//
// Covers topology listing (local + ssh-hosts fleet) + status cache
// update semantics.

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  listNodes,
  findNode,
  updateNodeStatus,
  _getNodeStatusForTesting,
  _resetNodeStatusForTesting,
} from '../src/llm/local-manager/node-registry.js';
import { _resetSshHostsForTesting, setSshHostsForTesting } from '../src/ssh/ssh-hosts.js';
import { TEST_FLEET } from './fixtures/ssh-fleet.js';

describe('node-registry · topology', () => {
  beforeEach(() => {
    _resetNodeStatusForTesting();
    _resetSshHostsForTesting();
    setSshHostsForTesting(TEST_FLEET);
  });

  test('first node is local · subsequent are ssh-hosts default fleet', () => {
    const nodes = listNodes();
    expect(nodes[0]!.id).toBe('local');
    expect(nodes[0]!.isLocal).toBe(true);
    expect(nodes.length).toBeGreaterThanOrEqual(6); // local + 5 default hosts
    const names = nodes.slice(1).map((n) => n.id);
    expect(names).toContain('mbp');
    expect(names).toContain('node-b');
  });

  test('remote nodes carry sshHost + description', () => {
    const mbp = findNode('mbp');
    expect(mbp).not.toBeNull();
    expect(mbp!.isLocal).toBe(false);
    expect(mbp!.sshHost).toBe('mbp');
    expect(mbp!.description).toBe('MacBook Pro');
  });

  test('findNode is case-insensitive', () => {
    expect(findNode('LOCAL')!.id).toBe('local');
    expect(findNode('MbP')!.id).toBe('mbp');
    expect(findNode('ghost-node')).toBeNull();
  });

  test('blank status before first probe', () => {
    const nodes = listNodes();
    for (const n of nodes) {
      expect(n.lastProbedAt).toBe(0);
      expect(n.reachable).toBeUndefined();
      expect(n.runtimes).toEqual([]);
      expect(n.lmstudioBaseUrl).toBeUndefined();
    }
  });
});

describe('node-registry · status cache', () => {
  beforeEach(() => {
    _resetNodeStatusForTesting();
    _resetSshHostsForTesting();
    setSshHostsForTesting(TEST_FLEET);
  });

  test('updateNodeStatus persists across listNodes calls', () => {
    updateNodeStatus('mbp', {
      reachable: true,
      runtimes: ['lmstudio'],
      lmstudioBaseUrl: 'http://mbp:1234/v1',
      at: 1_700_000_000_000,
    });
    const nodes = listNodes();
    const mbp = nodes.find((n) => n.id === 'mbp')!;
    expect(mbp.reachable).toBe(true);
    expect(mbp.runtimes).toEqual(['lmstudio']);
    expect(mbp.lmstudioBaseUrl).toBe('http://mbp:1234/v1');
    expect(mbp.lastProbedAt).toBe(1_700_000_000_000);
  });

  test('partial update preserves previous fields', () => {
    updateNodeStatus('local', {
      reachable: true,
      runtimes: ['lmstudio'],
      lmstudioBaseUrl: 'http://localhost:1234/v1',
      at: 1000,
    });
    updateNodeStatus('local', { reachable: false, at: 2000 });
    const s = _getNodeStatusForTesting('local')!;
    expect(s.reachable).toBe(false);
    expect(s.runtimes).toEqual(['lmstudio']); // preserved
    expect(s.lmstudioBaseUrl).toBe('http://localhost:1234/v1'); // preserved
    expect(s.lastProbedAt).toBe(2000);
  });

  test('unreachable node clears runtimes only when explicitly empty', () => {
    updateNodeStatus('node-b', { reachable: true, runtimes: ['lmstudio'], at: 1 });
    updateNodeStatus('node-b', { reachable: false, runtimes: [], at: 2 });
    const s = _getNodeStatusForTesting('node-b')!;
    expect(s.reachable).toBe(false);
    expect(s.runtimes).toEqual([]);
  });

  test('_resetNodeStatusForTesting clears all entries', () => {
    updateNodeStatus('mbp', { reachable: true, runtimes: ['lmstudio'], at: 1 });
    _resetNodeStatusForTesting();
    expect(_getNodeStatusForTesting('mbp')).toBeUndefined();
  });
});

describe('node-registry · self-alias filter (fleet fixups 2026-04-22)', () => {
  beforeEach(async () => {
    _resetNodeStatusForTesting(); // pins self-aliases to empty set
    _resetSshHostsForTesting();
    setSshHostsForTesting(TEST_FLEET);
    // These tests exercise the self-alias resolver · release the pin
    // so `initializeSelfAliases` can repopulate with injected deps.
    const mod = await import('../src/llm/local-manager/node-registry.js');
    mod._unlockSelfAliasesForTesting();
  });

  test('before initialization · full fleet is returned (inert filter)', () => {
    // No init yet · self-alias set is null · all hosts included.
    const names = listNodes().map((n) => n.id);
    expect(names).toContain('mbp');
    expect(names).toContain('node-b');
  });

  test('ssh-host whose DNS resolves to a local IP is dropped', async () => {
    const { initializeSelfAliases, _peekSelfAliasesForTesting } = await import(
      '../src/llm/local-manager/node-registry.js'
    );
    await initializeSelfAliases({
      localIps: ['100.64.0.2', '192.168.0.50'],
      resolveHost: async (host) => {
        // Simulate: mbp → self tun IP · others distinct
        if (host === 'mbp') return '100.64.0.2';
        if (host === 'node-b') return '100.64.0.4';
        return null;
      },
    });
    expect(_peekSelfAliasesForTesting()).toEqual(['mbp']);
    const names = listNodes().map((n) => n.id);
    expect(names).not.toContain('mbp'); // filtered out
    expect(names).toContain('node-b'); // distinct IP · kept
    expect(names[0]).toBe('local'); // local pseudo-node unchanged
  });

  test('initialization is idempotent · repeat calls share the same resolution', async () => {
    const { initializeSelfAliases } = await import(
      '../src/llm/local-manager/node-registry.js'
    );
    let resolveCalls = 0;
    const resolveHost = async (host: string) => {
      resolveCalls += 1;
      return host === 'mbp' ? '10.0.0.1' : null;
    };
    await initializeSelfAliases({ localIps: ['10.0.0.1'], resolveHost });
    const firstCalls = resolveCalls;
    expect(firstCalls).toBeGreaterThan(0);
    // Second call must not re-resolve.
    await initializeSelfAliases({ localIps: ['10.0.0.1'], resolveHost });
    expect(resolveCalls).toBe(firstCalls);
  });

  test('hosts that fail to resolve are never treated as self', async () => {
    const { initializeSelfAliases, _peekSelfAliasesForTesting } = await import(
      '../src/llm/local-manager/node-registry.js'
    );
    await initializeSelfAliases({
      localIps: ['10.0.0.1'],
      resolveHost: async () => null, // DNS fails for every host
    });
    expect(_peekSelfAliasesForTesting()).toEqual([]);
    const names = listNodes().map((n) => n.id);
    expect(names).toContain('mbp');
    expect(names).toContain('node-b');
  });

  test('filter is case-insensitive on ssh-host name', async () => {
    const { initializeSelfAliases } = await import(
      '../src/llm/local-manager/node-registry.js'
    );
    await initializeSelfAliases({
      localIps: ['10.0.0.1'],
      resolveHost: async (host) => (host === 'mbp' ? '10.0.0.1' : null),
    });
    expect(findNode('MBP')).toBeNull();
    expect(findNode('mbp')).toBeNull();
    // local is always present regardless of filter
    expect(findNode('local')).not.toBeNull();
  });
});
