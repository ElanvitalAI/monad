// ── Capture substrate · frame → asciicast recorder (PLAN P4 · §4-2) ──
//
// The recording half of the capture bus: turn a stream of SelfReportFrames
// (full-screen rendered snapshots · picker/modal 포함) into an asciicast v2
// recording. PLAN §4-2 — "레코딩 = 프레임 시계열. SelfReportFrame 스트림이
// 곧 자연스러운 레코딩 소스." Any surface that publishes frames (the
// dashboard TUI self-report, a forwarded self-implement child) becomes
// recordable through ONE bridge, reusing the existing Recorder/encoders.
//
// A SelfReportFrame is a FULL screen (not an incremental byte stream), so
// each frame is written as a `clear + home + screen` chunk — asciinema
// replays it as a flipbook of screens (each frame repaints). This reuses
// `Recorder` verbatim (its `write()` push interface) — no Recorder change.
//
// This module is the reusable seam + the bus adapter named in PLAN §4-2.
// WHERE recording is triggered (a UI button, a manifest-poll adapter for
// cross-process surfaces) layers on top — out of scope here.

import { createRecorder } from './recorder.js';
import type { RecorderHandle } from './types.js';
import { subscribeSurfaceFrames, type SelfReportFrame } from './self-report-frame.js';
import type { ChannelBus } from '../terminal-matrix/channel-bus.js';

/** Repaint prelude written before each frame's text so playback shows the
 *  full screen snapshot: ESC[0m = reset SGR (so a prior frame's leftover
 *  color/attrs can't bleed into this one · review), ESC[2J = clear screen,
 *  ESC[H = cursor home. */
const REPAINT = '\x1b[0m\x1b[2J\x1b[H';

export interface FrameRecorderHandle {
  /** Record one rendered-screen frame (full snapshot). No-op after stop(). */
  feed(frame: SelfReportFrame): void;
  /** Stop and return the asciicast v2 string. Empty when never fed.
   *  Idempotent — subsequent calls return the same serialization. */
  stop(): string;
  readonly frameCount: number;
  readonly status: 'idle' | 'recording' | 'stopped';
}

export interface FrameRecorderOpts {
  /** asciicast header title. */
  readonly title?: string;
  /** Deterministic clock (ms) for tests. */
  readonly now?: () => number;
}

/** Create a frame recorder. The underlying `Recorder` is created lazily on
 *  the FIRST frame (its dims come from that frame's cols/rows) so callers
 *  don't need to know the surface geometry up front.
 *
 *  ⚠️ Geometry is fixed to the first frame's cols/rows: asciicast v2 as
 *  produced by the shared `Recorder`/encoder carries dims only in the
 *  header (no per-event resize), and P4 reuses them unchanged. A surface
 *  that resizes mid-recording keeps replaying at the initial geometry
 *  (later frames wrap, not crash). Capturing resize events would require
 *  extending the encoder — deferred (surfaces rarely resize mid-record). */
export function createFrameRecorder(opts: FrameRecorderOpts = {}): FrameRecorderHandle {
  let rec: RecorderHandle | null = null;
  let stopped = false;
  return {
    feed(frame: SelfReportFrame): void {
      if (stopped) return;
      if (!rec) {
        rec = createRecorder({
          dims: { cols: frame.cols, rows: frame.rows },
          ...(opts.title !== undefined ? { title: opts.title } : {}),
          ...(opts.now ? { now: opts.now } : {}),
        });
        rec.start();
      }
      rec.write(REPAINT + frame.text, 'o');
    },
    stop(): string {
      stopped = true;
      if (!rec) return '';
      if (rec.status === 'recording') rec.stop();
      return rec.serialize();
    },
    get frameCount(): number { return rec?.frameCount ?? 0; },
    get status(): 'idle' | 'recording' | 'stopped' {
      return stopped ? 'stopped' : (rec ? 'recording' : 'idle');
    },
  };
}

/** A live recording of a surface's frame channel — owns both the recorder
 *  and its bus subscription so there's ONE lifecycle to manage. */
export interface FrameRecordingSession {
  /** Stop recording, unsubscribe from the bus, and return the asciicast
   *  v2 string. Idempotent — the subscription is dropped exactly once so a
   *  stopped session can't leak a dangling callback (review should-fix). */
  stop(): string;
  readonly frameCount: number;
  readonly status: 'idle' | 'recording' | 'stopped';
}

/** ⭐PLAN §4-2 named seam — record a surface's frame channel
 *  (`tui-observe:<surfaceId>`). Owns the recorder + subscription and ties
 *  them into one `stop()` so the caller can't stop the recorder while
 *  leaking the subscription (or vice versa). Same-process only (ChannelBus
 *  is process-local); cross-process recording layers a manifest-poll
 *  adapter on top. */
export function recordSurfaceFromBus(
  bus: ChannelBus,
  surfaceId: string,
  opts: FrameRecorderOpts = {},
): FrameRecordingSession {
  const rec = createFrameRecorder(opts);
  const sub = subscribeSurfaceFrames(bus, surfaceId, (f) => rec.feed(f));
  let unsubscribed = false;
  return {
    stop(): string {
      if (!unsubscribed) { unsubscribed = true; sub.unsubscribe(); }
      return rec.stop();
    },
    get frameCount(): number { return rec.frameCount; },
    get status(): 'idle' | 'recording' | 'stopped' { return rec.status; },
  };
}
