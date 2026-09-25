// M3-3 (Phase 3) — NL tier switch detector + planner tests.
//
// The detector accepts an injected LlmRunner so we test prompt
// build, reply parsing, timeout, fallback, and the planner's
// preset/delta math without a real LLM.

import { describe, expect, test } from 'bun:test';
import {
  buildNlTierIntentMessages,
  detectTierIntentFromChat,
  parseNlTierIntentReply,
  planNlTierSwitch,
  type CurrentTierSlots,
  type LlmMessage,
} from '../../src/model-tier/index.js';

const BASE_TIERS: CurrentTierSlots = { stt: 'balanced', llm: 'balanced', tts: 'balanced' };

describe('M3-3 · buildNlTierIntentMessages', () => {
  test('emits system + user with 4 intents listed', () => {
    const msgs = buildNlTierIntentMessages('정확도 더 높여줘');
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.content).toContain('apply-preset');
    expect(msgs[0]!.content).toContain('increase-quality');
    expect(msgs[0]!.content).toContain('decrease-cost');
    expect(msgs[0]!.content).toContain('none');
    expect(msgs[0]!.content).toContain('medical_dictation');
    expect(msgs[1]!.content).toBe('정확도 더 높여줘');
  });
});

describe('M3-3 · parseNlTierIntentReply', () => {
  test('parses apply-preset payload', () => {
    const r = parseNlTierIntentReply(
      '{"intent":"apply-preset","preset":"medical_dictation","tierDelta":null,"rationale":"med"}',
    );
    expect(r?.intent).toBe('apply-preset');
    expect(r?.preset).toBe('medical_dictation');
    expect(r?.tierDelta).toBeUndefined();
    expect(r?.source).toBe('llm');
  });

  test('parses increase-quality with tierDelta', () => {
    const r = parseNlTierIntentReply(
      '{"intent":"increase-quality","preset":null,"tierDelta":1,"rationale":"acc"}',
    );
    expect(r?.intent).toBe('increase-quality');
    expect(r?.tierDelta).toBe(1);
  });

  test('clamps tierDelta to [-2, 2]', () => {
    const r = parseNlTierIntentReply(
      '{"intent":"increase-quality","preset":null,"tierDelta":99,"rationale":""}',
    );
    expect(r?.tierDelta).toBe(2);
  });

  test('rejects unknown intent', () => {
    const r = parseNlTierIntentReply(
      '{"intent":"explode","preset":null,"tierDelta":null,"rationale":""}',
    );
    expect(r).toBeNull();
  });

  test('rejects unknown preset id', () => {
    const r = parseNlTierIntentReply(
      '{"intent":"apply-preset","preset":"financial_advice","tierDelta":null,"rationale":""}',
    );
    expect(r).toBeNull();
  });

  test('tolerates leading prose + code fence', () => {
    const r = parseNlTierIntentReply(
      'Sure: ```json\n{"intent":"none","preset":null,"tierDelta":null,"rationale":"unrelated"}\n```',
    );
    expect(r?.intent).toBe('none');
  });
});

describe('M3-3 · detectTierIntentFromChat', () => {
  const echo = (reply: string) => async (_msgs: readonly LlmMessage[]) => reply;

  test('happy path · returns LLM detection', async () => {
    const r = await detectTierIntentFromChat(
      '이번 회의는 의료 용어 많아',
      echo('{"intent":"apply-preset","preset":"medical_dictation","tierDelta":null,"rationale":""}'),
    );
    expect(r.intent).toBe('apply-preset');
    expect(r.preset).toBe('medical_dictation');
    expect(r.source).toBe('llm');
  });

  test('runner throws → fallback intent=none', async () => {
    const r = await detectTierIntentFromChat('정확도 더', async () => { throw new Error('x'); });
    expect(r.intent).toBe('none');
    expect(r.source).toBe('fallback');
  });

  test('runner returns garbage → fallback', async () => {
    const r = await detectTierIntentFromChat('hi', echo('not json'));
    expect(r.intent).toBe('none');
    expect(r.source).toBe('fallback');
  });

  test('empty text short-circuits without calling LLM', async () => {
    let called = false;
    const r = await detectTierIntentFromChat('   ', async () => { called = true; return ''; });
    expect(called).toBe(false);
    expect(r.intent).toBe('none');
  });

  test('timeout fallback', async () => {
    const slow = (): Promise<string> => new Promise((resolve) => setTimeout(
      () => resolve('{"intent":"increase-quality","preset":null,"tierDelta":1,"rationale":""}'),
      200,
    ));
    const r = await detectTierIntentFromChat('정확도 높여', slow, { timeoutMs: 20 });
    expect(r.intent).toBe('none');
    expect(r.source).toBe('fallback');
  });
});

describe('M3-3 · planNlTierSwitch', () => {
  test('intent=none → noop plan', () => {
    const plan = planNlTierSwitch(
      { intent: 'none', rationale: '', source: 'llm' },
      BASE_TIERS,
    );
    expect(plan.isNoop).toBe(true);
    expect(plan.apply).toEqual({});
  });

  test('apply-preset medical_dictation → loaded/best/best + cap $20', () => {
    const plan = planNlTierSwitch(
      { intent: 'apply-preset', preset: 'medical_dictation', rationale: '', source: 'llm' },
      BASE_TIERS,
    );
    expect(plan.apply.stt).toBe('loaded');
    expect(plan.apply.llm).toBe('best');
    expect(plan.apply.tts).toBe('best');
    expect(plan.monthlyUsdCap).toBe(20);
    expect(plan.isNoop).toBe(false);
    expect(plan.confirmMessage).toContain('Medical');
  });

  test('increase-quality from balanced → better across surfaces', () => {
    const plan = planNlTierSwitch(
      { intent: 'increase-quality', tierDelta: 1, rationale: '', source: 'llm' },
      BASE_TIERS,
    );
    expect(plan.apply.stt).toBe('better');
    expect(plan.apply.llm).toBe('better');
    expect(plan.apply.tts).toBe('better');
    expect(plan.isNoop).toBe(false);
    expect(plan.confirmMessage).toContain('정확도');
  });

  test('decrease-cost from balanced → budget across surfaces', () => {
    const plan = planNlTierSwitch(
      { intent: 'decrease-cost', tierDelta: -1, rationale: '', source: 'llm' },
      BASE_TIERS,
    );
    expect(plan.apply.stt).toBe('budget');
    expect(plan.apply.llm).toBe('budget');
    expect(plan.apply.tts).toBe('budget');
    expect(plan.confirmMessage).toContain('비용');
  });

  test('increase-quality from loaded → noop (already at ceiling)', () => {
    const plan = planNlTierSwitch(
      { intent: 'increase-quality', tierDelta: 1, rationale: '', source: 'llm' },
      { stt: 'loaded', llm: 'loaded', tts: 'loaded' },
    );
    expect(plan.isNoop).toBe(true);
    expect(plan.confirmMessage).toContain('한계');
  });

  test('decrease-cost from budget → noop (already at floor)', () => {
    const plan = planNlTierSwitch(
      { intent: 'decrease-cost', tierDelta: -1, rationale: '', source: 'llm' },
      { stt: 'budget', llm: 'budget', tts: 'budget' },
    );
    expect(plan.isNoop).toBe(true);
  });

  test('apply-preset live_caption · stt balanced + llm/tts budget · no cap', () => {
    const plan = planNlTierSwitch(
      { intent: 'apply-preset', preset: 'live_caption', rationale: '', source: 'llm' },
      BASE_TIERS,
    );
    expect(plan.apply.stt).toBe('balanced');
    expect(plan.apply.llm).toBe('budget');
    expect(plan.apply.tts).toBe('budget');
    expect(plan.monthlyUsdCap).toBeUndefined();
  });

  test('apply-preset sleep_mode propagates monthlyUsdCap = 0', () => {
    const plan = planNlTierSwitch(
      { intent: 'apply-preset', preset: 'sleep_mode', rationale: '', source: 'llm' },
      BASE_TIERS,
    );
    expect(plan.monthlyUsdCap).toBe(0);
  });
});
