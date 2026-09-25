import { describe, expect, test } from 'bun:test';
import {
  runMemoryLifecycle,
  summarizeLifecycle,
  type MemoryLifecycleStages,
} from '../src/domains/memory-lifecycle.js';

function stages(overrides: Partial<MemoryLifecycleStages> = {}): MemoryLifecycleStages {
  return {
    replay: () => ({ candidates: 3, strengthened: 2, themes: ['memory'] }),
    decay: () => ({ hot: 1, warm: 2, cold: 3, changed: 4 }),
    rif: () => ({ clusters: 1, suppressed: 0 }),
    recaps: () => ({ sessions: 2, promoted: 2 }),
    consolidate: async () => ({ groups: 1, consolidated: 5, skipped: 0 }),
    archive: () => ({ archived: 3, skipped: 0 }),
    pruneEvents: () => 7,
    pruneKnowledge: () => 11,
    ...overrides,
  };
}

describe('memory lifecycle orchestration', () => {
  test('runs decay → session promotion → semantic consolidation → archive → raw pruning', async () => {
    const order: string[] = [];
    const report = await runMemoryLifecycle(stages({
      replay: () => { order.push('replay'); return { candidates: 3, strengthened: 2, themes: ['memory'] }; },
      decay: () => { order.push('decay'); return { hot: 1, warm: 2, cold: 3, changed: 4 }; },
      rif: () => { order.push('rif'); return { clusters: 1, suppressed: 0 }; },
      recaps: () => { order.push('recaps'); return { sessions: 2, promoted: 2 }; },
      consolidate: async () => { order.push('consolidate'); return { groups: 1, consolidated: 5, skipped: 0 }; },
      archive: () => { order.push('archive'); return { archived: 3, skipped: 0 }; },
      pruneEvents: () => { order.push('pruneEvents'); return 7; },
      pruneKnowledge: () => { order.push('pruneKnowledge'); return 11; },
    }));

    expect(order).toEqual([
      'replay',
      'decay',
      'rif',
      'recaps',
      'consolidate',
      'archive',
      'pruneEvents',
      'pruneKnowledge',
    ]);
    expect(report.decay?.changed).toBe(4);
    expect(report.recaps?.promoted).toBe(2);
    expect(report.consolidate?.consolidated).toBe(5);
    expect(report.archive?.archived).toBe(3);
    expect(report.prunedEvents).toBe(7);
    expect(report.prunedKnowledge).toBe(11);
    expect(report.errors).toEqual([]);
  });

  test('is fail-soft: a broken stage is reported and later stages still run', async () => {
    const order: string[] = [];
    const report = await runMemoryLifecycle(stages({
      replay: () => { order.push('replay'); return { candidates: 3, strengthened: 2, themes: ['memory'] }; },
      decay: () => { order.push('decay'); throw new Error('decay unavailable'); },
      rif: () => { order.push('rif'); return { clusters: 1, suppressed: 0 }; },
      recaps: () => { order.push('recaps'); return { sessions: 1, promoted: 1 }; },
      consolidate: async () => { order.push('consolidate'); throw new Error('summarizer timeout'); },
      archive: () => { order.push('archive'); return { archived: 1, skipped: 0 }; },
      pruneEvents: () => { order.push('pruneEvents'); return 0; },
      pruneKnowledge: () => { order.push('pruneKnowledge'); return 0; },
    }));

    expect(order).toEqual([
      'replay',
      'decay',
      'rif',
      'recaps',
      'consolidate',
      'archive',
      'pruneEvents',
      'pruneKnowledge',
    ]);
    expect(report.decay).toBeNull();
    expect(report.recaps?.promoted).toBe(1);
    expect(report.consolidate).toBeNull();
    expect(report.archive?.archived).toBe(1);
    expect(report.errors.map((entry) => entry.stage)).toEqual(['decay', 'consolidate']);
    expect(summarizeLifecycle(report)).toContain('⚠️오류2(decay,consolidate)');
  });
});
