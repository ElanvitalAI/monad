import { describe, it, expect } from 'bun:test';
import {
  feasibilityBudget, parseScopeNegotiation, proposeScopeNegotiation, formatNegotiationCard,
  type NegotiateInput,
} from './mission-feasibility-negotiate.js';

function input(p: Partial<NegotiateInput>): NegotiateInput {
  return { phaseTitle: '관측 품질 원인을 구별해 보존하라', phasePrompt: 'p', acceptance: ['freshness', '단위 정합'], diagnosis: '단위 결손을 abstain 처리 안 함·의미론 결함', ...p };
}

describe('feasibilityBudget (config-first)', () => {
  it('기본 2/2', () => {
    const b = feasibilityBudget();
    expect(b.maxStalls).toBeGreaterThanOrEqual(1);
    expect(b.maxReplans).toBeGreaterThanOrEqual(1);
  });
});

describe('parseScopeNegotiation (순수)', () => {
  it('scope_cut — 축소 acceptance + deferred', () => {
    const n = parseScopeNegotiation('{"rootCause":"품질검증 과다","kind":"scope_cut","narrowedAcceptance":["결손 시 abstain"],"deferred":"정밀 freshness 후속","rationale":"지금 닫을 계약"}');
    expect(n.kind).toBe('scope_cut');
    expect(n.narrowedAcceptance).toEqual(['결손 시 abstain']);
    expect(n.deferred).toContain('freshness');
    expect(n.needsHitl).toBe(true);
  });

  it('replan / 파싱 실패 → 보수적 replan', () => {
    expect(parseScopeNegotiation('{"kind":"replan","replanHint":"접근 교정"}').kind).toBe('replan');
    expect(parseScopeNegotiation('텍스트').kind).toBe('replan');
  });
});

describe('proposeScopeNegotiation (judge 주입·fail-soft)', () => {
  it('judge 주입 scope_cut', async () => {
    const n = await proposeScopeNegotiation(input({}), {
      judge: async () => '{"rootCause":"품질 의미론 과다","kind":"scope_cut","narrowedAcceptance":["결손=abstain"],"deferred":"정밀검증 후속","rationale":"achievable 축소"}',
    });
    expect(n.kind).toBe('scope_cut');
    expect(n.narrowedAcceptance).toContain('결손=abstain');
  });

  it('judge 오류 → fail-soft replan', async () => {
    const n = await proposeScopeNegotiation(input({}), { judge: async () => { throw new Error('down'); } });
    expect(n.kind).toBe('replan');
    expect(n.needsHitl).toBe(true);
  });

  it('judge 미주입(test) → replan 폴백', async () => {
    const n = await proposeScopeNegotiation(input({}));
    expect(n.kind).toBe('replan');
  });
});

describe('formatNegotiationCard', () => {
  it('scope_cut 카드 — 축소·defer·HITL 명시', () => {
    const card = formatNegotiationCard(
      { rootCause: '품질 과다', kind: 'scope_cut', narrowedAcceptance: ['결손=abstain'], deferred: '정밀 후속', rationale: 'achievable', needsHitl: true },
      '관측 품질',
    );
    expect(card).toContain('스코프컷 제안');
    expect(card).toContain('결손=abstain');
    expect(card).toContain('defer');
    expect(card).toContain('사람 승인');
  });
});
