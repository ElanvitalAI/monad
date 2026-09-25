// build-context seed(3-pillar RFC·research/ground→RUN 이관) — 순수 헬퍼 검증 (2026-07-19)
import { test, expect, describe } from 'bun:test';
import { buildContextSeedEntry, type EnrichLike, type GroundLike } from '../src/autopilot/mission-build-orchestrate.js';

const enrich = (o: Partial<EnrichLike> = {}): EnrichLike => ({ researched: false, enrichments: [], corrections: [], needReason: '', ...o });
const ground = (o: Partial<GroundLike> = {}): GroundLike => ({ grounded: false, context: '', files: [], ...o });

describe('buildContextSeedEntry — BUILD 조사 문맥 → RUN 이관 엔트리', () => {
  test('research + ground 모두 → provenance=build 엔트리(재참조용)', () => {
    const seed = buildContextSeedEntry(
      enrich({ researched: true, enrichments: ['외부발견A'], corrections: ['교정B'] }),
      ground({ grounded: true, context: '내부 컨텍스트', files: ['src/x.ts', 'src/y.ts'] }),
    );
    expect(seed).not.toBeNull();
    expect(seed!.provenance).toBe('build');
    expect(seed!.phaseId).toBe('build:context');
    expect(seed!.summary).toContain('내부 grounding: 내부 컨텍스트');
    expect(seed!.summary).toContain('외부조사 보강: 외부발견A');
    expect(seed!.summary).toContain('교정: 교정B');
    expect(seed!.reusables).toEqual(['src/x.ts', 'src/y.ts']); // 내부 소스=재사용 경계(se-bridge·wmBlock read)
  });

  test('ground 만(내부소스만) → 엔트리', () => {
    const seed = buildContextSeedEntry(enrich(), ground({ grounded: true, files: ['src/a.ts'] }));
    expect(seed).not.toBeNull();
    expect(seed!.reusables).toEqual(['src/a.ts']);
  });

  test('research 만(외부조사만) → 엔트리', () => {
    const seed = buildContextSeedEntry(enrich({ researched: true, enrichments: ['E'] }), ground());
    expect(seed).not.toBeNull();
    expect(seed!.summary).toContain('외부조사 보강: E');
  });

  test('조사·grounding 둘 다 없으면 null(무주입)', () => {
    expect(buildContextSeedEntry(enrich(), ground())).toBeNull();
    // researched=true 지만 내용 0 → null(빈 이관 방지)
    expect(buildContextSeedEntry(enrich({ researched: true }), ground({ grounded: true, context: '   ' }))).toBeNull();
  });

  test('reusables(내부 파일) 상한 20', () => {
    const files = Array.from({ length: 30 }, (_, i) => `src/f${i}.ts`);
    const seed = buildContextSeedEntry(enrich(), ground({ grounded: true, files }));
    expect(seed!.reusables.length).toBe(20);
  });
});
