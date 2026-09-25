// Terminal posture vocabulary · Layer 1 (host-agnostic).
//
// 이 파일이 정의하는 단어는 TUI / PWA / Discord / ACP / 외부 thinking-tool
// 어떤 host 도 그대로 import 한다. TUI-PTY 전용 transport policy 는
// `./tui-policy.ts` (Layer 2) 가 담당.
//
// 관련 ROADMAP:
// - 내부 문서 `ROADMAP-terminal-multiplatform-substrate-2026-05-02` (strategic)
// - 내부 문서 `ROADMAP-terminal-surface-arc-execution-2026-05-02` (tactical)

export type TerminalUserExposure =
  | 'user-interactive'
  | 'observe-only'
  | 'hidden'
  | 'unavailable';

export interface TerminalExposureSnapshot {
  userExposure: TerminalUserExposure;
  agentInteractive: boolean;
}

/**
 * User-facing capability vector.
 *
 * Per G1 (strategic ROADMAP §4): start with 4 booleans. select / copy 같은
 * 추가 capability 는 future arc 에서 sub-capability 로 도입한다 — 이번 arc
 * 에서 6+ field 로 시작하지 않는다.
 *
 * Per G6: capability 는 gate 다. intent 의미 (click / double-click /
 * word-select 등) 를 capability boolean 으로 환원하지 마라.
 *
 * agent perspective 는 `TerminalExposureSnapshot.agentInteractive` 로
 * 별도 표현. capability 는 user 시점만 다룬다 (single-tenant 가정).
 */
export interface TerminalSurfaceCapability {
  /** user 가 surface 의 출력을 관찰 가능한가 */
  canRead: boolean;
  /** user 가 interrupt chord (ctrl-C/D/\) 를 보낼 수 있는가 */
  canInterrupt: boolean;
  /** user 가 surface 의 underlying executor 에 input 을 쓸 수 있는가 */
  canWrite: boolean;
  /** user-facing inspect 가능한가 (word-select / copy / hover) */
  canInspect: boolean;
}

/**
 * Exposure → capability vector derivation. user 시점.
 *
 * | userExposure     | canRead | canInterrupt | canWrite | canInspect |
 * |------------------|---------|--------------|----------|------------|
 * | user-interactive | true    | true         | true     | true       |
 * | observe-only     | true    | true         | false    | true       |
 * | hidden           | false   | false        | false    | false      |
 * | unavailable      | false   | false        | false    | false      |
 */
export function deriveTerminalCapability(
  exposure: TerminalExposureSnapshot,
): TerminalSurfaceCapability {
  switch (exposure.userExposure) {
    case 'user-interactive':
      return { canRead: true, canInterrupt: true, canWrite: true, canInspect: true };
    case 'observe-only':
      return { canRead: true, canInterrupt: true, canWrite: false, canInspect: true };
    case 'hidden':
      return { canRead: false, canInterrupt: false, canWrite: false, canInspect: false };
    case 'unavailable':
      return { canRead: false, canInterrupt: false, canWrite: false, canInspect: false };
  }
}

export function interactiveTerminalExposure(
  agentInteractive: boolean = true,
): TerminalExposureSnapshot {
  return {
    userExposure: 'user-interactive',
    agentInteractive,
  };
}

export function classifyVwTerminalExposure(
  focusPolicy: 'output-only' | 'interactive',
  status: 'running' | 'backgrounded' | 'completed' | 'killed',
): TerminalExposureSnapshot {
  if (status === 'completed' || status === 'killed') {
    return {
      userExposure: 'unavailable',
      agentInteractive: false,
    };
  }
  return {
    userExposure: focusPolicy === 'interactive' ? 'user-interactive' : 'observe-only',
    agentInteractive: true,
  };
}

export function classifyModalTerminalExposure(
  status: 'running' | 'backgrounded' | 'completed' | 'killed',
): TerminalExposureSnapshot {
  if (status === 'completed' || status === 'killed') {
    return {
      userExposure: 'unavailable',
      agentInteractive: false,
    };
  }
  return {
    userExposure: 'user-interactive',
    agentInteractive: true,
  };
}

export function classifyBackgroundTerminalExposure(
  status: 'running' | 'backgrounded' | 'completed' | 'killed',
): TerminalExposureSnapshot {
  if (status === 'completed' || status === 'killed') {
    return {
      userExposure: 'unavailable',
      agentInteractive: false,
    };
  }
  return {
    userExposure: 'hidden',
    agentInteractive: true,
  };
}

/**
 * Equality comparator for posture snapshots.
 *
 * Posture transitions only matter when `exposure` changes. The
 * `interactionPolicy` is derived from exposure (Layer 2 derivation),
 * so policy equality follows exposure equality. Comparing exposure
 * alone keeps the predicate cheap and avoids spurious re-renders
 * when only Layer 2 fields are touched (which they aren't, for now).
 *
 * Used by `ShellRegistry.subscribePosture` to satisfy G7 (no stale,
 * no spurious): callbacks fire only on real posture diffs.
 */
export function exposureEqual(
  a: TerminalExposureSnapshot | null | undefined,
  b: TerminalExposureSnapshot | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.userExposure === b.userExposure
      && a.agentInteractive === b.agentInteractive;
}

export function classifyTerminalSessionExposure(
  state: 'foreground' | 'background' | 'exited',
): TerminalExposureSnapshot {
  switch (state) {
    case 'foreground':
      return {
        userExposure: 'user-interactive',
        agentInteractive: true,
      };
    case 'background':
      return {
        userExposure: 'hidden',
        agentInteractive: true,
      };
    case 'exited':
      return {
        userExposure: 'unavailable',
        agentInteractive: false,
      };
  }
}
