// ── Capture Phase 0 — asciicast recorder ──
//
// Stateful stream recorder that accumulates frames until `stop()` and
// exposes `serialize()` to produce an asciicast v2 artifact. Pause /
// resume shift the elapsed clock but keep the frame list intact — the
// paused span simply never contributes a frame.
//
// Minimal by design: no file I/O, no event emitters, no throttling.
// Wiring to PTY / pane substrate lands in Phase 2b; the recorder's
// contract is narrow enough to stay immune to those downstream changes.
//
// State machine:
//   idle → start() → recording
//   recording → pause() → paused
//   paused → resume() → recording
//   * → stop() → stopped
//
// Methods called in the wrong state raise `RecorderStateError`.

import { encodeAsciicast, type AsciicastFrame } from './encoders/asciicast.js';
import {
  RecorderStateError,
  type CaptureDimensions,
  type RecorderHandle,
  type RecorderOpts,
  type RecorderStatus,
  type RecorderStream,
} from './types.js';

class Recorder implements RecorderHandle {
  private _status: RecorderStatus = 'idle';
  private _frames: AsciicastFrame[] = [];
  private startMs: number | null = null;
  private pausedAtMs: number | null = null;
  private pausedMs = 0;
  private readonly dims: CaptureDimensions;
  private readonly title?: string;
  private readonly env?: Record<string, string>;
  private readonly now: () => number;
  private readonly forcedStartedAtSec?: number;

  constructor(private readonly opts: RecorderOpts) {
    this.dims = opts.dims;
    this.title = opts.title;
    this.env = opts.env;
    this.now = opts.now ?? Date.now;
    this.forcedStartedAtSec = opts.startedAtSec;
  }

  get status(): RecorderStatus { return this._status; }
  get frameCount(): number { return this._frames.length; }
  get elapsedSec(): number {
    if (this.startMs === null) return 0;
    const endMs = this._status === 'stopped'
      ? (this.stopAtMs ?? this.now())
      : this._status === 'paused'
        ? (this.pausedAtMs ?? this.now())
        : this.now();
    const activeMs = Math.max(0, endMs - this.startMs - this.pausedMs);
    return activeMs / 1000;
  }

  private stopAtMs: number | null = null;

  start(): void {
    if (this._status !== 'idle') {
      throw new RecorderStateError('start requires idle state', this._status);
    }
    this.startMs = this.now();
    this._status = 'recording';
  }

  pause(): void {
    if (this._status !== 'recording') {
      throw new RecorderStateError('pause requires recording state', this._status);
    }
    this.pausedAtMs = this.now();
    this._status = 'paused';
  }

  resume(): void {
    if (this._status !== 'paused') {
      throw new RecorderStateError('resume requires paused state', this._status);
    }
    if (this.pausedAtMs !== null) {
      this.pausedMs += this.now() - this.pausedAtMs;
      this.pausedAtMs = null;
    }
    this._status = 'recording';
  }

  stop(): void {
    if (this._status === 'stopped' || this._status === 'idle') {
      // Idempotent stop: idle → stopped is a no-op transition by design
      // so callers don't need to track prior state.
      this._status = 'stopped';
      return;
    }
    if (this._status === 'paused' && this.pausedAtMs !== null) {
      this.pausedMs += this.now() - this.pausedAtMs;
      this.pausedAtMs = null;
    }
    this.stopAtMs = this.now();
    this._status = 'stopped';
  }

  write(bytes: string, stream: RecorderStream = 'o'): void {
    if (this._status !== 'recording') {
      // Drop silently when not recording. Paused recordings routinely
      // see incoming bytes we want to discard; stopped writes are a
      // programming error but the engine shouldn't crash on late
      // arrivals from an async producer.
      return;
    }
    if (this.startMs === null) return;  // unreachable; start() set it
    const time = (this.now() - this.startMs - this.pausedMs) / 1000;
    this._frames.push({
      time: Math.max(0, time),
      stream,
      data: bytes,
    });
  }

  serialize(): string {
    const startedAtSec = this.forcedStartedAtSec
      ?? (this.startMs !== null ? Math.floor(this.startMs / 1000) : Math.floor(this.now() / 1000));
    return encodeAsciicast({
      dims: this.dims,
      startedAtSec,
      ...(this.title !== undefined ? { title: this.title } : {}),
      ...(this.env !== undefined ? { env: this.env } : {}),
      frames: this._frames,
    });
  }
}

export function createRecorder(opts: RecorderOpts): RecorderHandle {
  return new Recorder(opts);
}
