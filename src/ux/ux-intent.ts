// ── UX 에이전트 계약 — UXIntent (양식 중립) + SurfaceCapabilities ──────────────
// RFC-run-supervisor-single-control-point-2026-08-01 §4 {#uxintent-contract} (P0).
//
// 대표 비전: FLOW(무엇을·언제·다음) = 조율 에이전트 / RENDER·NORMALIZE(어떻게 보이나) =
// UX 에이전트. 이 파일은 그 둘 사이의 **양식 중립 계약**만 정의한다(순수 타입 + 능력 레지스트리).
// 렌더 로직(intent+capability→양식 선택)은 P1(ux-render.ts), 텔레그램 배선은 P3.
//
// 안전: 순수 타입·집행 0. 서피스 능력 없으면 graceful degrade(P1 이 처리).

import type { BuildDecisions } from '../autopilot/mission-build-coordinator.js';
import type { SessionSource } from '../session/index.js';

// ── 서피스 채널 주소 (UX 레이어) ────────────────────────────────────────────
// 주의: `src/surface/address.ts`의 SurfaceAddress 는 터미널 UI 페인/모달 주소(z-축)로
// 개념이 다르다. 여기 UXSurfaceAddr 는 세션 출처를 쓰는 **전달 채널** 주소다.
// native 는 채널 축이고, nativePlatform 은 capability 선택을 위한 별도 플랫폼 축이다.
export type NativePlatform = 'ios' | 'android';

type UXSurfaceTarget = {
  /** chatId / channelId / deviceToken 등 서피스별 목적지 식별자. */
  readonly target?: string;
};

/** Persisted channel source, with the native platform retained only where it selects capabilities. */
export type UXSurfaceAddr =
  | (UXSurfaceTarget & { readonly source: Exclude<SessionSource, 'native'>; readonly nativePlatform?: never })
  | (UXSurfaceTarget & { readonly source: 'native'; readonly nativePlatform?: NativePlatform });

export type UXCapabilitySource = Exclude<SessionSource, 'native'> | NativePlatform | 'native';

export function capabilitySource(surface: UXSurfaceAddr | SessionSource): UXCapabilitySource {
  if (typeof surface === 'string') return surface;
  return surface.source === 'native' && surface.nativePlatform
    ? surface.nativePlatform
    : surface.source;
}

// ── 인터랙션 양식 어휘 ──────────────────────────────────────────────────────
export type SurfaceInteraction =
  | 'text'
  | 'buttons'
  | 'reactions'
  | 'select'
  | 'modal'
  | 'force-reply'
  | 'live-activity'
  | 'native-action';

// ── UXOption — 선택지(양식 무관) ────────────────────────────────────────────
export interface UXOption {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly recommended?: boolean;
  readonly kind?: 'approve' | 'reject' | 'choice' | 'edit';
}

// ── UXIntent — 양식 중립 계약(설계의 심장) ──────────────────────────────────
export interface UXIntent {
  readonly missionId: string;
  /** 'clarify:scope' | 'clarify:arc' | 'hitl:approve-plan' | 'redecompose-offer' | ... */
  readonly flowState: string;
  /** 사람에게 보일 질문/상태(요약). */
  readonly prompt: string;
  readonly options: readonly UXOption[];
  /** 자유 입력 허용(force-reply/modal). marker = 콜백 라우팅 토큰. */
  readonly freeform?: { readonly marker: string; readonly hint: string };
  /** 동적 양식/버튼 생성 근거(신호 기반). */
  readonly context: UXIntentContext;
  /** 목표 서피스(origin) — 없으면 팬아웃. */
  readonly surface?: UXSurfaceAddr;
}

export interface UXIntentContext {
  /** arcHint·scope 등 조율자 결정 채널(#4485). */
  readonly decisions?: BuildDecisions;
  /** 현재 흐르는 신호(치명 수·되먹임 라운드·긴급도 등). */
  readonly signals?: Record<string, unknown>;
  readonly urgency?: 'low' | 'normal' | 'high';
  /** 간단(리액션 가능) vs 복잡(버튼/select). 미지정 시 P1 이 자동 판정. */
  readonly complexity?: 'simple' | 'rich';
}

// ── UXEvent — NORMALIZE 산출(서피스 이벤트→공통 결정) ───────────────────────
export interface UXEvent {
  readonly missionId: string;
  readonly flowState: string;
  /** 선택된 옵션(버튼/select) — freeformText/approve/reject 와 배타. */
  readonly optionId?: string;
  /** 자유 입력(force-reply/modal). */
  readonly freeformText?: string;
  /** 리액션 등 단순 승인/거부(옵션 없이). */
  readonly verdict?: 'approve' | 'reject';
  /** 어느 서피스에서 왔나(coherence supersede·관측용). */
  readonly surface?: UXSurfaceAddr;
}

// ── SurfaceCapabilities — 서피스 능력 자기보고 레지스트리 ────────────────────
export interface SurfaceCapabilities {
  readonly interactions: ReadonlySet<SurfaceInteraction>;
}

/** RFC §2.4 기본 능력 — 각 서피스 채널이 부팅 시 override 가능(자기보고). */
const DEFAULT_CAPABILITIES: Record<UXCapabilitySource, readonly SurfaceInteraction[]> = {
  cli: ['text'],
  telegram: ['text', 'buttons', 'reactions', 'force-reply'],
  discord: ['text', 'buttons', 'reactions', 'select', 'modal'],
  pwa: ['text', 'buttons', 'select'],
  native: ['text', 'native-action'],
  ios: ['text', 'native-action', 'live-activity'],
  android: ['text', 'native-action'],
  tui: ['text', 'buttons'],
  voice: ['text'],
  unknown: ['text'],
};

const registry = new Map<UXCapabilitySource, SurfaceCapabilities>();

/** 서피스가 자기 능력을 자기보고(부팅 시). 미보고 서피스는 getSurfaceCapabilities 가 기본값 반환. */
export function reportSurfaceCapabilities(
  surface: UXSurfaceAddr | SessionSource,
  interactions: readonly SurfaceInteraction[],
): void {
  registry.set(capabilitySource(surface), { interactions: new Set(interactions) });
}

/** 서피스 능력 조회 — 자기보고 우선, 없으면 RFC §2.4 기본값. 항상 값 반환(graceful). */
export function getSurfaceCapabilities(surface: UXSurfaceAddr | SessionSource): SurfaceCapabilities {
  const source = capabilitySource(surface);
  const reported = registry.get(source);
  if (reported) return reported;
  return { interactions: new Set(DEFAULT_CAPABILITIES[source]) };
}

/** 이 서피스가 특정 양식을 지원하는가. P1 RENDER 의 양식 선택 근거. 순수. */
export function surfaceSupports(
  surface: UXSurfaceAddr | SessionSource,
  interaction: SurfaceInteraction,
): boolean {
  return getSurfaceCapabilities(surface).interactions.has(interaction);
}

/** 테스트/재부팅용 — 자기보고 레지스트리 초기화(기본값으로 복귀). */
export function resetSurfaceCapabilities(): void {
  registry.clear();
}
