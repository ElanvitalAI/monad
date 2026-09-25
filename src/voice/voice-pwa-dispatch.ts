// PR-S1V.16 (sprint 22 §B · 2026-04-30) — PWA voice onFinalTranscript
// dispatcher.
//
// Glues the §1.1 streaming-STT singleton + §1.2 PWA TTS bridge + §C
// session emit hooks together by:
//
//   1. Registering the PWA-minted sessionId in the daemon's session
//      history (idempotent — `register()` is a no-op when the id is
//      already known).
//   2. Building the LLM message array from the history's running tail
//      + the new user message.
//   3. Calling the injected `llmStream` (bound to the daemon's chosen
//      provider) and pushing each chunk into the TTS bridge as it
//      arrives — chunk-streaming is the explicit recommendation in
//      the §B HANDOFF since `history.onAppend` already provides
//      fan-out and we don't want to wait for the whole turn before
//      synthesis starts.
//   4. Persisting the user + assistant messages to history once the
//      stream resolves so subsequent turns see the full context.
//   5. Flushing the TTS bridge so the buffered text synthesises into
//      a PCM blob and emits to the browser via the bridge's attached
//      emitter (wired in §C's onSessionOpen hook).
//
// Errors are swallowed at this layer so a transient LLM/TTS failure
// can't kill the WS endpoint — debug.log captures every branch for
// triage. The dispatcher is provider-agnostic: tests inject a fake
// `llmStream` and the daemon boot wires the real `streamLLM`.

import { debug } from '../debug/log.js';
import { buildTurnOutputTextBlocks } from '../input/turn-output-block.js';
import { selectTurnOutputTextForSink } from '../input/turn-output-sink-registry.js';
import type { LLMMessage } from '../llm.js';
import type { PwaTtsBridge } from './voice-pwa-tts-bridge.js';

/** Subset of `DaemonSessionHistory` the dispatcher actually uses.
 *  Keeping the surface narrow lets tests use a 30-line fake instead
 *  of standing up the disk-backed singleton. */
export interface PwaDispatchHistory {
  has(sessionId: string): boolean;
  register(sessionId: string, initialMessages?: LLMMessage[]): void;
  get(sessionId: string): LLMMessage[];
  append(sessionId: string, msgs: LLMMessage[]): void;
}

/** LLM streaming primitive — matches `streamLLM` in `src/llm.ts` minus
 *  the optional `opts` argument (caller binds defaults). */
export type PwaDispatchLLMStream = (
  messages: LLMMessage[],
  onChunk: (delta: string, full: string) => void,
) => Promise<string>;

export interface PwaDispatchDeps {
  history: PwaDispatchHistory;
  ttsBridge: PwaTtsBridge | null;
  llmStream: PwaDispatchLLMStream;
  /** Optional system prompt prepended once at session-register time
   *  (only when the session is newly minted). When omitted, no
   *  system message is seeded — the LLM provider's own default
   *  applies. */
  systemPrompt?: string;
  /** 2026-04-30 — receives assistant LLM response chunks for live
   *  display in the browser. Daemon boot wires this to
   *  `session.emitTranscript({kind:'assistant', text})` so the PWA
   *  can render the response text alongside the synthesized audio.
   *  When omitted, transcripts are dropped (audio-only path). */
  emitAssistantChunk?: (sessionId: string, chunk: string) => void;
  /** 2026-04-30 — late-bound lookup for the dashboard voice-input-host.
   *  In `tui-bridge` dispatch mode the dispatcher calls
   *  `dictateTranscript(text)` so the user's phone transcript appears
   *  in the focused dashboard input. Returns null when the dashboard
   *  isn't running in this process — the dispatcher then short-
   *  circuits with `skippedReason: 'tui-bridge-not-wired'`. */
  getVoiceInputHost?: () => {
    dictateTranscript: (text: string) => boolean | Promise<boolean>;
  } | null;
}

export interface PwaDispatchOutcome {
  /** True when the dispatcher pushed a turn through the LLM. False
   *  when it short-circuited (mode is tui-bridge, or bridge missing,
   *  or text was empty). */
  dispatched: boolean;
  /** Number of characters in the assistant response. */
  responseChars: number;
  /** Reason string when `dispatched === false`. */
  skippedReason?: string;
}

/**
 * Run a single PWA voice turn from a final transcript.
 *
 * - `dispatchMode === 'tui-bridge'`: short-circuits with `skippedReason
 *   = 'tui-bridge-deferred'`. The voice-input-host bridge wire is
 *   dashboard-scope and lands on a separate sprint.
 * - `dispatchMode === 'daemon-direct'`: runs the LLM stream and
 *   pipes chunks into the TTS bridge. When `ttsBridge` is null the
 *   dispatcher still updates history but skips synthesis (returns
 *   `skippedReason = 'no-tts-bridge'`).
 */
export async function dispatchPwaFinalTranscript(
  sessionId: string,
  text: string,
  dispatchMode: 'daemon-direct' | 'tui-bridge',
  deps: PwaDispatchDeps,
): Promise<PwaDispatchOutcome> {
  if (debug.enabled) {
    // Capture the actual STT-produced transcript text so
    // language-misdetection (e.g. openai-realtime-stt returning
    // Japanese for Korean speech) is visible in log/debug-*.log
    // — added 2026-05-05 after a Korean/Japanese root-cause hunt.
    debug.log('voice.pwa.dispatch', 'final.received', {
      sessionId, chars: text.length, mode: dispatchMode, text,
    });
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return { dispatched: false, responseChars: 0, skippedReason: 'empty-transcript' };
  }

  if (dispatchMode === 'tui-bridge') {
    const host = deps.getVoiceInputHost?.() ?? null;
    if (!host) {
      if (debug.enabled) {
        debug.log('voice.pwa.dispatch', 'tui-bridge.not-wired', {
          sessionId,
          hint: 'dashboard runtime not active in this process — switch to daemon-direct',
        });
      }
      return {
        dispatched: false,
        responseChars: 0,
        skippedReason: 'tui-bridge-not-wired',
      };
    }
    let landed: boolean;
    try {
      landed = await host.dictateTranscript(trimmed);
    } catch (err) {
      if (debug.enabled) {
        debug.log('voice.pwa.dispatch', 'tui-bridge.dictate.error', {
          sessionId, err: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
      return {
        dispatched: false,
        responseChars: 0,
        skippedReason: 'tui-bridge-dictate-error',
      };
    }
    if (debug.enabled) {
      debug.log('voice.pwa.dispatch', 'tui-bridge.dispatched', {
        sessionId, chars: trimmed.length, landed,
      });
    }
    return {
      dispatched: landed,
      responseChars: 0,
      ...(landed ? {} : { skippedReason: 'tui-bridge-no-input-target' }),
    };
  }

  // Register session if needed — register() is idempotent so this is
  // safe to always call on the cold path; the `has()` guard just
  // avoids an extra noop write to disk under a hot session.
  if (!deps.history.has(sessionId)) {
    const seed: LLMMessage[] = deps.systemPrompt
      ? [{ role: 'system', content: deps.systemPrompt }]
      : [];
    deps.history.register(sessionId, seed);
    if (debug.enabled) {
      debug.log('voice.pwa.dispatch', 'session.registered', {
        sessionId, seeded: seed.length,
      });
    }
  }

  const userMsg: LLMMessage = { role: 'user', content: trimmed };
  const messages: LLMMessage[] = [...deps.history.get(sessionId), userMsg];
  if (debug.enabled) {
    // What actually goes into the LLM (role + first 200 chars per
    // message). Distinguishes STT misdetection from a missing system
    // prompt as the cause of off-language replies.
    debug.log('voice.pwa.dispatch', 'llm.input', {
      sessionId,
      messages: messages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string'
          ? m.content.slice(0, 200)
          : '[non-string]',
      })),
    });
  }

  let assistantText = '';
  try {
    assistantText = await deps.llmStream(messages, (delta) => {
      if (!delta) return;
      if (deps.ttsBridge) {
        deps.ttsBridge.pushChunk(sessionId, delta);
      }
      if (deps.emitAssistantChunk) {
        const fanoutText = selectTurnOutputTextForSink(
          'fan-out-pwa',
          buildTurnOutputTextBlocks(delta),
        ) ?? delta;
        try { deps.emitAssistantChunk(sessionId, fanoutText); }
        catch { /* isolation — never let UI bridge break the LLM stream */ }
      }
    });
  } catch (err) {
    if (debug.enabled) {
      debug.log('voice.pwa.dispatch', 'llm.error', {
        sessionId, err: err instanceof Error ? err.message : String(err),
      }, { level: 'error' });
    }
    return { dispatched: false, responseChars: 0, skippedReason: 'llm-error' };
  }

  // Persist user + assistant once the stream completes — keeps
  // history in sync with the just-finished turn so the next final
  // sees prior context.
  deps.history.append(sessionId, [
    userMsg,
    { role: 'assistant', content: assistantText },
  ]);

  if (deps.ttsBridge) {
    await deps.ttsBridge.flush(sessionId);
  }

  if (debug.enabled) {
    debug.log('voice.pwa.dispatch', 'turn.done', {
      sessionId,
      assistantChars: assistantText.length,
      ttsBridge: deps.ttsBridge ? 'wired' : 'absent',
    });
  }

  return {
    dispatched: true,
    responseChars: assistantText.length,
    ...(deps.ttsBridge ? {} : { skippedReason: 'no-tts-bridge' }),
  };
}
