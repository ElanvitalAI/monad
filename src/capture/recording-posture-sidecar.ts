// ── X6 (Phase 4 Bundle 1) — Recording × posture timeline sidecar ──
//
// HANDOFF Phase 4 / ROADMAP §7 X6: "Recording × posture timeline". 기존
// recorder (asciicast / GIF / mp4) 가 동작하는 동안 substrate posture
// 변화를 sidecar 메타데이터로 저장. 재생 시 어느 시점에 어떤 posture
// 변화 발생했는지 timeline 으로 표시 가능.
//
// 의존:
//   - X3 watch-pane-posture-timeline (이미 land) — 같은 기록 패턴
//   - 기존 capture/recorder.ts (이미 land)
//
// Pure recorder wrapper — 시작/종료 시점 + 그 사이의 posture 이벤트 + 외부
// "checkpoint" 마커 (capture frame 시점) 모두 sidecar 에 timeline 으로.

import type {
  ShellPostureEvent,
  ShellPostureSubscriber,
  ShellRegistry,
  Unsubscribe,
} from '../shell-runner/types.js';
import type { TerminalUserExposure } from '../terminal/posture.js';

export interface PostureChangeMarker {
  readonly kind: 'posture-change';
  readonly at: number;          // ms since recording start
  readonly shellId: string;
  readonly prev: TerminalUserExposure | null;
  readonly next: TerminalUserExposure | null;
}

export interface FrameMarker {
  readonly kind: 'frame';
  readonly at: number;          // ms since recording start
  readonly frameNumber: number;
  /** Optional label (예: "before fix" / "after retry"). */
  readonly label?: string;
}

export interface CheckpointMarker {
  readonly kind: 'checkpoint';
  readonly at: number;
  readonly label: string;
  readonly metadata?: Record<string, unknown>;
}

export type RecordingMarker = PostureChangeMarker | FrameMarker | CheckpointMarker;

export interface RecordingSidecar {
  /** Recording 시작 wall-clock (ISO). */
  readonly startedAt: string;
  /** Recording 종료 wall-clock (ISO). */
  readonly endedAt?: string;
  /** Total duration ms. */
  readonly durationMs?: number;
  /** Posture / frame / checkpoint markers, time-ordered. */
  readonly markers: readonly RecordingMarker[];
  /** Recording target (예: vw label, surface id). */
  readonly target?: string;
  /** Optional metadata. */
  readonly meta?: Record<string, unknown>;
}

export interface RecordingPostureSidecarDeps {
  registry: ShellRegistry;
  /** Filter posture events to a specific shell. omit = all. */
  shellId?: string;
  /** Test seam — defaults to performance.now() (or Date.now). */
  now?: () => number;
  /** ISO clock — defaults to new Date(). */
  isoNow?: () => string;
  logDebug?: (category: string, event: string, data?: unknown) => void;
}

export interface RecordingPostureRecorder {
  /** Add a frame marker at current time. */
  recordFrame(frameNumber: number, label?: string): void;
  /** Add a custom checkpoint. */
  checkpoint(label: string, metadata?: Record<string, unknown>): void;
  /** Set recording target identifier. */
  setTarget(target: string): void;
  /** Stop recording and return final sidecar. Idempotent. */
  finish(meta?: Record<string, unknown>): RecordingSidecar;
  /** Diagnostic — current marker count. */
  size(): number;
}

function nowFn(deps: RecordingPostureSidecarDeps): () => number {
  if (deps.now) return deps.now;
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return () => performance.now();
  }
  return () => Date.now();
}

export function startRecordingPostureSidecar(
  deps: RecordingPostureSidecarDeps,
): RecordingPostureRecorder {
  const tick = nowFn(deps);
  const isoNow = deps.isoNow ?? (() => new Date().toISOString());
  const startedAt = isoNow();
  const startTick = tick();
  let target: string | undefined = undefined;
  let finished: RecordingSidecar | null = null;
  let unsubscribe: Unsubscribe | null = null;

  const markers: RecordingMarker[] = [];

  const log = (category: string, event: string, data?: unknown): void => {
    if (deps.logDebug) deps.logDebug(category, event, data);
  };

  const sub: ShellPostureSubscriber = (event: ShellPostureEvent) => {
    if (deps.shellId && event.shellId !== deps.shellId) return;
    if (finished) return;
    markers.push({
      kind: 'posture-change',
      at: tick() - startTick,
      shellId: event.shellId,
      prev: event.prev?.userExposure ?? null,
      next: event.next?.userExposure ?? null,
    });
  };

  unsubscribe = deps.registry.subscribePosture(sub);

  return {
    recordFrame(frameNumber, label) {
      if (finished) return;
      markers.push({
        kind: 'frame',
        at: tick() - startTick,
        frameNumber,
        ...(label !== undefined ? { label } : {}),
      });
    },
    checkpoint(label, metadata) {
      if (finished) return;
      markers.push({
        kind: 'checkpoint',
        at: tick() - startTick,
        label,
        ...(metadata !== undefined ? { metadata } : {}),
      });
    },
    setTarget(t) {
      target = t;
    },
    finish(meta) {
      if (finished) return finished;
      if (unsubscribe) {
        try { unsubscribe(); } catch { /* idempotent */ }
        unsubscribe = null;
      }
      // Sort markers by time (stable).
      const sorted = markers.slice().sort((a, b) => a.at - b.at);
      const endedAt = isoNow();
      const durationMs = tick() - startTick;
      finished = {
        startedAt,
        endedAt,
        durationMs,
        markers: sorted,
        ...(target !== undefined ? { target } : {}),
        ...(meta !== undefined ? { meta } : {}),
      };
      log('recording.sidecar.finish', '', { markers: sorted.length, durationMs });
      return finished;
    },
    size() {
      return markers.length;
    },
  };
}

/**
 * Pure helper — given a frame number from a recording, return all
 * markers within ±toleranceMs of that frame's `at` time.
 */
export function nearestMarkersForFrame(
  sidecar: RecordingSidecar,
  frameAtMs: number,
  toleranceMs: number,
): readonly RecordingMarker[] {
  return sidecar.markers.filter((m) => Math.abs(m.at - frameAtMs) <= toleranceMs);
}
