import { describe, it, expect } from 'bun:test';
import {
  CAPABILITY_CATALOG, capabilitiesForComposition, promotionTargets, capability,
  resolveActiveCapabilities,
} from './capabilities.js';

describe('capabilitiesForComposition — 조합깊이 = 무게 (PLAN §6b)', () => {
  it('agent-mission = 경량(base + enhance·coverage)', () => {
    const c = capabilitiesForComposition('agent-mission');
    expect(c).toContain('memory');
    expect(c).toContain('enhance');
    expect(c).not.toContain('arming');
    expect(c).not.toContain('goal-loop');
  });

  it('self-implement = 중간(+goal-loop·isolation·budget)', () => {
    const c = capabilitiesForComposition('self-implement');
    expect(c).toContain('goal-loop');
    expect(c).toContain('isolation');
    expect(c).toContain('budget');
    expect(c).not.toContain('arming');
  });

  it('mission-fabric = 최대 조합(모든 미션 고유 포함)', () => {
    const c = capabilitiesForComposition('mission-fabric');
    for (const cap of ['arming', 'frame-journal', 'lineage', 'materialize', 'decision', 'critique-grounding'] as const) {
      expect(c).toContain(cap);
    }
    // 최대 조합이 가장 많은 capability 를 가짐
    expect(c.length).toBeGreaterThan(capabilitiesForComposition('agent-mission').length);
    expect(c.length).toBeGreaterThan(capabilitiesForComposition('self-implement').length);
  });

  it('전 조합 공통 base = pty-substrate·memory·observe(entry-independent)', () => {
    for (const kind of ['agent-mission', 'self-implement', 'skill', 'mission-fabric'] as const) {
      const c = capabilitiesForComposition(kind);
      expect(c).toContain('pty-substrate');
      expect(c).toContain('memory');
      expect(c).toContain('observe');
    }
  });
});

describe('카탈로그 무결성', () => {
  it('enhance 만 진입 민감(sensitive)·나머지 independent', () => {
    for (const d of CAPABILITY_CATALOG) {
      if (d.id === 'enhance') expect(d.entry).toBe('sensitive');
      else expect(d.entry).toBe('independent');
    }
  });

  it('promotionTargets = 미션 고유(shared:false) — arming·budget·materialize 등', () => {
    const t = promotionTargets();
    expect(t).toContain('arming');
    expect(t).toContain('budget');
    expect(t).toContain('materialize');
    // 이미 공유는 승격 대상 아님
    expect(t).not.toContain('enhance');
    expect(t).not.toContain('memory');
    expect(t).not.toContain('pty-substrate');
  });

  it('capability(id) 조회', () => {
    expect(capability('memory')?.shared).toBe(true);
    expect(capability('isolation')?.shared).toBe(false);
  });
});

describe('resolveActiveCapabilities — 선언 → behavior 구동(선언 ∩ 진입정책·§6e)', () => {
  it('monad-apparatus 진입 → enhance 활성(정책 기본 ON)', () => {
    const a = resolveActiveCapabilities('skill', { entry: 'monad-apparatus' });
    expect(a.has('enhance')).toBe(true);
    expect(a.has('memory')).toBe(true);   // entry-independent 항상
    expect(a.has('observe')).toBe(true);
  });

  it('external-verbatim 진입 → enhance 비활성(mode-gated OFF)·기억은 유지', () => {
    const a = resolveActiveCapabilities('skill', { entry: 'external-verbatim' });
    expect(a.has('enhance')).toBe(false);   // 진입 민감 게이트
    expect(a.has('memory')).toBe(true);     // entry-independent
    expect(a.has('observe')).toBe(true);
  });

  it('explicitEnhance 가 진입 기본값보다 우선(양방향)', () => {
    expect(resolveActiveCapabilities('skill', { entry: 'monad-apparatus', explicitEnhance: false }).has('enhance')).toBe(false);
    expect(resolveActiveCapabilities('skill', { entry: 'external-verbatim', explicitEnhance: true }).has('enhance')).toBe(true);
  });

  it('선언에 없는 capability 는 활성 집합에도 없음(skill 조합엔 arming 없음)', () => {
    const a = resolveActiveCapabilities('skill', { entry: 'monad-apparatus' });
    expect(a.has('arming')).toBe(false);
    expect(a.has('isolation')).toBe(false);
  });

  it('기본 진입(opts 생략) = monad-apparatus(enhance ON)', () => {
    expect(resolveActiveCapabilities('skill').has('enhance')).toBe(true);
  });
});
