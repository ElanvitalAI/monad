// 미션 중복 체크 게이트 — 기존 미션/태스크 비교(주입 compare seam).
import { describe, it, expect } from 'bun:test';
import { TaskStore } from '../task-orchestrator/store.js';
import { createMission } from './mission-registry.js';
import { checkMissionOverlap, parseOverlaps, type CatalogItem } from './mission-dedup.js';

function memStore(): TaskStore { return new TaskStore({ path: ':memory:' }); }

describe('parseOverlaps', () => {
  it('fence/prose 관대 파싱·잘못된 항목 필터', () => {
    expect(parseOverlaps('```json\n{"overlaps":[{"id":"m1","overlap":"o","consolidation":"c"}]}\n```')).toEqual([{ id: 'm1', overlap: 'o', consolidation: 'c' }]);
    expect(parseOverlaps('{"overlaps":[{"nope":1}]}')).toEqual([]);
    expect(parseOverlaps('없음')).toEqual([]);
  });
});

describe('checkMissionOverlap', () => {
  it('기존 미션 없음 → 중복 없음', async () => {
    const store = memStore();
    try {
      const m = createMission(store, { goal: '새 미션', source: 'human-intent', triage: { executionModel: 'task', tier: 'light', engine: 'tox' } });
      const r = await checkMissionOverlap(m.id, { store, compare: async () => { throw new Error('비교 호출되면 안 됨'); } });
      expect(r.ok).toBe(true);
      expect(r.overlaps.length).toBe(0);
      expect(r.comparedCount).toBe(0);
    } finally { store.close(); }
  });

  it('기존 미션과 겹침 → overlaps + 통합안', async () => {
    const store = memStore();
    try {
      const existing = createMission(store, { goal: 'persistence 마이그레이션 구현', source: 'human-intent', triage: { executionModel: 'task', tier: 'heavy', engine: 'tox' } });
      const neu = createMission(store, { goal: 'persistence 스키마 버전 마이그레이션', source: 'human-intent', triage: { executionModel: 'task', tier: 'heavy', engine: 'tox' } });
      const seen: CatalogItem[] = [];
      const r = await checkMissionOverlap(neu.id, {
        store,
        compare: async (_goal, catalog) => { seen.push(...catalog); return [{ id: existing.id, overlap: '동일 persistence 마이그레이션', consolidation: '기존 미션에 병합' }]; },
      });
      expect(r.ok).toBe(true);
      expect(r.overlaps.length).toBe(1);
      expect(r.overlaps[0]!.id).toBe(existing.id);
      expect(r.overlaps[0]!.kind).toBe('mission');
      expect(r.overlaps[0]!.consolidation).toContain('병합');
      // 카탈로그에 기존 미션이 자신 제외하고 포함됐다.
      expect(seen.some((c) => c.id === existing.id)).toBe(true);
      expect(seen.some((c) => c.id === neu.id)).toBe(false);
    } finally { store.close(); }
  });

  it('비교 실패 → fail-soft(미션 안 막음)', async () => {
    const store = memStore();
    try {
      createMission(store, { goal: '기존', source: 'human-intent', triage: { executionModel: 'task', tier: 'light', engine: 'tox' } });
      const neu = createMission(store, { goal: '새것', source: 'human-intent', triage: { executionModel: 'task', tier: 'light', engine: 'tox' } });
      const r = await checkMissionOverlap(neu.id, { store, compare: async () => { throw new Error('LLM 다운'); } });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('LLM');
    } finally { store.close(); }
  });
});
