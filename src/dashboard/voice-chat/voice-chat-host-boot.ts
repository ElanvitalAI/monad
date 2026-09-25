// PR-S1V.9 (sprint 22 Phase 4 · 2026-04-29) — Voice-chat boot helper.
//
// One-stop construction for the dashboard:
//   const vchat = bootDashboardVoiceChat({
//     submitTranscript: (text) => sendChatMessage(text),
//     onPartialTranscript: (text) => updateStatusBar(text),
//     onPhaseChange: (next, prev) => updateIndicator(next),
//   });
//   // ...slash command handler:
//   handleVoiceChatSlash(vchat, args);
//   // ...ESC key handler:
//   if (vchat.controller.isActive()) await vchat.handleEsc();
//
// Slash subcommands:
//   /voice-chat            → enter (start listening)
//   /voice-chat start      → enter
//   /voice-chat stop       → exit (cancel)
//   /voice-chat status     → describe phase
//
// Reference: ROADMAP §5.2-§5.3.

import { startRecording, stopRecording } from '../../voice/audio-capture.js';
import { debug } from '../../debug/log.js';
import {
  createStreamingSTTProvider,
  resolveStreamingSTTProviderIdFromEnv,
  type StreamingSTTProvider,
  type StreamingSTTProviderConfig,
  type StreamingSTTProviderId,
} from '../../voice/streaming-stt/streaming-stt-provider.js';
import {
  readVadOptsFromEnv,
  resolveVadModeFromEnv,
  type VadMode,
  type VadOpts,
} from '../../voice/streaming-stt/streaming-stt-vad.js';
import {
  createVoiceChatModeController,
  describeVoiceChatPhase,
  type VoiceChatModeController,
  type VoiceChatPhase,
} from './voice-chat-mode-controller.js';
import {
  createVoiceChatPipeline,
  type VoiceChatAudioCapture,
  type VoiceChatPipeline,
} from './voice-chat-pipeline.js';

export interface BootDashboardVoiceChatOpts {
  /** Called when STT commits a final transcript. Dashboard submits the
   *  text into the chat input → response stream → auto-TTS path. */
  submitTranscript: (text: string) => void | Promise<void>;
  /** Optional partial transcript hook (status bar / inline display). */
  onPartialTranscript?: (text: string) => void;
  /** Optional hook fired when the user starts speaking while the
   *  assistant is still in the `speaking` phase. Dashboards
   *  typically map this to a quick-pass stop signal. */
  onBargeIn?: () => void;
  /** Phase indicator hook — typically wired to the dashboard status bar. */
  onPhaseChange?: (next: VoiceChatPhase, prev: VoiceChatPhase) => void;
  /** Override provider — tests inject mocks. Production resolves from env. */
  createProvider?: () => Promise<StreamingSTTProvider>;
  /** Override audio capture — tests inject in-memory fakes. */
  audioCapture?: VoiceChatAudioCapture;
  /** ISO 639-1 hint. Defaults to `OPENAI_STT_LANGUAGE` env, then `'ko'`. */
  language?: string;
  /** Model override (provider-specific). */
  model?: string;
  /** Phase 5 — VAD mode override. Defaults to `MONAD_VOICE_VAD` env,
   *  fallback `'server'`. `'server'` lets upstream provider's VAD
   *  detect turn boundary; `'local'` runs the energy-based VAD inside
   *  the pipeline; `'manual'` requires explicit ESC to finalize. */
  vadMode?: VadMode;
  /** VAD tuning override (threshold / silenceMs / minSpeechMs). When
   *  the dashboard passes user-config values here, they win over env
   *  (`MONAD_VOICE_VAD_*`). */
  vadOpts?: VadOpts;
  /** Optional speaking-phase VAD tuning for barge-in detection. */
  bargeInVadOpts?: VadOpts;
  /** Phase 5 multi-turn — when true, `notifyResponseDone()` auto-
   *  restarts listening (controller `speaking → listening`) instead
   *  of dropping to `inactive`. Defaults to `MONAD_VOICE_CHAT_MULTI_TURN`
   *  env (1/true/on/yes) or false. */
  multiTurn?: boolean;
  /** Override STT provider id. Highest precedence; when omitted,
   *  resolves from `STREAMING_STT_PROVIDER` env then default
   *  `'openai-realtime-stt'`. Dashboard reads this from
   *  `getUserConfig().voice.stt.provider`. */
  providerId?: StreamingSTTProviderId;
  /** Surfaced when STT / pipeline raises a hard error and the
   *  controller is forced into `stopping`. Dashboards typically wire
   *  this to a HUD warning segment + chatLines push so the user sees
   *  the failure for at least a few seconds (see `voice-error`
   *  segment in dashboard/index.ts). The host always also exits the
   *  controller; this hook is callback-only, no state toggle. */
  onError?: (err: Error) => void;
}

export interface BootDashboardVoiceChatResult {
  controller: VoiceChatModeController;
  pipeline: VoiceChatPipeline;
  providerId: StreamingSTTProviderId;
  vadMode: VadMode;
  multiTurn: boolean;
  /** Convenience: ESC handler for the dispatch loop. Returns `true`
   *  when the press was consumed by voice-chat. */
  handleEsc: () => Promise<boolean>;
  /** Called by the dashboard after the assistant response + auto-TTS
   *  drain finishes. With `multiTurn=true`, automatically restarts
   *  listening for the next turn. With `multiTurn=false` (default),
   *  drops to inactive. */
  notifyResponseDone: () => void;
}

export function bootDashboardVoiceChat(
  opts: BootDashboardVoiceChatOpts,
): BootDashboardVoiceChatResult {
  // Priority: opts (= user-config from dashboard) > env > hardcoded.
  const providerId = resolveStreamingSTTProviderIdFromEnv(undefined, {
    ...(opts.providerId ? { configOverride: opts.providerId } : {}),
  });
  const language = opts.language ?? process.env.OPENAI_STT_LANGUAGE?.trim() ?? 'ko';
  const vadMode: VadMode = resolveVadModeFromEnv(undefined, {
    ...(opts.vadMode ? { configOverride: opts.vadMode } : {}),
  });
  const multiTurn = opts.multiTurn ?? readEnvFlag('MONAD_VOICE_CHAT_MULTI_TURN');
  // Local VAD runs only when explicitly requested. server/manual leave
  // the pipeline's `vadOpts` undefined → no auto-finalize. opts.vadOpts
  // (from user-config) wins over env tuning.
  const vadOpts: VadOpts | null = vadMode === 'local'
    ? readVadOptsFromEnv({}, { ...(opts.vadOpts ? { configOverride: opts.vadOpts } : {}) })
    : null;

  const controller = createVoiceChatModeController({
    ...(opts.onPhaseChange ? { onPhaseChange: opts.onPhaseChange } : {}),
  });

  const audioCapture: VoiceChatAudioCapture = opts.audioCapture ?? {
    start: (onData, onEnd) => startRecording(onData, onEnd, { silenceDetection: false }),
    stop: () => stopRecording(),
  };

  // Lazy provider: don't construct until first startListening, so a
  // missing env (e.g. GEMINI_API_KEY) doesn't block dashboard boot.
  let cachedProvider: StreamingSTTProvider | null = null;
  const createProvider = opts.createProvider ?? (async () => {
    if (cachedProvider) return cachedProvider;
    cachedProvider = await createStreamingSTTProvider(buildProviderConfig(providerId));
    return cachedProvider;
  });

  // Pipeline takes a provider, but we want lazy creation. Wrap into a
  // proxy that resolves the provider on first openSession call.
  const proxyProvider: StreamingSTTProvider = {
    id: providerId,
    format: { sampleRate: 16000, channels: 1, bitsPerSample: 16 },
    async openSession(sessionOpts) {
      const real = await createProvider();
      return real.openSession(sessionOpts);
    },
  };

  const pipeline = createVoiceChatPipeline({
    controller,
    streamingProvider: proxyProvider,
    audioCapture,
    language,
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.onPartialTranscript ? { onPartialTranscript: opts.onPartialTranscript } : {}),
    ...(opts.onBargeIn ? { onBargeIn: opts.onBargeIn } : {}),
    ...(vadOpts ? { vadOpts } : {}),
    ...(opts.bargeInVadOpts ? { bargeInVadOpts: opts.bargeInVadOpts } : {}),
    onFinalTranscript: async (text) => {
      // STT committed final → advance state machine and hand off to
      // submitTranscript. Phase transition AFTER submit is now the
      // caller's responsibility (2026-04-30):
      //
      //   - Auto-submitted (sticky ACP / future plain extract) →
      //     caller transitions to `speaking` (response stream
      //     expected; TTS engages).
      //   - Dictate-only (single-turn / sticky-less multi-turn) →
      //     caller calls `controller.exit('user-cancel')` so the HUD
      //     `voice-state` segment clears immediately. Previously the
      //     finally below transitioned to `speaking` unconditionally,
      //     which made the indicator falsely claim the assistant was
      //     speaking even when no LLM call had been issued.
      //
      // The host-boot module no longer assumes a default outcome —
      // submit caller knows whether a real turn is in flight.
      controller.transition('processing');
      try {
        await opts.submitTranscript(text);
      } catch (err) {
        // Submit failure → tear down so the user isn't stuck in
        // `processing`. Same pattern as the pipeline `onError` path.
        if (debug.enabled)
          debug.log('voice.chat.error', 'submitTranscript.exception', {
            err: err instanceof Error ? err.message : String(err),
          }, { level: 'error' });
        controller.exit('error');
      }
    },
    onError: (err) => {
      // STT failure → tear down voice-chat. The dashboard's HUD
      // `voice-error` segment + chatLines warning is wired through
      // the caller's onError hook below.
      controller.exit('error');
      if (debug.enabled)
        debug.log('voice.chat.error', 'pipeline.onError', { err: err.message }, { level: 'error' });
      try { opts.onError?.(err); } catch { /* isolation — caller handler error must not loop back */ }
    },
  });

  async function handleEsc(): Promise<boolean> {
    const phase = controller.getPhase();
    if (phase === 'inactive') return false;
    if (debug.enabled)
      debug.log('voice.chat.handleEsc', phase, {});
    // 2026-04-30 — ESC is now ALWAYS a hard cancel (matches Alt+R
    // toggle behaviour). User feedback: "voice chat 를 빠져나갈때
    // ESC 도 동작하게 해주세요. alt+r 를 또 누르는건 불편합니다."
    //
    // Previous design split listening's first ESC into a transcript
    // "commit" gesture and made the second ESC an exit, which was
    // surprising — server VAD already commits automatically on
    // silence, so the manual-commit path was rarely useful and
    // confused the exit semantics. Now every ESC = exit, regardless
    // of phase, regardless of STT state. (Manual-VAD users who want
    // explicit commit can still press Alt+R to toggle off; future
    // work could add a separate keybinding for commit-without-exit
    // if dogfood shows it's missed.)
    try { await pipeline.cancel(); } catch { /* swallow */ }
    controller.exit('user-cancel');
    return true;
  }

  function notifyResponseDone(): void {
    if (controller.getPhase() !== 'speaking') return;
    if (multiTurn) {
      // Continuous mode: speaking → listening (re-arm STT for next
      // turn). Fire-and-forget — pipeline.startListening handles its
      // own errors via onError callback.
      //
      // 2026-04-30 — explicit VAD reset before re-listen. The local
      // VAD detector accumulates RMS state across the previous turn
      // window; without resetting, the first chunk of the new
      // listening window can immediately trigger speech-end on a
      // long silence count (echo loop residue from BACKLOG §9.5b).
      try { pipeline.resetVad(); } catch { /* swallow */ }
      controller.transition('listening');
      void pipeline.startListening();
    } else {
      controller.transition('inactive');
    }
  }

  return {
    controller,
    pipeline,
    providerId,
    vadMode,
    multiTurn,
    handleEsc,
    notifyResponseDone,
  };
}

function readEnvFlag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}

function buildProviderConfig(id: StreamingSTTProviderId): StreamingSTTProviderConfig {
  switch (id) {
    case 'openai-realtime-stt':
      return { id: 'openai-realtime-stt' };
    case 'gemini-live-stt':
      return { id: 'gemini-live-stt' };
    case 'whisper-cpp-local':
      return { id: 'whisper-cpp-local' };
    case 'elevenlabs-scribe-realtime':
      return { id: 'elevenlabs-scribe-realtime' };
  }
}

// ── Slash-command handler ──────────────────────────────────────────

/** Result of a Ctrl+Shift+R chord toggle.
 *
 *  - `enter`: controller was idle, listening just started
 *  - `exit`:  controller was active, mode just stopped
 *  - `mutex`: another voice mode (D5 base) is busy — caller should
 *             surface the message in chatLines but NOT toggle */
export type VoiceChatRealtimeToggleAction = 'enter' | 'exit' | 'mutex';

export interface VoiceChatRealtimeToggleResult {
  action: VoiceChatRealtimeToggleAction;
  status: string;
}

/** Toggle voice-chat continuous mode on/off — single entry chord
 *  (Alt+R). Reuses the same pipeline as `/voice-chat start` and
 *  `/voice-chat stop` so the surface state stays unified.
 *
 *  Reference: experiment/voice-chat-realtime-rebind branch (2026-04-30). */
export async function toggleVoiceChatRealtime(
  vchat: BootDashboardVoiceChatResult,
  opts: { d5VoiceActive?: () => boolean } = {},
): Promise<VoiceChatRealtimeToggleResult> {
  // Step-by-step instrumentation so a freeze lands a clear trail in
  // log/latest. Categories all start with `voice.chat.` (per
  // SCHEME-debug-logging-2026-04-30) so a single grep surfaces the
  // toggle's lifecycle.
  if (debug.enabled)
    debug.log('voice.chat.toggle.step', 'enter.fn', {});
  // Mutex with D5 base PTT (Ctrl+Shift+V) — caller passes a thunk
  // so this module stays decoupled from voice-input-host.
  if (opts.d5VoiceActive?.() === true) {
    if (debug.enabled)
      debug.log('voice.chat.toggle.step', 'mutex.d5', {});
    return {
      action: 'mutex',
      status: 'voice mode (Ctrl+Shift+V) is active — exit it first (ESC) before Alt+R',
    };
  }
  if (vchat.controller.isActive()) {
    if (debug.enabled)
      debug.log('voice.chat.toggle.step', 'exit.path.begin', {
        priorPhase: vchat.controller.getPhase(),
      });
    try {
      await vchat.pipeline.cancel();
      if (debug.enabled)
        debug.log('voice.chat.toggle.step', 'exit.pipeline.cancel.ok', {});
    } catch (err) {
      if (debug.enabled)
        debug.log('voice.chat.toggle.step', 'exit.pipeline.cancel.err', {
          err: err instanceof Error ? err.message : String(err),
        });
    }
    vchat.controller.exit('user-cancel');
    if (debug.enabled)
      debug.log('voice.chat.toggle.step', 'exit.controller.done', {
        phase: vchat.controller.getPhase(),
      });
    return { action: 'exit', status: 'voice-chat exited' };
  }
  if (debug.enabled)
    debug.log('voice.chat.toggle.step', 'enter.path.begin', {
      providerId: vchat.providerId,
    });
  const startListenStart = Date.now();
  let ok: boolean;
  try {
    ok = await vchat.pipeline.startListening();
  } catch (err) {
    if (debug.enabled)
      debug.log('voice.chat.toggle.step', 'enter.pipeline.start.exception', {
        err: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - startListenStart,
      }, { level: 'error' });
    throw err;
  }
  if (debug.enabled)
    debug.log('voice.chat.toggle.step', 'enter.pipeline.start.return', {
      ok,
      elapsedMs: Date.now() - startListenStart,
    });
  if (!ok) {
    return {
      action: 'exit', // treat as no-op; mode never entered
      status: 'voice-chat: failed to start listening — check audio device + STT provider',
    };
  }
  return {
    action: 'enter',
    status: `voice-chat started (provider: ${vchat.providerId}) — speak, ESC or Alt+R to exit`,
  };
}

/** Map a `/voice-chat <subcommand>` invocation to controller / pipeline
 *  actions. Returns a status string for the dashboard to surface
 *  (toast / chat log). */
export async function handleVoiceChatSlash(
  vchat: BootDashboardVoiceChatResult,
  args: readonly string[],
): Promise<string> {
  const sub = (args[0] ?? 'start').toLowerCase();
  switch (sub) {
    case 'start':
    case 'on':
    case '': {
      if (vchat.controller.isActive()) {
        return `voice-chat already active (phase: ${vchat.controller.getPhase()})`;
      }
      const ok = await vchat.pipeline.startListening();
      if (!ok) {
        return 'voice-chat: failed to start listening — check audio device + STT provider';
      }
      return `voice-chat started (provider: ${vchat.providerId}) — speak, then ESC to send`;
    }
    case 'stop':
    case 'off':
    case 'cancel': {
      if (!vchat.controller.isActive()) return 'voice-chat: not active';
      await vchat.pipeline.cancel();
      vchat.controller.exit('user-cancel');
      return 'voice-chat stopped';
    }
    case 'status': {
      const phase = vchat.controller.getPhase();
      const desc = describeVoiceChatPhase(phase) || 'inactive';
      return `voice-chat phase=${phase} · ${desc} · provider=${vchat.providerId}`;
    }
    default:
      return `voice-chat: unknown subcommand "${sub}". use start/stop/status`;
  }
}
