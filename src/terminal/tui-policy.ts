// Terminal interaction policy · Layer 2 (TUI-PTY 전용).
//
// 이 파일은 **TUI host 만** import 한다. PWA / Discord / ACP gateway / 외부
// thinking-tool 코드는 import 하지 않는다 — 그쪽은 Layer 1 (`./posture.ts`)
// 의 capability vector 위에서 자기 host 에 맞는 transport 를 derive 한다.
//
// 관련 ROADMAP:
// - 내부 문서 `ROADMAP-terminal-multiplatform-substrate-2026-05-02` (strategic)
// - 내부 문서 `ROADMAP-terminal-surface-arc-execution-2026-05-02` (tactical)

import type {
  TerminalExposureSnapshot,
  TerminalSurfaceCapability,
} from './posture.js';
import { deriveTerminalCapability } from './posture.js';

export type TerminalKeyboardParticipation = 'full' | 'interrupt-only' | 'none';

export type TerminalMouseTransportPolicy = 'full' | 'discrete-only' | 'none';

/**
 * TUI host 가 PTY child 와 mouse/key transport 를 어떻게 처리할지 결정하는
 * policy. PWA/Discord/ACP 는 같은 정보를 자기 host 의 transport 모델로
 * 별도 derive 하므로 이 policy 를 보지 않는다.
 *
 * `hostInspectable` 은 TUI host 가 surface buffer 를 자기 안에서 inspect 할
 * 수 있는지를 의미 (예: bg shell 의 buffer 를 host 가 debug 로 읽음).
 * 이는 user-facing `canInspect` 와 다른 개념 (예: `hidden` exposure 는
 * `canInspect: false` 지만 `hostInspectable: true` — host diagnostic 용).
 */
export interface TerminalInteractionPolicy {
  keyboardParticipation: TerminalKeyboardParticipation;
  mouseTransport: TerminalMouseTransportPolicy;
  hostMouseIntentVisible: boolean;
  hostInspectable: boolean;
  agentWriteAllowed: boolean;
}

export interface TerminalPostureSnapshot {
  exposure: TerminalExposureSnapshot;
  interactionPolicy: TerminalInteractionPolicy;
}

/**
 * Exposure 만 보고 TUI policy 를 derive 하는 legacy entry. PR #1333 이
 * landed 한 함수 — caller 호환을 위해 그대로 보존.
 *
 * 새 코드는 `deriveTuiInteractionPolicy(capability, exposure)` 를 권장.
 * 동일 결과가 나오지만 capability vector 를 명시적 입력으로 받아
 * Layer 1 / Layer 2 의존선이 분명해진다.
 */
export function resolveTerminalInteractionPolicy(
  exposure: TerminalExposureSnapshot,
): TerminalInteractionPolicy {
  return deriveTuiInteractionPolicy(deriveTerminalCapability(exposure), exposure);
}

/**
 * Capability vector + exposure → TUI policy.
 *
 * Capability 가 input 인 이유 (G6): TUI policy 는 user-facing capability
 * 의 *transport-level translation* 이지, capability 자체를 흡수하지 않는다.
 * `agentWriteAllowed` 는 `agentInteractive` 만 보고 결정 — capability 의
 * `canWrite` (user 시점) 와 분리.
 */
export function deriveTuiInteractionPolicy(
  capability: TerminalSurfaceCapability,
  exposure: TerminalExposureSnapshot,
): TerminalInteractionPolicy {
  switch (exposure.userExposure) {
    case 'user-interactive':
      return {
        keyboardParticipation: 'full',
        mouseTransport: 'full',
        hostMouseIntentVisible: true,
        hostInspectable: true,
        agentWriteAllowed: exposure.agentInteractive,
      };
    case 'observe-only':
      return {
        keyboardParticipation: capability.canInterrupt ? 'interrupt-only' : 'none',
        mouseTransport: 'discrete-only',
        hostMouseIntentVisible: true,
        hostInspectable: true,
        agentWriteAllowed: exposure.agentInteractive,
      };
    case 'hidden':
      return {
        keyboardParticipation: 'none',
        mouseTransport: 'none',
        hostMouseIntentVisible: false,
        hostInspectable: true,
        agentWriteAllowed: exposure.agentInteractive,
      };
    case 'unavailable':
      return {
        keyboardParticipation: 'none',
        mouseTransport: 'none',
        hostMouseIntentVisible: false,
        hostInspectable: false,
        agentWriteAllowed: exposure.agentInteractive,
      };
  }
}

export function describeTerminalPosture(
  exposure: TerminalExposureSnapshot,
): TerminalPostureSnapshot {
  return {
    exposure,
    interactionPolicy: resolveTerminalInteractionPolicy(exposure),
  };
}
