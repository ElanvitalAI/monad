// PR-S1V.9 (sprint 22 Phase 4 · 2026-04-29) — Voice-chat listening
// pipeline.
//
// Glues audio-capture (PR-S1V.1) ↔ streaming STT (PR-S1V.8) for the
// `listening` phase of voice-chat. The pipeline is intentionally
// scoped to one concern: turn the user's mic input into a final
// transcript and hand it to the caller. Submitting that transcript
// to monad's chat path, advancing the state machine through
// `processing` → `speaking`, and rendering the assistant response
// (auto-TTS) all stay with the dashboard.
//
//   /voice-chat ─→ pipeline.startListening()
//                       │ STT session + audio capture
//                       ▼
//   ESC / done key ─→ pipeline.finishListening()
//                       │ stop capture · session.finalize()
//                       ▼  onFinalTranscript(text)
//   dashboard ─→ submit text → controller.transition(processing/speaking)
//   ESC again ─→ pipeline.cancel() · controller.exit('user-cancel')
//
// Reference: ROADMAP §5.4.

import { debug } from '../../debug/log.js';
import type {
  StreamingSTTProvider,
  StreamingSTTSession,
} from '../../voice/streaming-stt/streaming-stt-provider.js';
import { createVadDetector, type VadDetector, type VadOpts } from '../../voice/streaming-stt/streaming-stt-vad.js';
import type { VoiceChatModeController } from './voice-chat-mode-controller.js';

// ── Audio capture seam ─────────────────────────────────────────────

/** Minimum audio-capture surface the pipeline needs. Production passes
 *  `startRecording` / `stopRecording` from `src/voice/audio-capture.ts`;
 *  tests pass an in-memory fake. */
export interface VoiceChatAudioCapture {
  start(
    onData: (pcm: Buffer) => void,
    onEnd: () => void,
  ): Promise<boolean>;
  stop(): void;
}

// ── Pipeline ───────────────────────────────────────────────────────

export interface VoiceChatPipelineDeps {
  controller: VoiceChatModeController;
  streamingProvider: StreamingSTTProvider;
  audioCapture: VoiceChatAudioCapture;
  /** Called every time the STT provider emits a partial. Wire to the
   *  status bar / inline transcript widget. */
  onPartialTranscript?: (text: string) => void;
  /** Called when STT commits a final transcript. Caller submits this
   *  to monad's chat dispatch and advances the state machine. */
  onFinalTranscript: (text: string) => void;
  /** Called when mic audio indicates the user started speaking while
   *  the assistant is still in the `speaking` phase. The dashboard
   *  typically maps this to a quick-pass stop signal so TTS is cut
   *  before the next listening window re-arms. */
  onBargeIn?: () => void;
  /** Hook for STT/transport errors. Pipeline auto-cancels after firing. */
  onError?: (err: Error) => void;
  /** ISO 639-1 language hint forwarded to the provider. */
  language?: string;
  /** Provider-specific model override. */
  model?: string;
  /** Phase 5 VAD wiring. When `vadOpts` is set, the pipeline runs a
   *  local energy detector on the audio stream and auto-triggers
   *  `finishListening()` on `onSpeechEnd`. Pass `{}` to enable with
   *  defaults; omit (or set to `null`) to leave finalize fully manual
   *  (Phase 4 behaviour). For providers with built-in server VAD
   *  (openai-realtime / gemini-live), the dashboard typically leaves
   *  this off so the upstream provider handles turn detection. */
  vadOpts?: VadOpts | null;
  /** Optional speaking-phase VAD used only for barge-in detection.
   *  Unlike `vadOpts`, this detector runs while the controller is in
   *  `speaking` and never finalizes STT directly; it only fires
   *  `onBargeIn`. */
  bargeInVadOpts?: VadOpts | null;
}

export interface VoiceChatPipeline {
  /** Open STT session + start audio capture. Resolves when both
   *  succeed; rejects (and cleans up) on either failure. Phase →
   *  `listening`. No-op if already listening. */
  startListening(): Promise<boolean>;
  /** Tell STT "we're done" — stop the capture, finalize the session,
   *  and let the final transcript flow through `onFinalTranscript`.
   *  No phase change here; the caller advances after submit. */
  finishListening(): Promise<void>;
  /** Hard stop — abort STT, stop capture, no final emit. The caller
   *  is expected to call `controller.exit('user-cancel')` afterward. */
  cancel(): Promise<void>;
  /** True between startListening() success and finishListening/cancel
   *  completion. */
  isListening(): boolean;
  /** Reset the local VAD detector so the next listening window starts
   *  with a fresh silence-window count. No-op when VAD is not wired
   *  (server-VAD providers like openai-realtime). Used by the multi-
   *  turn re-listen path so a long previous turn doesn't leak speech-
   *  end residue into the next window. */
  resetVad(): void;
}

export function createVoiceChatPipeline(deps: VoiceChatPipelineDeps): VoiceChatPipeline {
  let session: StreamingSTTSession | null = null;
  let listening = false;
  let aborting = false;
  let vad: VadDetector | null = null;
  let bargeInVad: VadDetector | null = null;
  let bargeInFired = false;
  let lastObservedPhase = deps.controller.getPhase();
  if (deps.vadOpts) {
    // Wire VAD's onSpeechEnd to auto-finish the listening turn. We
    // wrap the user-supplied callbacks so dashboards can also observe
    // start/end transitions (e.g., for status bar level meter).
    const userStart = deps.vadOpts.onSpeechStart;
    const userEnd = deps.vadOpts.onSpeechEnd;
    vad = createVadDetector({
      ...deps.vadOpts,
      onSpeechStart: () => {
        if (debug.enabled) debug.log('voice.chat.vad', 'speech-start', {});
        userStart?.();
      },
      onSpeechEnd: () => {
        if (debug.enabled) debug.log('voice.chat.vad', 'speech-end', {});
        userEnd?.();
        // Fire-and-forget — finalize asynchronously so the audio
        // callback returns immediately. Errors land in onError.
        if (listening) void finishListening();
      },
    });
  }
  if (deps.onBargeIn) {
    bargeInVad = createVadDetector({
      threshold: 0.012,
      minSpeechMs: 120,
      silenceMs: 400,
      sampleRate: 16000,
      ...(deps.bargeInVadOpts ?? {}),
      onSpeechStart: () => {
        if (bargeInFired) return;
        bargeInFired = true;
        if (debug.enabled) debug.log('voice.chat.barge-in', 'speech-start', {});
        deps.onBargeIn?.();
      },
      onSpeechEnd: () => {
        if (debug.enabled) debug.log('voice.chat.barge-in', 'speech-end', {});
      },
    });
  }

  function syncPhaseEdge(phase: ReturnType<VoiceChatModeController['getPhase']>): void {
    if (phase === lastObservedPhase) return;
    if (phase === 'speaking') {
      bargeInFired = false;
      bargeInVad?.reset();
      if (debug.enabled) debug.log('voice.chat.barge-in', 'arm', {});
    } else if (lastObservedPhase === 'speaking') {
      bargeInVad?.reset();
      bargeInFired = false;
      if (debug.enabled) debug.log('voice.chat.barge-in', 'disarm', { nextPhase: phase });
    }
    lastObservedPhase = phase;
  }

  async function startListening(): Promise<boolean> {
    if (debug.enabled)
      debug.log('voice.chat.pipeline', 'start.enter', {
        listening,
        phase: deps.controller.getPhase(),
      });
    if (listening) return false;
    if (deps.controller.getPhase() !== 'inactive') {
      if (debug.enabled)
        debug.log('voice.chat.pipeline', 'start.skip', {
          reason: 'controller-not-inactive',
          phase: deps.controller.getPhase(),
        });
      return false;
    }
    let opened: StreamingSTTSession;
    const sttStartedAt = Date.now();
    if (debug.enabled)
      debug.log('voice.chat.pipeline', 'stt.openSession.begin', {
        provider: deps.streamingProvider.id,
        language: deps.language ?? null,
        model: deps.model ?? null,
      });
    try {
      opened = await deps.streamingProvider.openSession({
        ...(deps.language ? { language: deps.language } : {}),
        ...(deps.model ? { model: deps.model } : {}),
        onPartial: (text) => deps.onPartialTranscript?.(text),
        onFinal: (text) => deps.onFinalTranscript(text),
        onError: (err) => {
          if (debug.enabled)
            debug.log('voice.chat.pipeline', 'stt.error', { err: err.message }, { level: 'error' });
          deps.onError?.(err);
          void cancel();
        },
      });
      if (debug.enabled)
        debug.log('voice.chat.pipeline', 'stt.openSession.ok', {
          elapsedMs: Date.now() - sttStartedAt,
        });
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (debug.enabled)
        debug.log('voice.chat.pipeline', 'stt.openSession.error', {
          err: e.message,
          elapsedMs: Date.now() - sttStartedAt,
        }, { level: 'error' });
      deps.onError?.(e);
      return false;
    }
    session = opened;

    if (debug.enabled)
      debug.log('voice.chat.pipeline', 'capture.start.begin', {});
    const captureStartedAt = Date.now();
    // 2026-04-30 — Gate the mic-to-STT/VAD push by controller phase.
    //
    //   listening  → push to STT + tee into local VAD (normal path)
    //   processing → submit in flight, no new audio expected
    //   speaking   → assistant's TTS is playing through the speaker;
    //                if we keep pushing, the mic re-captures the
    //                assistant's own voice and STT transcribes it
    //                as a new utterance → `transition.rejected`
    //                events at controller level + OpenAI realtime
    //                API audio cost on echo. Observed in
    //                log/latest 2026-04-29 19:50 + 20:09 dogfood.
    //   stopping / inactive → cleanup; no push.
    //
    // Capture itself stays running so the next listening window
    // (multi-turn re-arm) starts immediately without sox respawn.
    // Throttled debug — first skip per phase change only, so the
    // log doesn't drown in per-chunk lines (audio frames ~33Hz).
    let lastSkipPhase: string | null = null;
    const captureStarted = await deps.audioCapture.start(
      (pcm) => {
        const phase = deps.controller.getPhase();
        syncPhaseEdge(phase);
        if (phase === 'speaking' && bargeInVad && !bargeInFired) {
          bargeInVad.push(pcm);
        }
        if (phase !== 'listening') {
          if (debug.enabled && phase !== lastSkipPhase) {
            debug.log('voice.chat.pipeline', 'capture.push.skip', {
              phase, reason: 'phase-not-listening',
            });
            lastSkipPhase = phase;
          }
          return;
        }
        if (lastSkipPhase !== null) {
          if (debug.enabled)
            debug.log('voice.chat.pipeline', 'capture.push.resume', {
              phase, prevSkipPhase: lastSkipPhase,
            });
          lastSkipPhase = null;
        }
        if (session && session.isOpen()) session.pushAudio(pcm);
        // Tee the same chunk into the local VAD so it can fire
        // onSpeechEnd → auto-finalize. The VAD's RMS detection runs in
        // ~O(n) on the chunk, well under the audio frame rate budget.
        if (vad) vad.push(pcm);
      },
      () => {
        if (debug.enabled) debug.log('voice.chat.pipeline', 'capture.end', {});
      },
    );
    if (debug.enabled)
      debug.log('voice.chat.pipeline', 'capture.start.return', {
        ok: captureStarted,
        elapsedMs: Date.now() - captureStartedAt,
      });
    if (!captureStarted) {
      try { await session.abort(); } catch { /* ignore */ }
      session = null;
      return false;
    }
    if (!deps.controller.transition('listening') && deps.controller.getPhase() !== 'listening') {
      // Controller refused — clean up and bail.
      deps.audioCapture.stop();
      try { await session.abort(); } catch { /* ignore */ }
      session = null;
      if (debug.enabled)
        debug.log('voice.chat.pipeline', 'start.controller.refused', {
          phase: deps.controller.getPhase(),
        });
      return false;
    }
    listening = true;
    if (debug.enabled)
      debug.log('voice.chat.pipeline', 'start.ok', {
        provider: deps.streamingProvider.id,
      });
    return true;
  }

  async function finishListening(): Promise<void> {
    if (!listening || !session) return;
    listening = false;
    if (debug.enabled)
      debug.log('voice.chat.pipeline', 'finish', {});
    deps.audioCapture.stop();
    if (vad) vad.reset();
    if (bargeInVad) {
      bargeInVad.reset();
      bargeInFired = false;
    }
    try {
      await session.finalize();
    } catch (err) {
      if (debug.enabled)
        debug.log('voice.chat.pipeline', 'finalize.error', { err: String(err) }, { level: 'error' });
    }
    session = null;
  }

  async function cancel(): Promise<void> {
    if (!listening && !session) return;
    if (aborting) return;
    aborting = true;
    listening = false;
    if (debug.enabled)
      debug.log('voice.chat.pipeline', 'cancel', {});
    deps.audioCapture.stop();
    if (vad) vad.reset();
    if (bargeInVad) {
      bargeInVad.reset();
      bargeInFired = false;
    }
    if (session) {
      try { await session.abort(); } catch { /* ignore */ }
      session = null;
    }
    aborting = false;
  }

  function isListening(): boolean { return listening; }

  function resetVad(): void {
    if (vad) {
      vad.reset();
      if (debug.enabled) debug.log('voice.chat.vad', 'reset.explicit', {});
    }
    if (bargeInVad) {
      bargeInVad.reset();
      bargeInFired = false;
      if (debug.enabled) debug.log('voice.chat.barge-in', 'reset.explicit', {});
    }
  }

  return { startListening, finishListening, cancel, isListening, resetVad };
}
