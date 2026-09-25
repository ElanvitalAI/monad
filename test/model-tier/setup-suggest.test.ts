// PLAN-model-intelligence-router-2026-07-10 · Phase B4 tests.

import { describe, it, expect } from 'bun:test';
import { suggestSetupModel } from '../../src/model-tier/setup-suggest.js';
import { withLlmModel, type UserConfig } from '../../src/user-config.js';

describe('suggestSetupModel', () => {
  it('resolves an empty intent to the balanced default', async () => {
    const s = await suggestSetupModel('', { provider: 'anthropic' });
    expect(s.tier).toBe('balanced');
    expect(s.source).toBe('default');
    expect(s.model.length).toBeGreaterThan(0);
  });

  it('resolves a light-work intent to a cheap tier', async () => {
    const s = await suggestSetupModel('주로 기사 요약이랑 번역만 해', { provider: 'anthropic' });
    expect(s.tier).toBe('budget');
    expect(s.model).toContain('haiku');
  });

  it('resolves a hard-work intent to a high tier', async () => {
    const s = await suggestSetupModel(
      '복잡한 아키텍처 설계랑 디버깅 근거 분석을 많이 해',
      { provider: 'anthropic' },
    );
    expect(s.tier).toBe('best');
    expect(s.model).toContain('opus');
  });
});

describe('withLlmModel', () => {
  const base = { llm: { provider: 'auto', model: 'x' } } as unknown as UserConfig;

  it('pins the model without mutating the input', () => {
    const next = withLlmModel(base, 'claude-opus-4-7');
    expect(next.llm.model).toBe('claude-opus-4-7');
    expect(base.llm.model).toBe('x');
  });

  it('also sets the provider when given', () => {
    const next = withLlmModel(base, 'claude-opus-4-7', 'anthropic');
    expect(next.llm.provider).toBe('anthropic');
  });

  it('ignores a blank model', () => {
    const next = withLlmModel(base, '   ');
    expect(next.llm.model).toBe('x');
  });
});
