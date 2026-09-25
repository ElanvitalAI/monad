// PLAN-model-intelligence-router-2026-07-10 · Phase B4 —
// The onboarding model prompt is dual-purpose: a model id (single token)
// passes through; a natural-language intent (has whitespace) routes to the
// setup suggester. This covers the detection predicate + the intent→model
// resolution the wizard branch performs.

import { describe, it, expect } from 'bun:test';
import { looksLikeModelIntent } from '../src/onboarding.js';
import { suggestSetupModel } from '../src/model-tier/index.js';

describe('looksLikeModelIntent', () => {
  it('treats a bare model id as NOT intent', () => {
    expect(looksLikeModelIntent('claude-opus-4-7')).toBe(false);
    expect(looksLikeModelIntent('gpt-5.6')).toBe(false);
    expect(looksLikeModelIntent('')).toBe(false);
    expect(looksLikeModelIntent('   ')).toBe(false);
  });

  it('treats a sentence as intent', () => {
    expect(looksLikeModelIntent('주로 빠른 채팅이랑 가벼운 코딩')).toBe(true);
    expect(looksLikeModelIntent('mostly hard debugging and analysis')).toBe(true);
  });
});

describe('intent → setup model (wizard branch behaviour)', () => {
  it('resolves a light-work intent to a budget model', async () => {
    const s = await suggestSetupModel('주로 기사 요약이랑 번역', { provider: 'anthropic' });
    expect(s.tier).toBe('budget');
    expect(s.model).toContain('haiku');
  });

  it('resolves a hard-work intent to a top model', async () => {
    const s = await suggestSetupModel('복잡한 아키텍처 설계랑 디버깅 분석', { provider: 'anthropic' });
    expect(s.tier).toBe('best');
    expect(s.model).toContain('opus');
  });
});
