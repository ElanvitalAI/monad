import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  contentFromAnswers,
  createAskUserElicitationHandler,
  planElicitationQuestions,
  questionFromSchemaProperty,
} from '../src/acp/codex-elicitation-ask.js';
import type { AskUserQuestionDispatchResult } from '../src/ask-user-question/tool.js';

/** ⛔⭐⭐⭐ E-트랙. 2026-08-21 전수 실측: `setElicitationHandler` 의 프로덕션 호출자가 «0» 이라
 *  monad 는 코덱스의 물음을 ***구조적으로 전부 거절***하고 있었다. 사람에게 묻는 기계는 이미
 *  끝까지 있었고 끊긴 것은 배선 한 줄이었다 — 또 「있는데 그 경로가 안 쓴다」였다. */

describe('elicitation schema → 고를 수 있는 물음', () => {
  it('enum 은 그대로 선택지가 되고, 자유 입력은 꺼진다', () => {
    const planned = questionFromSchemaProperty('region', { enum: ['seoul', 'tokyo'], description: 'Pick a region' });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.question).toMatchObject({ id: 'region', question: 'Pick a region', includeOther: false });
    expect(planned.question.options.map((option) => option.label)).toEqual(['seoul', 'tokyo']);
  });

  it('수·불리언 enum 도 유효한 스키마다 — 문자열만 받으면 멀쩡한 물음을 거절한다', () => {
    // ⛔📏 무인 리뷰 must-fix(2026-08-21): 초판이 문자열 enum 만 받아 수 enum 을 거절했다.
    const planned = questionFromSchemaProperty('count', { enum: [1, 2, 3] });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.question.options.map((option) => option.label)).toEqual(['1', '2', '3']);
    // ⭐ 되돌릴 값은 «원본»이다 — 라벨은 표시용일 뿐이다.
    expect(planned.valueByLabel).toEqual({ 1: 1, 2: 2, 3: 3 });
  });

  it('선택지가 넷을 넘으면 «조용히 자르지» 않고 거절한다', () => {
    // ⛔📏 무인 리뷰 must-fix: 초판은 앞 넷만 실어 «고를 수 없는 값»을 만들었다.
    const planned = questionFromSchemaProperty('region', { enum: ['a', 'b', 'c', 'd', 'e'] });
    expect(planned).toEqual({ ok: false, reason: 'too-many-options' });
  });

  it('라벨로 못 만드는 enum 값(객체·null)은 거절한다', () => {
    expect(questionFromSchemaProperty('x', { enum: [{ a: 1 }, 'b'] })).toEqual({ ok: false, reason: 'unmappable-property' });
    expect(questionFromSchemaProperty('x', { enum: [null, 'b'] })).toEqual({ ok: false, reason: 'unmappable-property' });
  });

  it('불리언은 되돌릴 수 있는 라벨 둘이 된다 — 번역하면 왕복이 깨진다', () => {
    const planned = questionFromSchemaProperty('confirm', { type: 'boolean' });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.question.options.map((option) => option.label)).toEqual(['true', 'false']);
    expect(planned.question.includeOther).toBe(false);
    expect(planned.valueByLabel).toEqual({ true: true, false: false });
  });

  it('자유 문자열·수는 «고르기»가 아니라 물음이 안 된다', () => {
    expect(questionFromSchemaProperty('name', { type: 'string' })).toEqual({ ok: false, reason: 'unmappable-property' });
    expect(questionFromSchemaProperty('count', { type: 'number' })).toEqual({ ok: false, reason: 'unmappable-property' });
    expect(questionFromSchemaProperty('one', { enum: ['only'] })).toEqual({ ok: false, reason: 'unmappable-property' });
  });
});

describe('물음 계획 — 못 고르면 «전체»를 거절한다', () => {
  it('스키마가 없거나 속성이 없으면 이유를 이름으로 낸다', () => {
    expect(planElicitationQuestions(undefined).declineReason).toBe('no-schema');
    expect(planElicitationQuestions({}).declineReason).toBe('no-properties');
    expect(planElicitationQuestions({ properties: {} }).declineReason).toBe('no-properties');
  });

  it('한 속성이라도 못 고르면 부분 답을 만들지 않는다', () => {
    const plan = planElicitationQuestions({ properties: { ok: { enum: ['a', 'b'] }, free: { type: 'string' } } });
    expect(plan.declineReason).toBe('unmappable-property');
    expect(plan.request).toBeUndefined();
  });

  it('AskUserQuestion 의 상한(3)을 넘으면 거절한다', () => {
    const properties = Object.fromEntries(['a', 'b', 'c', 'd'].map((name) => [name, { type: 'boolean' }]));
    expect(planElicitationQuestions({ properties }).declineReason).toBe('too-many-properties');
  });

  it('상대가 준 안내문을 첫 물음 앞에 붙인다 — 버리면 사람이 맥락 없이 고른다', () => {
    const plan = planElicitationQuestions({ properties: { confirm: { type: 'boolean' } } }, 'Deploy to production?');
    expect(plan.request?.questions[0]?.question).toContain('Deploy to production?');
    expect(plan.valueByLabel).toEqual({ confirm: { true: true, false: false } });
  });
});

describe('답 → content — ⛔ 답을 «검증»한다', () => {
  const map = { confirm: { true: true, false: false }, region: { seoul: 'seoul', tokyo: 'tokyo' } };

  it('라벨을 스키마의 원본 값으로 되돌린다', () => {
    expect(contentFromAnswers({ confirm: 'true', region: 'seoul' }, map))
      .toEqual({ ok: true, content: { confirm: true, region: 'seoul' } });
  });

  it('🚨 다중 선택은 «첫 값으로 접지» 않고 거절한다 — 무엇을 뜻했는지 우리가 모른다', () => {
    // ⛔📏 무인 리뷰 must-fix(2026-08-21): 초판은 첫 값을 임의로 채택하고 «그 동작을 시험으로 정당화»했다.
    //   그것이 이 파일이 막겠다던 「조용한 오답 진행」 그 자체다.
    expect(contentFromAnswers({ region: ['seoul', 'tokyo'] }, { region: map.region }))
      .toEqual({ ok: false, reason: 'answer-off-schema' });
    expect(contentFromAnswers({ region: [] }, { region: map.region }))
      .toEqual({ ok: false, reason: 'answer-missing' });
    // ⭐ 하나만 고른 배열은 «한 값»이라 그대로 받는다.
    expect(contentFromAnswers({ region: ['seoul'] }, { region: map.region }))
      .toEqual({ ok: true, content: { region: 'seoul' } });
  });

  it('🚨 라벨이 겹치는 enum 은 되돌릴 수 없으므로 물음이 안 된다', () => {
    // ⛔📏  은 서로 «다른 JSON 값»인데 표시 라벨이 같다 ⇒ 사용자의 선택을 다른 값으로 보낸다.
    expect(questionFromSchemaProperty('x', { enum: [1, '1'] })).toEqual({ ok: false, reason: 'ambiguous-labels' });
    expect(questionFromSchemaProperty('x', { enum: [true, 'true'] })).toEqual({ ok: false, reason: 'ambiguous-labels' });
  });

  it('🚨 스키마에 없는 답(자유 입력 등)은 accept 로 «새지» 않는다', () => {
    // ⛔📏 무인 리뷰 must-fix(2026-08-21): 초판은 이것을 그대로 실어 보냈다.
    expect(contentFromAnswers({ region: 'busan' }, { region: map.region })).toEqual({ ok: false, reason: 'answer-off-schema' });
    expect(contentFromAnswers({ region: 'seoul', extra: 'x' }, { region: map.region })).toEqual({ ok: false, reason: 'answer-off-schema' });
  });

  it('물은 속성이 빠진 답은 부분 답으로 넘기지 않는다', () => {
    expect(contentFromAnswers({ confirm: 'true' }, map)).toEqual({ ok: false, reason: 'answer-missing' });
  });
});

describe('핸들러 — 배선', () => {
  const schema = { properties: { confirm: { type: 'boolean' } } };

  function handler(dispatched: AskUserQuestionDispatchResult, seen: Record<string, unknown>[] = []) {
    return createAskUserElicitationHandler({
      dispatch: async (raw) => { seen.push(raw); return dispatched; },
      observe: () => {},
    });
  }

  it('사람이 답하면 accept 로 되돌린다', async () => {
    const seen: Record<string, unknown>[] = [];
    const answer = await handler({ output: 'ok', result: { answers: { confirm: 'true' }, answeredBy: 'human' } }, seen)(
      { server: 's', message: 'Proceed?', schema },
    );
    expect(answer).toEqual({ action: 'accept', content: { confirm: true } });
    // ⭐ 물음이 실제로 그 기계로 «갔나» — 이 축의 결함이 배선 부재였으므로 이것이 핵심이다.
    expect(seen).toHaveLength(1);
    expect((seen[0] as { questions: { id: string }[] }).questions.map((q) => q.id)).toEqual(['confirm']);
  });

  it('답할 표면이 없으면 «사람이 거절한 것»과 다른 값으로 거절한다', async () => {
    const reasons: string[] = [];
    const decline = createAskUserElicitationHandler({
      dispatch: async () => ({ output: 'none', absenceReason: 'no-delivery-resolver' }),
      observe: (_event, data) => { reasons.push(String(data.reason)); },
    });
    expect(await decline({ server: 's', schema })).toEqual({ action: 'decline' });
    expect(reasons).toEqual(['no-answer-surface']);
  });

  it('사람이 취소하면 취소로 남는다', async () => {
    const reasons: string[] = [];
    const cancel = createAskUserElicitationHandler({
      dispatch: async () => ({ output: 'x', result: { answers: {}, cancelled: true } }),
      observe: (_event, data) => { reasons.push(String(data.reason)); },
    });
    expect(await cancel({ server: 's', schema })).toEqual({ action: 'decline' });
    expect(reasons).toEqual(['cancelled']);
  });

  it('그 기계가 던져도 코덱스 턴을 죽이지 않는다', async () => {
    const thrown = createAskUserElicitationHandler({
      dispatch: async () => { throw new Error('surface exploded'); },
      observe: () => {},
    });
    expect(await thrown({ server: 's', schema })).toEqual({ action: 'decline' });
  });

  it('못 고르는 스키마는 그 기계를 «부르지도» 않는다', async () => {
    let called = 0;
    const skip = createAskUserElicitationHandler({
      dispatch: async () => { called++; return { output: '' }; },
      observe: () => {},
    });
    expect(await skip({ server: 's', schema: { properties: { name: { type: 'string' } } } })).toEqual({ action: 'decline' });
    expect(called).toBe(0);
  });
});

describe('배선이 프로덕션 조립 지점에 «있다»', () => {
  it('agent-manager 가 코덱스 에이전트를 세울 때 이 핸들러를 건넨다', () => {
    // ⛔ 이 축의 결함은 로직이 아니라 «부르는 자리가 없음»이었다. 그래서 그 자리를 문다.
    //   ⚠️ 소스 문면으로 무는 것은 약한 시험이다 — 다만 조립 지점은 데몬을 띄워야 도는 자리라
    //   이 스위트에서 «실행»으로는 못 문다. 그 한계를 여기 이름으로 적어 둔다.
    const source = readFileSync(resolve(import.meta.dir, '../src/acp/agent-manager.ts'), 'utf8');
    expect(source).toContain('createAskUserElicitationHandler');
    expect(source.indexOf('createAskUserElicitationHandler(')).toBeGreaterThan(source.indexOf('new CodexAppServerAgent('));
  });
});
