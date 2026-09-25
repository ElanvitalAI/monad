import { describe, it, expect } from 'bun:test';
import { isTransientLlmError, withTransientRetry } from './mission-engine.js';

describe('isTransientLlmError — 재시도 가치 판정', () => {
  it('transient(5xx·게이트웨이·네트워크) → true', () => {
    for (const m of [
      'Codex API 520: <html>', 'HTTP 502 Bad Gateway', '503 Service Unavailable', '504 Gateway Timeout',
      '429 Too Many Requests', 'ECONNRESET', 'ETIMEDOUT', 'socket hang up', 'fetch failed',
      'Cloudflare error', 'model overloaded', 'temporarily unavailable',
    ]) expect(isTransientLlmError(new Error(m))).toBe(true);
  });
  it('비-transient(스키마·빈응답·auth) → false', () => {
    for (const m of [
      'schema validation failed', 'empty response', 'invalid JSON', '401 Unauthorized', '400 Bad Request',
      'no model fits', 'context length exceeded',
    ]) expect(isTransientLlmError(new Error(m))).toBe(false);
  });
  it('비-Error 입력도 안전', () => {
    expect(isTransientLlmError('520 gateway')).toBe(true);
    expect(isTransientLlmError(null)).toBe(false);
    expect(isTransientLlmError(undefined)).toBe(false);
  });
});

describe('withTransientRetry — 2분 재시도(sleep 주입)', () => {
  const noSleep = async () => {};

  it('transient 실패 후 재시도 성공', async () => {
    let calls = 0;
    const r = await withTransientRetry(async () => {
      calls++;
      if (calls === 1) throw new Error('Codex API 520');
      return 'ok';
    }, { retries: 1, delayMs: 0, sleep: noSleep });
    expect(r).toBe('ok');
    expect(calls).toBe(2); // 1 실패 + 1 재시도 성공
  });

  it('재시도 소진 시 마지막 오류 rethrow', async () => {
    let calls = 0;
    await expect(withTransientRetry(async () => {
      calls++;
      throw new Error('520 gateway');
    }, { retries: 1, delayMs: 0, sleep: noSleep })).rejects.toThrow('520');
    expect(calls).toBe(2); // 최초 + 재시도 1회
  });

  it('비-transient 는 즉시 throw(재시도 안 함)', async () => {
    let calls = 0;
    await expect(withTransientRetry(async () => {
      calls++;
      throw new Error('schema validation failed');
    }, { retries: 3, delayMs: 0, sleep: noSleep })).rejects.toThrow('schema');
    expect(calls).toBe(1); // 재시도 없음
  });

  it('sleep 이 delayMs 로 호출됨(2분 파라미터 전달)', async () => {
    const slept: number[] = [];
    await withTransientRetry(async () => { if (slept.length === 0) throw new Error('520'); return 1; },
      { retries: 1, delayMs: 120_000, sleep: async (ms) => { slept.push(ms); } });
    expect(slept).toEqual([120_000]); // 2분
  });
});
