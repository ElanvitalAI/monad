// ── Coordinator Mission — 미션이 조율 오케스트레이터를 생성·제어 (C3 · 2026-07-10) ──
//
// PLAN-trade-coordinator-mission C3. 대표 통찰의 실현: "미션에서 종합 조율 에이전트를
// 생성할 수 있는 능력." coordinator 미션 하나가 (1) 하위 계약 미션들을 자식으로 묶고
// (계보 fan-in) (2) 포트폴리오 오케스트레이터 관측 크론을 배선한다.
//
// 안전: 관측 크론은 trade-orchestrator-observe(READ-ONLY·dry·집행 0). 실 크론 등록은
// materialize-mandate arming 게이트 뒤(기본 disarmed·fail-closed). 실집행은 C4·대표 HITL.

import { createHash } from 'node:crypto';
import { TaskStore } from '../task-orchestrator/store.js';
import type { Severity } from '../domains/signal-pool.js';
import { loadMarketPosture } from '../domains/market-posture-store.js';
import type { MarketPosture } from '../domains/market-posture.js';
import { createMissionWithSlug, attachChildMission, type MissionRow, type MissionSource } from './mission-registry.js';

/** Existing research boundaries selected by a coordinator plan, never invoked here. */
export type ResearchLens = 'runGate2' | 'runReactiveLens' | 'runDig';

/**
 * Selects the existing research route without invoking it. S3/S4 are the
 * existing critical severities: all events retain Gate2, while only critical
 * events continue through sector, stock, then quote/liquidity investigation.
 */
export function routeResearchLens(severity: Severity | undefined): readonly ResearchLens[] {
  return severity === 'S3' || severity === 'S4'
    ? ['runGate2', 'runReactiveLens', 'runDig']
    : ['runGate2'];
}


/** 오케스트레이터 관측 크론 — schedule_manage 가 cd/bun/로그 자동보강(상대경로 OK). */
export const COORDINATOR_OBSERVE_COMMAND = 'scripts/trade-orchestrator-observe.ts';
/** 정규장 5,35분(규칙 사이클·레버 사이클 직후) — blackboard 최신 반영 후 통합 관측. */
export const COORDINATOR_OBSERVE_CRON = '5,35 9-15 * * 1-5';

export interface CreateCoordinatorInput {
  goal: string;
  source: MissionSource;
  /** 하위 계약 에이전트 미션 골(예: 삼성 캡스톤·한국 레버). 각자 자식 미션으로 생성·연결. */
  childGoals?: string[];
  now?: Date;
  /** id 영문 slug 생성 seam(테스트 격리·luna 우회). 기본 generateMissionSlug. */
  slugFn?: (goal: string) => Promise<string>;
}
/**
 * 후속 판단 단계가 공유하는 공통 운반 형식이다. 정확히 9개 필드만 가지며,
 * 시간·신뢰도·메타데이터의 유효성 검사는 이 타입 경계의 책임이 아니다.
 */
export interface CoordinatorEnvelope<TPayload> {
  envelopeId: string;
  schemaVersion: string;
  missionId: string;
  cycleId: string;
  correlationId: string;
  createdAt: string;
  expiresAt: string;
  producer: string;
  payload: TPayload;
}

/** 관측 신호의 현재 품질 상태다. */
export type SignalQualityState = 'normal' | 'delayed' | 'missing' | 'error';

/** 판단 이전에 원문 출처와 품질을 보존하는 범용 관측 신호다. */
export interface ObservedSignalEnvelope<TValue> {
  value: TValue;
  observedAt: string;
  source: string;
  unit: string;
  confidence: number;
  ttlMs: number;
  rawHash: string;
  qualityState: SignalQualityState;
}

/** 관측 신호 envelope 생성 입력 — 기존 signal/position 값과 시점·출처·단위 정보를 그대로 전달. */
export interface BuildObservedSignalInput<TValue> {
  /** 판단이 소비할 정규화된 값(기존 signal/position 그대로). */
  value: TValue;
  /** 원문 입력(임의 타입). 결정적 해시의 대상이며 envelope에는 해시만 남긴다. */
  raw: unknown;
  /** 관측 시점 — 기존 timestamp(ISO 문자열 또는 Date). */
  observedAt: string | Date;
  /** 원문 출처(기존 source 정보). */
  source: string;
  /** 값의 단위(기존 unit 정보). */
  unit: string;
  /** 관측 신뢰도(0..1). */
  confidence: number;
  /** 신선도 만료(밀리초). */
  ttlMs: number;
  /** 품질 상태. 정책 판정은 이 단계 범위 밖 — 미지정 시 'normal' 기본값만 채운다. */
  qualityState?: SignalQualityState;
}

/**
 * 원문 입력을 결정적 문자열로 안전 직렬화한다. `undefined`/함수는 표식으로 치환하고,
 * BigInt 는 문자열로, 순환 참조는 '[circular]' 로 안전 처리하며 객체 키는 정렬해
 * 같은 원문 입력이 항상 같은 문자열이 되도록 한다. (JSON.stringify 가 undefined 를
 * 반환하는 최상위 케이스도 결정적 표식으로 닫는다.)
 */
function stableSerializeRaw(raw: unknown): string {
  const seen = new WeakSet<object>();
  const serialized = JSON.stringify(raw, (_key, val) => {
    if (typeof val === 'bigint') return `__bigint__:${val.toString()}`;
    if (typeof val === 'function') return '__function__';
    if (typeof val === 'undefined') return '__undefined__';
    if (val !== null && typeof val === 'object') {
      if (seen.has(val)) return '__circular__';
      seen.add(val);
      if (!Array.isArray(val)) {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(val as Record<string, unknown>).sort()) {
          sorted[k] = (val as Record<string, unknown>)[k];
        }
        return sorted;
      }
    }
    return val;
  });
  return serialized ?? '__undefined__';
}

/**
 * ObservedSignalEnvelope 를 만드는 단일 로컬 생성 경로다. 모든 envelope 가 시점·출처·
 * 단위·신뢰도·TTL·원문 해시를 빠짐없이 갖도록 채운다. 원문 해시는 기존 모듈의 해시
 * 관례(node:crypto sha1 hex)를 재사용하며 같은 원문 입력에 대해 결정적이다. 품질 판정
 * 정책·게시 필드·신규 직렬화기는 이 단계에서 추가하지 않는다.
 */
export function buildObservedSignalEnvelope<TValue>(input: BuildObservedSignalInput<TValue>): ObservedSignalEnvelope<TValue> {
  const observedAt = input.observedAt instanceof Date ? input.observedAt.toISOString() : input.observedAt;
  const rawHash = createHash('sha1').update(stableSerializeRaw(input.raw)).digest('hex');
  return {
    value: input.value,
    observedAt,
    source: input.source,
    unit: input.unit,
    confidence: input.confidence,
    ttlMs: input.ttlMs,
    rawHash,
    qualityState: input.qualityState ?? 'normal',
  };
}

/**
 * 신호 품질 판정 입력 — 기존 값·시점·TTL·provider 오류·파생 결과·단위 검증·잠정치·소스
 * 일치 여부만 사용한다. 신규 시장·거시·파생 데이터 조회나 전이 확률 계산은 하지 않는다.
 */
export interface ClassifySignalQualityInput<TValue = unknown> {
  /** 정규화된 관측 값. undefined/null 이면 결측으로 본다. */
  value?: TValue | null;
  /** 관측 시점(ISO 문자열 또는 Date). 파싱 불가/미래 시점은 fail-closed(error). */
  observedAt?: string | Date | null;
  /** 판정 기준 현재 시각(ISO 문자열 또는 Date). 미지정 시 Date.now(). */
  now?: string | Date | null;
  /** 신선도 만료(밀리초). 누락/음수/NaN 은 fail-closed(error). */
  ttlMs?: number | null;
  /** provider 가 명시적으로 보고한 오류(있으면 error). */
  providerError?: unknown;
  /** 파생 계산 결과. 배열이면 비어 있을 때 error. */
  derived?: unknown;
  /** 단위 검증 통과 여부. 명시적 false 면 미검증 단위로 error. */
  unitValidated?: boolean;
  /** 장중 잠정치 여부. true 면 아직 확정되지 않은 값이라 error. */
  provisional?: boolean;
  /** 소스 간 일치 여부. 명시적 false 면 상충 소스로 error. */
  sourcesAgree?: boolean;
  /** 직전 관측 값(연속 0 감지용, 선택). */
  previousValue?: TValue | null;
  /** 연속 0 누적 횟수(현재 관측 이전까지의 카운트, 선택). */
  consecutiveZeroCount?: number;
  /** 연속 0 이 error 로 판정되는 임계 횟수(기본 3). */
  consecutiveZeroThreshold?: number;
}

function toEpochMs(input: string | Date | null | undefined): number | null {
  if (input == null) return null;
  const ms = input instanceof Date ? input.getTime() : Date.parse(input);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * fail-closed 단일 신호 품질 판정기다. 기존 입력만으로 네 상태(결측·지연·오류·정상)를
 * 결정한다. 정상으로 통과시키기 애매한 모든 경계(연속 0, 빈 파생 결과, 미검증 단위,
 * 장중 잠정치, 상충 소스, 미래/파싱불가 시점, 비정상 TTL)는 error 로 닫는다. 전이 확률
 * 계산이나 신규 데이터 조회는 하지 않는다.
 */
export function classifySignalQuality<TValue = unknown>(
  input: ClassifySignalQualityInput<TValue>,
): SignalQualityState {
  // 1) 결측 — 값 자체가 없다.
  if (input.value === undefined || input.value === null) return 'missing';

  // 2) 명시적 provider 오류 — fail-closed.
  if (input.providerError !== undefined && input.providerError !== null) return 'error';

  // 3) 시점 유효성 — 파싱 불가하면 fail-closed.
  const observedMs = toEpochMs(input.observedAt);
  const nowMs = input.now == null ? Date.now() : toEpochMs(input.now);
  if (observedMs === null || nowMs === null) return 'error';
  // 미래 관측은 비정상이라 fail-closed.
  if (observedMs > nowMs) return 'error';

  // 4) TTL 유효성 — 누락/음수/NaN 은 fail-closed.
  if (typeof input.ttlMs !== 'number' || !Number.isFinite(input.ttlMs) || input.ttlMs < 0) {
    return 'error';
  }

  // 5) 단위 미검증 — fail-closed.
  if (input.unitValidated === false) return 'error';

  // 6) 장중 잠정치 — 확정 전 값이라 fail-closed.
  if (input.provisional === true) return 'error';

  // 7) 상충 소스 — fail-closed.
  if (input.sourcesAgree === false) return 'error';

  // 8) 빈 파생 결과 — 배열이 비었으면 fail-closed.
  if (Array.isArray(input.derived) && input.derived.length === 0) return 'error';

  // 9) 연속 0 — 임계 횟수 이상 누적되면 fail-closed.
  const threshold = input.consecutiveZeroThreshold ?? 3;
  if (typeof input.value === 'number' && input.value === 0) {
    const priorCount = typeof input.consecutiveZeroCount === 'number' ? input.consecutiveZeroCount : 0;
    // 현재 관측을 포함한 유효 연속 횟수.
    const effective = priorCount + 1;
    if (effective >= threshold) return 'error';
  }

  // 10) 지연 — TTL 초과.
  if (nowMs - observedMs > input.ttlMs) return 'delayed';

  // 11) 정상.
  return 'normal';
}

/**
 * coordinator 가 관측하는 여섯 신호 피드 범주다. 골의 신호원(커뮤니티/속보/국면/공시/수급)
 * 과 실시간 시세를 고정 집합으로 정의한다. 신규 피드·전이 확률은 추가하지 않는다.
 */
export const COORDINATOR_FEED_CATEGORIES = [
  'community', // 커뮤니티 정성 신호
  'breaking', // 속보/뉴스
  'regime', // 국면
  'disclosure', // 공시
  'flow', // 수급
  'quote', // 실시간 시세
] as const;
export type FeedCategory = (typeof COORDINATOR_FEED_CATEGORIES)[number];

/** 게시 대상 슬롯 — 여섯 피드 범주 + 현재 포지션. */
export type QualitySlot = FeedCategory | 'position';

/**
 * 게시 입력 — 슬롯별로 관측 원자료를 그대로 전달한다. 값이 있으면 envelope 로 게시하고,
 * 없거나 파싱 실패면 fail-closed(결측/오류) envelope 로 누락 없이 게시한다. 값-품질
 * semantics(신선도·연속 0 정교화)는 이 게시 단계 범위 밖 — 후속 판정 페이즈로 이관.
 */
export interface SlotObservationInput<TValue = unknown> {
  /** 관측된 정규화 값. undefined/null 이면 결측. */
  value?: TValue | null;
  /** 원문 입력(결정적 해시 대상). */
  raw?: unknown;
  /** 관측 시점(ISO/Date). 파싱 불가면 fail-closed(error). */
  observedAt?: string | Date | null;
  /** 원문 출처. */
  source?: string;
  /** 값의 단위. */
  unit?: string;
  /** 관측 신뢰도(0..1). */
  confidence?: number;
  /** 신선도 만료(밀리초). */
  ttlMs?: number;
  /** provider 가 명시적으로 보고한 오류(있으면 error 게시). */
  providerError?: unknown;
}

/** 슬롯별 품질 상태 게시 결과 — envelope 와 4상태 중 하나를 항상 가진다. */
export interface PublishedSignalQuality<TValue = unknown> {
  slot: QualitySlot;
  qualityState: SignalQualityState;
  envelope: ObservedSignalEnvelope<TValue | null>;
}

/**
 * ★ [외부 구현·claude-code·대표 승인 2026-07-16] 조율이 market_posture(생산자·국면 감시 루프)를
 * 관측 스냅샷에 연결하는 read-only seam — DEFCON·근거(provenance)·시각(asOf)을 누락(missing)/노후
 * (delayed) 처리와 함께 기존 envelope 로 게시한다. 생산자(scripts/market-posture-cycle.ts)가 게시한
 * market_posture 를 loadMarketPosture 로 구독만 하며, 새 데이터 조회·전이 확률·방향성 주문·집행은
 * 하지 않는다(계약이 강제). ★DEFCON=기민성 축(집행 방향과 직교) — 조율은 posture 를 문맥으로 읽을
 * 뿐 집행 트리거가 아니다. 기존 buildObservedSignalEnvelope 만 재사용(신규 직렬화기·게시경로 없음).
 */
export interface CoordinatorMarketPostureView {
  defcon: number;
  regimeLabel: string;
  asOf: string;
  freshness: string;
  /** 근거 수(provenance.sources) — "DEFCON·근거·시각" 중 근거. */
  evidenceSources: number;
}

export function observeMarketPosture(
  deps: { load?: () => MarketPosture | null; now?: () => number } = {},
): ObservedSignalEnvelope<CoordinatorMarketPostureView | null> {
  const posture = (deps.load ?? loadMarketPosture)();
  const nowMs = (deps.now ?? Date.now)();
  if (!posture) {
    // 누락 — 생산자 미게시/결측. fail-closed(missing) envelope 로 닫아 소비자가 "관측 안 됨"을 안다.
    return buildObservedSignalEnvelope<CoordinatorMarketPostureView | null>({
      value: null, raw: null, observedAt: new Date(nowMs).toISOString(),
      source: 'market-posture', unit: 'defcon', confidence: 0, ttlMs: 0, qualityState: 'missing',
    });
  }
  // 노후 — freshness 가 FRESH 가 아니면(STALE/UNKNOWN) delayed 로 표기(누락/노후 처리·arc-2 요구).
  const fresh = posture.freshness?.status ?? 'UNKNOWN';
  const qualityState: SignalQualityState = fresh === 'FRESH' ? 'normal' : 'delayed';
  const sources = posture.provenance?.sources ?? [];
  const view: CoordinatorMarketPostureView = {
    defcon: posture.defcon, regimeLabel: posture.regime.label, asOf: posture.asOf,
    freshness: fresh, evidenceSources: sources.length,
  };
  return buildObservedSignalEnvelope<CoordinatorMarketPostureView | null>({
    value: view, raw: posture, observedAt: posture.asOf,
    source: sources.join(',') || 'market-posture', unit: 'defcon', confidence: 1, ttlMs: 0, qualityState,
  });
}

/**
 * 축소 계약 판정 — 존재/결측만으로 4상태 중 하나를 정한다. provider 오류·시점 파싱
 * 실패는 fail-closed(error), 값 결측은 missing, 그 외 값 존재는 normal. 신선도(TTL)·
 * 연속 0 등 정교한 값-품질 판정은 후속 페이즈로 defer(여기서 하지 않는다).
 */
function classifyExistence(obs: SlotObservationInput): SignalQualityState {
  if (obs.providerError !== undefined && obs.providerError !== null) return 'error';
  if (obs.value === undefined || obs.value === null) return 'missing';
  if (obs.observedAt != null) {
    const ms = obs.observedAt instanceof Date ? obs.observedAt.getTime() : Date.parse(obs.observedAt);
    if (!Number.isFinite(ms)) return 'error'; // 시점 파싱 실패 — fail-closed.
  }
  return 'normal';
}

/**
 * 여섯 피드 범주 + 현재 포지션의 품질 상태를 게시한다(축소 계약: 존재/결측 기준).
 * 각 슬롯을 빠짐없이 게시하며 — 값이 있으면 classifySignalQuality 판정, 없거나 시점
 * 파싱 실패면 fail-closed(결측/오류) envelope 로 닫는다. 누락된 슬롯도 결측 envelope 로
 * 게시해 소비자가 "관측 안 됨"과 "정상 0"을 구분하게 한다. 신규 데이터 조회·전이 확률
 * 계산은 하지 않으며 기존 buildObservedSignalEnvelope/classifySignalQuality 만 재사용한다.
 */
export function publishSignalQualityStates(
  observations: Partial<Record<QualitySlot, SlotObservationInput>>,
  now?: Date,
): PublishedSignalQuality[] {
  const slots: QualitySlot[] = [...COORDINATOR_FEED_CATEGORIES, 'position'];
  const nowIso = (now ?? new Date()).toISOString();
  return slots.map((slot): PublishedSignalQuality => {
    const obs = observations[slot];
    // 관측 자체가 누락 — 결측 envelope 로 게시(소비자가 관측 부재를 인지).
    if (obs === undefined) {
      return {
        slot,
        qualityState: 'missing',
        envelope: buildObservedSignalEnvelope<null>({
          value: null,
          raw: null,
          observedAt: nowIso,
          source: 'coordinator:unobserved',
          unit: 'none',
          confidence: 0,
          ttlMs: 0,
          qualityState: 'missing',
        }),
      };
    }
    // 관측 존재 — 축소 계약(존재/결측)만으로 판정한다. 신선도·연속 0 등 값-품질
    // semantics 는 D3 협상에 따라 후속 판정 페이즈로 defer(여기서 재유입하지 않는다).
    const qualityState = classifyExistence(obs);
    const envelope = buildObservedSignalEnvelope<unknown>({
      value: obs.value ?? null,
      raw: obs.raw ?? obs.value ?? null,
      observedAt: obs.observedAt ?? nowIso,
      source: obs.source ?? `coordinator:${slot}`,
      unit: obs.unit ?? 'none',
      confidence: obs.confidence ?? (obs.value == null ? 0 : 1),
      ttlMs: obs.ttlMs ?? 0,
      qualityState,
    });
    return { slot, qualityState, envelope };
  });
}

/** 관측값이 직접 확인한 사실인지, 그 관측에서 도출한 추론인지를 명시한다. */
export type EvidenceKind = 'fact' | 'inference';

/** 기존 관측 envelope 와 출처 접근 상태를 근거 묶음으로 넘기는 순수 입력이다. */
export interface EvidenceObservation<TValue = unknown> {
  subject: string;
  kind: EvidenceKind;
  envelope: ObservedSignalEnvelope<TValue>;
  /** 명시적 false 는 해당 출처를 현재 근거로 사용할 수 없음을 뜻한다. */
  sourceAccessible?: boolean;
}

/** 사실/추론에 공통으로 보존하는 원 관측과 출처 신뢰도다. */
export interface EvidenceItem<TValue = unknown> {
  subject: string;
  value: TValue;
  observedAt: string;
  source: string;
  confidence: number;
  unit: string;
  rawHash: string;
}

/** 근거에 포함된 출처의 신뢰도를 원 관측의 confidence 로 표현한다. */
export interface EvidenceSourceReliability {
  source: string;
  confidence: number;
}

/** 같은 대상에 서로 다른 유효 관측값이 있을 때만 남기는 해결 전 상충점이다. */
export interface EvidenceConflict {
  subject: string;
  observations: EvidenceItem[];
}

export type EvidenceGapReason = 'missing' | 'expired' | 'inaccessible' | 'unavailable';

/** 근거로 제외된 관측과 그 제외 사유다. */
export interface EvidenceDataGap {
  subject: string;
  source: string;
  reason: EvidenceGapReason;
}

/** 사실, 추론, 신뢰도, 상충, 공백을 판단 없이 분리 보존하는 순수 결과다. */
export interface EvidenceBundle {
  facts: EvidenceItem[];
  inferences: EvidenceItem[];
  sourceReliability: EvidenceSourceReliability[];
  conflicts: EvidenceConflict[];
  dataGaps: EvidenceDataGap[];
}

function evidenceItem(observation: EvidenceObservation): EvidenceItem {
  const { envelope } = observation;
  return {
    subject: observation.subject,
    value: envelope.value,
    observedAt: envelope.observedAt,
    source: envelope.source,
    confidence: envelope.confidence,
    unit: envelope.unit,
    rawHash: envelope.rawHash,
  };
}

/**
 * 기존 관측만 정규화하여 판단 입력을 만든다. 유효 기간이 끝났거나 접근할 수 없는
 * 출처는 사실/추론에서 제외하고 공백으로 남긴다. 네트워크, 도구, 시장 데이터 조회는
 * 전혀 수행하지 않는다.
 */
export function buildEvidenceBundle(
  observations: readonly EvidenceObservation[],
  now: string | Date,
): EvidenceBundle {
  const nowMs = toEpochMs(now);
  const facts: EvidenceItem[] = [];
  const inferences: EvidenceItem[] = [];
  const sourceReliability: EvidenceSourceReliability[] = [];
  const dataGaps: EvidenceDataGap[] = [];

  for (const observation of observations) {
    const { envelope } = observation;
    const observedMs = toEpochMs(envelope.observedAt);
    const expired = observedMs === null || nowMs === null || nowMs > observedMs + envelope.ttlMs;
    let gapReason: EvidenceGapReason | undefined;
    if (observation.sourceAccessible === false) gapReason = 'inaccessible';
    else if (expired || envelope.qualityState === 'delayed') gapReason = 'expired';
    else if (envelope.qualityState === 'missing') gapReason = 'missing';
    else if (envelope.qualityState === 'error') gapReason = 'unavailable';

    if (gapReason !== undefined) {
      dataGaps.push({ subject: observation.subject, source: envelope.source, reason: gapReason });
      continue;
    }

    const item = evidenceItem(observation);
    if (observation.kind === 'fact') facts.push(item);
    else inferences.push(item);
    sourceReliability.push({ source: envelope.source, confidence: envelope.confidence });
  }

  const included = [...facts, ...inferences];
  const conflicts = [...new Set(included.map((item) => item.subject))].flatMap((subject) => {
    const items = included.filter((item) => item.subject === subject);
    const values = new Set(items.map((item) => stableSerializeRaw(item.value)));
    return values.size > 1 ? [{ subject, observations: items }] : [];
  });

  return { facts, inferences, sourceReliability, conflicts, dataGaps };
}

/** 기존 조사 경계에 넘길 관측과 심각도 입력이다. */
export interface ResearchEntryRequest {
  severity: Severity | undefined;
  observations: readonly EvidenceObservation[];
  now: string | Date;
}

/** 기존 Gate2/reactive/dig 경계가 소비할 선택 경로와 정규화된 근거다. */
export interface ResearchEntryInput {
  lenses: readonly ResearchLens[];
  evidence: EvidenceBundle;
}

/** Existing Gate2/reactive-dig entry boundary; execution remains outside the coordinator. */
export type ResearchEntryPoint<TResult = void> = (input: ResearchEntryInput) => TResult;

/**
 * 조사 경로를 선택하기 직전에 기존 관측을 근거로 정규화한다. 만료·접근 불가 관측은
 * buildEvidenceBundle 이 dataGaps 로만 보존하므로, 이 함수는 별도 조회나 출처 복구 없이
 * 유효한 근거와 기존 조사 렌즈만 같은 입력으로 전달한다.
 */
export function buildResearchEntryInput(request: ResearchEntryRequest): ResearchEntryInput {
  const evidence = buildEvidenceBundle(request.observations, request.now);
  return { lenses: routeResearchLens(request.severity), evidence };
}

/**
 * 선택된 기존 조사 계획과 같은 근거 묶음만 기존 진입점에 전달한다. coordinator 는 이
 * 경계에서 조사 실행, 외부 조회, 또는 미관측 국면의 보완을 하지 않는다.
 */
export function handoffResearchEntry<TResult>(
  request: ResearchEntryRequest,
  entrypoint: ResearchEntryPoint<TResult>,
): TResult {
  return entrypoint(buildResearchEntryInput(request));
}

/** 판단에서 분리 보존하는 관측 사실이다. */
export interface JudgmentFact {
  subject: string;
  value: string | number | boolean | null;
  observedAt: string;
}

/** 커뮤니티 심리는 사실 및 최종 판단과 별도로 담는다. */
export interface CommunitySentiment {
  source: string;
  summary: string;
  observedAt: string;
}

/** 상충하는 신호는 해결 여부를 강제하지 않는 원자료다. */
export interface ConflictingSignal {
  source: string;
  summary: string;
  observedAt: string;
}

/** 후속 판단 및 승인 단계가 소비할, 검증 없는 판단 스냅샷이다. */
export interface JudgmentSnapshot {
  facts: JudgmentFact[];
  communitySentiment: CommunitySentiment[];
  evidenceUrls: string[];
  conflictingSignals: ConflictingSignal[];
  confidence: number;
  abstentionReason?: string;
}

/** fan-in 입력이 어느 미션과 사이클에서 도착했는지를 보존한다. */
export interface FanInMetadata {
  source: 'capstone' | 'lever' | 'free-swing';
  sourceMissionId: string;
  sourceCycleId: string;
  receivedAt: string;
}

export interface CapstoneFanInEntry {
  metadata: FanInMetadata & { source: 'capstone' };
  envelope: CoordinatorEnvelope<JudgmentSnapshot>;
}

export interface LeverFanInEntry {
  metadata: FanInMetadata & { source: 'lever' };
  envelope: CoordinatorEnvelope<JudgmentSnapshot>;
}

export interface FreeSwingFanInEntry {
  metadata: FanInMetadata & { source: 'free-swing' };
  envelope: CoordinatorEnvelope<JudgmentSnapshot>;
}

/** 세 계약 계보의 판단 입력을 구분한 coordinator fan-in 형식이다. */
export interface CoordinatorFanIn {
  capstone: CapstoneFanInEntry[];
  lever: LeverFanInEntry[];
  freeSwing: FreeSwingFanInEntry[];
}

// ── A2 실패-폐쇄형 2단 판단 정책 (phase 12 · 정의모듈·운영 크론 배선=arming HITL·2026-07-15) ──
//   대표 결정(mission_decide re-ground): 판단 함수는 여기 정의·단위/통합테스트로 검증. 런타임
//   createCoordinatorMission 배선은 disarmed·arming 단계. 전이 확률·신규 조회 없음(기존 신호만).

export type AlertGrade = 'critical' | 'elevated' | 'watch' | 'muted';
export type CoordinatorRegime = 'risk-on' | 'risk-off' | 'neutral' | 'uncertain';

export interface CoordinatorDecisionInput {
  evidence: EvidenceBundle;
  qualityStates: readonly PublishedSignalQuality[];
  severity: Severity | undefined;
  /** 2차 luna 판단 — abstain 이면 주문 후보 철회(단, 1차 하드 게이트 우회 불가). */
  lunaAbstain?: boolean;
  lunaReason?: string;
}
export interface CoordinatorDecision {
  gate1Pass: boolean;
  orderCandidate: boolean;
  dataFaultAlert: boolean;
  regime: CoordinatorRegime;
  alertGrade: AlertGrade;
  abstained: boolean;
  rationale: string;
}

/** 국면 단순 규칙 분류 — 유효 사실의 방향(키워드/부호) 카운트. 전이 확률·신규 조회 없음. */
function classifyRegimeSimple(ev: EvidenceBundle): CoordinatorRegime {
  if (ev.facts.length === 0) return 'uncertain';
  let on = 0, off = 0;
  for (const f of ev.facts) {
    if (/risk-?on|상승|매수|긍정/i.test(f.subject)) on++;
    else if (/risk-?off|하락|매도|위험|부정/i.test(f.subject)) off++;
    else if (typeof f.value === 'number') { if (f.value > 0) on++; else if (f.value < 0) off++; }
  }
  if (ev.conflicts.length > 0 && Math.abs(on - off) <= 1) return 'uncertain';
  if (on > off) return 'risk-on';
  if (off > on) return 'risk-off';
  return 'neutral';
}

function gradeAlert(x: { gate1Pass: boolean; critical: boolean; decisive: boolean; evidence: EvidenceBundle }): AlertGrade {
  if (!x.gate1Pass) return 'watch'; // 데이터 장애 = 관찰(주문 아님)
  const thin = x.evidence.facts.length + x.evidence.inferences.length === 0 || x.evidence.dataGaps.length > x.evidence.facts.length;
  if (thin) return 'muted'; // 근거 부족 → 강등
  if (x.critical && x.decisive) return 'critical';
  if (x.critical || x.decisive) return 'elevated';
  return 'watch';
}

/**
 * 실패-폐쇄형 2단 판단(phase 12) — 1차 하드 게이트(품질)→2차 luna→국면→알림 등급을 하나로 구성한다.
 * 1차 품질 실패는 주문 후보가 아니라 데이터 장애 알림으로 귀결. luna abstain 은 후보 철회하나 하드
 * 게이트 우회 불가. 국면은 단순 규칙(전이 확률 없음). 근거 부족·TTL 만료 시 알림 강등. 순수.
 */
export function evaluateCoordinatorDecision(input: CoordinatorDecisionInput): CoordinatorDecision {
  const states = input.qualityStates;
  const total = states.length || 1;
  const errorOrMissing = states.filter((s) => s.qualityState === 'error' || s.qualityState === 'missing').length;
  const gate1Pass = states.length > 0 && errorOrMissing / total < 0.5 && input.evidence.dataGaps.length <= errorOrMissing + 2;
  const dataFaultAlert = !gate1Pass;
  const regime = classifyRegimeSimple(input.evidence);
  const abstained = input.lunaAbstain === true;
  const decisive = regime === 'risk-on' || regime === 'risk-off';
  const critical = input.severity === 'S3' || input.severity === 'S4';
  const orderCandidate = gate1Pass && !abstained && decisive && critical;
  const alertGrade = gradeAlert({ gate1Pass, critical, decisive, evidence: input.evidence });
  const rationale = dataFaultAlert
    ? `1차 품질 게이트 실패(error/missing ${errorOrMissing}/${total}) → 데이터 장애 알림·주문 후보 아님`
    : abstained ? `luna abstain(${input.lunaReason ?? ''}) → 주문 후보 철회(하드 게이트 우회 아님)`
    : `국면 ${regime}·심각도 ${input.severity ?? 'none'}·주문후보 ${orderCandidate}`;
  return { gate1Pass, orderCandidate, dataFaultAlert, regime, alertGrade, abstained, rationale };
}

// ── A2 계약 제안 위험 중재 (phase 13 · blackboard fan-in·2026-07-15) ──
export type ArbitrationVerdict = 'accept' | 'reduce' | 'reject';
export interface NormalizedProposal {
  source: 'capstone' | 'lever' | 'free-swing';
  confidence: number;
  expectedLoss: number;
  expiresAt: string;
  /** 계보 보존 — 상위 미션·사이클 ID. */
  sourceMissionId: string;
  sourceCycleId: string;
  hasEvidence: boolean;
}
export interface ArbitratedProposal extends NormalizedProposal {
  verdict: ArbitrationVerdict;
  reason: string;
}
export interface ArbitrationOptions {
  now: string | Date;
  /** 파생(레버) 검증 결측 — true 면 레버리지 제안 차단. */
  derivativeVerificationMissing?: boolean;
  /** 총 익스포저(정규화 confidence 합) 상한. 초과 시 reduce. */
  maxTotalExposure?: number;
}

/** fan-in 3계보 제안을 표준 형식으로 정규화(계보 ID 보존). 순수. */
export function normalizeFanInProposals(fanIn: CoordinatorFanIn): NormalizedProposal[] {
  const all = [...fanIn.capstone, ...fanIn.lever, ...fanIn.freeSwing];
  return all.map((e) => ({
    source: e.metadata.source,
    confidence: e.envelope.payload.confidence,
    expectedLoss: Math.max(0, 1 - e.envelope.payload.confidence),
    expiresAt: e.envelope.expiresAt,
    sourceMissionId: e.metadata.sourceMissionId,
    sourceCycleId: e.metadata.sourceCycleId,
    hasEvidence: e.envelope.payload.evidenceUrls.length > 0 || e.envelope.payload.facts.length > 0,
  }));
}

/**
 * 계약 제안 위험 중재(phase 13) — 세 계보 제안을 정규화 → 만료/불완전/레버 파생결측 거부 → 총 익스포저·
 * 중복 위험으로 accept/reduce/reject. 계보 ID 보존. 순수(집행 없음·arming 배선은 별도).
 */
export function arbitrateContractProposals(fanIn: CoordinatorFanIn, opts: ArbitrationOptions): ArbitratedProposal[] {
  const nowMs = toEpochMs(opts.now) ?? 0;
  const maxExp = opts.maxTotalExposure ?? 2.0;
  const prelim = normalizeFanInProposals(fanIn).map((p): ArbitratedProposal => {
    const expMs = toEpochMs(p.expiresAt);
    if (expMs === null || expMs < nowMs) return { ...p, verdict: 'reject', reason: '만료(expired)' };
    if (!p.hasEvidence || p.confidence <= 0) return { ...p, verdict: 'reject', reason: '불완전(근거/확신도 없음)' };
    if (p.source === 'lever' && opts.derivativeVerificationMissing) return { ...p, verdict: 'reject', reason: '파생 검증 결측 → 레버리지 차단' };
    return { ...p, verdict: 'accept', reason: '수용 후보' };
  });
  const totalExposure = prelim.filter((p) => p.verdict === 'accept').reduce((s, p) => s + p.confidence, 0);
  const seen = new Set<string>();
  return prelim.map((p) => {
    if (p.verdict !== 'accept') return p;
    if (totalExposure > maxExp) return { ...p, verdict: 'reduce', reason: `총 익스포저 ${totalExposure.toFixed(2)}>${maxExp} → 축소` };
    if (seen.has(p.source)) return { ...p, verdict: 'reduce', reason: '중복(같은 계보 다건) → 축소' };
    seen.add(p.source);
    return p;
  });
}

export interface CoordinatorMissionResult { parent: MissionRow; children: MissionRow[] }

/** 조율 미션 + 하위 계약 미션들 생성 + 부모↔자식 연결(계보 fan-in). materialize(크론)는 별도.
 *  slug 보강 창구(createMissionWithSlug) 경유 — 영문 kebab id 일관성(2026-07-14). */
export async function createCoordinatorMission(store: TaskStore, input: CreateCoordinatorInput): Promise<CoordinatorMissionResult> {
  const now = input.now ?? new Date();
  const slugOpts = input.slugFn ? { slugFn: input.slugFn } : {};
  const parent = await createMissionWithSlug(store, {
    goal: input.goal, source: input.source,
    triage: { executionModel: 'coordinator', engine: 'orchestrator', rationale: '포트폴리오 조율·밸런싱(fan-in)' },
    now,
  }, slugOpts);
  const children: MissionRow[] = [];
  for (const g of input.childGoals ?? []) {
    // 자식 계약 미션 — 표식(계보). 실 실행은 기존 계약 크론(규칙/레버 사이클)이 담당.
    const child = await createMissionWithSlug(store, {
      goal: g, source: input.source,
      triage: { executionModel: 'scheduler', engine: 'schedule_manage', rationale: '계약 에이전트(조율 하위)' },
      now,
    }, slugOpts);
    attachChildMission(store, parent.id, child.id, now);
    children.push(child);
  }
  return { parent, children };
}
