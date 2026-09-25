// PLAN-model-intelligence-router-2026-07-10 · Phase B3 tests.

import { describe, it, expect } from 'bun:test';
import { detectNuanceDelta, adjustTier } from '../../src/model-tier/nuance-adjust.js';
import { resolveAutoRoute } from '../../src/model-tier/auto-route.js';

describe('detectNuanceDelta', () => {
  it('bumps up on care cues', () => {
    expect(detectNuanceDelta('이건 신중히 정확하게 해줘').delta).toBe(2);
    expect(detectNuanceDelta('be careful here').delta).toBe(1);
  });

  it('drops on quick/rough cues', () => {
    expect(detectNuanceDelta('그냥 대충 빨리').delta).toBe(-2);
    expect(detectNuanceDelta('just a quick draft').delta).toBeLessThan(0);
  });

  it('nets out conflicting cues', () => {
    expect(detectNuanceDelta('정확하게 하되 빨리').delta).toBe(0);
  });

  it('is zero on neutral text', () => {
    expect(detectNuanceDelta('summarize this article').delta).toBe(0);
  });
});

describe('adjustTier', () => {
  it('clamps at both ends', () => {
    expect(adjustTier('budget', -3)).toBe('budget');
    expect(adjustTier('loaded', 3)).toBe('loaded');
  });
  it('moves within range', () => {
    expect(adjustTier('balanced', 1)).toBe('better');
    expect(adjustTier('best', -1)).toBe('better');
  });
});

describe('resolveAutoRoute applyNuance', () => {
  it('bumps the routed tier up when nuance escalates', async () => {
    // Bulk keyword → budget; but "신중히 정확하게" bumps +2 → better.
    const r = await resolveAutoRoute(
      { text: '이 기사 요약하되 신중히 정확하게' },
      { provider: 'anthropic' },
      { enabled: true, applyNuance: true },
    );
    expect(r?.tier).toBe('better');
    expect(r?.rationale).toContain('nuance');
  });

  it('leaves the tier unchanged when nuance is off', async () => {
    const r = await resolveAutoRoute(
      { text: '이 기사 요약하되 신중히 정확하게' },
      { provider: 'anthropic' },
      { enabled: true, applyNuance: false },
    );
    expect(r?.tier).toBe('budget');
  });
});
