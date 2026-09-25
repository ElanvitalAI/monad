// ── X3 (Phase 2 Bundle 2) — WatchPane × posture timeline ──
//
// HANDOFF Phase 2 §5 X3: "WatchPane × posture timeline". 기존 WatchPane 이
// 시간 구간 동안 capture 했던 결과에, 같은 구간의 substrate posture
// 전환 이벤트를 합쳐 하나의 통합 timeline 으로 보여준다.
//
// 사용 시나리오:
//   - LLM 이 `watch_pane(surfaceId, durationMs)` 호출
//   - durationMs 동안 capture 결과 N 개 + posture event K 개 발생
//   - X3 가 합쳐서 시간순 timeline 반환:
//       [{ at: 100, kind: 'capture',  ansi: '...' },
//        { at: 250, kind: 'posture-change', prev: 'user-interactive', next: 'observe-only' },
//        { at: 500, kind: 'capture',  ansi: '...' },
//        { at: 720, kind: 'posture-change', prev: 'observe-only', next: 'unavailable' }]
//
// Pure timeline composer — 실제 watch-pane 호출은 분리. host 가 watch
// 기간 동안 두 stream 을 모은 뒤 `composePostureTimeline` 으로 join.

import type {
  ShellPostureSubscriber,
  ShellRegistry,
  Unsubscribe,
} from '../shell-runner/types.js';
import type { TerminalUserExposure } from '../terminal/posture.js';

export interface CaptureTimelineEntry {
  readonly kind: 'capture';
  readonly at: number;
  /** Capture body (text/ansi/svg etc) — opaque to the composer. */
  readonly body: string;
  /** Optional format hint for downstream rendering. */
  readonly format?: string;
}

export interface PostureChangeTimelineEntry {
  readonly kind: 'posture-change';
  readonly at: number;
  readonly shellId: string;
  readonly prev: TerminalUserExposure | null;
  readonly next: TerminalUserExposure | null;
}

export type WatchTimelineEntry = CaptureTimelineEntry | PostureChangeTimelineEntry;

/**
 * Merge captures + posture events into a single chronologically sorted
 * timeline. Stable ordering when timestamps tie: captures come first
 * (so posture-change reads as "after capture N").
 */
export function composePostureTimeline(
  captures: readonly CaptureTimelineEntry[],
  postureEvents: readonly PostureChangeTimelineEntry[],
): readonly WatchTimelineEntry[] {
  const merged: WatchTimelineEntry[] = [...captures, ...postureEvents];
  merged.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at;
    if (a.kind !== b.kind) return a.kind === 'capture' ? -1 : 1;
    return 0;
  });
  return merged;
}

// ── Recorder helper ─────────────────────────────────────────────────

export interface WatchPostureRecorderDeps {
  registry: ShellRegistry;
  /** When set, only events for this shellId are recorded. */
  shellId?: string;
  /** Test seam — defaults to Date.now. */
  now?: () => number;
}

export interface WatchPostureRecorder {
  /** Pull the events recorded since `start()`. Does not stop the
   *  recorder — call `stop()` separately. */
  drain(): readonly PostureChangeTimelineEntry[];
  /** Stop recording. Idempotent. */
  stop(): void;
  /** Diagnostic — current event count. */
  size(): number;
}

/**
 * Subscribe to substrate posture changes for a watch window. Filter
 * to a specific shellId when provided. Returns a recorder whose
 * `drain()` produces the timeline-ready entries to merge with
 * captures.
 */
export function startWatchPostureRecorder(
  deps: WatchPostureRecorderDeps,
): WatchPostureRecorder {
  const now = deps.now ?? Date.now;
  const events: PostureChangeTimelineEntry[] = [];
  let unsubscribe: Unsubscribe | null = null;

  const sub: ShellPostureSubscriber = (event) => {
    if (deps.shellId && event.shellId !== deps.shellId) return;
    events.push({
      kind: 'posture-change',
      at: now(),
      shellId: event.shellId,
      prev: event.prev?.userExposure ?? null,
      next: event.next?.userExposure ?? null,
    });
  };

  unsubscribe = deps.registry.subscribePosture(sub);

  return {
    drain() {
      return events.slice();
    },
    stop() {
      if (unsubscribe) {
        try { unsubscribe(); } catch { /* idempotent */ }
        unsubscribe = null;
      }
    },
    size() {
      return events.length;
    },
  };
}
