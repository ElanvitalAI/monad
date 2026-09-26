// Anthropic thinking 형상 판정 계약 — 모델 «세대·마이너»가 adaptive/legacy 를 가른다.
//
// ⛔ 왜 이 테스트가 있나(2026-08-12): 종전 규칙 `/-4-(?:[89]|\d\d)\b/` 이 「4 세대의 8 이상」만 물어
//   `claude-opus-5` 가 legacy 형상으로 나갔고 API 가 거부했다 —
//   `Anthropic API 400: "thinking.type.enabled" is not supported`.
//   그 상태에서 elanous 는 Anthropic 4.7 «이상 전부»를 못 썼다. 그런데 그 함수 주석은
//   *"5.x+ should be re-checked when they ship"* 라고 «예고해 두고» 있었다 — 예고는 게이트가 아니다.
//
// 📏 기대값의 출처 = live `GET /v1/models` capabilities (2026-08-12 · HTTP 200)
//   thinking.types.enabled.supported 가 false 인 모델이 adaptive 를 요구한다.
import { describe, expect, test } from 'bun:test';
import { _usesAdaptiveThinkingForContractTest as usesAdaptiveThinking } from '../src/llm.js';

describe('usesAdaptiveThinking — 모델 계열 계약', () => {
  test('adaptive 를 요구하는 모델(live capabilities: enabled=false)', () => {
    for (const model of [
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
    ]) expect({ model, adaptive: usesAdaptiveThinking(model) }).toEqual({ model, adaptive: true });
  });

  test('legacy 로 남아야 하는 모델(live capabilities: enabled=true)', () => {
    for (const model of [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-opus-4-5-20251101',
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-5-20250929',
    ]) expect({ model, adaptive: usesAdaptiveThinking(model) }).toEqual({ model, adaptive: false });
  });

  test('점 표기도 같은 결과를 낸다', () => {
    expect(usesAdaptiveThinking('claude-opus-4.7')).toBe(true);
    expect(usesAdaptiveThinking('claude-opus-4.8')).toBe(true);
    expect(usesAdaptiveThinking('claude-opus-4.6')).toBe(false);
  });

  test('릴리스 날짜 접미가 버전으로 오독되지 않는다', () => {
    // `-20251101` 을 마이너로 읽으면 4.5 가 adaptive 로 넘어가 회귀가 된다.
    expect(usesAdaptiveThinking('claude-opus-4-5-20251101')).toBe(false);
    expect(usesAdaptiveThinking('claude-haiku-4-5-20251001')).toBe(false);
  });

  test('6 세대 이상은 이름을 몰라도 adaptive 다 — 목록은 늙지만 세대 비교는 안 늙는다', () => {
    expect(usesAdaptiveThinking('claude-opus-6')).toBe(true);
    expect(usesAdaptiveThinking('claude-opus-10-2')).toBe(true);
  });

  test('판정 못 하는 입력은 legacy(무회귀)', () => {
    expect(usesAdaptiveThinking(undefined)).toBe(false);
    expect(usesAdaptiveThinking('')).toBe(false);
    expect(usesAdaptiveThinking('gpt-5.6-terra')).toBe(false);
  });
});
