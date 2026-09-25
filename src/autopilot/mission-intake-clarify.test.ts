import { describe, it, expect } from 'bun:test';
import { analyzeGoalAmbiguity, fallbackScopeQuestion, parseArcAnswer, foldAnswersIntoDesign, decideArcAutoproceed, extractExclusionClause } from './mission-intake-clarify.js';
import type { IntakeClarification } from './mission-intake-clarify.js';

const LLM_ONE_SCOPE = '[{"kind":"scope","header":"X","question":"Q","options":[{"label":"a","recommended":true},{"label":"b"}]}]';

describe('parseArcAnswer — 아크 수 파싱(라이브 옵션 라벨 회귀·2026-07-19)', () => {
  it('선두 "N개(추천): …" 옵션 라벨을 파싱(종전 undefined 붕괴 근본수복)', () => {
    // sol 이 옵션 라벨을 "5개(추천): 공통 문서…"처럼 써서 "아크"가 숫자에 인접하지 않던 라이브 버그.
    expect(parseArcAnswer('5개(추천): 공통 문서·어댑터 → YouTube 수집·정규화')).toBe(5);
    expect(parseArcAnswer('6개(세분화): 추천안에서 Obsidian 저장')).toBe(6);
    expect(parseArcAnswer('4개(압축): 공통 기반·수집 → 요약')).toBe(4);
  });
  it('종전 "N개 아크"/"N아크" 형태도 계속 인식(하위호환)', () => {
    expect(parseArcAnswer('5개 아크')).toBe(5);
    expect(parseArcAnswer('3 개 아크로')).toBe(3);
    expect(parseArcAnswer('2아크')).toBe(2);
  });
  it('"자동"/미숫자/과대는 undefined(분해기 위임·오파싱 방지)', () => {
    expect(parseArcAnswer('자동')).toBeUndefined();
    expect(parseArcAnswer('자동(분해기 위임)')).toBeUndefined();
    expect(parseArcAnswer(undefined)).toBeUndefined();
    expect(parseArcAnswer('99개')).toBeUndefined(); // 상한 12 초과
  });
});

describe('decideArcAutoproceed — arc 되묻기 자율 진행(2026-07-21·두 경로 통합 seam·#4855 우회 근본)', () => {
  const arcQ = (recLabel: string, altLabel = '대안'): IntakeClarification => ({
    questionId: 'q1', kind: 'arc', header: '아크', question: '몇 갈래?', blocking: true,
    options: [{ label: recLabel, recommended: true }, { label: altLabel }],
  });
  const scopeQ = (): IntakeClarification => ({
    questionId: 'q1', kind: 'scope', header: '범위', question: 'A/B?', blocking: true,
    options: [{ label: 'A', recommended: true }, { label: 'B' }],
  });

  it('clear single recommendation(arc·추천 1개) → autoproceed + 추천 아크수 채택', () => {
    const d = decideArcAutoproceed([arcQ('3개(추천): 공통·수집·요약')]);
    expect(d.autoproceed).toBe(true);
    expect(d.arcHint).toBe(3);
  });
  it('빈 질문 → autoproceed 아님(카드 없음이지만 채택도 없음)', () => {
    expect(decideArcAutoproceed([]).autoproceed).toBe(false);
  });
  it('추천 0개(애매) → autoproceed 아님(종전대로 카드)', () => {
    const q: IntakeClarification = { questionId: 'q1', kind: 'arc', header: '아크', question: 'Q', blocking: true,
      options: [{ label: '2개' }, { label: '3개' }] };
    expect(decideArcAutoproceed([q]).autoproceed).toBe(false);
  });
  it('추천 복수(애매) → autoproceed 아님', () => {
    const q: IntakeClarification = { questionId: 'q1', kind: 'arc', header: '아크', question: 'Q', blocking: true,
      options: [{ label: '2개', recommended: true }, { label: '3개', recommended: true }] };
    // normalizeOptions 는 첫 추천만 남기지만, 방어적으로 원시 배열이 복수 추천이면 autoproceed 금지.
    expect(decideArcAutoproceed([q]).autoproceed).toBe(false);
  });
  it('scope 질문 섞이면 → autoproceed 아님(경계 바꾸는 애매 질문=HITL 유지)', () => {
    expect(decideArcAutoproceed([arcQ('3개(추천)'), scopeQ()]).autoproceed).toBe(false);
  });
  it('explicitArcHint(CLI --arc-hint) 지정 시 그 값 우선(추천 파싱 대신)', () => {
    const d = decideArcAutoproceed([arcQ('3개(추천)')], 7);
    expect(d.autoproceed).toBe(true);
    expect(d.arcHint).toBe(7);
  });
  it('추천 라벨이 "자동"(숫자 없음) → autoproceed 하되 arcHint 없음(LLM 재량)', () => {
    const d = decideArcAutoproceed([arcQ('자동(분해기 위임)')]);
    expect(d.autoproceed).toBe(true);
    expect(d.arcHint).toBeUndefined();
  });
});

describe('foldAnswersIntoDesign — arcHint append 리듀서(P1 라이브 배선·손실 차단)', () => {
  const arc = (answer: string): IntakeClarification => ({ kind: 'arc', header: '아크', question: 'Q', options: [{ label: answer }], answer } as IntakeClarification);
  it('유효 arc 답 → arcHint 반영', () => {
    expect(foldAnswersIntoDesign('목표', [arc('5개(추천): …')]).arcHint).toBe(5);
  });
  it('★ 유효 답 뒤에 파싱실패(undefined) 답이 와도 유효값 보존(LastValue였다면 소실)', () => {
    const design = foldAnswersIntoDesign('목표', [arc('5개(추천): …'), arc('자동')]);
    expect(design.arcHint).toBe(5); // append 리듀서 — undefined 는 5 를 덮지 않음
  });
  it('모두 파싱실패 → arcHint 없음(undefined)', () => {
    expect(foldAnswersIntoDesign('목표', [arc('자동')]).arcHint).toBeUndefined();
  });
});

describe('extractExclusionClause — 에코 UX 수복(제외 절만·전체 복제 금지)', () => {
  it('"A까지 다루고, 유사 레거시는 후속" → 제외 절만("유사 레거시는 후속")', () => {
    expect(extractExclusionClause('원미션 경로와 직접 호출자·관련 문서까지만 다루고, 유사 레거시는 후속')).toBe('유사 레거시는 후속');
  });
  it('제외 절 없는 단일 범위 서술 → 빈 문자열(제외 라인 미표시)', () => {
    expect(extractExclusionClause('저장소 전체의 콘텐츠 URL·YouTube·Knowledge 인입 레거시')).toBe('');
  });
  it('"·"(목록 구분자)는 절 경계 아님 — 안 쪼갬', () => {
    // "직접 호출자·관련 문서" 가 "·" 로 쪼개지면 안 됨(콤마만 절 경계).
    expect(extractExclusionClause('직접 호출자·관련 문서까지')).toBe('');
  });
});

describe('foldAnswersIntoDesign — scope 에코(범위=제외 중복 근절)', () => {
  const scope = (answer: string): IntakeClarification => ({ kind: 'scope', header: '정리 범위', question: 'Q', options: [{ label: answer }], answer } as IntakeClarification);
  it('★ 인라인 "~는 후속" 답변 → excluded 가 전체 복제 아니라 제외 절만(범위≠제외)', () => {
    const d = foldAnswersIntoDesign('목표', [scope('원미션 경로까지만 다루고, 유사 레거시는 후속')]);
    expect(d.scope).toEqual(['정리 범위: 원미션 경로까지만 다루고, 유사 레거시는 후속']);
    expect(d.excluded).toEqual(['정리 범위: 유사 레거시는 후속']); // 전체 복제(종전 결함) 아님
  });
  it('제외 절 없는 범위 → excluded 빈 배열(제외 라인 미표시)', () => {
    const d = foldAnswersIntoDesign('목표', [scope('저장소 전체 레거시')]);
    expect(d.excluded).toEqual([]);
  });
});

describe('A — clarify 2단계 범위 fallback(opt-in·대표 결정 "스킵+MAX2" 2026-07-18)', () => {
  it('heavy + scope + LLM 0개 + 기본(skip) → fallback 안 함(0개·arc 직행 왕복 최소화)', async () => {
    const qs = await analyzeGoalAmbiguity('컨텐츠 흡수 미션', { phase: 'scope', heavy: true }, { judge: async () => '[]' });
    expect(qs).toHaveLength(0);
  });

  it('heavy + scope + LLM 0개 + forceScopeFallback → fallback 범위 질문 1개(종전 2단계 보장 복귀)', async () => {
    const qs = await analyzeGoalAmbiguity('컨텐츠 흡수 미션', { phase: 'scope', heavy: true, forceScopeFallback: true }, { judge: async () => '[]' });
    expect(qs).toHaveLength(1);
    expect(qs[0]!.kind).toBe('scope');
    expect(qs[0]!.header).toBe('완료 범위');
  });

  it('heavy + scope + LLM 질문 있으면 fallback 안 함(LLM 것 우선)', async () => {
    const qs = await analyzeGoalAmbiguity('골', { phase: 'scope', heavy: true }, { judge: async () => LLM_ONE_SCOPE });
    expect(qs).toHaveLength(1);
    expect(qs[0]!.header).toBe('X');
  });

  it('ClarificationPolicy intake budget으로 첫 질문만 ask하고 나머지는 defer한다', async () => {
    const raw = '[{"kind":"scope","header":"X","question":"Q1","options":[{"label":"a","recommended":true},{"label":"b"}]},{"kind":"scope","header":"Y","question":"Q2","options":[{"label":"c","recommended":true},{"label":"d"}]}]';
    const qs = await analyzeGoalAmbiguity('골', { phase: 'scope', heavy: true }, { judge: async () => raw });
    expect(qs).toHaveLength(1);
    expect(qs[0]!.question).toBe('Q1');
  });

  it('non-heavy + scope 0개 → fallback 안 함(억지 질문 마찰 없음)', async () => {
    const qs = await analyzeGoalAmbiguity('골', { phase: 'scope', heavy: false }, { judge: async () => '[]' });
    expect(qs).toHaveLength(0);
  });

  it('arc phase 0개 → fallback 안 함(범위만 강제·아크는 LLM 판단)', async () => {
    const qs = await analyzeGoalAmbiguity('골', { phase: 'arc', heavy: true }, { judge: async () => '[]' });
    expect(qs).toHaveLength(0);
  });

  it('fallbackScopeQuestion — blocking scope·추천 옵션·순수', () => {
    const q = fallbackScopeQuestion();
    expect(q.kind).toBe('scope');
    expect(q.blocking).toBe(true);
    expect(q.options.length).toBe(3);
    expect(q.options.some((o) => o.recommended)).toBe(true);
  });
});
