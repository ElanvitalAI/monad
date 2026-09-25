// ── Phase B (Capture Fabric · X3 closure) — WatchPane × posture timeline auto-merge ──
//
// `watch-pane.ts` (P7-E-α) emits before/after diff for a watched
// surface. `watch-pane-posture-timeline.ts` (X3 base) provides the
// pure composer. This module is the *closure layer* that wires the
// two together as a single async helper.
//
// Why a separate file?
//   - `watch-pane.ts` deliberately stays substrate-agnostic
//     (it doesn't know about ShellRegistry).
//   - `watch-pane-posture-timeline.ts` is a pure composer (no IO).
//   - This file is the IO-aware glue: starts the posture recorder
//     before the watch, runs the watch, drains posture events, merges.

import type { ShellRegistry } from '../shell-runner/types.js';
import {
  composePostureTimeline,
  startWatchPostureRecorder,
  type CaptureTimelineEntry,
  type WatchTimelineEntry,
} from './watch-pane-posture-timeline.js';
import { dispatchWatchPane, type WatchPaneDeps, type WatchPaneOut } from './watch-pane.js';

export interface WatchPaneWithTimelineDeps extends WatchPaneDeps {
  /** Substrate posture source — when supplied, the wrapper records
   *  posture-change events for the watch duration and merges them
   *  with the before/after captures into a single timeline. */
  shellRegistry?: ShellRegistry;
  /** Filter posture events to a specific shellId. When omitted, all
   *  posture changes during the watch window are recorded (typically
   *  noisy — supply a shellId for focused watches). */
  shellId?: string;
  /** Test seam — defaults to `Date.now`. */
  now?: () => number;
}

export interface WatchPaneWithTimelineOut extends WatchPaneOut {
  /** Phase B X3 closure — chronologically merged timeline of capture
   *  entries (before/after) and posture-change events recorded during
   *  the watch window. Empty array when no posture source was supplied
   *  or no events fired. */
  readonly timeline: readonly WatchTimelineEntry[];
}

/**
 * Run `dispatchWatchPane` while recording posture transitions in
 * parallel, then merge both streams into a single timeline.
 *
 * Caller behaviour parity with `dispatchWatchPane`:
 *   - same arguments shape
 *   - same `before/after/diff` fields preserved verbatim
 *   - additional `timeline` field surfaces the merged stream
 *
 * Posture recorder lifecycle is bracketed around the watch — started
 * before the call, stopped after the result resolves (success or
 * throw). Even if the watch throws, the recorder is cleanly torn down.
 */
export async function dispatchWatchPaneWithTimeline(
  args: Record<string, unknown>,
  deps: WatchPaneWithTimelineDeps = {},
): Promise<WatchPaneWithTimelineOut> {
  const now = deps.now ?? Date.now;
  const recorder = deps.shellRegistry
    ? startWatchPostureRecorder({
        registry: deps.shellRegistry,
        ...(deps.shellId !== undefined ? { shellId: deps.shellId } : {}),
        now,
      })
    : null;

  let result: WatchPaneOut;
  try {
    result = await dispatchWatchPane(args, deps);
  } finally {
    if (recorder) recorder.stop();
  }

  const captures: CaptureTimelineEntry[] = [];
  if (result.before) {
    captures.push({
      kind: 'capture',
      at: now() - 1, // before the watch — slot earlier than posture events
      body: result.before.text,
      format: `text:${result.before.lines}lines`,
    });
  }
  if (result.after) {
    captures.push({
      kind: 'capture',
      at: now(),
      body: result.after.text,
      format: `text:${result.after.lines}lines`,
    });
  }
  const postureEvents = recorder ? recorder.drain() : [];
  const timeline = composePostureTimeline(captures, postureEvents);

  return {
    ...result,
    timeline,
  };
}
