// 🎛️ 발사 «능력»의 결정 자리 — 한 곳.
//
// ⛔⭐ **이 셀이 있는 이유** (RFC-one-door-many-entrances §4c · P3):
//   결정이 흩어져 있으면 ***고칠 때 «한 곳만» 고친다.*** 2026-08-20 하루에 그 형태를 셋 봤다:
//     ⓐ `deliverableTargets` — 타입도 소비도 있는데 «채우는 자»가 없었다
//     ⓑ `deployFindings` — 슈퍼바이저가 `triageRun` 을 인자 없이 불러 «구조적으로» 안 닿았다
//     ⓒ `--no-*` 판정 — 프로그램 경로엔 규칙이 있고 Commander 경로엔 «없었다»
//   ⇒ 셋 다 「같은 축의 결정이 두 곳 이상에 있고 한 곳만 갱신됐다」는 한 형태다.
//
// ⛔ **새 능력을 더하지 않는다.** 지금 있는 축의 «결정 자리»만 모은다(RFC P3 의 명시 제약).
// ⛔ **어휘를 새로 만들지 않는다** — `DevSelectionSource` 와 `observeDevSelection` 이 이미 있다.
//   같은 축에 두 어휘를 지으면 두 경로가 반씩 골라 서로 다르게 판정한다(이 창의 ⓒ 가 그 실물).
import type { DevCompletion, DevSelectionSource } from './dev-pipeline.js';

/** 한 축의 결정 — ⛔ 값 «옆에» 출처를 둔다. 값만 두면 「왜 이 값인가」를 못 묻는다. */
export interface ResolvedCapability<T> {
  readonly value: T;
  readonly source: DevSelectionSource;
}

export type LaunchCapabilityDefaultProfile = 'self-mission' | 'plan-staged' | 'safe';

export interface LaunchCapabilityRequest {
  /** 실행 표면의 기존 무플래그 정책. 실제 값 결정은 아래 resolver만 한다. */
  readonly defaultProfile?: LaunchCapabilityDefaultProfile;
  /** 발사 입구가 «명시»한 값. `undefined` 는 「말하지 않았다」이지 「끄라」가 아니다. */
  readonly completion?: DevCompletion;
  readonly autoReview?: boolean;
  /** 호출자가 이미 출처를 아는 경우(재라우팅 등) 그대로 존중한다. */
  readonly completionSource?: DevSelectionSource;
  readonly autoReviewSource?: DevSelectionSource;
}

export interface ResolvedLaunchCapabilities {
  readonly completion: ResolvedCapability<DevCompletion>;
  readonly autoReview: ResolvedCapability<boolean>;
}

/** ⛔ 기본값을 «여기 한 곳»에 둔다. 흩어 두면 입구마다 다른 기본값이 생긴다. */
const DEFAULTS: Record<LaunchCapabilityDefaultProfile, { completion: DevCompletion; autoReview: boolean }> = {
  // `elanous dev`의 무플래그 self 요청이 기존에 내던 결과를 이 한 곳에서 보존한다.
  'self-mission': { completion: 'auto-merge', autoReview: true },
  // staged planning retained its auto-drive behavior but never had unattended review wiring.
  'plan-staged': { completion: 'auto-merge', autoReview: false },
  // Other dispatches cannot honor PR completion or unattended review.
  safe: { completion: 'worktree-only', autoReview: false },
};

/**
 * 발사 능력을 «한 번» 정한다.
 *
 * ⛔ 이 함수는 ***판정만 한다*** — 관측도 검증도 하지 않는다(그것은 호출자의 몫).
 * ⛔ 산출이 종전 `planDevPipeline` 의 인라인 규칙과 «바이트 동일»해야 한다:
 *   값이 없으면 기본값 ⊕ source='default' · 있으면 그 값 ⊕ source='request'.
 *   ⇒ 명시 source 가 주어지면 그것이 이긴다(재라우팅이 「원래 어디서 왔는지」를 안다).
 */
export function resolveLaunchCapabilities(request: LaunchCapabilityRequest = {}): ResolvedLaunchCapabilities {
  // A caller without launch context is never implicitly authorized for unattended completion.
  // Entrances that retain the established autonomous dev policy name `self-mission` explicitly.
  const defaults = DEFAULTS[request.defaultProfile ?? 'safe'];
  return {
    completion: {
      value: request.completion ?? defaults.completion,
      source: request.completionSource ?? (request.completion === undefined ? 'default' : 'request'),
    },
    autoReview: {
      value: request.autoReview ?? defaults.autoReview,
      source: request.autoReviewSource ?? (request.autoReview === undefined ? 'default' : 'request'),
    },
  };
}

/** 관측에 실을 한 줄 — ⛔ 축마다 «따로». 배열로 싣지 마라(debug.log 배열은 6에서 잘린다).
 *
 *  ⛔⭐ **`entrance` 칸을 «지금은 안 받는다»** — RFC §4c 의 payload 는 {axis,value,source,entrance}이지만
 *  각 입구가 자기 선언을 여기까지 «넘기는» 배선이 아직 없다. 안 쓰는 인자를 미리 열면
 *  ***「쓰는 데 없는 표면」***이 남고, 이 저장소의 리뷰 규칙 6이 그것을 막는다(실제로 막혔다).
 *  ⇒ 입구를 넘기는 칸이 서는 «그때» 이 함수에 한 줄을 더한다. */
export function launchCapabilityObservation(
  axis: 'completion' | 'autoReview',
  resolved: ResolvedCapability<DevCompletion | boolean>,
): Record<string, unknown> {
  // ⛔⭐ 키 이름은 `effectiveValue` 다 — RFC 초안은 `value` 라 적었지만 ***코드의 어휘가 이긴다***.
  //   내가 `value` 로 냈다가 기존 시험이 막았다: 같은 것이 두 이름을 가지면
  //   읽는 자가 «어느 쪽을 보느냐»로 갈린다(이 창이 하루에 세 번 밟은 그 형태다).
  return { axis, effectiveValue: resolved.value, source: resolved.source };
}
