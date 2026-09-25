// ── V3 (Phase 2 Bundle 1) — Voice 가 capability gate 자연어 표현 ──
//
// HANDOFF Phase 2 §5 V3: "Voice 가 capability gate 자연어 표현". V1 의
// utterance composer 가 'canApply=false' 시 단순히 "읽기 전용이라 직접
// 다시 시도하세요" 라고 했지만, V3 는 *왜* 안 되는지 substrate 의
// `TerminalSurfaceCapability` 4 boolean + `TerminalUserExposure` 를 풀어서
// 사람 말로 설명한다.
//
// 예시:
//   - vw user-interactive            → "VW 터미널이라 키보드로 직접 쓸 수 있어요."
//   - vw observe-only                → "출력만 보이는 VW 터미널이라 키보드 입력은 못 가지요. ctrl-C 같은 인터럽트는 가능."
//   - bg hidden                      → "백그라운드 모니터링 전용이에요. 출력도 안 보이고 입력도 못 보냅니다."
//   - inline / killed unavailable    → "이미 종료된 셸이라 어떤 작업도 못 해요."
//
// Pure function — V1 의 voice runtime 이 호출 시 spoken phrasing 으로 변환.
// Future Discord / PWA gateway 도 같은 함수로 동일 capability 표현 통일.

import type {
  TerminalExposureSnapshot,
  TerminalSurfaceCapability,
} from '../terminal/posture.js';

export type CapabilityNamingLane = 'ko' | 'en';

export interface CapabilityNamingOpts {
  exposure: TerminalExposureSnapshot;
  capability: TerminalSurfaceCapability;
  /** Surface kind hint for richer phrasing — when omitted, generic
   *  "터미널" / "terminal" is used. */
  surfaceKind?: 'vw' | 'bg' | 'modal' | 'inline' | 'preview';
  lane?: CapabilityNamingLane;
}

const SURFACE_LABEL_KO: Record<NonNullable<CapabilityNamingOpts['surfaceKind']>, string> = {
  vw: 'VW 터미널',
  bg: '백그라운드 셸',
  modal: '모달 터미널',
  inline: '인라인 셸',
  preview: '프리뷰 패널',
};

const SURFACE_LABEL_EN: Record<NonNullable<CapabilityNamingOpts['surfaceKind']>, string> = {
  vw: 'VW terminal',
  bg: 'background shell',
  modal: 'modal terminal',
  inline: 'inline shell',
  preview: 'preview pane',
};

function nameKo(opts: CapabilityNamingOpts): string {
  const { exposure, capability, surfaceKind } = opts;
  const surface = surfaceKind ? SURFACE_LABEL_KO[surfaceKind] : '터미널';

  if (exposure.userExposure === 'unavailable') {
    return `이미 종료된 ${surface}이에요. 어떤 작업도 못 해요.`;
  }
  if (exposure.userExposure === 'hidden') {
    return `${surface}이 백그라운드 모니터링 전용이에요. 출력도 안 보이고 입력도 못 보냅니다.`;
  }
  if (exposure.userExposure === 'observe-only') {
    const interruptHint = capability.canInterrupt
      ? ' ctrl-C 같은 인터럽트는 가능해요.'
      : '';
    return `출력만 보이는 ${surface}이라 키보드 입력은 못 가져갑니다.${interruptHint}`;
  }
  // user-interactive
  if (capability.canWrite && capability.canInspect) {
    return `${surface}이라 키보드로 직접 쓸 수 있어요.`;
  }
  // edge: user-interactive 인데 capability 가 약한 경우 (현재 파생식상
  // 발생하지 않지만 safety)
  return `${surface}이 활성화돼 있어요.`;
}

function nameEn(opts: CapabilityNamingOpts): string {
  const { exposure, capability, surfaceKind } = opts;
  const surface = surfaceKind ? SURFACE_LABEL_EN[surfaceKind] : 'terminal';

  if (exposure.userExposure === 'unavailable') {
    return `That ${surface} has already ended; nothing can be done with it.`;
  }
  if (exposure.userExposure === 'hidden') {
    return `That ${surface} is background-only — no output is shown and you can't send input.`;
  }
  if (exposure.userExposure === 'observe-only') {
    const interruptHint = capability.canInterrupt
      ? " You can still send interrupts like ctrl-C."
      : '';
    return `The ${surface} is read-only, so keyboard input doesn't go through.${interruptHint}`;
  }
  if (capability.canWrite && capability.canInspect) {
    return `The ${surface} is active — keyboard input goes straight through.`;
  }
  return `The ${surface} is active.`;
}

/**
 * Produce a natural-language description of the capability gate state.
 * Used by V1 voice utterance to explain *why* an [Apply] action is or
 * isn't available, and by future Discord / PWA gateways for consistent
 * cross-host phrasing.
 */
export function describeCapability(opts: CapabilityNamingOpts): string {
  const lane = opts.lane ?? 'ko';
  return lane === 'ko' ? nameKo(opts) : nameEn(opts);
}

/**
 * Short hint suitable for chat-line decoration ("· 제안만" 자리에 붙는
 * 한 줄). Uses the same capability vector but produces ~10-character
 * phrases instead of full sentences.
 */
export function describeCapabilityShort(opts: CapabilityNamingOpts): string {
  const lane = opts.lane ?? 'ko';
  const { exposure, capability } = opts;
  if (exposure.userExposure === 'unavailable') {
    return lane === 'ko' ? '종료된 셸' : 'shell ended';
  }
  if (exposure.userExposure === 'hidden') {
    return lane === 'ko' ? '백그라운드 모니터링' : 'background only';
  }
  if (exposure.userExposure === 'observe-only') {
    return lane === 'ko' ? '읽기 전용' : 'read-only';
  }
  if (capability.canWrite) {
    return lane === 'ko' ? '활성' : 'active';
  }
  return lane === 'ko' ? '제한적' : 'limited';
}
