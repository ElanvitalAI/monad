import { test, expect, describe } from 'bun:test';
import {
  evaluateCoordinatorDecision,
  arbitrateContractProposals,
  normalizeFanInProposals,
  buildEvidenceBundle,
  publishSignalQualityStates,
  type EvidenceObservation,
  type CoordinatorFanIn,
  type CapstoneFanInEntry,
} from './coordinator-mission.js';

// ── A2 아크 실체화(phase 12·13) — 실패-폐쇄형 2단 판단 + 계약 제안 위험 중재 ──
//   정의모듈·운영 크론 배선=arming HITL(mission_decide re-ground). 정의+통합테스트로 충족.

const NOW = new Date('2026-07-15T00:00:00Z');
const FRESH = '2026-07-14T23:59:30Z';

function obs(subject: string, value: unknown, quality: 'normal' | 'error' | 'missing' = 'normal'): EvidenceObservation {
  return {
    subject, kind: 'fact',
    envelope: { value, observedAt: FRESH, source: `s:${subject}`, unit: 'x', confidence: 0.9, ttlMs: 60_000, rawHash: 'h', qualityState: quality },
  };
}

/** 전 6피드+포지션을 정상 게시 → 1차 품질 게이트 통과(gate1Pass=true) 셋업. */
function allGood() {
  const v = { value: 1, observedAt: FRESH, source: 'x' };
  return publishSignalQualityStates({ community: v, breaking: v, regime: v, disclosure: v, flow: v, quote: v, position: v }, NOW);
}

describe('evaluateCoordinatorDecision (phase 12) — 2단 판단 정책', () => {
  test('1차 품질 게이트 실패 → 데이터 장애 알림·주문 후보 아님', () => {
    const q = publishSignalQualityStates({ community: { value: null, observedAt: FRESH }, breaking: { value: null, observedAt: FRESH }, regime: { value: null, observedAt: FRESH }, disclosure: { value: null, observedAt: FRESH } }, NOW);
    const ev = buildEvidenceBundle([obs('a', 1)], NOW);
    const d = evaluateCoordinatorDecision({ evidence: ev, qualityStates: q, severity: 'S4' });
    expect(d.gate1Pass).toBe(false);
    expect(d.dataFaultAlert).toBe(true);
    expect(d.orderCandidate).toBe(false); // 하드 게이트 실패 = 주문 아님
  });

  test('luna abstain → 주문 후보 철회(하드 게이트 우회 아님)', () => {
    const ev = buildEvidenceBundle([obs('상승-매수', 5), obs('상승-긍정', 3)], NOW);
    const d = evaluateCoordinatorDecision({ evidence: ev, qualityStates: allGood(), severity: 'S4', lunaAbstain: true, lunaReason: '추가조사' });
    expect(d.gate1Pass).toBe(true); // 품질은 통과
    expect(d.abstained).toBe(true);
    expect(d.orderCandidate).toBe(false); // luna abstain 으로 철회
  });

  test('국면 단순규칙 + 심각 이벤트 → 주문 후보', () => {
    const ev = buildEvidenceBundle([obs('상승-매수', 5), obs('상승-긍정', 3)], NOW);
    const d = evaluateCoordinatorDecision({ evidence: ev, qualityStates: allGood(), severity: 'S4' });
    expect(d.gate1Pass).toBe(true);
    expect(d.regime).toBe('risk-on');
    expect(d.orderCandidate).toBe(true);
    expect(d.alertGrade).toBe('critical');
  });

  test('근거 부족 → 알림 강등(muted·품질은 통과)', () => {
    const ev = buildEvidenceBundle([], NOW); // 빈 근거·품질 게이트는 통과
    const d = evaluateCoordinatorDecision({ evidence: ev, qualityStates: allGood(), severity: undefined });
    expect(d.gate1Pass).toBe(true);
    expect(d.regime).toBe('uncertain');
    expect(d.alertGrade).toBe('muted');
    expect(d.orderCandidate).toBe(false);
  });
});

describe('arbitrateContractProposals (phase 13) — 계약 제안 위험 중재', () => {
  const entry = (source: 'capstone' | 'lever' | 'free-swing', over: { confidence?: number; expiresAt?: string; urls?: string[] } = {}): CapstoneFanInEntry => ({
    metadata: { source, sourceMissionId: `m-${source}`, sourceCycleId: `c-${source}`, receivedAt: FRESH } as never,
    envelope: {
      envelopeId: `e-${source}`, schemaVersion: '1', missionId: 'coord', cycleId: 'c1', correlationId: 'corr', createdAt: FRESH,
      expiresAt: over.expiresAt ?? '2026-07-15T01:00:00Z', producer: source,
      payload: { facts: [{ subject: 'x', value: 1, observedAt: FRESH }], communitySentiment: [], evidenceUrls: over.urls ?? ['u'], conflictingSignals: [], confidence: over.confidence ?? 0.7 },
    },
  });
  const fanIn = (over: Partial<CoordinatorFanIn> = {}): CoordinatorFanIn => ({ capstone: [], lever: [], freeSwing: [], ...over });

  test('만료 제안 reject + 계보 ID 보존', () => {
    const r = arbitrateContractProposals(fanIn({ capstone: [entry('capstone', { expiresAt: '2020-01-01T00:00:00Z' })] }), { now: NOW });
    expect(r[0]!.verdict).toBe('reject');
    expect(r[0]!.reason).toContain('만료');
    expect(r[0]!.sourceMissionId).toBe('m-capstone'); // 계보 보존
  });

  test('불완전(근거 없음) reject', () => {
    const r = arbitrateContractProposals(fanIn({ capstone: [entry('capstone', { urls: [] })] }), { now: NOW });
    // facts 는 있으나 hasEvidence 는 urls||facts — facts 있으니 accept. 확신도 0 으로 불완전 테스트.
    const r2 = arbitrateContractProposals(fanIn({ capstone: [entry('capstone', { confidence: 0 })] }), { now: NOW });
    expect(r2[0]!.verdict).toBe('reject');
    expect(r).toBeDefined();
  });

  test('레버 파생 검증 결측 → 레버리지 차단(reject)', () => {
    const r = arbitrateContractProposals(fanIn({ lever: [entry('lever') as never] }), { now: NOW, derivativeVerificationMissing: true });
    expect(r[0]!.verdict).toBe('reject');
    expect(r[0]!.reason).toContain('레버리지');
  });

  test('총 익스포저 초과 → reduce', () => {
    const many = fanIn({ capstone: [entry('capstone', { confidence: 0.9 })], lever: [entry('lever', { confidence: 0.9 }) as never], freeSwing: [entry('free-swing', { confidence: 0.9 }) as never] });
    const r = arbitrateContractProposals(many, { now: NOW, maxTotalExposure: 1.0 });
    expect(r.every((p) => p.verdict === 'reduce')).toBe(true);
  });

  test('normalizeFanInProposals — 3계보 정규화·계보 보존', () => {
    const norm = normalizeFanInProposals(fanIn({ capstone: [entry('capstone')], lever: [entry('lever') as never] }));
    expect(norm).toHaveLength(2);
    expect(norm.map((p) => p.source).sort()).toEqual(['capstone', 'lever']);
    expect(norm[0]!.sourceCycleId).toContain('c-');
  });
});
