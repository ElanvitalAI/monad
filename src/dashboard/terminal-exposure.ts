// Re-export shim · canonical 위치는 split 됐다.
//
// Layer 1 (host-agnostic) → `src/terminal/posture.ts`
// Layer 2 (TUI-PTY 전용)  → `src/terminal/tui-policy.ts`
//
// 이 파일은 한 cycle 동안만 호환 위해 보존된다. 새 import 는 새 위치를
// 직접 가리키도록 권장:
//   - 외부 host (ACP/Discord/PWA) 는 Layer 1 만
//   - TUI host (dashboard / shell-runner / virtual-windows) 는 양쪽 다 가능
//
// 관련 ROADMAP:
// - 내부 문서 `ROADMAP-terminal-multiplatform-substrate-2026-05-02`
// - 내부 문서 `ROADMAP-terminal-surface-arc-execution-2026-05-02`

export {
  classifyBackgroundTerminalExposure,
  classifyModalTerminalExposure,
  classifyTerminalSessionExposure,
  classifyVwTerminalExposure,
  deriveTerminalCapability,
  interactiveTerminalExposure,
  type TerminalExposureSnapshot,
  type TerminalSurfaceCapability,
  type TerminalUserExposure,
} from '../terminal/posture.js';

export {
  describeTerminalPosture,
  deriveTuiInteractionPolicy,
  resolveTerminalInteractionPolicy,
  type TerminalInteractionPolicy,
  type TerminalKeyboardParticipation,
  type TerminalMouseTransportPolicy,
  type TerminalPostureSnapshot,
} from '../terminal/tui-policy.js';
