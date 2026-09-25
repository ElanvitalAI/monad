import { describe, it, expect } from 'bun:test';
import {
  decideBaselineReuse, formatBaselineSection,
  type BaselineReuseSignals, type BaselineFingerprint, type DecompBaseline,
} from './mission-decompose-baseline.js';

const FP: BaselineFingerprint = { goalHash: 'g1', groundingFilesSha: 's1', at: '2026-07-21T00:00:00Z' };

/** 재사용 성립 기본 신호(모든 조건 통과). 개별 무효화 트리거는 override 로 뒤집는다. */
const okSignals = (over: Partial<BaselineReuseSignals> = {}): BaselineReuseSignals => ({
  enabled: true,
  hasReviseContext: true,
  redesign: false,
  fresh: false,
  baselinePhaseCount: 4,
  fingerprint: FP,
  currentGoalHash: 'g1',
  currentGroundingFilesSha: 's1',
  ...over,
});

describe('decideBaselineReuse (순수·대표 최우선=invalidate 놓치지 말 것)', () => {
  it('모든 조건 통과 → reuse=true', () => {
    const d = decideBaselineReuse(okSignals());
    expect(d.reuse).toBe(true);
  });

  it('(config OFF) enabled=false → 재사용 안 함(무회귀 기본)', () => {
    expect(decideBaselineReuse(okSignals({ enabled: false })).reuse).toBe(false);
  });

  it('revise 맥락 아님(신규/일방 분해) → 재사용 안 함', () => {
    expect(decideBaselineReuse(okSignals({ hasReviseContext: false })).reuse).toBe(false);
  });

  it('(a) redesign=전제 전환 → 폐기', () => {
    const d = decideBaselineReuse(okSignals({ redesign: true }));
    expect(d.reuse).toBe(false);
    expect(d.reason).toContain('redesign');
  });

  it('(c) fresh=진짜 리셋 → 폐기', () => {
    const d = decideBaselineReuse(okSignals({ fresh: true }));
    expect(d.reuse).toBe(false);
    expect(d.reason).toContain('fresh');
  });

  it('(d) 이전 분해 없음(phaseCount 0) → 폐기', () => {
    expect(decideBaselineReuse(okSignals({ baselinePhaseCount: 0 })).reuse).toBe(false);
  });

  it('지문 없음(첫 분해) → 폐기(안전)', () => {
    expect(decideBaselineReuse(okSignals({ fingerprint: null })).reuse).toBe(false);
  });

  it('(b) 골 텍스트/범위 변경(goalHash 불일치·maturity-split) → 폐기', () => {
    const d = decideBaselineReuse(okSignals({ currentGoalHash: 'g2' }));
    expect(d.reuse).toBe(false);
    expect(d.reason).toContain('goal-changed');
  });

  it('(e) grounded 파일 SHA 변경 → 폐기(전제 무효·기존 grounding invalidate 신호 존중)', () => {
    const d = decideBaselineReuse(okSignals({ currentGroundingFilesSha: 's2' }));
    expect(d.reuse).toBe(false);
    expect(d.reason).toContain('grounding-sha-changed');
  });

  it('grounded 파일 SHA 빈값(git 실패) → 폐기(안전)', () => {
    expect(decideBaselineReuse(okSignals({ currentGroundingFilesSha: '' })).reuse).toBe(false);
  });
});

describe('formatBaselineSection (순수)', () => {
  const baseline: DecompBaseline = {
    arcs: [
      { name: '관측 계약', intent: '관측을 남긴다', phaseTitles: ['로그 추가', '조회 CLI'], verdict: 'founded', action: 'keep' },
      { name: '허상 아크', phaseTitles: ['없는 파일 수정'], verdict: 'mirage', reason: '대상 파일이 실제로 없음', action: 'narrow' },
    ],
    phases: [],
    phaseCount: 3,
  };

  it('아크·페이즈·verdict 를 렌더하고 증분 지시를 포함한다', () => {
    const s = formatBaselineSection(baseline);
    expect(s).toContain('이전 분해');
    expect(s).toContain('관측 계약');
    expect(s).toContain('로그 추가');
    expect(s).toContain('증분 수정');
  });

  it('mirage/over_scope 아크는 "전제 교정 필수"를 명시(답습 방지)', () => {
    const s = formatBaselineSection(baseline);
    expect(s).toContain('mirage');
    expect(s).toContain('대상 파일이 실제로 없음');
    expect(s).toContain('반드시 교정');
  });

  it('아크 없으면 flat 페이즈로 폴백', () => {
    const flat: DecompBaseline = { arcs: [], phases: [{ title: '단일 페이즈', acceptance: ['검증1'] }], phaseCount: 1 };
    const s = formatBaselineSection(flat);
    expect(s).toContain('단일 페이즈');
    expect(s).toContain('검증1');
  });

  it('maxChars 상한으로 축약(토큰 폭증 방지)', () => {
    const big: DecompBaseline = { arcs: [], phases: Array.from({ length: 200 }, (_, i) => ({ title: `페이즈 ${i} 아주아주 긴 제목 텍스트`, acceptance: [] })), phaseCount: 200 };
    const s = formatBaselineSection(big, 500);
    expect(s.length).toBeLessThanOrEqual(500 + 20);
    expect(s).toContain('축약');
  });
});
