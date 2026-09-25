import { describe, expect, test } from 'bun:test';
import { AX_QUESTIONS, axVerdict, stateForModel, type AxAnswers, type AxTask } from './ax-screen.js';

const A = (o: Partial<Record<keyof AxAnswers, number>> = {}): AxAnswers => ({
  repetition: { score: o.repetition ?? 3 },
  closed_set: { noul: o.closed_set ?? 0.9 },
  extraction: { noul: o.extraction ?? 0.1 },
  reversible: { noul: o.reversible ?? 0.8 },
});
const T = (p: Partial<AxTask> = {}): AxTask => ({ id: 'X', 업무: '어떤 일', 현재판단: 'human-judgment', ...p });

describe('ax-screen — ⛔ 실물 스크리닝에서 데인 자리를 문다', () => {
  test('안전 축이 «맨 앞»이다 — 급여 이체에 「생성형」이라는 틀린 사유를 붙이지 않는다', () => {
    const v = axVerdict(T({ 업무: '급여 이체 실행' }), A({ reversible: 0.25, closed_set: 0.16 }));
    expect(v.tier).toBe('⚠️ 경고로만');
    expect(v.why).toContain('되돌리기 어렵다');
    expect(v.why).not.toContain('생성형');     // ⛔ 첫 판이 붙였던 «틀린» 사유
  });

  test('🆕 「추출」 업무를 살린다 — 닫힘이 낮아도 탈락시키지 않는다', () => {
    // 발주 메일 → ERP 등록: 첫 판은 closed 0.17 로 «제외»했다
    const v = axVerdict(T({ 업무: '발주 메일을 읽고 ERP 에 등록' }), A({ closed_set: 0.17, extraction: 0.9, repetition: 3 }));
    expect(v.tier).not.toBe('제외');
    expect(v.kind).toBe('추출');
  });

  test('판정도 추출도 아니면 제외한다', () => {
    expect(axVerdict(T(), A({ closed_set: 0.05, extraction: 0.05 })).tier).toBe('제외');
  });

  test('⭐ 「현재판단」이 비면 «순위를 안 매긴다» — 모른다를 「사람의 감」으로 접지 않는다', () => {
    const v = axVerdict({ id: 'X', 업무: '알람 확인' }, A());
    expect(v.tier).toBe('⛔ 못 잰다');
    expect(v.why).toContain('인터뷰');
  });

  test('규칙이 확실하면 제외한다 — if 문이 낫다', () => {
    expect(axVerdict(T({ 현재판단: 'documented-rules' }), A()).tier).toBe('제외');
  });

  test('이미 시스템이 하면 제외한다', () => {
    expect(axVerdict(T({ 현재판단: 'system-automated' }), A()).tier).toBe('제외');
  });

  test('반복이 적으면 분모가 없다', () => {
    expect(axVerdict(T(), A({ repetition: 0.5 })).tier).toBe('제외');
  });

  test('반복 × 닫힘이 등급을 정한다 — ⛔ 모델이 아니라 «코드»가', () => {
    expect(axVerdict(T(), A({ repetition: 4, closed_set: 0.95 })).tier).toBe('1순위');
    expect(axVerdict(T(), A({ repetition: 2, closed_set: 0.9 })).tier).toBe('2순위');
    expect(axVerdict(T(), A({ repetition: 1.6, closed_set: 0.6 })).tier).toBe('후보');
  });

  test('⛔ 「지금 무엇으로 하나」를 모델에게 «묻지 않는다» — 표현에 따라 뒤집히기 때문', () => {
    expect(Object.keys(AX_QUESTIONS)).toEqual(['repetition', 'closed_set', 'extraction', 'reversible']);
    expect(Object.keys(AX_QUESTIONS)).not.toContain('current_method');
  });

  test('반복 물음이 «추측하지 마라»를 명시한다', () => {
    expect(AX_QUESTIONS.repetition!.instructions).toContain('추측하지 마라');
  });
});

describe('stateForModel — ⛔ 모델이 «정답»을 보면 그 측정은 무효다', () => {
  test('_ 와 정답_ 으로 시작하는 칸을 «전부» 뺀다', () => {
    const t = {
      id: 'T01', 업무: '어떤 일', 부서: '영업', 비고: '월 100건', 현재판단: 'human-judgment',
      _설명: '이 줄은 예시다', _정답칸: '사람이 채운다',
      정답_자동화가능: true, 정답_이유: '반복이 많다', 정답_채운사람: '홍길동',
    } as unknown as AxTask;
    const sent = stateForModel(t);
    expect(Object.keys(sent).sort()).toEqual(['id', '부서', '비고', '업무', '현재판단'].sort());
    const json = JSON.stringify(sent);
    expect(json).not.toContain('정답');
    expect(json).not.toContain('홍길동');
    expect(json).not.toContain('예시');
  });

  test('정답 칸이 없는 평범한 업무는 그대로 간다', () => {
    const t = { id: 'T02', 업무: 'x', 현재판단: 'human-judgment' } as AxTask;
    expect(stateForModel(t)).toEqual({ id: 'T02', 업무: 'x', 현재판단: 'human-judgment' });
  });
});
