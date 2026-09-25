// ── C4 (Phase 3 Bundle 4) — group-shell-memory tests ──

import { describe, expect, test } from 'bun:test';
import { createGroupShellMemory } from '../../src/discord/group-shell-memory';

describe('createGroupShellMemory — recordSpawn / recordEnd / get', () => {
  test('record + get roundtrip', () => {
    const m = createGroupShellMemory();
    m.recordSpawn({
      shellId: 'sh-1',
      channelId: 'ch-dev',
      persona: 'alice',
      verb: 'build',
      spawnedAt: '2026-05-01T10:00:00Z',
    });
    expect(m.size()).toBe(1);
    expect(m.get('sh-1')?.persona).toBe('alice');
  });

  test('recordEnd updates fields', () => {
    const m = createGroupShellMemory();
    m.recordSpawn({
      shellId: 'sh-1',
      channelId: 'ch-dev',
      persona: 'alice',
      verb: 'build',
      spawnedAt: '2026-05-01T10:00:00Z',
    });
    expect(m.recordEnd('sh-1', {
      endedAt: '2026-05-01T10:05:00Z',
      exitCode: 0,
      outcome: 'exit',
      tail: 'success',
    })).toBe(true);
    const r = m.get('sh-1')!;
    expect(r.exitCode).toBe(0);
    expect(r.tail).toBe('success');
  });

  test('recordEnd unknown id → false', () => {
    const m = createGroupShellMemory();
    expect(m.recordEnd('gone', { endedAt: '2026-05-01T00:00:00Z' })).toBe(false);
  });

  test('cap evicts oldest', () => {
    const m = createGroupShellMemory({ cap: 3 });
    for (let i = 0; i < 5; i += 1) {
      m.recordSpawn({
        shellId: `sh-${i}`,
        channelId: 'ch',
        persona: 'p',
        verb: 'v',
        spawnedAt: '2026-05-01T10:00:00Z',
      });
    }
    expect(m.size()).toBe(3);
    expect(m.get('sh-0')).toBeNull();
    expect(m.get('sh-4')?.shellId).toBe('sh-4');
  });
});

describe('createGroupShellMemory — list filters', () => {
  function seed() {
    const m = createGroupShellMemory();
    m.recordSpawn({ shellId: 'a', channelId: 'ch-dev', persona: 'alice', verb: 'build', spawnedAt: '2026-05-01T10:00:00Z' });
    m.recordEnd('a', { endedAt: '2026-05-01T10:05:00Z', exitCode: 0 });
    m.recordSpawn({ shellId: 'b', channelId: 'ch-dev', persona: 'bob', verb: 'test', spawnedAt: '2026-05-01T11:00:00Z' });
    m.recordEnd('b', { endedAt: '2026-05-01T11:05:00Z', exitCode: 1 });
    m.recordSpawn({ shellId: 'c', channelId: 'ch-prod', persona: 'alice', verb: 'deploy', spawnedAt: '2026-05-02T09:00:00Z' });
    m.recordEnd('c', { endedAt: '2026-05-02T09:10:00Z', exitCode: 0 });
    return m;
  }

  test('newest-first ordering', () => {
    const m = seed();
    const list = m.list();
    expect(list.map((r) => r.shellId)).toEqual(['c', 'b', 'a']);
  });

  test('channelId filter', () => {
    const m = seed();
    expect(m.list({ channelId: 'ch-dev' }).map((r) => r.shellId)).toEqual(['b', 'a']);
  });

  test('persona filter', () => {
    const m = seed();
    expect(m.list({ persona: 'alice' }).map((r) => r.shellId)).toEqual(['c', 'a']);
  });

  test('verb filter', () => {
    const m = seed();
    expect(m.list({ verb: 'test' }).map((r) => r.shellId)).toEqual(['b']);
  });

  test('failedOnly filter', () => {
    const m = seed();
    expect(m.list({ failedOnly: true }).map((r) => r.shellId)).toEqual(['b']);
  });

  test('sinceIso filter', () => {
    const m = seed();
    expect(m.list({ sinceIso: '2026-05-02T00:00:00Z' }).map((r) => r.shellId)).toEqual(['c']);
  });

  test('combined filter', () => {
    const m = seed();
    expect(m.list({ persona: 'alice', sinceIso: '2026-05-02T00:00:00Z' })
      .map((r) => r.shellId)).toEqual(['c']);
  });

  test('limit caps result', () => {
    const m = seed();
    expect(m.list({ limit: 1 })).toHaveLength(1);
  });
});

describe('createGroupShellMemory — prune', () => {
  test('prune drops records before cutoff', () => {
    const m = createGroupShellMemory();
    m.recordSpawn({ shellId: 'a', channelId: 'c', persona: 'p', verb: 'v', spawnedAt: '2026-05-01T10:00:00Z' });
    m.recordEnd('a', { endedAt: '2026-05-01T10:05:00Z' });
    m.recordSpawn({ shellId: 'b', channelId: 'c', persona: 'p', verb: 'v', spawnedAt: '2026-05-02T10:00:00Z' });
    expect(m.prune('2026-05-02T00:00:00Z')).toBe(1);
    expect(m.size()).toBe(1);
    expect(m.get('a')).toBeNull();
    expect(m.get('b')).not.toBeNull();
  });
});
