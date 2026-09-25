// PLAN-model-intelligence-router-2026-07-10 · Phase B2 bridge tests.

import { describe, it, expect } from 'bun:test';
import { resolveAutoRoute } from '../../src/model-tier/auto-route.js';
import type { LlmRunner } from '../../src/model-tier/preset-suggest-llm.js';

describe('resolveAutoRoute', () => {
  it('returns null (no override) when disabled', async () => {
    const r = await resolveAutoRoute(
      { text: '이 아키텍처 결정을 분석해줘' },
      { provider: 'anthropic' },
      { enabled: false },
    );
    expect(r).toBeNull();
  });

  it('maps a bulk ask to the budget-tier model of the provider', async () => {
    const r = await resolveAutoRoute(
      { text: '이 기사 요약해줘' },
      { provider: 'anthropic' },
      { enabled: true },
    );
    expect(r).not.toBeNull();
    expect(r?.tier).toBe('budget');
    // Anthropic budget tier ships Haiku.
    expect(r?.model).toContain('haiku');
    expect(r?.source).toBe('heuristic');
  });

  it('maps a hard reasoning ask to a higher tier model', async () => {
    const r = await resolveAutoRoute(
      { text: '이 아키텍처 결정의 근거를 분석해서 판단해줘' },
      { provider: 'anthropic' },
      { enabled: true },
    );
    expect(r?.tier).toBe('best');
    expect(r?.model).toContain('opus');
    expect(r?.reasoningLevel).toBeDefined();
  });

  it('uses the classifier LLM on ambiguous input when supplied', async () => {
    const runner: LlmRunner = async () => '{"tier":"loaded","confidence":0.9}';
    const r = await resolveAutoRoute(
      { text: 'help me put together an agenda for the team offsite next month' },
      { provider: 'anthropic', runLlm: runner },
      { enabled: true },
    );
    expect(r?.source).toBe('llm');
    expect(r?.tier).toBe('loaded');
  });
});
