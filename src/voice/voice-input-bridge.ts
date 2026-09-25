// PR-S1V.4 (sprint 21-Parallel-Voice · 2026-04-29) — Voice input bridge.
//
// Glue layer between voice-mode (state machine), audio-capture (PR-S1V.1),
// stt-provider (PR-S1V.2), and the canonical session-submit chain.
// voice-mode delegates `transcribe` and `onTranscript` to this bridge so
// the state machine stays free of MessageBlock-specific concerns.
//
// PR-S1V.4-wiring (2026-04-29) extended the bridge so the actual prompt
// reaches the agent (not just the conversation-stream user block):
//   - `noteUserSubmit` → `submitToSession` so the dashboard owns a
//     transport-aware send chain (embodied PTY vs ACP live pane).
//   - `onSendError` lets the host surface failures (status indicator,
//     debug log) without leaking that concern into voice-mode.
//
// Reference: PLAN-voice-input-bridge-s1v4-2026-04-29.md §3 + §7,
// PLAN-voice-wiring-s1v4w-2026-04-29.md §4.5 + §4.5a.

import { debug } from '../debug/log.js';
import type { InputSourceRef } from '../input/input-source-kind.js';
import { isVoiceCostId } from '../models/voice-costs.js';
import { globalVoiceCostTracker } from './cost-tracker.js';
import type { STTOpts, STTProvider, STTResult } from './stt-provider.js';
import {
  routeVoiceTranscript,
  type VoiceBrand,
  type VoicePrefixRouteResult,
} from './voice-prefix-router.js';

// PCM byte rate from PR-S1V.1 audio-capture: 16 kHz · 16-bit · mono =
// 32 000 bytes/sec = 32 bytes/ms. Used as fallback when the provider
// doesn't return its own duration field.
const PCM_BYTES_PER_MS = 32;

// ── Types ──────────────────────────────────────────────────────────

export interface VoiceInputBridgeDeps {
  /** Provider that turns PCM into transcript text. From PR-S1V.2. */
  sttProvider: STTProvider;
  /** Resolve which session should receive the user block.
   *  - `brand=null` → focused/default session (host decides).
   *  - `brand='codex'` etc. → matching brand pane in the active room.
   *  Returns `null` when no session is available — bridge then logs and
   *  drops the transcript. */
  resolveSession: (brand: VoiceBrand | null) => SessionResolution | null;
  /** Submit the transcript to the resolved session with **submit
   *  semantics** (i.e. equivalent to the user typing the text and
   *  pressing Enter). Host owns the transport split — embodied PTY
   *  sessions go through `EmbodiedAgentSession.send` (with a newline
   *  appended to match `reply.ts`), ACP live sessions go through
   *  `clientSessionSend` after `noteUserSubmit` echoes the user block
   *  into the conversation stream. The bridge stays transport-agnostic
   *  and only awaits the result so failures can surface via
   *  `onSendError`. */
  submitToSession: (sessionId: string, text: string) => Promise<void>;
  /** Optional dictation fallback. Used when no live session target can
   *  be resolved: the host may choose to insert the transcript into a
   *  draft surface instead of dropping it. Returns `true` when the
   *  transcript was accepted by a dictation target. */
  dictateTranscript?: (text: string) => Promise<boolean> | boolean;
  /** PLAN §4.5a — host-owned send-failure callback. Bridge invokes it
   *  inside the `injectTranscript` catch so the host can surface the
   *  error (status indicator flash, debug.log). voice-mode has no
   *  visibility into send because it's a transport concern. */
  onSendError?: (err: Error) => void;
  /** Optional STT options propagated on every batch (language, etc.). */
  sttOpts?: STTOpts;
  /** PR-B alpha — canonical caller source metadata. */
  defaultSource?: InputSourceRef;
}

export interface SessionResolution {
  sessionId: string;
}

export interface VoiceInputBridge {
  /** PCM Buffer → STT transcript text. Wraps STTProvider.transcribeBatch. */
  transcribe(pcm: Buffer): Promise<{ text: string; sttResult: STTResult }>;
  /** transcript text → prefix routing → session submit. The submit is
   *  awaited so a network/transport failure surfaces via `onSendError`
   *  before the result is returned. */
  injectTranscript(text: string): Promise<InjectResult>;
  /** Compose `transcribe` + `injectTranscript` into one call (used by
   *  voice-mode's `onTranscript` after a transcribe round-trip). */
  handleTranscript(text: string): Promise<InjectResult>;
}

export interface InjectResult {
  /** Was a stream actually resolved + pushed to? */
  injected: boolean;
  /** Canonical source vocabulary attached by the caller. */
  source: InputSourceRef;
  /** Routing decision (brand + stripped text). */
  routing: VoicePrefixRouteResult;
  /** Resolved sessionId — null when no stream matched. */
  sessionId: string | null;
  /** Reason a non-empty transcript was dropped or rerouted. */
  reason?: 'empty' | 'no-stream' | 'dictated';
  /** When `submitToSession` rejected, the captured error. `injected`
   *  stays `true` because the user block was already echoed (ACP path)
   *  or the transcript was forwarded; the field exists so callers can
   *  decide whether to retry / surface. */
  sendError?: Error;
}

// ── Implementation ──────────────────────────────────────────────────

const DEFAULT_VOICE_INPUT_SOURCE: InputSourceRef = {
  kind: 'voice',
  channel: 'dashboard',
  surface: 'dashboard-voice-chat',
  mode: 'multi-turn',
  transcriptSource: 'voice',
};

export function createVoiceInputBridge(deps: VoiceInputBridgeDeps): VoiceInputBridge {
  function log(event: string, data?: unknown): void {
    if (debug.enabled) debug.log('voice.bridge', event, data);
  }

  async function transcribe(pcm: Buffer): Promise<{ text: string; sttResult: STTResult }> {
    log('transcribe.start', { bytes: pcm.byteLength });
    const sttResult = await deps.sttProvider.transcribeBatch(pcm, deps.sttOpts);
    log('transcribe.done', { chars: sttResult.text.length, language: sttResult.language });

    // PR-S1V.5 — record the call against the monthly cost tracker. The
    // provider's own `durationMs` is preferred (Whisper verbose_json
    // returns it accurately); the PCM byte fallback covers providers
    // that only respond with the transcript text. Unknown provider ids
    // (e.g. `whisper-cpp` local · `openai-realtime` future stream PR)
    // are skipped silently — they need a VOICE_COSTS entry first.
    const providerId = deps.sttProvider.id;
    if (isVoiceCostId(providerId)) {
      const durationMs = sttResult.durationMs ?? Math.round(pcm.byteLength / PCM_BYTES_PER_MS);
      try {
        globalVoiceCostTracker().recordStt({ providerId, durationMs });
      } catch (err) {
        if (debug.enabled)
          debug.log('voice.bridge', 'cost.record-error', { err: String(err) }, { level: 'error' });
      }
    }

    return { text: sttResult.text, sttResult };
  }

  async function injectTranscript(text: string): Promise<InjectResult> {
    const source = deps.defaultSource ?? DEFAULT_VOICE_INPUT_SOURCE;
    const routing = routeVoiceTranscript(text);
    log('inject.start', {
      sourceKind: source.kind,
      rawChars: text.length,
      brand: routing.brand,
      strippedChars: routing.text.length,
      // First 40 chars only — guards against accidentally dumping
      // a long transcript into the debug log. The host call site
      // also logs `transcript.result` with the same data, so this
      // entry's job is to anchor the resolveSession trace below.
      preview: routing.text.slice(0, 40),
    });
    if (routing.text.length === 0) {
      log('inject.skip-empty');
      return { injected: false, source, routing, sessionId: null, reason: 'empty' };
    }
    const resolution = deps.resolveSession(routing.brand);
    if (!resolution) {
      if (deps.dictateTranscript) {
        const dictated = await deps.dictateTranscript(routing.text);
        if (dictated) {
          log('inject.dictated', {
            brand: routing.brand,
            chars: routing.text.length,
          });
          return {
            injected: true,
            source,
            routing,
            sessionId: null,
            reason: 'dictated',
          };
        }
      }
      // Failure mode is critical for diagnosing "voice mode says
      // Transcribing but nothing landed" reports — log enough that
      // the next reproduction tells us whether the prefix detector
      // misclassified vs the focused-fallback chain genuinely had
      // no target. The dashboard's resolveVoiceSession also emits
      // a `voice.resolve.exhausted` line so the two together
      // pinpoint the gap without re-instrumenting.
      log('inject.no-session', {
        brand: routing.brand,
        strippedChars: routing.text.length,
        preview: routing.text.slice(0, 40),
      });
      return { injected: false, source, routing, sessionId: null, reason: 'no-stream' };
    }
    try {
      await deps.submitToSession(resolution.sessionId, routing.text);
      log('inject.pushed', {
        brand: routing.brand,
        sessionId: resolution.sessionId,
        chars: routing.text.length,
      });
      return {
        injected: true,
        source,
        routing,
        sessionId: resolution.sessionId,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log('inject.send-error', {
        brand: routing.brand,
        sessionId: resolution.sessionId,
        err: error.message,
      });
      // Bridge calls the host callback inside the catch so the host can
      // surface the failure (debug.log + status indicator flash). The
      // caught error is also returned on `result.sendError` for tests
      // and any future caller that wants to react inline.
      try {
        deps.onSendError?.(error);
      } catch (cbErr) {
        if (debug.enabled)
          debug.log('voice.bridge', 'onSendError.callback-throw', { err: String(cbErr) });
      }
      return {
        injected: true,
        source,
        routing,
        sessionId: resolution.sessionId,
        sendError: error,
      };
    }
  }

  async function handleTranscript(text: string): Promise<InjectResult> {
    return injectTranscript(text);
  }

  return { transcribe, injectTranscript, handleTranscript };
}
