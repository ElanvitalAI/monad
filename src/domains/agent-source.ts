// ── 에이전트/신호 소스 추상화 — 미래 확장 seam (2026-07-10 · PLAN §4b) ──────────
//
// 대표 청사진: 매매 skill·정보를 마켓플레이스에서 다운로드하고, 외부 소스(에이전트·
// 텔레그램 채널·구독 피드)가 신호를 공급하면 정보 질↑ (일명 "매매 리딩방"의 미래형).
// 지금은 기초 수립 — blackboard(C1) 에 제출하는 "소스"를 인터페이스로만 추상화하고,
// 구현은 전부 no-op(내부=신뢰1.0·구독=전부허용). 나중에 외부/마켓플레이스/구독이
// 붙을 때 구조 변경 없이 구현만 채운다(회귀 0). 노드형: 각 소스 = 플러그 노드.
//
// [[VISION-conatus-platform-elanous-2026-07-05]] P9(지식 마켓플레이스·판매)의 신호/매매 버전.

/** 소스 출처 — C0 는 internal 만 실사용. 나머지는 미래(외부·채널·구독) 확장 슬롯. */
export type SourceOrigin = 'internal' | 'external' | 'channel' | 'subscription';

/** 신뢰도(ρ) 0~1 — 내부=1.0. 외부 소스는 검증·이력으로 가중(미래). */
export type TrustScore = number;

/** blackboard 에 신호/의도를 제출하는 주체(내부 계약 에이전트·외부 에이전트·채널·구독). */
export interface SignalSource {
  /** 안정 소스 id(예: 'contract:samsung-capstone'·'channel:@someroom'·'sub:provider-x'). */
  id: string;
  origin: SourceOrigin;
  /** 사람가독 이름. */
  name?: string;
  /** 신뢰도(ρ) — 오케스트레이터 밸런싱 가중. 내부 기본 1.0. */
  trust: TrustScore;
  /** 구독/entitlement 키(미래 — 구독 티어별 접근·가중). */
  entitlementKey?: string;
}

/** 모든 blackboard 항목에 붙는 출처 메타 — 어디서·언제·(미래)서명. 감사·신뢰 가중용. */
export interface SourceProvenance {
  sourceId: string;
  origin: SourceOrigin;
  /** 수신/생성 시각(ISO). */
  receivedAt: string;
  /** 미래 — 외부 소스 서명(마켓플레이스 무결성). C0 미사용. */
  signedBy?: string;
  /** 신뢰도 스냅샷(수신 당시). */
  trust?: TrustScore;
}

/** 내부 소스 팩토리 — 신뢰 1.0. C0 의 유일 실사용 경로. */
export function internalSource(id: string, name?: string): SignalSource {
  return { id, origin: 'internal', trust: 1.0, ...(name ? { name } : {}) };
}

/** provenance 스탬프(순수). trust 미지정 시 소스 trust 상속. */
export function stampProvenance(source: SignalSource, receivedAt: string): SourceProvenance {
  return { sourceId: source.id, origin: source.origin, receivedAt, trust: source.trust };
}

// ── entitlement 게이트 (미래 구독 — C0 는 all-allow no-op) ──────────────────────
export interface EntitlementCheck {
  /** subscriber 가 source 를 소비할 자격이 있나. C0 는 항상 true(내부 전용). */
  canConsume(source: SignalSource, subscriber?: string): boolean;
}

/** C0 기본 게이트 — 전부 허용(내부 전용). 미래에 구독 티어 게이트로 교체(seam). */
export const allowAllEntitlement: EntitlementCheck = {
  canConsume: () => true,
};
