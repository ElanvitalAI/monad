// 기억 생애주기 오케스트레이터 단위테스트 — 순서·fail-soft·집계(단계 주입).
import { describe, test, expect } from 'bun:test';
import { runMemoryLifecycle, summarizeLifecycle } from './memory-lifecycle.js';

const okStages = () => ({
  replay: () => ({ candidates: 20, strengthened: 12, themes: ['finance'] }),
  decay: () => ({ hot: 10, warm: 5, cold: 3, changed: 2 }),
  rif: () => ({ clusters: 2, suppressed: 3 }),
  recaps: () => ({ sessions: 2, promoted: 2 }),
  consolidate: async () => ({ groups: 1, consolidated: 6, skipped: 0 }),
  archive: () => ({ archived: 3, skipped: 1 }),
  pruneEvents: () => 4,
  pruneKnowledge: () => 1,
});

describe('runMemoryLifecycle', () => {
  test('전 단계 성공 → 집계·오류 없음', async () => {
    const r = await runMemoryLifecycle(okStages());
    expect(r.decay?.changed).toBe(2);
    expect(r.recaps?.promoted).toBe(2);
    expect(r.consolidate?.consolidated).toBe(6);
    expect(r.archive?.archived).toBe(3);
    expect(r.prunedEvents).toBe(4);
    expect(r.prunedKnowledge).toBe(1);
    expect(r.errors).toEqual([]);
  });

  test('한 단계 throw → 그 단계 null·나머지 진행·오류 기록(fail-soft)', async () => {
    const s = okStages();
    s.archive = () => { throw new Error('S3 down'); };
    const r = await runMemoryLifecycle(s);
    expect(r.archive).toBeNull();
    expect(r.prunedEvents).toBe(4); // archive 실패해도 prune 진행
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.stage).toBe('archive');
    expect(r.errors[0]!.error).toContain('S3 down');
  });

  test('실행 순서 = decay→recaps→consolidate→archive→prune', async () => {
    const order: string[] = [];
    await runMemoryLifecycle({
      replay: () => { order.push('replay'); return { candidates: 0, strengthened: 0, themes: [] }; },
      decay: () => { order.push('decay'); return { hot: 0, warm: 0, cold: 0, changed: 0 }; },
      rif: () => { order.push('rif'); return { clusters: 0, suppressed: 0 }; },
      recaps: () => { order.push('recaps'); return { sessions: 0, promoted: 0 }; },
      consolidate: async () => { order.push('consolidate'); return { groups: 0, consolidated: 0, skipped: 0 }; },
      archive: () => { order.push('archive'); return { archived: 0, skipped: 0 }; },
      pruneEvents: () => { order.push('prune-events'); return 0; },
      pruneKnowledge: () => { order.push('prune-knowledge'); return 0; },
    });
    expect(order).toEqual(['replay', 'decay', 'rif', 'recaps', 'consolidate', 'archive', 'prune-events', 'prune-knowledge']);
  });
});

describe('summarizeLifecycle', () => {
  test('사람이 읽는 요약', async () => {
    const r = await runMemoryLifecycle(okStages());
    const s = summarizeLifecycle(r);
    expect(s).toContain('recap(세션2→2)');
    expect(s).toContain('archive(S3 3');
    expect(s).not.toContain('오류');
  });
  test('변화 없음', async () => {
    const s = summarizeLifecycle({ replay: null, decay: null, rif: null, recaps: null, consolidate: null, archive: null, prunedEvents: null, prunedKnowledge: null, errors: [] });
    expect(s).toBe('변화 없음');
  });
});
