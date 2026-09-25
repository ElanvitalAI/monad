// PR-S1V.4 (sprint 21-Parallel-Voice · 2026-04-29) — Dashboard host for
// voice-mode + Space hold push-to-talk.
//
// Wires voice-mode (state machine) + voice-input-bridge (STT + injection)
// into the dashboard's key dispatch loop. Exposes a minimal API so
// `dashboard/index.ts` can:
//   1. Call `host.maybeHandleKey(key)` first in its `onKey` handler —
//      returns `true` when the key was consumed by voice mode and the
//      dispatcher should stop.
//   2. Call `host.requestEnter()` from the Ctrl+Shift+V binding.
//   3. Subscribe `host.onIndicatorChange(cb)` to drive a status-bar
//      pill ("🎙 Voice mode" / "🔴 Recording" / "✨ Transcribing").
//
// PR-S1V.4-wiring (2026-04-29) extensions:
//   - maybeHandleKey is now modal-A: every key is consumed while voice
//     mode is active (escape exits, space toggles recording, all other
//     keys are no-op-swallowed) so bell / terminal / editor primitives
//     never see release/repeat artefacts.
//   - The host owns the bridge's `onSendError` callback and flashes the
//     status indicator with `✖ send failed`. After a 5 s timer it asks
//     `voice-mode.getState()` for the current state and recomputes the
//     indicator label so the restore stays accurate even if the user
//     transitioned to recording/processing during the flash.
//   - `submitToSession` (host-supplied) is threaded through to the
//     bridge so the dashboard owns the transport split (PTY vs ACP).
//
// Reference: PLAN-voice-input-bridge-s1v4-2026-04-29.md §8,
// PLAN-voice-wiring-s1v4w-2026-04-29.md §4.3a + §4.5a.

import type { Key } from '../tui.js';
import { debug } from '../debug/log.js';
import {
  startRecording,
  stopRecording,
} from '../voice/audio-capture.js';
import {
  createVoiceMode,
  installKittyCrashSafety,
  type VoiceMode,
  type VoiceModeState,
} from '../voice/voice-mode.js';
import {
  createVoiceInputBridge,
  type SessionResolution,
  type VoiceInputBridge,
} from '../voice/voice-input-bridge.js';
import type { InputSourceRef } from '../input/input-source-kind.js';
import type { STTProvider } from '../voice/stt-provider.js';
import type { VoiceBrand } from '../voice/voice-prefix-router.js';

// ── Types ──────────────────────────────────────────────────────────

export interface VoiceInputHostDeps {
  /** STT provider — typically created once at boot via `createSTTProvider`. */
  sttProvider: STTProvider;
  /** Resolve the target session for an inject. Host calls into the
   *  agent-room registry (or focused-pane registry) to look up the
   *  matching session id based on the brand prefix. */
  resolveSession: (brand: VoiceBrand | null) => SessionResolution | null;
  /** Submit the transcript to the resolved session with submit
   *  semantics (Enter included). Dashboard owns the transport split —
   *  embodied PTY vs ACP live pane — so the host stays transport-
   *  agnostic. PLAN §4.5 hybrid lookup is implemented in dashboard
   *  boot (not here). */
  submitToSession: (sessionId: string, text: string) => Promise<void>;
  /** Optional dictation fallback when no live session target exists. */
  dictateTranscript?: (text: string) => Promise<boolean> | boolean;
  /** Stdout sink for kitty level toggles. Defaults to `process.stdout.write`. */
  writeStdout?: (s: string) => void;
  /** Override the kitty escape sequences (test injection). */
  kittySequences?: { voice: string; normal: string };
  /** Inactivity ms forwarded to voice-mode. */
  inactivityMs?: number;
  /** PR-S1V.4-wiring · injectable timer for the `✖ send failed`
   *  indicator restore. Test code passes a fake timer so the restore
   *  callback can fire deterministically. Defaults to `setTimeout`. */
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Override the send-failed restore window. Defaults to 5 000 ms. */
  sendErrorRestoreMs?: number;
}

export interface VoiceIndicator {
  visible: boolean;
  label?: string;
}

/** PR-S1V.D4 (2026-04-29) — Dictation lifecycle that runs alongside —
 *  but mutually exclusive with — explicit voice mode. Long-press Space
 *  detector fires `startDictation()`; the same detector's release path
 *  fires `stopDictation()` which transcribes + hands the result to
 *  `dictateTranscript`. Voice mode and dictation share the audio-capture
 *  module (one sox subprocess at a time) so the host enforces mutual
 *  exclusion. */
export type DictationState = 'idle' | 'recording' | 'processing';

export interface VoiceInputHost {
  /** Inspect current voice-mode state (test/log). */
  getState(): VoiceModeState;
  /** PR-S1V.D4 — separate dictation state. Mutually exclusive with
   *  voice-mode (one sox subprocess). */
  getDictationState(): DictationState;
  getIndicator(): VoiceIndicator;
  /** Subscribe to indicator updates. Returns an unsubscribe. */
  onIndicatorChange(cb: (ind: VoiceIndicator) => void): () => void;
  /** Caller registers Ctrl+Shift+V to invoke this. */
  requestEnter(): void;
  /** PR-S1V.D4 — long-press Space detector hands off here when threshold
   *  reached. Returns `false` when refused (voice mode active, no STT
   *  provider, etc.) so the caller knows the OS Space char already
   *  reached the chat input but no dictation will follow. */
  startDictation(): boolean;
  /** PR-S1V.D4 — long-press Space detector hands off here on release.
   *  Awaitable so the caller can `await` if it wants to chain on the
   *  STT result; the host's chat-main inject runs internally. */
  stopDictation(): Promise<void>;
  /** PR-S1V.D5+ — pending-phase indicator. The detector calls this
   *  the moment Space goes from idle → pending, well before the
   *  600 ms threshold commits to recording. Emits a subtle "🎤 hold…"
   *  HUD label so the user sees their press was registered.
   *  No-op when voice mode is active or dictation is already running
   *  — those owners drive the indicator themselves. */
  notePending(): void;
  /** PR-S1V.D5+ — counterpart to `notePending`. Called on tap (no
   *  threshold) or any cancel-by-other-key path. Clears the "🎤 hold…"
   *  label only if it's still showing; no-op when voice mode or an
   *  in-flight dictation has taken over the indicator. */
  clearPending(): void;
  /**
   * Pre-key hook. Returns `true` when the host consumed the key.
   *
   * - `idle` → `false` (defer to legacy dispatcher).
   * - any non-idle state → modal A invariant: returns `true` for every
   *   key. `escape` (non-release) exits voice mode, `space`
   *   press/release feeds the recording lifecycle, and every other key
   *   is swallowed as a no-op so legacy dispatchers (bell, terminal,
   *   input-core) never see release/repeat events that the kitty `>3u`
   *   protocol synthesises.
   */
  maybeHandleKey(key: Key): boolean;
  /** Tear down — exits voice mode + uninstalls crash-safety handlers. */
  dispose(): void;
  /** Internal handles for testing. */
  _internal: {
    bridge: VoiceInputBridge;
    voiceMode: VoiceMode;
    handleTranscript: (text: string) => Promise<void>;
    /** PR-S1V.4-wiring — recompute helper exposed for unit tests so
     *  the restore-label invariant can be verified without reaching
     *  into the timer callback. */
    indicatorForState: (state: VoiceModeState) => VoiceIndicator;
  };
}

// ── Default kitty sequences (mirrors src/tui.ts ansi.kittyKbVoiceOn/Off) ──
// We re-declare them here instead of importing the `ansi` table to keep
// this module test-friendly (no `process.stdout.write` side-effects from
// the import chain).
const CSI = '\x1b[';
const DEFAULT_KITTY = {
  voice: `${CSI}>3u`,
  normal: `${CSI}>1u`,
};

const SEND_ERROR_RESTORE_MS = 5000;

/** PR-S1V.4-wiring · transition-aware indicator label.
 *
 * voice-mode emits indicator labels via its own `onIndicator` deps, so
 * for every state there is a single canonical label. The host needs the
 * same mapping for two reasons:
 *
 *   1. Bridge-level send failures flash `✖ send failed`. After the
 *      restore window the host has to re-emit a label that matches the
 *      *current* state (the user may have already transitioned
 *      idle→active→recording), not whatever label was active when the
 *      flash started.
 *
 *   2. Tests can compare the label against `indicatorForState(state)`
 *      without reaching into voice-mode internals.
 */
export function indicatorForState(state: VoiceModeState): VoiceIndicator {
  switch (state.kind) {
    case 'idle':       return { visible: false };
    case 'active':     return { visible: true, label: '🎙 Voice mode' };
    case 'recording':  return { visible: true, label: '🔴 Recording' };
    case 'processing': return { visible: true, label: '✨ Transcribing' };
  }
}

// ── Implementation ──────────────────────────────────────────────────

export function createVoiceInputHost(deps: VoiceInputHostDeps): VoiceInputHost {
  const writeStdout = deps.writeStdout ?? ((s: string) => process.stdout.write(s));
  const kittySeqs = deps.kittySequences ?? DEFAULT_KITTY;
  const setTimer = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const restoreMs = deps.sendErrorRestoreMs ?? SEND_ERROR_RESTORE_MS;
  const defaultVoiceSource: InputSourceRef = {
    kind: 'voice',
    channel: 'dashboard',
    surface: 'dashboard-voice-chat',
    mode: 'multi-turn',
    transcriptSource: 'voice',
  };

  let indicator: VoiceIndicator = { visible: false };
  const indicatorListeners = new Set<(ind: VoiceIndicator) => void>();
  let restoreHandle: unknown = null;

  function emitIndicator(next: VoiceIndicator): void {
    indicator = next;
    for (const cb of indicatorListeners) {
      try {
        cb(next);
      } catch (err) {
        if (debug.enabled)
          debug.log('voice.host', 'indicator.listener.error', { err: String(err) }, { level: 'error' });
      }
    }
  }

  function writeKitty(mode: 'normal' | 'voice'): void {
    const seq = mode === 'voice' ? kittySeqs.voice : kittySeqs.normal;
    if (debug.enabled) debug.log('voice.host', 'kitty.write', { mode });
    writeStdout(seq);
  }

  // ── Bridge — PR-S1V.4-wiring threads submitToSession + onSendError ──
  // TEMP DEBUG TRIAL (2026-04-29 · fix/voice-runtime-tdz-2) — pass a
  // language hint to the STT provider. Without `language` the
  // OpenAI Whisper API auto-detects, which for short Korean utterances
  // tends to misclassify as English or romanise → garbage transcript.
  // ISO-639-1 'ko' is supported by both whisper-1 and gpt-4o-transcribe
  // (caveat: gpt-4o-transcribe has a known language-enforcement bug as
  // of 2025-09 community reports — keep whisper-1 for now). Override
  // with env var `OPENAI_STT_LANGUAGE` if needed.
  const sttLanguageOverride = process.env.OPENAI_STT_LANGUAGE?.trim();
  const sttLanguage = sttLanguageOverride || 'ko';
  const bridge = createVoiceInputBridge({
    sttProvider: deps.sttProvider,
    resolveSession: deps.resolveSession,
    submitToSession: deps.submitToSession,
    dictateTranscript: deps.dictateTranscript,
    sttOpts: { language: sttLanguage },
    defaultSource: defaultVoiceSource,
    onSendError: (err) => {
      if (debug.enabled)
        debug.log('voice.host', 'send.error', { err: err.message }, { level: 'error' });
      // Cancel any pending restore so multiple failures don't stack.
      if (restoreHandle !== null) {
        try { clearTimer(restoreHandle); } catch { /* best-effort */ }
        restoreHandle = null;
      }
      emitIndicator({ visible: true, label: '✖ send failed' });
      restoreHandle = setTimer(() => {
        restoreHandle = null;
        // Recompute from the *current* state — the user may have
        // transitioned during the flash window.
        emitIndicator(indicatorForState(voiceMode.getState()));
      }, restoreMs);
    },
  });

  async function handleTranscript(text: string): Promise<void> {
    const result = await bridge.handleTranscript(text);
    if (result.reason === 'dictated') {
      voiceMode.exit('handoff');
    }
    if (debug.enabled)
      debug.log('voice.host', 'transcript.result', {
        injected: result.injected,
        sourceKind: result.source.kind,
        brand: result.routing.brand,
        chars: result.routing.text.length,
        reason: result.reason,
        // sessionId helps cross-reference with the resolveSession
        // trace and the downstream submit log: when injected=false
        // we expect null, when injected=true the value pinpoints
        // which session the transcript landed on.
        sessionId: result.sessionId,
        sendError: result.sendError ? result.sendError.message : undefined,
      });
  }

  const voiceMode = createVoiceMode({
    startCapture: (onData, onEnd) =>
      startRecording(onData, onEnd, { silenceDetection: false }),
    stopCapture: () => stopRecording(),
    transcribe: async pcm => {
      const { text } = await bridge.transcribe(pcm);
      return { text };
    },
    onTranscript: handleTranscript,
    onIndicator: (visible, label) => {
      emitIndicator({ visible, ...(label ? { label } : {}) });
    },
    writeKitty,
    onError: (err, phase) => {
      if (debug.enabled)
        debug.log('voice.host', 'error', { phase, err: String(err) }, { level: 'error' });
    },
    inactivityMs: deps.inactivityMs,
  });

  // Crash-safety: always restore kitty level 1 on process termination.
  const uninstallCrashSafety = installKittyCrashSafety(writeKitty);

  // ── PR-S1V.D4 · dictation lifecycle ────────────────────────────────
  //
  // Runs alongside voice-mode but mutually exclusive (one sox subprocess
  // at a time). Triggered by the long-press Space detector in the chat
  // input pre-key hook. State transitions are voice-mode-independent so
  // a typing-while-dictating user keeps full chat input access (modal B
  // — the design split that distinguishes dictation from voice-mode).
  let dictationState: DictationState = 'idle';
  let dictationChunks: Buffer[] = [];
  // PR-S1V.D5+ smoothness — pending-phase indicator state. Tracks
  // whether the host is currently showing the "🎤 hold…" label so
  // `clearPending` knows whether it can safely clear (no in-flight
  // recording / voice mode owns the indicator instead).
  let pendingIndicatorActive = false;

  function logDictation(event: string, data?: unknown): void {
    if (debug.enabled) debug.log('voice.dictation', event, data);
  }

  function notePending(): void {
    // Don't override an active recording or voice-mode indicator —
    // those owners are mid-flow and must keep their label visible.
    if (dictationState !== 'idle') return;
    if (voiceMode.getState().kind !== 'idle') return;
    pendingIndicatorActive = true;
    emitIndicator({ visible: true, label: '🎤 hold…' });
    if (debug.enabled) debug.log('voice.dictation', 'pending.show');
  }

  function clearPending(): void {
    if (!pendingIndicatorActive) return;
    pendingIndicatorActive = false;
    // Only clear if the host hasn't transitioned to a real state in
    // the meantime (recording started, voice mode entered, etc.).
    if (dictationState !== 'idle') return;
    if (voiceMode.getState().kind !== 'idle') return;
    emitIndicator({ visible: false });
    if (debug.enabled) debug.log('voice.dictation', 'pending.clear');
  }

  function startDictation(): boolean {
    // Pending indicator is being replaced by the recording one — clear
    // the flag (the upcoming `emitIndicator` overwrites the label).
    pendingIndicatorActive = false;
    if (voiceMode.getState().kind !== 'idle') {
      logDictation('start.skip-voice-active', { voiceState: voiceMode.getState().kind });
      return false;
    }
    if (dictationState !== 'idle') {
      logDictation('start.skip-already-running', { dictationState });
      return false;
    }
    dictationState = 'recording';
    dictationChunks = [];
    emitIndicator({ visible: true, label: '🎙 Dictation' });
    logDictation('start');
    void (async () => {
      try {
        const ok = await startRecording(
          chunk => dictationChunks.push(chunk),
          () => {
            // sox/arecord unexpectedly exited; flush whatever buffered
            // and finalize so the user doesn't get stuck in `recording`.
            if (dictationState === 'recording') {
              logDictation('capture.unexpected-end');
              void stopDictation();
            }
          },
          { silenceDetection: false },
        );
        if (!ok) {
          logDictation('capture.start-failed');
          dictationState = 'idle';
          emitIndicator({ visible: false });
        }
      } catch (err) {
        logDictation('capture.error', { err: String(err) });
        dictationState = 'idle';
        emitIndicator({ visible: false });
      }
    })();
    return true;
  }

  async function stopDictation(): Promise<void> {
    if (dictationState !== 'recording') {
      logDictation('stop.skip', { dictationState });
      return;
    }
    dictationState = 'processing';
    emitIndicator({ visible: true, label: '✨ Transcribing' });
    try {
      stopRecording();
    } catch (err) {
      logDictation('capture.stop-error', { err: String(err) });
    }
    // Brief flush window for sox to emit the last buffered chunk.
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    const pcm = dictationChunks.length > 0
      ? Buffer.concat(dictationChunks)
      : Buffer.alloc(0);
    dictationChunks = [];
    logDictation('transcribe.start', { bytes: pcm.byteLength });

    if (pcm.byteLength === 0) {
      logDictation('transcribe.skip-empty');
      dictationState = 'idle';
      emitIndicator({ visible: false });
      return;
    }

    try {
      const { text } = await bridge.transcribe(pcm);
      logDictation('transcribe.done', { chars: text.length });
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        logDictation('inject.skip-empty');
      } else if (deps.dictateTranscript) {
        try {
          const ok = await deps.dictateTranscript(trimmed);
          logDictation('inject.result', { ok });
        } catch (err) {
          logDictation('inject.error', { err: String(err) });
        }
      } else {
        logDictation('inject.skip-no-callback');
      }
    } catch (err) {
      logDictation('transcribe.error', { err: String(err) });
    } finally {
      dictationState = 'idle';
      emitIndicator({ visible: false });
    }
  }

  function getDictationState(): DictationState {
    return dictationState;
  }

  function getState(): VoiceModeState {
    return voiceMode.getState();
  }

  function getIndicator(): VoiceIndicator {
    return indicator;
  }

  function onIndicatorChange(cb: (ind: VoiceIndicator) => void): () => void {
    indicatorListeners.add(cb);
    return () => {
      indicatorListeners.delete(cb);
    };
  }

  function requestEnter(): void {
    // PR #1109 review fix — mutual exclusion is enforced both
    // directions: startDictation already rejects when voice-mode is
    // active, but requestEnter previously ran voiceMode.enter()
    // unconditionally. Without this guard a Ctrl+Shift+V mid-dictation
    // would try to start a second sox subprocess (or step on the live
    // one). Bail with a debug log so the chord becomes a no-op until
    // dictation finishes — that matches the "one sox at a time"
    // contract documented in §9.1 of unified PLAN.
    if (dictationState !== 'idle') {
      if (debug.enabled)
        debug.log('voice.host', 'enter.skip-dictation-active', { dictationState });
      return;
    }
    voiceMode.enter();
  }

  function maybeHandleKey(key: Key): boolean {
    const state = voiceMode.getState();

    if (state.kind === 'idle') {
      // Idle — voice mode not active. Defer to the legacy dispatcher.
      return false;
    }

    // Modal A invariant (PLAN §4.3a): voice mode active terminates every
    // key inside the host. Escape exits, Space drives the recording
    // lifecycle, every other key is swallowed (no-op) so bell, terminal
    // modal, and input-core never see release/repeat artefacts of the
    // kitty `>3u` protocol.
    if (debug.enabled) {
      debug.log('voice.host', 'maybeHandleKey', {
        state: state.kind,
        name: key.name,
        kind: key.kind,
      });
    }

    if (key.name === 'escape' && key.kind !== 'release') {
      voiceMode.exit('esc');
      return true;
    }

    if (key.name === 'space') {
      if (key.kind === 'release') voiceMode.releaseSpace();
      else voiceMode.pressSpace();
      return true;
    }

    // Every other key while voice mode is active is swallowed.
    return true;
  }

  function dispose(): void {
    if (restoreHandle !== null) {
      try { clearTimer(restoreHandle); } catch { /* best-effort */ }
      restoreHandle = null;
    }
    voiceMode.dispose();
    indicatorListeners.clear();
    uninstallCrashSafety();
  }

  return {
    getState,
    getDictationState,
    getIndicator,
    onIndicatorChange,
    requestEnter,
    startDictation,
    stopDictation,
    notePending,
    clearPending,
    maybeHandleKey,
    dispose,
    _internal: { bridge, voiceMode, handleTranscript, indicatorForState },
  };
}
