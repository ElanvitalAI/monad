import { test, expect, describe } from 'bun:test';
import { openAutopilotMissionsDb, getChildMissionIds } from './mission-registry.js';
import {
  createCoordinatorMission, COORDINATOR_OBSERVE_COMMAND, COORDINATOR_OBSERVE_CRON,
  buildObservedSignalEnvelope,
  classifySignalQuality,
  publishSignalQualityStates,
  COORDINATOR_FEED_CATEGORIES,
  type CoordinatorFanIn,
} from './coordinator-mission.js';

const judgmentFanIn: CoordinatorFanIn = {
  capstone: [{
    metadata: { source: 'capstone', sourceMissionId: 'mission-capstone', sourceCycleId: 'cycle-1', receivedAt: '2026-07-10T09:00:00Z' },
    envelope: {
      envelopeId: 'capstone-1', schemaVersion: '1', missionId: 'mission-coordinator', cycleId: 'cycle-1',
      correlationId: 'correlation-1', createdAt: '2026-07-10T09:00:00Z', expiresAt: '2026-07-10T10:00:00Z', producer: 'capstone',
      payload: {
        facts: [{ subject: 'price', value: 70000, observedAt: '2026-07-10T09:00:00Z' }],
        communitySentiment: [{ source: 'forum', summary: 'cautious', observedAt: '2026-07-10T09:00:00Z' }],
        evidenceUrls: ['https://example.test/evidence'], conflictingSignals: [], confidence: 0.7, abstentionReason: 'awaiting confirmation',
      },
    },
  }],
  lever: [],
  freeSwing: [],
};

void judgmentFanIn;

const at = new Date(2026, 6, 10, 9, 0, 0);
/** id slug seam — luna(LLM) 우회(테스트 결정론·네트워크 0). */
const slugFn = async (goal: string) => (goal.includes('조율') ? 'coordinator-stub' : 'child-stub');

describe('createCoordinatorMission — 미션이 조율 에이전트 생성(C3)', () => {
  test('부모 coordinator + 자식 계약 미션 + 양방향 연결', async () => {
    const db = openAutopilotMissionsDb(':memory:');
    const { parent, children } = await createCoordinatorMission(db, {
      goal: '삼성·레버 포트폴리오 조율 매매',
      source: 'manual',
      childGoals: ['삼성 캡스톤 계약', '한국 레버리지 계약'],
      now: at,
      slugFn,
    });
    // slug 보강 창구 경유 — 영문 kebab id(2026-07-14).
    expect(parent.id).toMatch(/^apm_coordinator-stub_[0-9a-f]{6}$/);
    expect(parent.execution_model).toBe('coordinator');
    expect(parent.engine).toBe('orchestrator');
    expect(children.length).toBe(2);
    // 부모 → 자식(계보 fan-in).
    expect(getChildMissionIds(db, parent.id).sort()).toEqual(children.map(c => c.id).sort());
    // 자식 → 부모(양방향).
    for (const c of children) {
      expect(db.getMission(c.id)?.autopilot?.parentMissionId).toBe(parent.id);
      expect(db.getMission(c.id)?.autopilot?.executionModel).toBe('scheduler');
    }
  });

  test('childGoals 없으면 부모만(자식 0)', async () => {
    const db = openAutopilotMissionsDb(':memory:');
    const { parent, children } = await createCoordinatorMission(db, { goal: '조율', source: 'manual', now: at, slugFn });
    expect(children.length).toBe(0);
    expect(getChildMissionIds(db, parent.id)).toEqual([]);
  });

  test('판단 fan-in 타입 사용 예는 계약별 메타데이터와 스냅샷 필드를 분리한다', () => {
    const capstone = judgmentFanIn.capstone[0];
    expect(capstone.metadata.sourceMissionId).toBe('mission-capstone');
    expect(capstone.envelope.payload.facts[0]?.value).toBe(70000);
    expect(capstone.envelope.payload.communitySentiment[0]?.summary).toBe('cautious');
    expect(capstone.envelope.payload.evidenceUrls).toEqual(['https://example.test/evidence']);
    expect(capstone.envelope.payload.conflictingSignals).toEqual([]);
    expect(capstone.envelope.payload.confidence).toBe(0.7);
    expect(capstone.envelope.payload.abstentionReason).toBe('awaiting confirmation');
  });

  test('오케스트레이터 관측 크론 상수 — READ-ONLY 관측·정규장', () => {
    expect(COORDINATOR_OBSERVE_COMMAND).toContain('trade-orchestrator-observe');
    expect(COORDINATOR_OBSERVE_CRON).toBe('5,35 9-15 * * 1-5');
  });
});

describe('buildObservedSignalEnvelope — 표준 관측 envelope 단일 생성 경로', () => {
  test('모든 envelope에 시점·출처·단위·신뢰도·TTL·원문 해시를 빠짐없이 채운다', () => {
    const env = buildObservedSignalEnvelope({
      value: 70000,
      raw: { px: 70000, src: 'krx' },
      observedAt: '2026-07-10T09:00:00Z',
      source: 'price-guard',
      unit: 'KRW',
      confidence: 0.9,
      ttlMs: 60_000,
    });
    expect(env.value).toBe(70000);
    expect(env.observedAt).toBe('2026-07-10T09:00:00Z');
    expect(env.source).toBe('price-guard');
    expect(env.unit).toBe('KRW');
    expect(env.confidence).toBe(0.9);
    expect(env.ttlMs).toBe(60_000);
    expect(env.rawHash).toMatch(/^[0-9a-f]{40}$/);
    expect(env.qualityState).toBe('normal');
  });

  test('Date observedAt 를 ISO 문자열로 정규화한다', () => {
    const env = buildObservedSignalEnvelope({
      value: 1, raw: 1, observedAt: new Date('2026-07-10T09:00:00.000Z'),
      source: 's', unit: 'u', confidence: 0.5, ttlMs: 1000,
    });
    expect(env.observedAt).toBe('2026-07-10T09:00:00.000Z');
  });

  test('원문 해시는 같은 원문 입력에 대해 결정적이며 키 순서에 무관하다', () => {
    const a = buildObservedSignalEnvelope({
      value: 1, raw: { a: 1, b: 2 }, observedAt: 't', source: 's', unit: 'u', confidence: 1, ttlMs: 1,
    });
    const b = buildObservedSignalEnvelope({
      value: 1, raw: { b: 2, a: 1 }, observedAt: 't', source: 's', unit: 'u', confidence: 1, ttlMs: 1,
    });
    expect(a.rawHash).toBe(b.rawHash);
    const c = buildObservedSignalEnvelope({
      value: 1, raw: { a: 1, b: 3 }, observedAt: 't', source: 's', unit: 'u', confidence: 1, ttlMs: 1,
    });
    expect(c.rawHash).not.toBe(a.rawHash);
  });

  test('undefined·BigInt·순환 참조 원문도 예외 없이 결정적 해시를 만든다', () => {
    const undef = buildObservedSignalEnvelope({
      value: null, raw: undefined, observedAt: 't', source: 's', unit: 'u', confidence: 0, ttlMs: 0,
    });
    expect(undef.rawHash).toMatch(/^[0-9a-f]{40}$/);
    const big = buildObservedSignalEnvelope({
      value: 1, raw: { n: 10n }, observedAt: 't', source: 's', unit: 'u', confidence: 0, ttlMs: 0,
    });
    expect(big.rawHash).toMatch(/^[0-9a-f]{40}$/);
    const cyc: Record<string, unknown> = { a: 1 };
    cyc.self = cyc;
    const circular = buildObservedSignalEnvelope({
      value: 1, raw: cyc, observedAt: 't', source: 's', unit: 'u', confidence: 0, ttlMs: 0,
    });
    expect(circular.rawHash).toMatch(/^[0-9a-f]{40}$/);
  });

  test('qualityState 를 명시하면 보존한다(정책 판정은 하지 않음)', () => {
    const env = buildObservedSignalEnvelope({
      value: 1, raw: 1, observedAt: 't', source: 's', unit: 'u', confidence: 0, ttlMs: 0, qualityState: 'delayed',
    });
    expect(env.qualityState).toBe('delayed');
  });
});

describe('classifySignalQuality — fail-closed 신호 품질 판정기', () => {
  const now = '2026-07-14T12:00:00Z';
  const fresh = '2026-07-14T11:59:59Z';
  const stale = '2026-07-14T11:00:00Z';

  test('결측 입력 → missing', () => {
    expect(classifySignalQuality({ value: undefined, observedAt: fresh, now, ttlMs: 60_000 })).toBe('missing');
    expect(classifySignalQuality({ value: null, observedAt: fresh, now, ttlMs: 60_000 })).toBe('missing');
  });

  test('TTL 초과 입력 → delayed', () => {
    expect(classifySignalQuality({ value: 42, observedAt: stale, now, ttlMs: 60_000 })).toBe('delayed');
  });

  test('명시적 provider 오류 → error', () => {
    expect(classifySignalQuality({ value: 42, observedAt: fresh, now, ttlMs: 60_000, providerError: new Error('boom') })).toBe('error');
    expect(classifySignalQuality({ value: 42, observedAt: fresh, now, ttlMs: 60_000, providerError: 'rate-limited' })).toBe('error');
  });

  test('유효한 최신 입력 → normal', () => {
    expect(classifySignalQuality({ value: 42, observedAt: fresh, now, ttlMs: 60_000 })).toBe('normal');
  });

  test('연속 0 이 임계 횟수에 도달하면 → error (임계 미만은 normal)', () => {
    expect(classifySignalQuality({ value: 0, observedAt: fresh, now, ttlMs: 60_000, consecutiveZeroCount: 2, consecutiveZeroThreshold: 3 })).toBe('error');
    expect(classifySignalQuality({ value: 0, observedAt: fresh, now, ttlMs: 60_000, consecutiveZeroCount: 0, consecutiveZeroThreshold: 3 })).toBe('normal');
    expect(classifySignalQuality({ value: 0, observedAt: fresh, now, ttlMs: 60_000, previousValue: 0, consecutiveZeroCount: 2 })).toBe('error');
  });

  test('빈 파생 결과 → error (비지 않은 파생은 normal)', () => {
    expect(classifySignalQuality({ value: 42, observedAt: fresh, now, ttlMs: 60_000, derived: [] })).toBe('error');
    expect(classifySignalQuality({ value: 42, observedAt: fresh, now, ttlMs: 60_000, derived: [1] })).toBe('normal');
  });

  test('미검증 단위 → error', () => {
    expect(classifySignalQuality({ value: 42, observedAt: fresh, now, ttlMs: 60_000, unitValidated: false })).toBe('error');
    expect(classifySignalQuality({ value: 42, observedAt: fresh, now, ttlMs: 60_000, unitValidated: true })).toBe('normal');
  });

  test('장중 잠정치 → error', () => {
    expect(classifySignalQuality({ value: 42, observedAt: fresh, now, ttlMs: 60_000, provisional: true })).toBe('error');
  });

  test('상충 소스 → error', () => {
    expect(classifySignalQuality({ value: 42, observedAt: fresh, now, ttlMs: 60_000, sourcesAgree: false })).toBe('error');
    expect(classifySignalQuality({ value: 42, observedAt: fresh, now, ttlMs: 60_000, sourcesAgree: true })).toBe('normal');
  });

  test('미래 관측 시점 → error (fail-closed)', () => {
    expect(classifySignalQuality({ value: 42, observedAt: '2026-07-14T12:00:01Z', now, ttlMs: 60_000 })).toBe('error');
  });

  test('파싱 불가한 observedAt → error', () => {
    expect(classifySignalQuality({ value: 42, observedAt: 'not-a-date', now, ttlMs: 60_000 })).toBe('error');
    expect(classifySignalQuality({ value: 42, observedAt: null, now, ttlMs: 60_000 })).toBe('error');
  });

  test('누락/음수/NaN ttlMs → error (fail-closed)', () => {
    expect(classifySignalQuality({ value: 42, observedAt: fresh, now })).toBe('error');
    expect(classifySignalQuality({ value: 42, observedAt: fresh, now, ttlMs: -1 })).toBe('error');
    expect(classifySignalQuality({ value: 42, observedAt: fresh, now, ttlMs: NaN })).toBe('error');
  });

  test('Date 입력과 now 기본값도 정상 판정한다', () => {
    const d = new Date();
    expect(classifySignalQuality({ value: 42, observedAt: d, ttlMs: 60_000 })).toBe('normal');
  });
});

describe('publishSignalQualityStates — 여섯 피드+포지션 품질 게시(축소 계약)', () => {
  const now = new Date('2026-07-14T12:00:00Z');
  const fresh = '2026-07-14T11:59:30Z';

  test('여섯 피드 + 포지션 총 7개 슬롯을 빠짐없이 게시한다', () => {
    const published = publishSignalQualityStates({}, now);
    expect(published.length).toBe(COORDINATOR_FEED_CATEGORIES.length + 1);
    const slots = published.map((p) => p.slot);
    for (const cat of COORDINATOR_FEED_CATEGORIES) expect(slots).toContain(cat);
    expect(slots).toContain('position');
  });

  test('관측 누락 슬롯은 missing envelope 로 게시된다(관측 부재 인지)', () => {
    const published = publishSignalQualityStates({}, now);
    for (const p of published) {
      expect(p.qualityState).toBe('missing');
      expect(p.envelope.qualityState).toBe('missing');
      expect(p.envelope.source).toBe('coordinator:unobserved');
    }
  });

  test('값 존재+시점 유효 → normal, 원문 해시가 채워진다', () => {
    const published = publishSignalQualityStates(
      { flow: { value: 1234, raw: { net: 1234 }, observedAt: fresh, source: 'kis', unit: 'KRW', confidence: 0.9, ttlMs: 60_000 } },
      now,
    );
    const flow = published.find((p) => p.slot === 'flow')!;
    expect(flow.qualityState).toBe('normal');
    expect(flow.envelope.value).toBe(1234);
    expect(flow.envelope.rawHash).toMatch(/^[0-9a-f]{40}$/);
  });

  test('결측/파싱실패/provider오류는 fail-closed 로 게시된다', () => {
    const published = publishSignalQualityStates(
      {
        community: { value: null, observedAt: fresh },
        breaking: { value: 42, observedAt: 'not-a-date' },
        regime: { value: 42, observedAt: fresh, providerError: 'timeout' },
      },
      now,
    );
    expect(published.find((p) => p.slot === 'community')!.qualityState).toBe('missing');
    expect(published.find((p) => p.slot === 'breaking')!.qualityState).toBe('error');
    expect(published.find((p) => p.slot === 'regime')!.qualityState).toBe('error');
  });

  test('축소 계약 — 신선도(TTL) semantics 는 게시 단계에서 재유입되지 않는다(후속 defer)', () => {
    // TTL 을 아득히 넘긴 오래된 관측이라도 값이 존재하면 게시 단계는 normal(존재/결측 기준).
    const stale = '2020-01-01T00:00:00Z';
    const published = publishSignalQualityStates(
      { quote: { value: 70000, observedAt: stale, ttlMs: 1 } },
      now,
    );
    expect(published.find((p) => p.slot === 'quote')!.qualityState).toBe('normal');
  });
});

// ★ [외부 구현·claude-code·2026-07-16] 조율 market_posture 소비 seam(arc-2 배선·phase 7).
import { observeMarketPosture } from './coordinator-mission.js';
import type { MarketPosture } from '../domains/market-posture.js';

const posture = (over: Partial<MarketPosture> = {}): MarketPosture => ({
  schemaVersion: 'market-posture/v2', asOf: '2026-07-16T00:00:00.000Z', defcon: 5,
  response: { cadenceMultiplier: 1, depth: 'rules', alertMode: 'batch', emergencySweep: false, gate2HitlRequired: false },
  provenance: { sources: ['regime.db', 'capstone_regime.json'], calculatedBy: 'market-posture-cycle' },
  freshness: { status: 'FRESH', observedAt: '2026-07-16T00:00:00.000Z', ageMs: 0 },
  regime: { composite: 0.1, label: 'RISK_ON', transition: false, transitionAxes: [], asOf: '2026-07-16T00:00:00.000Z' },
  leverage: { regime: 'NEUTRAL' as never, effectiveExposure: 1 },
  ...over,
});

describe('observeMarketPosture — 조율 posture 소비 seam(arc-2·read-only)', () => {
  test('FRESH posture → normal·DEFCON·근거·시각 연결', () => {
    const env = observeMarketPosture({ load: () => posture({ defcon: 3 }) });
    expect(env.qualityState).toBe('normal');
    expect(env.value?.defcon).toBe(3);
    expect(env.value?.regimeLabel).toBe('RISK_ON');
    expect(env.value?.asOf).toBe('2026-07-16T00:00:00.000Z');
    expect(env.value?.evidenceSources).toBe(2);
  });
  test('노후(freshness UNKNOWN) → delayed', () => {
    const env = observeMarketPosture({ load: () => posture({ freshness: { status: 'UNKNOWN', observedAt: 'x', ageMs: 0 } }) });
    expect(env.qualityState).toBe('delayed');
    expect(env.value?.freshness).toBe('UNKNOWN');
  });
  test('누락(생산자 미게시) → missing·value null(fail-closed)', () => {
    const env = observeMarketPosture({ load: () => null, now: () => Date.parse('2026-07-16T01:00:00Z') });
    expect(env.qualityState).toBe('missing');
    expect(env.value).toBeNull();
  });
  test('read-only — 집행/방향성 필드 없음(계약 강제·기민성 축)', () => {
    const env = observeMarketPosture({ load: () => posture() });
    expect(env.value).not.toHaveProperty('freezeNewBuys');
    expect(env.value).not.toHaveProperty('side');
    expect(env.value).not.toHaveProperty('order');
  });
});
