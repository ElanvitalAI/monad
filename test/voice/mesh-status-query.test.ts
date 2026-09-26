// ── V5 (Phase 3 Bundle 4) — mesh-status-query tests ──

import { describe, expect, test } from 'bun:test';
import {
  createMeshStatusQuery,
  type MeshNodeStatus,
} from '../../src/voice/mesh-status-query';

const NODES: MeshNodeStatus[] = [
  {
    nodeId: 'elanous-alice',
    displayName: 'alice',
    activeTaskSummary: 'PR review',
    shellCounts: '2v 1h',
    lastSeenIso: '2026-05-02T10:00:00Z',
  },
  {
    nodeId: 'elanous-bob',
    displayName: 'bob',
    activeTaskSummary: 'idle',
    lastSeenIso: '2026-05-02T10:00:00Z',
  },
];

describe('createMeshStatusQuery — happy path', () => {
  test('multi-node spoken result', async () => {
    const spoken: string[] = [];
    const q = createMeshStatusQuery({
      fetchMeshStatus: async () => NODES,
      speak: async (s) => { spoken.push(s); },
    });
    const r = await q.ask();
    expect(r.outcome).toBe('spoken');
    expect(r.nodeCount).toBe(2);
    expect(spoken[0]).toContain('alice');
    expect(spoken[0]).toContain('bob');
  });

  test('single-node spoken — verb specific phrasing', async () => {
    const spoken: string[] = [];
    const q = createMeshStatusQuery({
      fetchMeshStatus: async () => [NODES[0]!],
      speak: async (s) => { spoken.push(s); },
    });
    await q.ask();
    expect(spoken[0]).toContain('alice');
    expect(spoken[0]).toContain('PR review');
    expect(spoken[0]).toContain('2v 1h');
  });
});

describe('createMeshStatusQuery — edge cases', () => {
  test('empty mesh → no-nodes', async () => {
    const spoken: string[] = [];
    const q = createMeshStatusQuery({
      fetchMeshStatus: async () => [],
      speak: async (s) => { spoken.push(s); },
    });
    const r = await q.ask();
    expect(r.outcome).toBe('no-nodes');
    expect(r.nodeCount).toBe(0);
    expect(spoken[0]).toContain('연결된 elanous 가 없');
  });

  test('fetch returns null → fetch-failed', async () => {
    const spoken: string[] = [];
    const q = createMeshStatusQuery({
      fetchMeshStatus: async () => null,
      speak: async (s) => { spoken.push(s); },
    });
    const r = await q.ask();
    expect(r.outcome).toBe('fetch-failed');
    expect(spoken[0]).toContain('가져오지 못');
  });

  test('fetch throws → fetch-failed', async () => {
    const q = createMeshStatusQuery({
      fetchMeshStatus: async () => { throw new Error('network'); },
      speak: async () => {},
    });
    expect((await q.ask()).outcome).toBe('fetch-failed');
  });

  test('fetch exceeds budget → fetch-failed', async () => {
    const q = createMeshStatusQuery({
      fetchMeshStatus: () => new Promise((r) => setTimeout(() => r(NODES), 200)),
      speak: async () => {},
      fetchBudgetMs: 50,
    });
    expect((await q.ask()).outcome).toBe('fetch-failed');
  });

  test('speak throws → tts-failed (utterance preserved)', async () => {
    const q = createMeshStatusQuery({
      fetchMeshStatus: async () => NODES,
      speak: async () => { throw new Error('audio'); },
    });
    const r = await q.ask();
    expect(r.outcome).toBe('tts-failed');
    expect(r.utterance).toContain('alice');
  });
});

describe('createMeshStatusQuery — staleness', () => {
  test('counts stale nodes (lastSeen older than threshold)', async () => {
    let nowMs = Date.parse('2026-05-02T11:00:00Z');
    const q = createMeshStatusQuery({
      fetchMeshStatus: async () => [
        { nodeId: 'a', lastSeenIso: '2026-05-02T10:59:00Z' }, // 1 min ago - fresh
        { nodeId: 'b', lastSeenIso: '2026-05-02T10:50:00Z' }, // 10 min ago - stale
      ],
      speak: async () => {},
      now: () => nowMs,
      staleThresholdMs: 5 * 60 * 1000, // 5 min
    });
    const r = await q.ask();
    expect(r.staleCount).toBe(1);
  });

  test('node without lastSeenIso → not counted as stale', async () => {
    const q = createMeshStatusQuery({
      fetchMeshStatus: async () => [{ nodeId: 'a' }],
      speak: async () => {},
    });
    const r = await q.ask();
    expect(r.staleCount).toBe(0);
  });
});

describe('createMeshStatusQuery — composer override', () => {
  test('custom composeUtterance honored', async () => {
    const spoken: string[] = [];
    const q = createMeshStatusQuery({
      fetchMeshStatus: async () => NODES,
      speak: async (s) => { spoken.push(s); },
      composeUtterance: (st) => `OVERRIDE ${st.length}`,
    });
    await q.ask();
    expect(spoken[0]).toBe('OVERRIDE 2');
  });
});
