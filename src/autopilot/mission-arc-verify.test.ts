import { describe, it, expect } from 'bun:test';
import { verifyArcAcceptance, type ArcVerifier } from './mission-arc-verify.js';
import type { MissionArc } from '../task-orchestrator/mission.js';

const arc = (over: Partial<MissionArc> & { arcId: string }): MissionArc => ({
  name: 'arc', intent: 'x', phaseIds: [], dependsOnArcs: [], acceptance: [], status: 'pending', ...over,
});

describe('verifyArcAcceptance', () => {
  it('빈 acceptance(flat/암묵1아크)면 즉시 통과 — 회귀 0', async () => {
    const r = await verifyArcAcceptance(arc({ arcId: 'a1', acceptance: [] }), 'apm_x');
    expect(r.ok).toBe(true);
    expect(r.evidence).toContain('flat');
  });

  it('acceptance 있어도 verifier 미주입이면 스킵-통과(테스트)', async () => {
    const r = await verifyArcAcceptance(arc({ arcId: 'a1', acceptance: ['통합됨'] }), 'apm_x');
    expect(r.ok).toBe(true);
  });

  it('verifier 통과 → ok=true + evidence', async () => {
    const verify: ArcVerifier = async () => ({ ok: true, evidence: 'observeCoordinatorState가 lifecycle에서 호출(mission.ts:42)' });
    const r = await verifyArcAcceptance(arc({ arcId: 'a1', acceptance: ['통합됨'] }), 'apm_x', verify);
    expect(r.ok).toBe(true);
    expect(r.evidence).toContain('lifecycle');
  });

  it('verifier 미충족 → ok=false + missing (dead-code 잡기)', async () => {
    const verify: ArcVerifier = async () => ({ ok: false, evidence: '', missing: 'observeCoordinatorState가 export만·미배선(dead-code)' });
    const r = await verifyArcAcceptance(arc({ arcId: 'a1', name: '관측 계약', acceptance: ['observe가 lifecycle에 배선'] }), 'apm_x', verify);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('dead-code');
  });

  it('verifier 예외 → fail-soft 미충족 처리(false-PASS 금지)', async () => {
    const verify: ArcVerifier = async () => { throw new Error('llm boom'); };
    const r = await verifyArcAcceptance(arc({ arcId: 'a1', acceptance: ['x'] }), 'apm_x', verify);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('예외');
  });
});
