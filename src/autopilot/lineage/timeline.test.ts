// Historian 통합 타임라인 — 병합·정렬·렌더 테스트 (H1)
import { describe, expect, it, beforeEach } from 'bun:test';
import { buildLineageTimeline, formatLineageTimeline, summarizeLineage } from './timeline.js';
import { mountLineageSource, resetLineageRegistryForTest } from './registry.js';
import type { LineageEntry, LineageSource } from './types.js';

function fakeSource(kind: LineageSource['kind'], entries: LineageEntry[]): LineageSource {
  return { kind, label: kind, readTimeline: () => entries };
}

describe('buildLineageTimeline — 병합·정렬', () => {
  beforeEach(() => resetLineageRegistryForTest());

  it('여러 소스를 at 오름차순 병합', () => {
    mountLineageSource(fakeSource('build-frames', [{ store: 'build-frames', at: '2026-07-20T10:00:00Z', summary: 'b' }]));
    mountLineageSource(fakeSource('working-memory', [{ store: 'working-memory', at: '2026-07-20T09:00:00Z', summary: 'w' }]));
    const t = buildLineageTimeline('m1');
    expect(t.map((e) => e.summary)).toEqual(['w', 'b']);
  });

  it('at 없는 항목은 뒤로, 같은 at 은 seq 순', () => {
    mountLineageSource(fakeSource('cache', [{ store: 'cache', summary: 'no-at' }]));
    mountLineageSource(fakeSource('exec-frames', [
      { store: 'exec-frames', at: '2026-07-20T10:00:00Z', seq: 2, summary: 's2' },
      { store: 'exec-frames', at: '2026-07-20T10:00:00Z', seq: 1, summary: 's1' },
    ]));
    const t = buildLineageTimeline('m1');
    expect(t.map((e) => e.summary)).toEqual(['s1', 's2', 'no-at']);
  });

  it('소스 예외는 fail-soft(전체 관측 안 막음)', () => {
    mountLineageSource({ kind: 'build-frames', label: 'x', readTimeline: () => { throw new Error('boom'); } });
    mountLineageSource(fakeSource('working-memory', [{ store: 'working-memory', at: '2026-07-20T09:00:00Z', summary: 'ok' }]));
    const t = buildLineageTimeline('m1');
    expect(t.map((e) => e.summary)).toEqual(['ok']);
  });
});

describe('summarizeLineage / formatLineageTimeline', () => {
  beforeEach(() => resetLineageRegistryForTest());

  it('스토어별 카운트', () => {
    const entries: LineageEntry[] = [
      { store: 'build-frames', summary: 'a' },
      { store: 'build-frames', summary: 'b' },
      { store: 'cache', summary: 'c' },
    ];
    const c = summarizeLineage(entries);
    expect(c['build-frames']).toBe(2);
    expect(c.cache).toBe(1);
    expect(c['exec-frames']).toBe(0);
  });

  it('빈 타임라인 — 안내 메시지', () => {
    expect(formatLineageTimeline([])).toContain('이력 없음');
  });

  it('generation 없으면 g? 로 렌더(H4 갭 가시화)', () => {
    const out = formatLineageTimeline([{ store: 'build-frames', at: '2026-07-20T10:00:00Z', summary: 'x' }]);
    expect(out).toContain('g?');
  });

  it('generation 있으면 gN', () => {
    const out = formatLineageTimeline([{ store: 'generation-archive', at: '2026-07-20T10:00:00Z', generation: 2, summary: 'x' }]);
    expect(out).toContain('g2');
  });
});
