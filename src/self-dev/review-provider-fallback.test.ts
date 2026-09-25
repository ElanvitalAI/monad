import { resolveModelAlias } from '../intelligence-map/model-alias.js';
import { describe, expect, test } from 'bun:test';
import { getProvider } from '../llm.js';
import {
  classifyReviewProviderFailure, buildReviewProviderAttempts, runReviewWithFallback,
  type ReviewFallbackObservation,
} from './review-provider-fallback.js';

const A = { model: 'gpt-5.6-sol', provider: getProvider('gpt-5.6-sol')!, label: 'codex' };
const B = { model: 'grok-4', provider: getProvider('grok-4')!, label: 'grok' };
const C = { model: 'claude-opus', provider: getProvider('claude-opus')!, label: 'claude' };

describe('classifyReviewProviderFailure — 「제공자가 아픈가」만 문다', () => {
  test('⭐ 실물 문면(#10069)을 문다', () => {
    expect(classifyReviewProviderFailure('Codex API error: Our servers are currently overloaded. Please try again later.')).toBe('overloaded');
  });
  test('rate limit · 5xx · timeout 을 각각 가른다', () => {
    expect(classifyReviewProviderFailure('429 rate limit exceeded')).toBe('rate-limited');
    expect(classifyReviewProviderFailure('HTTP 503 Service Unavailable')).toBe('server-error');
    expect(classifyReviewProviderFailure('request timed out')).toBe('timeout');
  });
  test('모델-프로바이더 불일치·기타 오류를 유한 사유로 가른다', () => {
    expect(classifyReviewProviderFailure("Codex API 400: The 'grok-4.6' model is not supported when using Codex")).toBe('model-provider-mismatch');
    expect(classifyReviewProviderFailure('prompt too long: 200000 tokens')).toBe('other');
    expect(classifyReviewProviderFailure('invalid api key')).toBe('other');
  });
});

describe('buildReviewProviderAttempts — 순서와 중복 제거', () => {
  test('기본이 «맨 앞»이고 중복 모델은 빠진다', () => {
    expect(buildReviewProviderAttempts(A, [B, A, C]).map((x) => x.label)).toEqual(['codex', 'grok', 'claude']);
  });
  test('⛔ 빈 모델은 무시한다', () => {
    expect(buildReviewProviderAttempts(A, [{ model: '  ', label: 'x' }]).map((x) => x.label)).toEqual(['codex']);
  });
});

describe('runReviewWithFallback — 계약 넷', () => {
  test('① 첫 시도 성공이면 종전과 «동일»하다', async () => {
    const calls: string[] = [];
    const r = await runReviewWithFallback([A, B], async (a) => { calls.push(a.label); return 'PASS'; });
    expect(r.text).toBe('PASS');
    expect(r.used.label).toBe('codex');
    expect(calls).toEqual(['codex']);
  });

  test('해석된 프로바이더는 별도 resolved 관측에 기록하고 attempt는 한 번만 남긴다', async () => {
    const seen: Array<{ event: string; data: ReviewFallbackObservation }> = [];
    const observe = (event: string, data: ReviewFallbackObservation) => { seen.push({ event, data }); };
    await runReviewWithFallback([A], async (_attempt, resolved) => {
      resolved('openai-codex');
      return 'PASS';
    }, observe);
    await runReviewWithFallback([A], async (_attempt, resolved) => {
      resolved(A.provider.name);
      return 'PASS';
    }, observe);
    await runReviewWithFallback([A], async () => 'PASS', observe);

    const attempts = seen.filter(({ event }) => event === 'attempt');
    const resolved = seen.filter(({ event }) => event === 'resolved');
    expect(attempts).toEqual([
      { event: 'attempt', data: { attempt: 1, total: 1, label: 'codex', model: A.model, provider: A.provider.name } },
      { event: 'attempt', data: { attempt: 1, total: 1, label: 'codex', model: A.model, provider: A.provider.name } },
      { event: 'attempt', data: { attempt: 1, total: 1, label: 'codex', model: A.model, provider: A.provider.name } },
    ]);
    expect(resolved).toEqual([
      { event: 'resolved', data: { attempt: 1, total: 1, label: 'codex', model: A.model, provider: A.provider.name, resolvedProvider: 'openai-codex' } },
      { event: 'resolved', data: { attempt: 1, total: 1, label: 'codex', model: A.model, provider: A.provider.name, resolvedProvider: A.provider.name } },
    ]);
  });

  test('확정 뒤 실패도 실제 프로바이더를 남기며 다음 시도로 새지 않는다', async () => {
    const seen: Array<{ event: string; data: ReviewFallbackObservation }> = [];
    await expect(runReviewWithFallback([A, B], async (attempt, resolved) => {
      if (attempt === A) {
        resolved('openai-codex');
        throw new Error('Our servers are currently overloaded.');
      }
      return 'PASS';
    }, (event, data) => { seen.push({ event, data }); })).resolves.toMatchObject({ used: B });

    expect(seen).toContainEqual({
      event: 'fallback',
      data: { attempt: 1, total: 2, label: 'codex', model: A.model, provider: A.provider.name, resolvedProvider: 'openai-codex', afterReason: 'overloaded', errorMessage: 'Our servers are currently overloaded.' },
    });
    expect(seen).toContainEqual({
      event: 'attempt',
      data: { attempt: 2, total: 2, label: 'grok', model: B.model, provider: B.provider.name, afterReason: 'overloaded' },
    });
  });

  test('⭐ 과부하면 다음 제공자로 넘어가고 «전이가 관측»된다', async () => {
    const seen: Array<{ e: string; label: string; after?: string }> = [];
    const r = await runReviewWithFallback([A, B], async (a) => {
      if (a.label === 'codex') throw new Error('Our servers are currently overloaded.');
      return 'PASS from grok';
    }, (e, d) => { seen.push({ e, label: d.label, after: d.afterReason }); });
    expect(r.used.label).toBe('grok');
    expect(r.attemptIndex).toBe(1);
    expect(seen.map((s) => s.e)).toEqual(['attempt', 'fallback', 'attempt']);
    // ⛔ 「왜 넘어갔나」가 값으로 남는다 — 나중에 세려면 이게 있어야 한다
    expect(seen[1]!.after).toBe('overloaded');
    expect(seen[2]!.after).toBe('overloaded');
  });

  test('② 폴백 불가능한 오류는 사유를 남기고 즉시 던진다 — 다른 모델로 안 샌다', async () => {
    const calls: string[] = [];
    await expect(runReviewWithFallback([A, B], async (a) => {
      calls.push(a.label); throw new Error('prompt too long');
    })).rejects.toThrow('prompt too long');
    expect(calls).toEqual(['codex']);
  });

  test('모델-프로바이더 불일치·과부하·기타 실패는 유한 사유와 원문으로 관측된다', async () => {
    const observed: Array<{ reason?: string; message?: string }> = [];
    for (const [message, reason] of [
      ["Codex API 400: The 'grok-4.6' model is not supported when using Codex", 'model-provider-mismatch'],
      ['Our servers are currently overloaded.', 'overloaded'],
      ['invalid api key', 'other'],
    ] as const) {
      await expect(runReviewWithFallback([A], async () => { throw new Error(message); }, (_event, data) => {
        if (data.afterReason) observed.push({ reason: data.afterReason, message: data.errorMessage });
      })).rejects.toThrow(message);
    }
    expect(observed).toEqual([
      { reason: 'model-provider-mismatch', message: "Codex API 400: The 'grok-4.6' model is not supported when using Codex" },
      { reason: 'overloaded', message: 'Our servers are currently overloaded.' },
      { reason: 'other', message: 'invalid api key' },
    ]);
  });

  test('프로바이더를 못 정한 모델은 호출하지 않고 사유를 남긴 뒤 다음 시도로 간다', async () => {
    const seen: Array<{ event: string; reason?: string; message?: string }> = [];
    const r = await runReviewWithFallback([
      { model: 'unregistered-review-model', label: 'unknown' },
      B,
    ], async (attempt) => {
      expect(attempt.label).toBe('grok');
      return 'PASS';
    }, (event, data) => { seen.push({ event, reason: data.afterReason, message: data.errorMessage }); });
    expect(r.used).toBe(B);
    expect(seen).toEqual([
      { event: 'attempt', reason: undefined, message: undefined },
      { event: 'fallback', reason: 'unknown-model-provider', message: 'review fallback: unable to infer provider for model unregistered-review-model' },
      { event: 'attempt', reason: 'unknown-model-provider', message: undefined },
    ]);
  });

  test('③ 전부 실패하면 «마지막» 오류를 던진다 — 첫 오류로 덮지 않는다', async () => {
    await expect(runReviewWithFallback([A, B], async (a) => {
      throw new Error(a.label === 'codex' ? 'overloaded' : 'HTTP 503 last one');
    })).rejects.toThrow('HTTP 503 last one');
  });

  test('④ 시도가 없으면 이름을 대고 거부한다', async () => {
    await expect(runReviewWithFallback([], async () => 'x')).rejects.toThrow('no attempts configured');
  });

  test('⛔ 관측 콜백이 던져도 리뷰를 막지 않는다', async () => {
    const r = await runReviewWithFallback([A], async () => 'PASS', () => { throw new Error('sink down'); });
    expect(r.text).toBe('PASS');
  });
});

// 🩸 B8(2026-09-25): 기대값에 `grok-4.6` 을 박아 두어 사다리가 4.7 로 옮겨지자 main 에서 둘이 빨갛게 됐다 — 사다리에서 파생한다.
const GROK_LADDER = resolveModelAlias('grok')!;

describe('reviewFallbackModelsFromConfig — config 노브', () => {
  test('⭐ 기본은 «빈 목록» — 이 착지는 기전만 세우고 동작을 «안» 바꾼다', async () => {
    const { reviewFallbackModelsFromConfig } = await import('./review-provider-fallback.js');
    expect(reviewFallbackModelsFromConfig(() => ({}))).toEqual([]);
    expect(reviewFallbackModelsFromConfig(() => ({ llm: {} }))).toEqual([]);
  });

  test('문자열 배열만 받고 공백·비문자열은 버리며 별칭을 정식 모델명으로 해석한다', async () => {
    const { reviewFallbackModelsFromConfig } = await import('./review-provider-fallback.js');
    expect(reviewFallbackModelsFromConfig(() => ({
      llm: { reviewFallbackModels: ['grok', 'grok-fast', '  ', 7, ' claude-opus ', 'unknown-model'] as unknown },
    }))).toEqual([GROK_LADDER, resolveModelAlias('grok-fast')!, 'claude-opus', 'unknown-model']);
  });

  test('해석된 폴백도 주 모델 뒤의 시도 목록에만 추가한다', async () => {
    const { reviewFallbackModelsFromConfig } = await import('./review-provider-fallback.js');
    const models = reviewFallbackModelsFromConfig(() => ({ llm: { reviewFallbackModels: ['grok'] } }));
    expect(buildReviewProviderAttempts(A, models.map((model) => ({ model, label: model })))).toEqual([
      A,
      { model: GROK_LADDER, label: GROK_LADDER },
    ]);
  });

  test('⛔ 읽기가 던져도 «막지» 않는다 — 폴백 없이 종전대로 돈다', async () => {
    const { reviewFallbackModelsFromConfig } = await import('./review-provider-fallback.js');
    expect(reviewFallbackModelsFromConfig(() => { throw new Error('config down'); })).toEqual([]);
  });
});
