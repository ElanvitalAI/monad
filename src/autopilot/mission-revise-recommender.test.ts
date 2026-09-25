import { describe, it, expect } from 'bun:test';
import {
  heuristicReviseRecommendation,
  buildRevisePrompt,
  parseReviseResponse,
  recommendRevise,
  isReviseKind,
  reviseKindLabel,
  type ReviseObservation,
} from './mission-revise-recommender.js';

const emptyObs = (over: Partial<ReviseObservation> = {}): ReviseObservation => ({
  currentGeneration: 0,
  priorGoals: [],
  workingMemoryDigest: '',
  executionContext: '',
  driftCount: 0,
  ...over,
});

describe('heuristicReviseRecommendation', () => {
  it('사용자 맥락(범위축소 키워드) -> revise-scope, 사용자 문구를 comment 로 보존', () => {
    const r = heuristicReviseRecommendation(emptyObs({ userContext: 'X 기능은 제외하고 재분해해줘' }));
    expect(r.shouldRevise).toBe(true);
    expect(r.reviseKind).toBe('revise-scope');
    expect(r.comment).toBe('X 기능은 제외하고 재분해해줘'); // raw 보존(LLM 없을 때 현행 동작 degrade)
    expect(r.confidence).toBe('high');
    expect(r.source).toBe('heuristic');
  });

  it('사용자 맥락(간소화) -> revise-simpler', () => {
    expect(heuristicReviseRecommendation(emptyObs({ userContext: '너무 복잡해 통합해서 단순하게' })).reviseKind).toBe('revise-simpler');
  });

  it('사용자 맥락(세분화) -> revise-smaller', () => {
    expect(heuristicReviseRecommendation(emptyObs({ userContext: '페이즈를 더 잘게 쪼개줘' })).reviseKind).toBe('revise-smaller');
  });

  it('프리셋에 안 맞는 자유 맥락 -> revise-custom (med·raw comment)', () => {
    const r = heuristicReviseRecommendation(emptyObs({ userContext: '투자 도메인 대신 코딩 도메인으로 바꿔' }));
    expect(r.reviseKind).toBe('revise-custom');
    expect(r.comment).toBe('투자 도메인 대신 코딩 도메인으로 바꿔');
    expect(r.confidence).toBe('med');
  });

  it('사용자 맥락 없고 실패 페이즈 있으면 -> revise-scope(med)', () => {
    const r = heuristicReviseRecommendation(emptyObs({ executionContext: '- "급락 리플레이": 최대 예산 실패' }));
    expect(r.shouldRevise).toBe(true);
    expect(r.reviseKind).toBe('revise-scope');
    expect(r.confidence).toBe('med');
  });

  it('근거 전무 -> shouldRevise=false', () => {
    const r = heuristicReviseRecommendation(emptyObs());
    expect(r.shouldRevise).toBe(false);
    expect(r.comment).toBe('');
  });

  it('공백만 있는 userContext 는 무시', () => {
    expect(heuristicReviseRecommendation(emptyObs({ userContext: '   ' })).shouldRevise).toBe(false);
  });
});

describe('buildRevisePrompt', () => {
  it('관측 요소를 프롬프트에 담고 형식 지시를 포함', () => {
    const obs = emptyObs({
      goal: '가격 가드 구현', currentGeneration: 2,
      priorGoals: ['원본 골', 'gen1 골'],
      userContext: '급락 리플레이는 빼줘',
      executionContext: '- "급락 리플레이": 재사용 위반',
      driftCount: 1,
    });
    const p = buildRevisePrompt(obs, heuristicReviseRecommendation(obs));
    expect(p).toContain('가격 가드 구현');
    expect(p).toContain('급락 리플레이는 빼줘');
    expect(p).toContain('재사용 위반');
    expect(p).toContain('drift 1건');
    expect(p).toContain('REVISE:');
    expect(p).toContain('KIND:');
    expect(p).toContain('COMMENT:');
  });

  it('ASCII 구두점만 사용(en-dash/em-dash 금지)', () => {
    const p = buildRevisePrompt(emptyObs({ goal: 'g' }), heuristicReviseRecommendation(emptyObs({ goal: 'g' })));
    expect(p).not.toContain('–'); // en-dash
    expect(p).not.toContain('—'); // em-dash
  });
});

describe('parseReviseResponse', () => {
  const fb = heuristicReviseRecommendation(emptyObs({ userContext: 'fallback 맥락' }));

  it('정상 응답 파싱', () => {
    const text = [
      'REVISE: yes',
      'KIND: revise-scope',
      'COMMENT: 급락 리플레이 페이즈를 제외하고 나머지로 재분해하라',
      'CONFIDENCE: high',
      'WHY: 재사용 위반 반복으로 하드 피처 제외가 근본',
    ].join('\n');
    const r = parseReviseResponse(text, fb);
    expect(r.shouldRevise).toBe(true);
    expect(r.reviseKind).toBe('revise-scope');
    expect(r.comment).toBe('급락 리플레이 페이즈를 제외하고 나머지로 재분해하라');
    expect(r.confidence).toBe('high');
    expect(r.source).toBe('llm');
  });

  it('REVISE no 면 comment 비움', () => {
    const r = parseReviseResponse('REVISE: no\nKIND: revise-custom\nWHY: 아직 정정 불필요', fb);
    expect(r.shouldRevise).toBe(false);
    expect(r.comment).toBe('');
  });

  it('무효 KIND 는 fallback kind 유지', () => {
    const r = parseReviseResponse('REVISE: yes\nKIND: revise-bogus\nCOMMENT: x', fb);
    expect(r.reviseKind).toBe(fb.reviseKind);
  });

  it('완전 파싱 실패(형식 없음) 는 fallback 유지', () => {
    const r = parseReviseResponse('음 잘 모르겠어요', fb);
    expect(r.shouldRevise).toBe(fb.shouldRevise);
    expect(r.reviseKind).toBe(fb.reviseKind);
  });

  it('COMMENT 없고 프리셋 kind 면 기본 지시로 폴백', () => {
    const r = parseReviseResponse('REVISE: yes\nKIND: revise-simpler\nCONFIDENCE: med', fb);
    expect(r.comment).toContain('간소화');
  });
});

describe('recommendRevise (오케스트레이터·DI)', () => {
  it('classify 미주입 -> 결정론 baseline', async () => {
    const observation = emptyObs({ userContext: '범위 줄여줘' });
    const { recommendation } = await recommendRevise('apm_x', {}, { observation });
    expect(recommendation.source).toBe('heuristic');
    expect(recommendation.reviseKind).toBe('revise-scope');
  });

  it('classify 주입 -> LLM 정련 반영', async () => {
    const observation = emptyObs({ userContext: '범위 줄여줘', goal: 'g' });
    const classify = async () => 'REVISE: yes\nKIND: revise-scope\nCOMMENT: A,B 제외\nCONFIDENCE: high\nWHY: 근거';
    const { recommendation } = await recommendRevise('apm_x', {}, { observation, classify });
    expect(recommendation.source).toBe('llm');
    expect(recommendation.comment).toBe('A,B 제외');
  });

  it('classify 예외 -> baseline 으로 fail-soft', async () => {
    const observation = emptyObs({ userContext: '범위 줄여줘' });
    const classify = async () => { throw new Error('llm down'); };
    const { recommendation } = await recommendRevise('apm_x', {}, { observation, classify });
    expect(recommendation.source).toBe('heuristic');
  });

  it('gather DI seam 으로 디스크 무접촉 관측 주입', async () => {
    const { recommendation, observation } = await recommendRevise('apm_x', { userContext: '단순화' }, {
      gather: {
        getRevisions: () => ({ currentGeneration: 1, currentGoal: 'goal', history: [] }),
        readMemory: () => [],
        execContext: () => '',
      },
    });
    expect(observation.goal).toBe('goal');
    expect(observation.currentGeneration).toBe(1);
    expect(recommendation.reviseKind).toBe('revise-simpler');
  });
});

describe('kind helpers', () => {
  it('isReviseKind 검증', () => {
    expect(isReviseKind('revise-scope')).toBe(true);
    expect(isReviseKind('nope')).toBe(false);
  });
  it('reviseKindLabel', () => {
    expect(reviseKindLabel('revise-scope')).toBe('범위축소');
  });
});
