// WT-N-5 P2 — daemon-side latest-frame pointer per session.
//
// PWA streams JPEG frames to `/v1/attachments` at 1 Hz. After each
// successful upload the PWA hits ACP `terminal/camera/frame/notify`
// with `{sessionId, terminalId?, attachmentId, ts}`. The handler
// updates this in-memory Map so the LLM tool `LiveCameraFrame` can
// resolve "most recent frame for the current session" in O(1) without
// scanning the attachments directory.
//
// Why in-memory only (not sqlite): live-camera frames are ephemeral
// (the user starts/stops the stream by hand · daemon restart drops
// the pointer · no resume contract). The actual JPEG files persist
// on disk under `/tmp/monad-attachments/` until the OS cleans them
// up — agents can still call `WebTerminalScreenshot` for fresh
// captures if the live pointer was dropped.

import { debug } from '../debug/log.js';

export interface LiveCameraFrameEntry {
  sessionId: string;
  terminalId?: string;
  attachmentId: string;
  ts: number;
  /** Monotonically-increasing per-session counter — useful for
   *  telemetry + dedup ("did the LLM already see frame N?"). */
  frameIndex: number;
}

const latestBySession = new Map<string, LiveCameraFrameEntry>();
const frameIndexBySession = new Map<string, number>();

export interface NotifyInput {
  sessionId: string;
  terminalId?: string;
  attachmentId: string;
  ts?: number;
}

/** Record a freshly-uploaded frame as the latest for `sessionId`.
 *  Returns the assigned `frameIndex` so the PWA can correlate
 *  uploaded vs LLM-consumed frames. */
export function recordLiveCameraFrame(input: NotifyInput): LiveCameraFrameEntry {
  const prev = frameIndexBySession.get(input.sessionId) ?? 0;
  const frameIndex = prev + 1;
  frameIndexBySession.set(input.sessionId, frameIndex);
  const entry: LiveCameraFrameEntry = {
    sessionId: input.sessionId,
    ...(input.terminalId ? { terminalId: input.terminalId } : {}),
    attachmentId: input.attachmentId,
    ts: input.ts ?? Date.now(),
    frameIndex,
  };
  latestBySession.set(input.sessionId, entry);
  if (debug.enabled) {
    debug.log('webterm.live-cam', 'notify', {
      sessionId: input.sessionId,
      attachmentId: input.attachmentId,
      frameIndex,
    });
  }
  return entry;
}

/** Look up the most-recent frame for `sessionId`. Returns `null`
 *  when the user never started a live-camera session in this
 *  daemon process (or after stop()). */
export function getLatestLiveCameraFrame(sessionId: string): LiveCameraFrameEntry | null {
  return latestBySession.get(sessionId) ?? null;
}

/** Drop the pointer for `sessionId` — useful when the PWA explicitly
 *  ends the camera stream. The on-disk JPEGs stay (OS reaps `/tmp`).
 *  Currently called on `terminal/camera/frame/clear` (future ACP
 *  ext method) — unused at P2 land but kept here so consumers don't
 *  reach into the Map directly. */
export function clearLiveCameraFrames(sessionId: string): boolean {
  const had = latestBySession.delete(sessionId);
  frameIndexBySession.delete(sessionId);
  if (had && debug.enabled) {
    debug.log('webterm.live-cam', 'clear', { sessionId });
  }
  return had;
}

/** Test seam — wipe the Map between test cases so registry state
 *  doesn't bleed across `describe` blocks. Production callers
 *  never invoke this. */
export function _resetLiveCameraRegistry(): void {
  latestBySession.clear();
  frameIndexBySession.clear();
}
