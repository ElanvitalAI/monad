// ── T3 (Phase 2 Bundle 1) — 상태바 라이브 posture 인지 ──
//
// HANDOFF Phase 2 §5 T3: "상태바 라이브 인지". 사용자가 chat 영역에 집중하고
// 있어도 status-bar 한 줄로 substrate 의 모든 shell posture 가 라이브로
// 보이게 한다. ShellRegistry.subscribePosture + listWithPosture 를 묶어서
// HUD segment 를 갱신.
//
// Segment shape:
//   "🐚 3v 1h"  (vw 3 개 active, bg/hidden 1 개)
//   "🐚 2v✱"   (vw 2 개 + 1 개 unavailable 발생 직후 — fade segment)
//
// Per HANDOFF §6 (closure 수용 기준) 갱신 latency 는 substrate 의 G7
// (no stale, no spurious) posture event 에 직접 매달려 있어 free.

import type {
  ShellRegistry,
  Unsubscribe,
} from '../shell-runner/types.js';
import type { TerminalUserExposure } from '../terminal/posture.js';

export interface ShellPostureCounts {
  /** user-interactive — vw 또는 modal active */
  readonly active: number;
  /** observe-only — vw output-only */
  readonly observing: number;
  /** hidden — bg / daemon-managed */
  readonly hidden: number;
  /** unavailable — 종료. UI 는 보통 짧게 보여주고 fade. */
  readonly ended: number;
  /** 전체 등록된 shell. 종합 합산. */
  readonly total: number;
}

export interface StatusShellPostureSegment {
  readonly key: 'shell-posture';
  readonly value: string;
  readonly priority: number;
  readonly counts: ShellPostureCounts;
}

export interface StatusShellPostureRuntimeDeps {
  registry: ShellRegistry;
  /** Setter — typically `(key, value, priority) => setSegment(hud,
   *  key, value, priority)`. */
  setSegment: (key: string, value: string, priority: number) => void;
  /** Clear — typically `(key) => clearSegment(hud, key)`. */
  clearSegment: (key: string) => void;
  /** Optional color helpers — when present, segment string is wrapped.
   *  Defaults to plain text so the runtime stays test-friendly. */
  colors?: {
    active?: (s: string) => string;
    observing?: (s: string) => string;
    hidden?: (s: string) => string;
    ended?: (s: string) => string;
  };
  /** Priority within the HUD ordering. Default 30 — between mode (10)
   *  and copied (5) ranges. */
  priority?: number;
  /** Repaint trigger — typically `() => draw()`. Optional. */
  redraw?: () => void;
  logDebug?: (category: string, event: string, data?: unknown) => void;
  /** Test seam — defaults to 0 ms (immediate). Production wires
   *  ~250ms debounce so a burst of posture events compresses. */
  debounceMs?: number;
  /** Test seam — defaults to setTimeout / clearTimeout. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface StatusShellPostureRuntime {
  /** Force-refresh the segment from current registry state. */
  refresh(): ShellPostureCounts;
  /** Stop subscriber + clear segment. Idempotent. */
  stop(): void;
  /** Diagnostic. */
  current(): ShellPostureCounts;
}

const SEGMENT_KEY = 'shell-posture';

export function summarizeShellPosture(
  postures: ReadonlyArray<{ exposure: TerminalUserExposure | null | undefined }>,
): ShellPostureCounts {
  let active = 0, observing = 0, hidden = 0, ended = 0;
  for (const p of postures) {
    switch (p.exposure) {
      case 'user-interactive': active += 1; break;
      case 'observe-only': observing += 1; break;
      case 'hidden': hidden += 1; break;
      case 'unavailable': ended += 1; break;
      default: break;
    }
  }
  return { active, observing, hidden, ended, total: postures.length };
}

export function formatShellPostureSegment(
  counts: ShellPostureCounts,
  colors?: StatusShellPostureRuntimeDeps['colors'],
): string {
  if (counts.total === 0) return '';
  const parts: string[] = [];
  if (counts.active > 0) parts.push((colors?.active ?? ((s: string) => s))(`${counts.active}v`));
  if (counts.observing > 0) parts.push((colors?.observing ?? ((s: string) => s))(`${counts.observing}o`));
  if (counts.hidden > 0) parts.push((colors?.hidden ?? ((s: string) => s))(`${counts.hidden}h`));
  if (counts.ended > 0) parts.push((colors?.ended ?? ((s: string) => s))(`${counts.ended}✱`));
  return `🐚 ${parts.join(' ')}`;
}

export function createStatusShellPostureRuntime(
  deps: StatusShellPostureRuntimeDeps,
): StatusShellPostureRuntime {
  let unsubscribe: Unsubscribe | null = null;
  let lastCounts: ShellPostureCounts = { active: 0, observing: 0, hidden: 0, ended: 0, total: 0 };
  let timerHandle: unknown = null;
  const debounceMs = deps.debounceMs ?? 0;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const priority = deps.priority ?? 30;

  const renderSnapshot = (): ShellPostureCounts => {
    const list = deps.registry.listWithPosture();
    const postures = list.map((entry) => ({
      exposure: entry.posture?.userExposure ?? null,
    }));
    const counts = summarizeShellPosture(postures);
    lastCounts = counts;
    const value = formatShellPostureSegment(counts, deps.colors);
    if (counts.total === 0 || value === '') {
      deps.clearSegment(SEGMENT_KEY);
    } else {
      deps.setSegment(SEGMENT_KEY, value, priority);
    }
    if (deps.logDebug) {
      deps.logDebug('status.shell-posture.refresh', `${counts.total}`, counts);
    }
    deps.redraw?.();
    return counts;
  };

  const scheduleRefresh = (): void => {
    if (debounceMs <= 0) {
      renderSnapshot();
      return;
    }
    if (timerHandle) clearTimer(timerHandle);
    timerHandle = setTimer(() => {
      timerHandle = null;
      renderSnapshot();
    }, debounceMs);
  };

  // Initial snapshot.
  renderSnapshot();

  unsubscribe = deps.registry.subscribePosture((event) => {
    if (deps.logDebug) {
      deps.logDebug('status.shell-posture.event', event.shellId, {
        prev: event.prev?.userExposure ?? null,
        next: event.next?.userExposure ?? null,
      });
    }
    scheduleRefresh();
  });

  return {
    refresh() {
      return renderSnapshot();
    },
    stop() {
      if (unsubscribe) {
        try { unsubscribe(); } catch { /* idempotent */ }
        unsubscribe = null;
      }
      if (timerHandle) {
        clearTimer(timerHandle);
        timerHandle = null;
      }
      deps.clearSegment(SEGMENT_KEY);
    },
    current() {
      return lastCounts;
    },
  };
}
