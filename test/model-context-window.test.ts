import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';

import { debug } from '../src/debug/log.js';
import { resolveModelContextWindow } from '../src/models/context-window.js';

afterEach(() => mock.restore());

describe('resolveModelContextWindow', () => {
  test('uses exact codex catalog entries when available', () => {
    expect(resolveModelContextWindow('gpt-5.4')).toBe(1_000_000);
    expect(resolveModelContextWindow('gpt-5.4-mini')).toBe(400_000);
    expect(resolveModelContextWindow('gpt-5-codex')).toBe(400_000);
  });

  test('uses exact builtin catalog entries for current non-codex defaults', () => {
    expect(resolveModelContextWindow('gpt-4o-mini')).toBe(128_000);
    // ⛔ 'grok-4-1-fast' 는 xAI 에서 grok-4.3 으로 리다이렉트되는 레거시 별칭이라 카탈로그에서 뺐다
    //    (2026-08-18 실호출 대조). 실물 장문 모델로 바꾼다.
    expect(resolveModelContextWindow('grok-4.20')).toBe(2_000_000);
    expect(resolveModelContextWindow('gemini-2.5-flash')).toBe(1_000_000);
  });

  test('falls back to family capabilities for claude and gemini aliases', () => {
    expect(resolveModelContextWindow('claude-opus-4-6')).toBe(200_000);
    expect(resolveModelContextWindow('claude-haiku-4-5-20251001')).toBe(200_000);
    // ⛔ 2026-08-18: 정확한 값은 1_048_576 (Gemini `/v1beta/models` inputTokenLimit 1차).
    expect(resolveModelContextWindow('gemini-2.5-pro')).toBe(1_048_576);
  });

  test('returns null and records the queried model for unknown models', () => {
    const log = spyOn(debug, 'log');

    expect(resolveModelContextWindow('totally-unknown-model')).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('models.context-window', 'unknown', {
      modelId: 'totally-unknown-model',
    });
    expect(resolveModelContextWindow(undefined)).toBeNull();
  });

  test('does not record an unknown observation for known models', () => {
    const log = spyOn(debug, 'log');

    expect(resolveModelContextWindow('gpt-5.4')).toBe(1_000_000);
    expect(log).not.toHaveBeenCalledWith('models.context-window', 'unknown', expect.anything());
  });
});
