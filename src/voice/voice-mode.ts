// PR-S1V.4 (sprint 21-Parallel-Voice · 2026-04-29) — Voice mode state
// machine + kitty-keyboard level toggle.
//
// 일반 monad 의 textInput Space (char input) 와 conflict 없이 Space hold
// push-to-talk 을 가능하게 하기 위해 별도 voice mode 분리. Mode 진입
// 시만 kitty `>3u` 활성 (release events 받음) · exit 시 `>1u` 복원.
//
// Reference: PLAN-voice-input-bridge-s1v4-2026-04-29.md §5 + §6.

import { debug } from '../debug/log.js';

// ── State ──────────────────────────────────────────────────────────

export type VoiceModeState =
  | { kind: 'idle' }
  | { kind: 'active' }
  | { kind: 'recording' }
  | { kind: 'processing' };

// ── Dependencies ────────────────────────────────────────────────────

export interface VoiceModeDeps {
  /** Start raw PCM capture. Returns true if a backend spawned. The
   *  voice mode calls this with `silenceDetection: false` because Space
   *  hold provides the explicit stop boundary. */
  startCapture: (
    onData: (chunk: Buffer) => void,
    onEnd: () => void,
  ) => Promise<boolean>;
  stopCapture: () => void;
  /** Run STT on the captured PCM and return the transcript text. */
  transcribe: (pcm: Buffer) => Promise<{ text: string }>;
  /** Forward the final transcript to the caller (voice-input-bridge wires
   *  this into MessageBlockStream user block injection). */
  onTranscript: (text: string) => void | Promise<void>;
  /** Visual indicator hook — host (dashboard) renders it. */
  onIndicator: (visible: boolean, label?: string) => void;
  /** Kitty-keyboard level toggle. `voice` writes `>3u`; `normal` writes
   *  `>1u`. Implemented as a stdout write in production. */
  writeKitty: (mode: 'normal' | 'voice') => void;
  /** Emit transcribe failures so the host can surface a toast / status
   *  pill without crashing the state machine. */
  onError?: (err: Error, phase: 'capture' | 'transcribe') => void;
  /** Inactivity timeout — `active` 상태에서 첫 Space press 없이 이 시간
   *  넘어가면 자동 idle 복귀. Default 5_000ms. */
  inactivityMs?: number;
  /** Test helpers — production paths use `Date.now` / `setTimeout` /
   *  `clearTimeout` directly. */
  nowMs?: () => number;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

const DEFAULT_INACTIVITY_MS = 5_000;

// ── Public API ──────────────────────────────────────────────────────

export interface VoiceMode {
  getState(): VoiceModeState;
  /** Caller hits Ctrl+Shift+V — enter `active`. No-op when already in
   *  any non-idle state. */
  enter(): void;
  /** Caller hits Esc, or 5 s inactivity fired, or `dispose()` — back to
   *  `idle`. Stops any in-flight capture. Always restores kitty level. */
  exit(reason: 'esc' | 'timeout' | 'dispose' | 'error' | 'handoff'): void;
  /** Space `down` event from the host. Only meaningful in `active`. */
  pressSpace(): void;
  /** Space `up` event from the host. Only meaningful in `recording`. */
  releaseSpace(): void;
  /** Tear down — exits cleanly + clears any timers. Idempotent. */
  dispose(): void;
}

export function createVoiceMode(deps: VoiceModeDeps): VoiceMode {
  let state: VoiceModeState = { kind: 'idle' };
  let chunks: Buffer[] = [];
  let timerId: unknown = null;
  let disposed = false;

  const inactivityMs = deps.inactivityMs ?? DEFAULT_INACTIVITY_MS;
  const setTimer =
    deps.setTimer ??
    ((cb: () => void, ms: number) => setTimeout(cb, ms) as unknown);
  const clearTimer =
    deps.clearTimer ??
    ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));

  function log(event: string, data?: unknown): void {
    if (debug.enabled) debug.log('voice.mode', event, data);
  }

  function clearInactivityTimer(): void {
    if (timerId !== null) {
      clearTimer(timerId);
      timerId = null;
    }
  }

  function armInactivityTimer(): void {
    clearInactivityTimer();
    timerId = setTimer(() => {
      log('inactivity-timeout');
      // Only fire when we're still active (not recording/processing).
      if (state.kind === 'active') {
        exit('timeout');
      }
    }, inactivityMs);
  }

  function setState(next: VoiceModeState): void {
    log('transition', { from: state.kind, to: next.kind });
    state = next;
  }

  function enter(): void {
    if (disposed) return;
    if (state.kind !== 'idle') {
      log('enter.ignored', { state: state.kind });
      return;
    }
    deps.writeKitty('voice');
    deps.onIndicator(true, '🎙 Voice mode');
    setState({ kind: 'active' });
    armInactivityTimer();
  }

  function exit(reason: 'esc' | 'timeout' | 'dispose' | 'error' | 'handoff'): void {
    if (state.kind === 'idle') return;
    log('exit', { reason, fromState: state.kind });
    clearInactivityTimer();
    if (state.kind === 'recording') {
      deps.stopCapture();
    }
    chunks = [];
    setState({ kind: 'idle' });
    deps.onIndicator(false);
    deps.writeKitty('normal');
  }

  function pressSpace(): void {
    if (state.kind !== 'active') {
      log('press-space.ignored', { state: state.kind });
      return;
    }
    clearInactivityTimer();
    chunks = [];
    setState({ kind: 'recording' });
    deps.onIndicator(true, '🔴 Recording');
    void (async () => {
      try {
        const ok = await deps.startCapture(
          chunk => chunks.push(chunk),
          () => {
            // sox/arecord exited (e.g. crash / device loss). If we were
            // still recording, treat as a forced stop and flush whatever
            // we got.
            if (state.kind === 'recording') {
              log('capture.unexpected-end');
              flushAndTranscribe();
            }
          },
        );
        if (!ok) {
          log('capture.start-failed');
          deps.onError?.(new Error('audio capture failed to start'), 'capture');
          // Fall back to active (user can try again or Esc).
          setState({ kind: 'active' });
          deps.onIndicator(true, '🎙 Voice mode');
          armInactivityTimer();
        }
      } catch (err) {
        log('capture.start-throw', { err: String(err) });
        deps.onError?.(err as Error, 'capture');
        setState({ kind: 'active' });
        deps.onIndicator(true, '🎙 Voice mode');
        armInactivityTimer();
      }
    })();
  }

  function releaseSpace(): void {
    if (state.kind !== 'recording') {
      log('release-space.ignored', { state: state.kind });
      return;
    }
    deps.stopCapture();
    flushAndTranscribe();
  }

  function flushAndTranscribe(): void {
    const pcm = Buffer.concat(chunks);
    chunks = [];
    if (pcm.byteLength === 0) {
      log('transcribe.skip-empty');
      setState({ kind: 'active' });
      deps.onIndicator(true, '🎙 Voice mode');
      armInactivityTimer();
      return;
    }
    setState({ kind: 'processing' });
    deps.onIndicator(true, '✨ Transcribing');
    void (async () => {
      try {
        const result = await deps.transcribe(pcm);
        log('transcribe.ok', { chars: result.text.length });
        await deps.onTranscript(result.text);
      } catch (err) {
        log('transcribe.error', { err: String(err) });
        deps.onError?.(err as Error, 'transcribe');
      } finally {
        // After transcribe (success or fail) return to active so the
        // user can immediately re-record without re-entering the mode.
        if (!disposed && state.kind === 'processing') {
          setState({ kind: 'active' });
          deps.onIndicator(true, '🎙 Voice mode');
          armInactivityTimer();
        }
      }
    })();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    log('dispose');
    exit('dispose');
  }

  return {
    getState: () => state,
    enter,
    exit,
    pressSpace,
    releaseSpace,
    dispose,
  };
}

// ── Crash-safety helper ─────────────────────────────────────────────

/**
 * Install `process.on('exit'/'SIGINT'/'SIGTERM')` handlers so we always
 * restore kitty level 1 on process termination — even if voice mode was
 * active at crash time. Idempotent: calling more than once installs the
 * handlers only once. Returns a cleanup function that uninstalls them.
 *
 * Production callers register this once at startup (host wiring); tests
 * call the returned cleanup so handlers don't leak across cases.
 */
export function installKittyCrashSafety(
  writeKitty: (mode: 'normal' | 'voice') => void,
): () => void {
  let installed = true;
  const handler = (): void => {
    if (!installed) return;
    try {
      writeKitty('normal');
    } catch {
      // best-effort — process is already terminating
    }
  };
  process.once('exit', handler);
  process.once('SIGINT', handler);
  process.once('SIGTERM', handler);
  return () => {
    installed = false;
    process.removeListener('exit', handler);
    process.removeListener('SIGINT', handler);
    process.removeListener('SIGTERM', handler);
  };
}
