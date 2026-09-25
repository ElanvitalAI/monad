// H6 P2 Bundle 1 · Manager read-API tests.

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  getInventory,
  refreshInventory,
  listKnownNodes,
  listModelsFor,
  listAllModels,
  resolveBaseUrl,
  _resetManagerForTesting,
  _peekCacheForTesting,
} from '../src/llm/local-manager/manager.js';
import { _resetSshHostsForTesting, setSshHostsForTesting } from '../src/ssh/ssh-hosts.js';
import { TEST_FLEET } from './fixtures/ssh-fleet.js';

const emptyJson = JSON.stringify({ models: [] });

beforeEach(() => {
  _resetManagerForTesting();
  _resetSshHostsForTesting();
  setSshHostsForTesting(TEST_FLEET);
});

describe('manager · getInventory + cache', () => {
  test('first call probes · result marked fresh (quad probe · lmstudio + ollama + mlx + docker)', async () => {
    let localCalls = 0;
    let remoteCalls = 0;
    const inv = await getInventory({
      runLocal: async () => { localCalls += 1; return { stdout: emptyJson, stderr: '' }; },
      runRemote: async () => { remoteCalls += 1; return { stdout: emptyJson, stderr: '' }; },
      now: () => 1000,
      staleMs: 60_000,
    });
    expect(inv.cached).toBe(false);
    expect(inv.nodes.length).toBeGreaterThanOrEqual(6); // local + 5 ssh hosts
    // Bundle 2 C2+C3 · 4 probes per node (lmstudio + ollama + mlx + docker) in parallel.
    expect(localCalls).toBe(4); // local node: all four runtimes
    expect(remoteCalls).toBe(4 * (inv.nodes.length - 1));
  });

  test('second call within staleness window returns cached', async () => {
    let calls = 0;
    await getInventory({
      runLocal: async () => { calls += 1; return { stdout: emptyJson, stderr: '' }; },
      runRemote: async () => { calls += 1; return { stdout: emptyJson, stderr: '' }; },
      now: () => 1000,
      staleMs: 60_000,
    });
    const inv2 = await getInventory({
      runLocal: async () => { calls += 1; return { stdout: emptyJson, stderr: '' }; },
      runRemote: async () => { calls += 1; return { stdout: emptyJson, stderr: '' }; },
      now: () => 1500, // within 60s
      staleMs: 60_000,
    });
    expect(inv2.cached).toBe(true);
    // Bundle 2 C2+C3 · 4 probes per node (quad).
    expect(calls).toBe(4 * inv2.nodes.length);
  });

  test('call after staleness triggers fresh probe', async () => {
    let calls = 0;
    await getInventory({
      runLocal: async () => { calls += 1; return { stdout: emptyJson, stderr: '' }; },
      runRemote: async () => { calls += 1; return { stdout: emptyJson, stderr: '' }; },
      now: () => 1000,
      staleMs: 500,
    });
    const inv2 = await getInventory({
      runLocal: async () => { calls += 1; return { stdout: emptyJson, stderr: '' }; },
      runRemote: async () => { calls += 1; return { stdout: emptyJson, stderr: '' }; },
      now: () => 2000,
      staleMs: 500,
    });
    expect(inv2.cached).toBe(false);
  });

  test('refreshInventory always fresh', async () => {
    await getInventory({
      runLocal: async () => ({ stdout: emptyJson, stderr: '' }),
      runRemote: async () => ({ stdout: emptyJson, stderr: '' }),
      now: () => 1000,
      staleMs: 60_000,
    });
    const inv2 = await refreshInventory({
      runLocal: async () => ({ stdout: emptyJson, stderr: '' }),
      runRemote: async () => ({ stdout: emptyJson, stderr: '' }),
      now: () => 1100, // well within cache window · forceful refresh
      staleMs: 60_000,
    });
    expect(inv2.cached).toBe(false);
  });
});

describe('manager · inventory shape', () => {
  test('aggregates models sorted by nodeId + label', async () => {
    // LM Studio HTTP probe (fleet fixups 2026-04-22) parses OpenAI-compat
    // `data[].id`. The generic runner below serves the same payload to
    // all 4 probes per node; only LM Studio recognizes it, which is
    // enough for this aggregation ordering test.
    const mbpJson = JSON.stringify({
      object: 'list',
      data: [
        { id: 'qwen-72b', object: 'model' },
        { id: 'abc-9b', object: 'model' },
      ],
    });
    const localJson = JSON.stringify({
      object: 'list',
      data: [{ id: 'tinyllama-1b', object: 'model' }],
    });
    await refreshInventory({
      runLocal: async () => ({ stdout: localJson, stderr: '' }),
      runRemote: async (host) => ({
        stdout: host === 'mbp' ? mbpJson : emptyJson,
        stderr: '',
      }),
      now: () => 1000,
    });
    const all = listAllModels();
    // Sorted: local first by alphabet, mbp by alphabet, others empty.
    const ids = all.map((m) => `${m.nodeId}/${m.label}`);
    expect(ids[0]).toBe('local/tinyllama-1b');
    expect(ids).toContain('mbp/abc-9b');
    expect(ids).toContain('mbp/qwen-72b');
    expect(ids.indexOf('mbp/abc-9b')).toBeLessThan(ids.indexOf('mbp/qwen-72b'));
  });

  test('listModelsFor filters by nodeId', async () => {
    const lmsPayload = JSON.stringify({ object: 'list', data: [{ id: 'm1' }, { id: 'm2' }] });
    await refreshInventory({
      // Only respond to the LM Studio probe (port 1234); make the
      // other 3 runtimes fail with daemon-down so models come from a
      // single runtime only.
      runLocal: async (argv) => {
        // /api/v0/models is the post-2026-05-05 primary; /v1/models
        // is the fallback for older LM Studio. Match both.
        if (argv.some((a) => a.includes(':1234/api/v0/models')
          || a.includes(':1234/v1/models'))) {
          return { stdout: lmsPayload, stderr: '' };
        }
        throw new Error('curl exited 7 · connection refused');
      },
      runRemote: async () => ({ stdout: emptyJson, stderr: '' }),
      now: () => 1,
    });
    expect(listModelsFor('local')).toHaveLength(2);
    expect(listModelsFor('mbp')).toHaveLength(0);
  });

  test('warnings aggregated from per-node probes with nodeId+runtime prefix', async () => {
    const inv = await refreshInventory({
      runLocal: async () => { throw new Error('command not found'); },
      runRemote: async (host) => {
        if (host === 'mbp') throw new Error('Permission denied (publickey).');
        return { stdout: emptyJson, stderr: '' };
      },
      now: () => 1,
    });
    // Bundle 2 C1 · warnings prefixed `<nodeId>:<runtime>:<warning>` so
    // dual-probe failures stay distinguishable (e.g. lmstudio ssh-timeout
    // vs ollama daemon-down on the same node).
    expect(inv.warnings.some((w) => w.startsWith('local:lmstudio:'))).toBe(true);
    expect(inv.warnings.some((w) => w.startsWith('local:ollama:'))).toBe(true);
    expect(inv.warnings.some((w) => w.startsWith('mbp:lmstudio:ssh-auth'))).toBe(true);
    expect(inv.warnings.some((w) => w.startsWith('mbp:ollama:ssh-auth'))).toBe(true);
  });
});

describe('manager · resolveBaseUrl', () => {
  test('returns null before any probe · populated after reachable probe', async () => {
    expect(resolveBaseUrl('local', 'any-model')).toBeNull();
    await refreshInventory({
      runLocal: async () => ({ stdout: emptyJson, stderr: '' }),
      runRemote: async () => ({ stdout: emptyJson, stderr: '' }),
      now: () => 1,
    });
    expect(resolveBaseUrl('local', 'any-model')).toBe('http://localhost:1234/v1');
  });

  test('unreachable node returns null', async () => {
    await refreshInventory({
      runLocal: async () => ({ stdout: emptyJson, stderr: '' }),
      runRemote: async () => { throw new Error('Connection refused'); },
      now: () => 1,
    });
    expect(resolveBaseUrl('mbp', 'x')).toBeNull();
  });

  test('unknown node returns null', () => {
    expect(resolveBaseUrl('ghost', 'x')).toBeNull();
  });
});

describe('manager · testing helpers', () => {
  test('listKnownNodes works before any probe', () => {
    expect(listKnownNodes().length).toBeGreaterThanOrEqual(6);
  });

  test('_peekCacheForTesting returns null before probe', () => {
    expect(_peekCacheForTesting()).toBeNull();
  });

  test('_peekCacheForTesting snapshot after probe', async () => {
    await refreshInventory({
      runLocal: async () => ({ stdout: emptyJson, stderr: '' }),
      runRemote: async () => ({ stdout: emptyJson, stderr: '' }),
      now: () => 42,
    });
    const peek = _peekCacheForTesting();
    expect(peek).not.toBeNull();
    expect(peek!.at).toBe(42);
  });
});

// 4.2 · Debug trace elevation (2026-04-22) — `llm.manager.refresh` fires
// unconditionally to the ring buffer / file sink so a forensic trail of
// every refresh lands in `log/latest` even when no loud sink (mirror /
// verbose / diag) is on. Single-user, user-driven cadence makes the per-
// call object literal cost negligible.
describe('manager · refresh trace (4.2 elevation)', () => {
  test('fires llm.manager.refresh into ring buffer at default trail level', async () => {
    // Use the debug singleton in trail mode (file on, mirror/verbose/diag
    // all off) so `debug.enabled` returns false — pre-elevation this would
    // have suppressed the event. Post-elevation it must still land.
    const { debug } = await import('../src/debug/log.js');
    debug.setLevel('trail');
    debug.clear();
    await refreshInventory({
      runLocal: async () => ({ stdout: emptyJson, stderr: '' }),
      runRemote: async () => ({ stdout: emptyJson, stderr: '' }),
      now: () => 1234,
      staleMs: 60_000,
    });
    const events = debug.events(50);
    const refreshEvents = events.filter((e) => e.category === 'llm.manager.refresh');
    expect(refreshEvents.length).toBe(1);
    const data = refreshEvents[0]!.data as {
      nodes: number; models: number; reachable: number; warnings: number;
    };
    expect(typeof data.nodes).toBe('number');
    expect(data.nodes).toBeGreaterThan(0);
    expect(typeof data.models).toBe('number');
    expect(typeof data.reachable).toBe('number');
    expect(typeof data.warnings).toBe('number');
  });

  test('still no-ops when ALL sinks are off (level=off · zero overhead)', async () => {
    const { debug } = await import('../src/debug/log.js');
    debug.setLevel('off');
    debug.clear();
    await refreshInventory({
      runLocal: async () => ({ stdout: emptyJson, stderr: '' }),
      runRemote: async () => ({ stdout: emptyJson, stderr: '' }),
      now: () => 5678,
      staleMs: 60_000,
    });
    expect(debug.events(10).filter((e) => e.category === 'llm.manager.refresh')).toHaveLength(0);
    // Restore default for subsequent tests.
    debug.setLevel('trail');
  });
});
