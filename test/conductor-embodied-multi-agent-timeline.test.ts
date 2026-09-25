// ── M3 (Phase 4 Bundle 4 hero) — embodied-multi-agent-timeline tests ──

import { describe, expect, test } from 'bun:test';
import {
  createEmbodiedTimeline,
  replayTimeline,
} from '../src/conductor/embodied-multi-agent-timeline';

describe('createEmbodiedTimeline — append + list', () => {
  test('append + list roundtrip', () => {
    const t = createEmbodiedTimeline();
    const id = t.append({
      kind: 'shell-spawn',
      actor: 'alice',
      shellId: 'sh-1',
      payload: { command: 'pwd' },
    });
    expect(typeof id).toBe('string');
    expect(t.list()).toHaveLength(1);
    expect(t.list()[0]!.shellId).toBe('sh-1');
  });

  test('id auto-generated unique when omitted', () => {
    const t = createEmbodiedTimeline();
    const id1 = t.append({ kind: 'note', actor: 'a', payload: {} });
    const id2 = t.append({ kind: 'note', actor: 'a', payload: {} });
    expect(id1).not.toBe(id2);
  });

  test('id preserved when provided', () => {
    const t = createEmbodiedTimeline();
    const id = t.append({ id: 'custom-id', kind: 'note', actor: 'a', payload: {} });
    expect(id).toBe('custom-id');
    expect(t.list()[0]!.id).toBe('custom-id');
  });

  test('chronological ordering preserved', () => {
    let t = 1000;
    const tl = createEmbodiedTimeline({ now: () => (t += 100) });
    tl.append({ kind: 'shell-spawn', actor: 'a', payload: {} });
    tl.append({ kind: 'voice-utterance', actor: 'monad', payload: {} });
    tl.append({ kind: 'shell-end', actor: 'a', payload: {} });
    const list = tl.list();
    expect(list[0]!.atMs).toBeLessThan(list[1]!.atMs);
    expect(list[1]!.atMs).toBeLessThan(list[2]!.atMs);
  });

  test('cap evicts oldest', () => {
    const t = createEmbodiedTimeline({ cap: 3 });
    for (let i = 0; i < 5; i += 1) {
      t.append({ kind: 'note', actor: 'a', payload: { n: i } });
    }
    expect(t.size()).toBe(3);
    expect(t.list()[0]!.payload['n']).toBe(2);
  });
});

describe('createEmbodiedTimeline — list filters', () => {
  function seed() {
    const t = createEmbodiedTimeline();
    t.append({ kind: 'shell-spawn', actor: 'alice', channelId: 'ch-dev', shellId: 'sh-1', payload: {} });
    t.append({ kind: 'voice-utterance', actor: 'monad', channelId: 'ch-dev', payload: {} });
    t.append({ kind: 'debate-round', actor: 'codex', channelId: 'ch-prod', payload: {} });
    t.append({ kind: 'shell-end', actor: 'alice', shellId: 'sh-1', channelId: 'ch-dev', payload: {} });
    t.append({ kind: 'hitl-prompt', actor: 'monad', channelId: 'ch-dev', payload: {} });
    return t;
  }

  test('kinds filter', () => {
    const t = seed();
    expect(t.list({ kinds: ['shell-spawn', 'shell-end'] })).toHaveLength(2);
  });

  test('actor filter', () => {
    const t = seed();
    expect(t.list({ actor: 'alice' })).toHaveLength(2);
  });

  test('channelId filter', () => {
    const t = seed();
    expect(t.list({ channelId: 'ch-dev' })).toHaveLength(4);
  });

  test('shellId filter', () => {
    const t = seed();
    expect(t.list({ shellId: 'sh-1' })).toHaveLength(2);
  });

  test('combined filter', () => {
    const t = seed();
    const out = t.list({ actor: 'alice', kinds: ['shell-spawn'] });
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('shell-spawn');
  });

  test('limit caps result', () => {
    const t = seed();
    expect(t.list({ limit: 2 })).toHaveLength(2);
  });
});

describe('createEmbodiedTimeline — summary + groupBy', () => {
  test('summary counts per kind + actor', () => {
    let nowMs = 1000;
    const t = createEmbodiedTimeline({ now: () => nowMs });
    t.append({ kind: 'shell-spawn', actor: 'alice', payload: {} });
    nowMs = 1500;
    t.append({ kind: 'shell-end', actor: 'alice', payload: {} });
    nowMs = 1800;
    t.append({ kind: 'shell-spawn', actor: 'bob', payload: {} });
    const s = t.summary();
    expect(s.totalEntries).toBe(3);
    expect(s.perKind['shell-spawn']).toBe(2);
    expect(s.perKind['shell-end']).toBe(1);
    expect(s.perActor['alice']).toBe(2);
    expect(s.perActor['bob']).toBe(1);
    expect(s.durationMs).toBeGreaterThanOrEqual(800);
  });

  test('groupByActor', () => {
    const t = createEmbodiedTimeline();
    t.append({ kind: 'shell-spawn', actor: 'alice', payload: {} });
    t.append({ kind: 'shell-spawn', actor: 'bob', payload: {} });
    t.append({ kind: 'shell-end', actor: 'alice', payload: {} });
    const grouped = t.groupByActor();
    expect(grouped['alice']).toHaveLength(2);
    expect(grouped['bob']).toHaveLength(1);
  });

  test('groupByKind', () => {
    const t = createEmbodiedTimeline();
    t.append({ kind: 'voice-utterance', actor: 'monad', payload: {} });
    t.append({ kind: 'voice-utterance', actor: 'monad', payload: {} });
    t.append({ kind: 'capture-frame', actor: 'monad', payload: {} });
    const grouped = t.groupByKind();
    expect(grouped['voice-utterance']).toHaveLength(2);
    expect(grouped['capture-frame']).toHaveLength(1);
    expect(grouped['shell-spawn']).toHaveLength(0);
  });
});

describe('createEmbodiedTimeline — finish', () => {
  test('finish returns summary with endedAt', () => {
    const t = createEmbodiedTimeline();
    t.append({ kind: 'note', actor: 'a', payload: {} });
    const s = t.finish();
    expect(s.endedAt).toBeTruthy();
    expect(s.totalEntries).toBe(1);
  });

  test('post-finish appends ignored', () => {
    const t = createEmbodiedTimeline();
    t.append({ kind: 'note', actor: 'a', payload: {} });
    t.finish();
    t.append({ kind: 'note', actor: 'b', payload: {} });
    expect(t.size()).toBe(1);
  });

  test('finish idempotent', () => {
    const t = createEmbodiedTimeline();
    t.append({ kind: 'note', actor: 'a', payload: {} });
    const a = t.finish();
    const b = t.finish();
    expect(a).toEqual(b);
  });
});

describe('createEmbodiedTimeline — relatesTo cross-link', () => {
  test('hitl-answer references hitl-prompt', () => {
    const t = createEmbodiedTimeline();
    const promptId = t.append({ kind: 'hitl-prompt', actor: 'monad', payload: { question: 'q' } });
    t.append({
      kind: 'hitl-answer',
      actor: 'user',
      payload: { decision: 'apply' },
      relatesTo: promptId,
    });
    const answers = t.list({ kinds: ['hitl-answer'] });
    expect(answers[0]!.relatesTo).toBe(promptId);
  });
});

describe('replayTimeline', () => {
  test('replays entries in order', async () => {
    const t = createEmbodiedTimeline();
    t.append({ kind: 'note', actor: 'a', payload: { n: 1 } });
    t.append({ kind: 'note', actor: 'a', payload: { n: 2 } });
    t.append({ kind: 'note', actor: 'a', payload: { n: 3 } });

    const seen: number[] = [];
    await replayTimeline(t.list(), {
      onEntry: (e) => { seen.push(e.payload['n'] as number); },
    }, { speed: 0 });
    expect(seen).toEqual([1, 2, 3]);
  });

  test('respects speed=0 (no delay)', async () => {
    const t = createEmbodiedTimeline();
    let nowMs = 1000;
    const tl = createEmbodiedTimeline({ now: () => (nowMs += 1000) });
    tl.append({ kind: 'note', actor: 'a', payload: {} });
    tl.append({ kind: 'note', actor: 'a', payload: {} });
    let delayCount = 0;
    await replayTimeline(tl.list(), {
      onEntry: () => {},
    }, {
      speed: 0,
      delay: async () => { delayCount += 1; },
    });
    expect(delayCount).toBe(0);
  });

  test('respects speed=1 (realtime delay)', async () => {
    let nowMs = 0;
    const tl = createEmbodiedTimeline({ now: () => (nowMs += 100) });
    tl.append({ kind: 'note', actor: 'a', payload: {} });
    tl.append({ kind: 'note', actor: 'a', payload: {} });
    let totalDelay = 0;
    await replayTimeline(tl.list(), { onEntry: () => {} }, {
      speed: 1,
      delay: async (ms) => { totalDelay += ms; },
    });
    // First entry: no wait (lastMs == entry.atMs).
    // Second entry: 100ms (atMs diff) at speed 1 → 100ms delay.
    expect(totalDelay).toBe(100);
  });

  test('fromMs filters early entries', async () => {
    let nowMs = 0;
    const tl = createEmbodiedTimeline({ now: () => (nowMs += 50) });
    tl.append({ kind: 'note', actor: 'a', payload: { n: 1 } });
    tl.append({ kind: 'note', actor: 'a', payload: { n: 2 } });
    tl.append({ kind: 'note', actor: 'a', payload: { n: 3 } });

    const seen: number[] = [];
    await replayTimeline(tl.list(), {
      onEntry: (e) => { seen.push(e.payload['n'] as number); },
    }, { speed: 0, fromMs: 75 });
    // entries at 50, 100, 150 → fromMs=75 filters out 50.
    expect(seen).toEqual([2, 3]);
  });

  test('signal abort halts playback', async () => {
    const tl = createEmbodiedTimeline();
    tl.append({ kind: 'note', actor: 'a', payload: { n: 1 } });
    tl.append({ kind: 'note', actor: 'a', payload: { n: 2 } });
    tl.append({ kind: 'note', actor: 'a', payload: { n: 3 } });

    const ctrl = new AbortController();
    const seen: number[] = [];
    await replayTimeline(tl.list(), {
      onEntry: (e) => {
        seen.push(e.payload['n'] as number);
        if (seen.length === 2) ctrl.abort();
      },
    }, { speed: 0, signal: ctrl.signal });
    expect(seen).toEqual([1, 2]);
  });

  test('onProgress fired per entry', async () => {
    const tl = createEmbodiedTimeline();
    tl.append({ kind: 'note', actor: 'a', payload: {} });
    tl.append({ kind: 'note', actor: 'a', payload: {} });
    const progress: number[] = [];
    await replayTimeline(tl.list(), {
      onEntry: () => {},
      onProgress: (current) => { progress.push(current); },
    }, { speed: 0 });
    expect(progress).toHaveLength(2);
  });

  test('onComplete fired at end', async () => {
    const tl = createEmbodiedTimeline();
    tl.append({ kind: 'note', actor: 'a', payload: {} });
    let completed = false;
    await replayTimeline(tl.list(), {
      onEntry: () => {},
      onComplete: () => { completed = true; },
    }, { speed: 0 });
    expect(completed).toBe(true);
  });
});
