import { describe, it, expect } from 'bun:test';
import {
  detectConcerns, gradePhaseGranularity, gradeDecompositionGranularity, formatGranularityForHitl,
  gradeArcConformance, gradePhaseCompletability, SIZE_THRESHOLDS,
  type GranularityInput, type CompletabilityInput,
} from './mission-phase-granularity.js';

function ph(p: Partial<GranularityInput>): GranularityInput {
  return { id: 'x', title: 't', prompt: 'p', acceptance: [], ...p };
}

describe('detectConcerns (순수)', () => {
  it('여러 관심사 클래스 감지', () => {
    expect(detectConcerns('복수 지표 국면과 관측 품질을 계산하라').sort()).toEqual(['compute', 'verify']);
    expect(detectConcerns('기존 재사용 지점을 한정 조사하라')).toContain('investigate');
  });
});

describe('gradePhaseGranularity', () => {
  it('★ 관심사 3+ 여도 too_large 아님(과대 게이트 제거·플랜 경량·2026-07-19)', () => {
    const g = gradePhaseGranularity(ph({ title: '타입 정의하고 배선 구현하고 회귀 테스트하라' }));
    expect(g.verdict).not.toBe('too_large'); // 굵은 페이즈는 의도적 — 과대 오탐 제거
    expect(g.skillCount).toBeGreaterThanOrEqual(3); // 메트릭은 계속 계산(관측용)
  });

  it('★ acceptance 과다(≥7)도 too_large 아님(과대 게이트 제거)', () => {
    const g = gradePhaseGranularity(ph({ title: '계산하라', acceptance: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }));
    expect(g.verdict).not.toBe('too_large');
  });

  it('단일 관심사·acceptance≤1·짧은 지시 = too_small', () => {
    const g = gradePhaseGranularity(ph({ title: '타입 정의', prompt: '짧음', acceptance: [] }));
    expect(g.verdict).toBe('too_small');
  });

  it('적정 = ok', () => {
    const g = gradePhaseGranularity(ph({ title: '읽기 전용 스냅샷을 배선하라', prompt: 'x'.repeat(200), acceptance: ['스냅샷 반영', '테스트 통과'] }));
    expect(g.verdict).toBe('ok');
  });
});

describe('gradeDecompositionGranularity + format', () => {
  it('★ 굵은 페이즈도 tooLarge 비어있음(과대 게이트 제거·노이즈 소거)', () => {
    const r = gradeDecompositionGranularity([
      ph({ id: 'big', title: '조사하고 설계하고 구현하고 검증하라' }),
      ph({ id: 'ok', title: '스냅샷 배선', prompt: 'x'.repeat(200), acceptance: ['a', 'b'] }),
    ]);
    expect(r.tooLarge.length).toBe(0); // 과대 오탐 제거 — split 노이즈 없음
    // too_small 도 없으면 카드는 빈 문자열(노이즈 소거)
    expect(formatGranularityForHitl(r)).toBe('');
  });

  it('전부 적정이면 빈 카드', () => {
    const r = gradeDecompositionGranularity([ph({ title: '스냅샷 배선', prompt: 'x'.repeat(200), acceptance: ['a', 'b'] })]);
    expect(formatGranularityForHitl(r)).toBe('');
  });
});

describe('gradePhaseCompletability — P0 통합 SSOT 크기 판정', () => {
  const cp = (p: Partial<CompletabilityInput>): CompletabilityInput => ({ id: 'x', title: 't', prompt: 'p', acceptance: [], ...p });

  it('적정 텍스트(규모신호 없음) = ok', () => {
    const g = gradePhaseCompletability(cp({ title: '읽기 전용 스냅샷을 배선하라', prompt: 'x'.repeat(200), acceptance: ['스냅샷 반영', '테스트 통과'] }));
    expect(g.verdict).toBe('ok');
    expect(g.completabilityScore).toBe(1);
  });

  it('★ 무회귀 가드(2026-07-19) — 굵은 조사/구현 페이즈(concerns≥3, 결합·acceptance 과다 없음) = ok(too_large 아님)', () => {
    const g = gradePhaseCompletability(cp({ title: '조사하고 설계하고 구현하고 검증하라', prompt: 'x'.repeat(300), acceptance: ['a', 'b'] }));
    expect(g.concerns.length).toBeGreaterThanOrEqual(3); // 메트릭은 계산
    expect(g.verdict).not.toBe('too_large');             // 텍스트 단독으론 안 찍음(오탐 근원 제거)
  });

  it('corroboration — concerns≥3 AND acceptance≥6 = too_large', () => {
    const g = gradePhaseCompletability(cp({ title: '조사 설계 구현 검증', acceptance: ['a', 'b', 'c', 'd', 'e', 'f'] }));
    expect(g.concerns.length).toBeGreaterThanOrEqual(3);
    expect(g.verdict).toBe('too_large');
    expect(g.oversizeFactors.length).toBeGreaterThan(0);
  });

  it('corroboration — concerns≥3 AND 제목 결합(및) = too_large', () => {
    const g = gradePhaseCompletability(cp({ title: '조사 및 설계 및 구현', prompt: '검증도 하라' }));
    expect(g.conjunctions).toBeGreaterThanOrEqual(1);
    expect(g.verdict).toBe('too_large');
  });

  it('실행근거 크기신호 files≥5 = 텍스트 적정이어도 too_large(지상진실 단독)', () => {
    const g = gradePhaseCompletability(cp({ title: '스냅샷 배선', prompt: 'x'.repeat(200), acceptance: ['a', 'b'], sizeSignals: { files: SIZE_THRESHOLDS.filesOversize } }));
    expect(g.verdict).toBe('too_large');
    expect(g.sizeSignals.files).toBe(5);
    expect(g.completabilityScore).toBeLessThan(1);
  });

  it('실행근거 크기신호 est>500 LOC = too_large', () => {
    const g = gradePhaseCompletability(cp({ title: '스냅샷 배선', prompt: 'x'.repeat(200), acceptance: ['a', 'b'], sizeSignals: { est: 600 } }));
    expect(g.verdict).toBe('too_large');
  });

  it('과소 — 단일 관심사·acceptance≤1·짧은 지시 = too_small', () => {
    const g = gradePhaseCompletability(cp({ title: '타입 정의', prompt: '짧음', acceptance: [] }));
    expect(g.verdict).toBe('too_small');
  });

  it('과소여도 실제 크기신호(files≥5) 있으면 too_small 제외', () => {
    const g = gradePhaseCompletability(cp({ title: '타입 정의', prompt: '짧음', acceptance: [], sizeSignals: { files: 6 } }));
    expect(g.verdict).toBe('too_large');
  });

  it('completabilityScore 단조 — 클수록 낮고 [0,1] 유지', () => {
    const small = gradePhaseCompletability(cp({ title: '배선', prompt: 'x'.repeat(200), acceptance: ['a', 'b'] }));
    const big = gradePhaseCompletability(cp({ title: '배선', prompt: 'x'.repeat(200), acceptance: ['a', 'b'], sizeSignals: { files: 20 } }));
    expect(big.completabilityScore).toBeLessThan(small.completabilityScore);
    expect(big.completabilityScore).toBeGreaterThanOrEqual(0);
    expect(small.completabilityScore).toBeLessThanOrEqual(1);
  });
});

describe('gradeArcConformance — P2 아크 정합(5아크→5페이즈 붕괴 탐지)', () => {
  it('5아크인데 5페이즈 → 아크 붕괴 판정', () => {
    const r = gradeArcConformance(5, 5)!;
    expect(r.conforms).toBe(false);
    expect(r.expectedMin).toBe(20);
    expect(r.expectedMax).toBe(25);
    expect(r.note).toContain('아크 붕괴');
  });
  it('5아크에 22페이즈 → 정합 OK', () => {
    const r = gradeArcConformance(22, 5)!;
    expect(r.conforms).toBe(true);
    expect(r.note).toContain('아크 정합 OK');
  });
  it('관대한 하한(arcHint×3) — 5아크에 15페이즈는 통과', () => {
    expect(gradeArcConformance(15, 5)!.conforms).toBe(true);
    expect(gradeArcConformance(14, 5)!.conforms).toBe(false);
  });
  it('1아크/미지정은 정합 무의미 → null', () => {
    expect(gradeArcConformance(5, 1)).toBeNull();
    expect(gradeArcConformance(5, NaN)).toBeNull();
  });
});
