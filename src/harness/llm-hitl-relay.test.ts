// 트랙 HITL 완주 — LLM 자율 relay 테스트. ask 는 fake. X3(부작용 fail-closed)·question 옵션 택1·fail-soft.
import { test, expect, describe } from 'bun:test';
import { buildLlmHitlRelay, extractJsonObject } from './llm-hitl-relay.js';
import type { AskUserQuestionRequest } from '../ask-user-question/types.js';

const q = (id: string, opts: string[]): AskUserQuestionRequest => ({
  questions: [{ id, header: 'h', question: `${id}?`, options: opts.map((label) => ({ label, description: label })) }],
});

describe('buildLlmHitlRelay — confirm (X3 규율)', () => {
  test('저위험 confirm — LLM yes → 승인', async () => {
    const r = buildLlmHitlRelay({ ask: async () => 'yes', observe: () => {} });
    expect(await r.confirm({ prompt: '계속 진행할까요?' })).toBe(true);
  });

  test('저위험 confirm — LLM no → 거부', async () => {
    const r = buildLlmHitlRelay({ ask: async () => 'no, 위험함', observe: () => {} });
    expect(await r.confirm({ prompt: '계속?' })).toBe(false);
  });

  test('⚠️ 부작용(apply/배포/집행) confirm → 기본 fail-closed(LLM 안 물음)', async () => {
    let asked = false;
    const r = buildLlmHitlRelay({ ask: async () => { asked = true; return 'yes'; }, observe: () => {} });
    expect(await r.confirm({ prompt: '변경을 실 위치에 apply 할까요?', detail: 'in-place 덮어쓰기' })).toBe(false);
    expect(await r.confirm({ prompt: '이 주문을 집행할까요?' })).toBe(false);
    expect(await r.confirm({ prompt: '이 draft PR 을 열까요?' })).toBe(false);
    expect(asked).toBe(false);   // 부작용은 PR-open을 포함해 LLM 판단조차 안 함(명시 승인 필요)
  });

  test('approveSideEffects=true 면 부작용도 LLM 판단', async () => {
    const r = buildLlmHitlRelay({ ask: async () => 'yes', approveSideEffects: true, observe: () => {} });
    expect(await r.confirm({ prompt: 'apply 할까요?' })).toBe(true);
  });

  test('LLM 실패 → fail-closed(false)', async () => {
    const r = buildLlmHitlRelay({ ask: async () => { throw new Error('llm down'); }, observe: () => {} });
    expect(await r.confirm({ prompt: '저위험 확인' })).toBe(false);
  });
});

describe('buildLlmHitlRelay — question', () => {
  test('맥락이 없거나 비어 있으면 종전 질문 프롬프트를 글자 하나까지 보존', async () => {
    const prompts: string[] = [];
    const ask = async (prompt: string) => { prompts.push(prompt); return '{"mode":"safe"}'; };
    const request = q('mode', ['safe', 'aggressive']);
    await buildLlmHitlRelay({ ask, observe: () => {} }).question(request);
    await buildLlmHitlRelay({ context: '   ', ask, observe: () => {} }).question(request);
    const expected = '자율 실행 중 아래 질문에 목표 맥락에 맞게 답하라. 각 질문마다 제시된 옵션 라벨 중 하나를 골라 JSON 으로만 답하라(다른 텍스트 금지): {"질문id":"고른 라벨"}\n\n[mode] mode?\n  옵션: safe | aggressive';
    expect(prompts).toEqual([expected, expected]);
  });

  test('작업 맥락을 질문 목록 앞에 싣는다', async () => {
    let prompt = '';
    const r = buildLlmHitlRelay({ context: '현재 인증 오류를 수정한다.', ask: async (value) => { prompt = value; return '{"mode":"safe"}'; }, observe: () => {} });
    await r.question(q('mode', ['safe', 'aggressive']));
    expect(prompt).toContain('작업 맥락:\n현재 인증 오류를 수정한다.\n\n자율 실행 중 아래 질문');
    expect(prompt.indexOf('현재 인증 오류를 수정한다.')).toBeLessThan(prompt.indexOf('[mode] mode?'));
  });

  test('2000자 맥락은 그대로 싣고 2001자 맥락은 앞 2000자와 잘림 안내만 싣는다', async () => {
    const prompts: string[] = [];
    const ask = async (prompt: string) => { prompts.push(prompt); return '{"mode":"safe"}'; };
    await buildLlmHitlRelay({ context: 'a'.repeat(2000), ask, observe: () => {} }).question(q('mode', ['safe']));
    await buildLlmHitlRelay({ context: `${'b'.repeat(2000)}c`, ask, observe: () => {} }).question(q('mode', ['safe']));
    expect(prompts[0]).toContain(`작업 맥락:\n${'a'.repeat(2000)}\n\n`);
    expect(prompts[0]).not.toContain('잘렸습니다');
    expect(prompts[1]).toContain(`작업 맥락:\n${'b'.repeat(2000)}\n[작업 맥락이 2000자로 잘렸습니다.]`);
    expect(prompts[1]).not.toContain(`${'b'.repeat(2000)}c`);
  });

  test('LLM 이 고른 옵션 라벨 채택과 에이전트 응답 표시', async () => {
    const r = buildLlmHitlRelay({ ask: async () => '{"mode":"safe"}', observe: () => {} });
    const res = await r.question(q('mode', ['safe', 'aggressive']));
    expect(res).toEqual({ answers: { mode: 'safe' }, answeredBy: 'agent' });
  });

  test('LLM 이 없는 라벨 고르면 첫 옵션(안전 기본)', async () => {
    const r = buildLlmHitlRelay({ ask: async () => '{"mode":"없는옵션"}', observe: () => {} });
    const res = await r.question(q('mode', ['safe', 'aggressive']));
    expect(res).toEqual({ answers: { mode: 'safe' } });
    expect(res?.answeredBy).toBeUndefined();
  });

  test('JSON 파싱 실패 → null(fail-closed)', async () => {
    const r = buildLlmHitlRelay({ ask: async () => '전혀 JSON 아님', observe: () => {} });
    expect(await r.question(q('mode', ['a', 'b']))).toBeNull();
  });

  test('LLM 실패 → null', async () => {
    const r = buildLlmHitlRelay({ ask: async () => { throw new Error('x'); }, observe: () => {} });
    expect(await r.question(q('mode', ['a', 'b']))).toBeNull();
  });
});

describe('extractJsonObject', () => {
  test('서두 텍스트 뒤 JSON 추출', () => {
    expect(extractJsonObject('답: {"a":1} 끝')).toEqual({ a: 1 });
  });
  test('JSON 없으면 null', () => {
    expect(extractJsonObject('no json')).toBeNull();
  });
});
