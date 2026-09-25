// Self-Evolution 발굴→제안 오케스트레이터 단위테스트 — 순수 조합.
import { describe, test, expect } from 'bun:test';
import { seedFromUnimplemented, seedFromAbsorption, planProposals } from './discovery-cycle.js';
import type { UnimplementedPlan } from './roadmap-scan.js';
import type { AbsorptionCandidate } from './ref-dig.js';

const uPlan = (over: Partial<UnimplementedPlan> = {}): UnimplementedPlan => ({
  path: 'docs/ROADMAP-memory.md', filename: 'ROADMAP-memory.md', topic: 'memory', date: '2026-07-01',
  openBoxes: 20, doneBoxes: 5, completionRatio: 0.2, staleScore: 20, priorityScore: 80, reasons: ['미완 20개'], ...over,
});
const aCand = (over: Partial<AbsorptionCandidate> = {}): AbsorptionCandidate => ({
  repoKey: 'codex', area: 'codex-rs/core', commits: 17, files: 55, whatChanged: ['feat: rollout budget'], score: 100, ...over,
});

describe('seed 변환', () => {
  test('내부 미구현 → internal seed(tier heavy)', () => {
    const s = seedFromUnimplemented(uPlan());
    expect(s.source).toBe('internal-roadmap');
    expect(s.slug).toBe('memory');
    expect(s.tier).toBe('heavy'); // openBoxes 20 > 15
    expect(s.rationale).toContain('미완 20개');
  });
  test('외부 흡수 → external seed + scopeSketch', () => {
    const s = seedFromAbsorption(aCand());
    expect(s.source).toBe('external-repo');
    expect(s.slug).toContain('absorb-codex');
    expect(s.tier).toBe('heavy'); // 17 commits > 10
    expect(s.scopeSketch!.length).toBeGreaterThan(0);
  });
});

describe('planProposals — 내부 우선 랭킹 + cap', () => {
  test('내부 먼저, cap 적용', () => {
    const plans = planProposals({
      unimplemented: [uPlan({ topic: 'a' }), uPlan({ topic: 'b' }), uPlan({ topic: 'c' }), uPlan({ topic: 'd' })],
      absorption: [aCand({ area: 'x' }), aCand({ area: 'y' }), aCand({ area: 'z' })],
      internalCap: 2, externalCap: 1,
    });
    expect(plans.length).toBe(3); // 2 내부 + 1 외부
    expect(plans[0]!.seed.source).toBe('internal-roadmap'); // 내부 먼저
    expect(plans[1]!.seed.source).toBe('internal-roadmap');
    expect(plans[2]!.seed.source).toBe('external-repo');
    expect(plans[0]!.rank).toBe(1);
  });

  test('기본 cap(3 내부·2 외부)', () => {
    const plans = planProposals({
      unimplemented: Array.from({ length: 10 }, (_, i) => uPlan({ topic: `t${i}` })),
      absorption: Array.from({ length: 10 }, (_, i) => aCand({ area: `a${i}` })),
    });
    expect(plans.filter(p => p.seed.source === 'internal-roadmap').length).toBe(3);
    expect(plans.filter(p => p.seed.source === 'external-repo').length).toBe(2);
  });
});
