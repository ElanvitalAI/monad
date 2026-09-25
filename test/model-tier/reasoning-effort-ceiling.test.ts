// ⭐ Reasoning-effort 상한 SSOT resolver 유닛 테스트 (2026-07-19).
// 모델/provider 마다 reasoning-effort 최대치가 천차만별 — catalog 명시 필드 우선 → family 패턴 폴백.

import { describe, it, expect } from 'bun:test';
import { reasoningEffortCeiling } from '../../src/intelligence-map/model-catalog.js';

describe('reasoningEffortCeiling — 모델별 reasoning-effort 상한 SSOT', () => {
  // ✅ 2026-09-23 정정 — 종전 기대값(luna=low · terra=high)은 ***추정이었고 틀렸다***.
  //   대표 이 *"제대로 탐침을 못한 것 같다"* 고 지적해 각 effort 를 «실제로 먹여» 봤다:
  //     codex exec -c model_reasoning_effort=<E> --model <M> "…"   (codex-cli 0.155.1)
  //     5.6-terra · 5.6-luna · gpt-6-sol 모두 low/medium/high/xhigh/max ✅ · bogus ❌(대조군)
  //   ⛔ 「능력 상한」과 「우리가 쓰는 값」은 다른 축이다 — 비용 제어는 `llm.codexReasoning.effort`.
  it('codex 계열은 effort 상한이 max 다 (2026-09-23 실호출 실측)', () => {
    for (const m of ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-6-astra']) {
      expect(reasoningEffortCeiling(m)).toBe('max');
    }
  });

  it('⛔ 상한이 «모든» 모델에서 max 인 것은 아니다 — 자가 무는지 확인', () => {
    // 이 줄이 없으면 위 시험은 「항상 max 를 돌려주는 함수」도 통과시킨다.
    expect(reasoningEffortCeiling('claude-haiku-4-5')).toBe('low');
    expect(reasoningEffortCeiling('gemini-3.1-pro-preview')).toBe('high');
  });

  it('anthropic: opus/sonnet=high(adaptive) · haiku=low', () => {
    expect(reasoningEffortCeiling('claude-opus-4-8')).toBe('high');
    expect(reasoningEffortCeiling('claude-sonnet-5')).toBe('high');
    expect(reasoningEffortCeiling('claude-haiku-4-5')).toBe('low');
  });

  it('gemini: thinkingLevel high', () => {
    expect(reasoningEffortCeiling('gemini-3.1-pro-preview')).toBe('high');
  });

  it('grok: non-reasoning=none · code-fast=low · 4.20/4.3/4.5=high', () => {
    expect(reasoningEffortCeiling('grok-4.20-non-reasoning')).toBe('none');
    expect(reasoningEffortCeiling('grok-code-fast-1')).toBe('low');
    expect(reasoningEffortCeiling('grok-4.3')).toBe('high');
    expect(reasoningEffortCeiling('grok-4.5')).toBe('high');
  });

  it('비추론/구세대: gpt-4o=none · 미상=medium', () => {
    expect(reasoningEffortCeiling('gpt-4o')).toBe('none');
    expect(reasoningEffortCeiling('local:mystery-model')).toBe('medium');
    expect(reasoningEffortCeiling(undefined)).toBe('medium');
  });
});
