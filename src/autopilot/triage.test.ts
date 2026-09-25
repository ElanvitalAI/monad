// Autopilot triage 라우터(P1.1) 단위테스트 — 순수함수(무네트워크).
import { describe, test, expect } from 'bun:test';
import {
  heuristicTriage, detectTier, triageGoal, buildTriagePrompt, parseTriageResponse,
  isExecutionModel, ENGINE_BY_MODEL, EXECUTION_MODELS,
} from './triage.js';

describe('heuristicTriage — 결정론 baseline', () => {
  const cases: Array<[string, string]> = [
    ['삼성전자 급락하면 매매 검토해줘', 'monitor-trigger'],
    ['매일 아침 반도체 뉴스 정리해줘', 'scheduler'],
    ['이 주제 끝까지 파봐', 'goal-loop'],
    ['이 종목에 대해 여러 전문가 관점으로 평가해줘', 'fanout'],
    ['이 변경 배포하되 승인받고 해', 'hitl-delegate'],
    ['포트폴리오 전체를 조율해서 매매해줘', 'coordinator'],
    ['여러 전략을 밸런싱해줘', 'coordinator'],
    ['DXY 가 뭐야?', 'single-shot'],
    ['이 버그 고쳐줘', 'task'],
  ];
  for (const [goal, expected] of cases) {
    test(`"${goal}" → ${expected}`, () => {
      const r = heuristicTriage({ goal });
      expect(r.executionModel).toBe(expected as any);
      expect(r.engine).toBe(ENGINE_BY_MODEL[expected as keyof typeof ENGINE_BY_MODEL]);
      expect(r.rationale.length).toBeGreaterThan(0);
    });
  }

  test('복합 신호(2+) → hybrid', () => {
    const r = heuristicTriage({ goal: '매일 삼성 감시하다 급락하면 검토해줘' });
    expect(r.executionModel).toBe('hybrid');
    expect(r.rationale).toContain('복합');
  });

  test('engine 은 항상 유효한 실행모델에 매핑', () => {
    for (const m of EXECUTION_MODELS) expect(ENGINE_BY_MODEL[m]).toBeTruthy();
  });
});

describe('detectTier — 규모 사이징', () => {
  test('대대적/리팩토링/마이그레이션 → heavy', () => {
    expect(detectTier('intake를 대대적으로 개편해줘')).toBe('heavy');
    expect(detectTier('전체 아키텍처 재설계')).toBe('heavy');
    expect(detectTier('migrate all crontab jobs')).toBe('heavy');
  });
  test('짧은 단일 작업 → light', () => {
    expect(detectTier('이 버그 고쳐줘')).toBe('light');
  });
  test('다문장(4+) → heavy', () => {
    expect(detectTier(
      '데이터를 먼저 수집해줘. 그다음 정제해서 저장해줘. 그리고 리포트를 만들어줘. 마지막으로 텔레그램으로 발송해줘.',
    )).toBe('heavy');
  });
});

describe('parseTriageResponse — LLM 응답 파싱(순수)', () => {
  test('유효 JSON', () => {
    const p = parseTriageResponse('결정: {"executionModel":"goal-loop","tier":"heavy","rationale":"깊은 조사"}');
    expect(p).not.toBeNull();
    expect(p!.executionModel).toBe('goal-loop');
    expect(p!.tier).toBe('heavy');
  });
  test('잘못된 모델 → null', () => {
    expect(parseTriageResponse('{"executionModel":"nonsense","tier":"light"}')).toBeNull();
  });
  test('JSON 없음 → null', () => {
    expect(parseTriageResponse('그냥 텍스트')).toBeNull();
  });
});

describe('triageGoal — LLM refine(ratchet-up only)', () => {
  test('classify 없으면 baseline', async () => {
    const r = await triageGoal({ goal: '이 버그 고쳐줘' });
    expect(r.executionModel).toBe('task');
    expect(r.refined).toBe(false);
  });

  test('LLM 이 더 무거운 모델 제안 → 승격(refined)', async () => {
    const classify = async () => '{"executionModel":"goal-loop","tier":"heavy","rationale":"실은 깊은 조사"}';
    const r = await triageGoal({ goal: '이 주제 조사해줘' }, { classify });
    expect(r.executionModel).toBe('goal-loop');
    expect(r.tier).toBe('heavy');
    expect(r.refined).toBe(true);
  });

  test('LLM 이 더 가벼운 모델 제안 → 무시(ratchet-up only)', async () => {
    // baseline=goal-loop(끝까지). LLM 이 single-shot 제안해도 승격 안 함.
    const classify = async () => '{"executionModel":"single-shot","tier":"light","rationale":"그냥 답"}';
    const r = await triageGoal({ goal: '이 주제 끝까지 파봐' }, { classify });
    expect(r.executionModel).toBe('goal-loop');
    expect(r.refined).toBe(false);
  });

  test('★ tier 승격은 executionModel 승격과 독립 — 키워드-빈약·의미-큰 골(2026-07-16)', async () => {
    // baseline: "협업 에이전트로 강화" → 신호 없음 → task, 키워드 없음 → light.
    // luna 가 tier=heavy 판정하면 model 은 task 유지해도 tier 는 heavy 로 승격돼야 한다(종전 버그).
    const classify = async () => '{"executionModel":"task","tier":"heavy","rationale":"루프 전체를 협업 구조로 재편 — 대규모"}';
    const r = await triageGoal({ goal: '자율 ACT 루프를 협업 에이전트로 강화해줘' }, { classify });
    expect(r.executionModel).toBe('task'); // 모델은 그대로
    expect(r.tier).toBe('heavy');          // ★ tier 만 독립 승격
    expect(r.refined).toBe(true);
  });

  test('휴리스틱 heavy floor — LLM 이 light 제안해도 명백히 큰 골은 heavy 유지', async () => {
    // baseline: "대규모 리팩토링" → 키워드 heavy. LLM 이 light 제안해도 floor 로 heavy.
    const classify = async () => '{"executionModel":"task","tier":"light","rationale":"작아보임"}';
    const r = await triageGoal({ goal: '대규모 리팩토링 해줘' }, { classify });
    expect(r.tier).toBe('heavy');
  });

  test('classify throw → baseline(fail-soft)', async () => {
    const classify = async () => { throw new Error('llm down'); };
    const r = await triageGoal({ goal: '이 버그 고쳐줘' }, { classify });
    expect(r.executionModel).toBe('task');
    expect(r.refined).toBe(false);
  });

  test('LLM 이 coordinator(최상위 무게) 제안 → 승격', async () => {
    // baseline=task(weight 1). LLM 이 coordinator(6) 제안 → ratchet-up 승격.
    const classify = async () => '{"executionModel":"coordinator","tier":"heavy","rationale":"실은 여럿 조율"}';
    const r = await triageGoal({ goal: '이것들 처리해줘' }, { classify });
    expect(r.executionModel).toBe('coordinator');
    expect(r.engine).toBe('orchestrator');
    expect(r.refined).toBe(true);
  });

  test('buildTriagePrompt 은 골+baseline 포함', () => {
    const p = buildTriagePrompt({ goal: '삼성 감시' }, heuristicTriage({ goal: '삼성 감시' }));
    expect(p).toContain('삼성 감시');
    expect(p).toContain('Heuristic baseline');
  });
});

describe('isExecutionModel', () => {
  test('가드', () => {
    expect(isExecutionModel('task')).toBe(true);
    expect(isExecutionModel('nope')).toBe(false);
  });
});
