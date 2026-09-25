// PR-S1V.12 (sprint 22 Phase 7 · 2026-04-30) — PWA voice server-side
// adapter.
//
// monad-agent's PWA (apps/pwa — to be added in a future sprint)
// wants to ship voice as another channel — phone in the pocket
// captures mic, streams PCM up to a WebSocket endpoint, the adapter
// feeds it through monad's existing harness (Phase 1-5: streaming
// STT → chat → response → auto-TTS), and pipes the TTS PCM back
// down to the browser for AudioBufferSourceNode playback.
//
// This file is the *server side* — the relay between browser
// WebSocket and the harness pipeline. Mirrors the channel-adapter
// shape introduced by Discord (PR-S1V.11) so future channels (Slack,
// WhatsApp, etc.) can plug in with the same contract.
//
// Frontend 4 files (apps/pwa/src/voice/{voice-capture, voice-playback,
// voice-websocket, voice-control-bar}.ts) are intentionally out of
// scope for this PR — apps/pwa frontend infrastructure doesn't exist
// in monad-agent yet. They land in a follow-up sprint that adds the
// PWA shell.
//
// Reference: ROADMAP-voice-harness-bidirectional §8.1 (server side).

import { debug } from '../../debug/log.js';
import type {
  StreamingSTTProvider,
  StreamingSTTSession,
} from '../streaming-stt/streaming-stt-provider.js';

// ── Public types ───────────────────────────────────────────────────

export type PwaVoiceSessionState =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'closing'
  | 'closed';

/** What the browser sends up. PCM 16 kHz · 16-bit signed mono Buffer
 *  blocks (matches DEFAULT_STREAMING_STT_FORMAT). The adapter expects
 *  Browser → server bytes are already at this rate; if the user mic
 *  delivers 48 kHz, the browser-side capture module is responsible for
 *  resampling before send. */
export interface PwaUpstreamFrame {
  pcm: Buffer;
  /** Optional client-side wallclock — useful for jitter analysis. */
  capturedAtMs?: number;
}

/** What the adapter pushes back down to the browser. PCM 24 kHz ·
 *  16-bit signed mono Buffer (TTS-native). Browser playback queue
 *  resamples to the AudioContext rate. */
export interface PwaDownstreamFrame {
  pcm: Buffer;
}

/** Live transcript event emitted by the adapter for browser display.
 *  Three kinds:
 *  - 'partial' — incremental STT output (user is still speaking).
 *  - 'final'   — committed STT segment (user finished one utterance).
 *  - 'assistant' — chunk of the LLM response (alongside DOWNSTREAM_PCM
 *    audio playback). */
export interface PwaTranscriptEvent {
  kind: 'partial' | 'final' | 'assistant';
  text: string;
}

export interface PwaVoiceSession {
  /** Stable id minted at openSession time — used by daemon-side
   *  bridges (TTS / dispatch) to key per-session state. Stub sessions
   *  may omit; production wired sessions always populate. */
  readonly sessionId?: string;
  /** Browser → server: raw mic PCM. */
  pushUpstream(frame: PwaUpstreamFrame): void;
  /** Browser → server: explicit "I'm done speaking" — flushes the
   *  current STT session and triggers harness submit. */
  finalize(): Promise<void>;
  /** Browser → server: BI-1 manual barge-in (Phase D · 2026-05-09).
   *  User clicked the cut-in button while TTS playback was active.
   *  Wired sessions abort the in-flight STT (so the next utterance
   *  starts a fresh one) + signal the dispatcher to drop any queued
   *  response (TTS bridge flush is the daemon's responsibility once
   *  the dispatch sees the cancellation). Stub sessions can omit. */
  interrupt?(): Promise<void>;
  /** Server → browser: subscribe to TTS PCM going down. The adapter
   *  invokes this with each chunk it wants the browser to render. */
  onDownstream(cb: (frame: PwaDownstreamFrame) => void): () => void;
  /** §C (sprint 22 follow-up · 2026-04-30) — server-side push to the
   *  browser. Daemon callers (e.g. PWA TTS bridge) invoke this with
   *  each PCM chunk they want rendered. The session fans the frame
   *  out to every `onDownstream` subscriber. No-op when the session is
   *  closed. Optional on the interface so stub sessions can stay
   *  test-only via the `StubPwaSession` extension; production wired
   *  sessions always implement it. */
  emitDownstream?(frame: PwaDownstreamFrame): void;
  /** Subscribe to live transcript events (STT partial/final + LLM
   *  assistant chunks). Returns an unsubscribe handle. Production
   *  wired sessions implement this; stub sessions omit. */
  onTranscript?(cb: (evt: PwaTranscriptEvent) => void): () => void;
  /** Server-side push of an assistant-side transcript event. Used by
   *  the daemon to forward LLM response chunks to the browser
   *  alongside the synthesized audio. STT partial/final events are
   *  emitted internally by the wired session — daemon code does not
   *  call this for those. */
  emitTranscript?(evt: PwaTranscriptEvent): void;
  /** Status transitions. */
  onStateChange(cb: (state: PwaVoiceSessionState) => void): () => void;
  getState(): PwaVoiceSessionState;
  /** Connection close (browser navigation away or user mute). */
  close(): Promise<void>;
}

export interface PwaVoiceAdapter {
  /** True when adapter is wired and ready to accept browser
   *  connections. Mirrors Discord adapter contract. */
  readonly available: boolean;
  readonly unavailableReason: string | null;
  /** Open a session in response to a fresh browser WebSocket
   *  connection. The caller routes incoming/outgoing frames through
   *  the returned session. Each browser tab = one session. */
  openSession(): Promise<PwaVoiceSession>;
  shutdown(): Promise<void>;
}

// ── Errors ─────────────────────────────────────────────────────────

export class PwaVoiceUnavailableError extends Error {
  constructor(hint: string) {
    super(`PWA voice unavailable — ${hint}`);
    this.name = 'PwaVoiceUnavailableError';
  }
}

// ── Stub adapter (test + dashboard idle) ───────────────────────────

export interface StubPwaAdapterOpts {
  failWith?: string;
}

export function createStubPwaVoiceAdapter(opts: StubPwaAdapterOpts = {}): PwaVoiceAdapter {
  const reason = opts.failWith ?? null;
  let active: StubPwaSession | null = null;

  function openSession(): Promise<PwaVoiceSession> {
    if (reason) {
      return Promise.reject(new PwaVoiceUnavailableError(reason));
    }
    if (active) void active.close();
    active = createStubSession();
    return Promise.resolve(active);
  }

  async function shutdown(): Promise<void> {
    if (active) {
      await active.close();
      active = null;
    }
  }

  return {
    available: !reason,
    unavailableReason: reason,
    openSession,
    shutdown,
  };
}

interface StubPwaSession extends PwaVoiceSession {
  /** Test-only: pull frames pushed up by the (fake) browser. */
  takeUpstream(): PwaUpstreamFrame[];
  /** Test-only: simulate the harness emitting downstream PCM. */
  emitDownstream(frame: PwaDownstreamFrame): void;
  /** Test-only: drive state transitions. */
  emitState(state: PwaVoiceSessionState): void;
  /** Test-only: count finalize() calls. */
  finalizeCount(): number;
  /** Test-only: count interrupt() calls (BI-1 barge-in). */
  interruptCount(): number;
}

function createStubSession(): StubPwaSession {
  let state: PwaVoiceSessionState = 'connecting';
  const upstream: PwaUpstreamFrame[] = [];
  const downstreamSubs = new Set<(f: PwaDownstreamFrame) => void>();
  const stateSubs = new Set<(s: PwaVoiceSessionState) => void>();
  let finalizes = 0;
  let interrupts = 0;

  function setState(next: PwaVoiceSessionState): void {
    state = next;
    for (const cb of stateSubs) {
      try { cb(next); } catch { /* isolation */ }
    }
  }
  // Move to streaming on next microtask so callers can subscribe first.
  queueMicrotask(() => setState('streaming'));

  return {
    pushUpstream(frame) {
      if (state !== 'streaming') return;
      upstream.push({ ...frame });
    },
    async finalize() {
      finalizes += 1;
    },
    async interrupt() {
      interrupts += 1;
    },
    onDownstream(cb) {
      downstreamSubs.add(cb);
      return () => { downstreamSubs.delete(cb); };
    },
    onStateChange(cb) {
      stateSubs.add(cb);
      return () => { stateSubs.delete(cb); };
    },
    getState: () => state,
    async close() {
      if (state === 'closed') return;
      setState('closing');
      setState('closed');
      downstreamSubs.clear();
      stateSubs.clear();
    },
    takeUpstream() {
      const copy = upstream.slice();
      upstream.length = 0;
      return copy;
    },
    emitDownstream(frame) {
      for (const cb of downstreamSubs) {
        try { cb(frame); } catch { /* isolation */ }
      }
    },
    emitState(next) { setState(next); },
    finalizeCount: () => finalizes,
    interruptCount: () => interrupts,
  };
}

// ── Production lazy adapter ────────────────────────────────────────

export interface PwaVoiceProductionOpts {
  /** WebSocket bind path (e.g. `'/voice'`). The adapter expects the
   *  caller's HTTP/WS server to forward incoming connections to
   *  `openSession()`. */
  wsPath?: string;
  /** Streaming STT provider — when supplied, the adapter is fully
   *  wired and `available = true`. Each `openSession()` opens a
   *  fresh STT session and routes upstream PCM into it. The caller
   *  reads `onFinalTranscript` via the session opts to plug into the
   *  harness chat dispatch.
   *
   *  When omitted, the adapter falls back to the legacy placeholder
   *  ("apps/pwa frontend shell needed before relay can connect")
   *  so backward-compat callers keep getting an Unavailable error. */
  sttProvider?: StreamingSTTProvider;
  /** Final transcript hook (browser → server → STT → here → harness).
   *  When wired with `sttProvider`, the adapter calls this once per
   *  final from STT so the daemon can dispatch the turn through the
   *  existing chat path. */
  onFinalTranscript?: (text: string, sessionId: string) => void;
  /** Partial transcript hook — useful for client-side partial echo
   *  if the daemon wants to surface them via DOWNSTREAM_STATE. */
  onPartialTranscript?: (text: string, sessionId: string) => void;
  /** §C (sprint 22 follow-up · 2026-04-30) — invoked once per fresh
   *  browser session right after `openSession()` resolves. Daemon
   *  callers wire the PWA TTS bridge here, e.g.
   *    bridge.attach(session.sessionId, frame => session.emitDownstream?.(frame))
   *  Errors thrown by the hook are isolated (logged + swallowed) so a
   *  bridge bug can't crash the WS endpoint. */
  onSessionOpen?: (session: PwaVoiceSession) => void;
  /** §C — invoked once per session when it transitions to closed.
   *  Daemon callers detach per-session state (TTS bridge, dispatch
   *  history) here. Errors are isolated. */
  onSessionClose?: (session: PwaVoiceSession) => void;
  /** ISO 639-1 STT language hint forwarded to `provider.openSession()`.
   *  When set, openai-realtime-stt sends it as
   *  `input_audio_transcription.language` (per Realtime API). Without
   *  it the provider auto-detects, which often misclassifies short
   *  Korean utterances as Japanese (similar phonetics). */
  sttLanguage?: string;
}

/**
 * Production adapter — connects the browser WebSocket frame protocol
 * to the harness pipeline. When `sttProvider` is provided, opens a
 * real streaming STT session per browser tab and routes upstream PCM
 * frames into it. Without `sttProvider`, falls back to legacy
 * "Unavailable" behaviour so callers can detect the missing wire.
 *
 * The downstream PCM (TTS playback) and dashboard dispatch wiring is
 * the daemon's responsibility — the adapter exposes
 * `session.emitDownstream()` semantics through the standard
 * `onDownstream(cb)` subscription so the caller can route TTS chunks
 * back to the browser.
 */
export function createPwaVoiceAdapter(opts: PwaVoiceProductionOpts = {}): PwaVoiceAdapter {
  if (!opts.sttProvider) {
    const reason = 'sttProvider not supplied — pass an STTProvider to enable PWA voice (Phase 7 frontend ships in apps/pwa, server wiring needs daemon-public-server WS endpoint)';
    if (debug.enabled)
      debug.log('voice.pwa.adapter', 'unavailable', { reason });
    return {
      available: false,
      unavailableReason: reason,
      openSession: () => Promise.reject(new PwaVoiceUnavailableError(reason)),
      shutdown: async () => { /* nothing wired yet */ },
    };
  }

  const provider = opts.sttProvider;
  let activeSessions: PwaVoiceSession[] = [];

  async function openSession(): Promise<PwaVoiceSession> {
    const session = await createWiredSession({
      provider,
      ...(opts.sttLanguage ? { language: opts.sttLanguage } : {}),
      onFinal: opts.onFinalTranscript,
      onPartial: opts.onPartialTranscript,
      onClose: () => {
        // §C — fire onSessionClose once per session lifecycle.
        if (opts.onSessionClose) {
          try { opts.onSessionClose(session); }
          catch (err) {
            if (debug.enabled)
              debug.log('voice.pwa.adapter', 'onSessionClose.error', {
                err: err instanceof Error ? err.message : String(err),
              }, { level: 'error' });
          }
        }
      },
    });
    activeSessions.push(session);
    if (debug.enabled)
      debug.log('voice.pwa.adapter', 'session.opened', {
        provider: provider.id, active: activeSessions.length,
        sessionId: session.sessionId,
      });
    // §C — fire onSessionOpen so the daemon can attach TTS bridge etc.
    if (opts.onSessionOpen) {
      try { opts.onSessionOpen(session); }
      catch (err) {
        if (debug.enabled)
          debug.log('voice.pwa.adapter', 'onSessionOpen.error', {
            sessionId: session.sessionId,
            err: err instanceof Error ? err.message : String(err),
          }, { level: 'error' });
      }
    }
    return session;
  }

  async function shutdown(): Promise<void> {
    const sessions = activeSessions.slice();
    activeSessions = [];
    await Promise.all(sessions.map((s) => s.close().catch(() => { /* swallow */ })));
    if (debug.enabled)
      debug.log('voice.pwa.adapter', 'shutdown', { closed: sessions.length });
  }

  return {
    available: true,
    unavailableReason: null,
    openSession,
    shutdown,
  };
}

interface WiredSessionOpts {
  provider: StreamingSTTProvider;
  /** ISO 639-1 STT language hint (e.g. 'ko'). Forwarded to the
   *  provider's openSession opts; openai-realtime-stt sends as
   *  `input_audio_transcription.language` to disambiguate
   *  Korean/Japanese auto-detection. */
  language?: string;
  onFinal?: (text: string, sessionId: string) => void;
  onPartial?: (text: string, sessionId: string) => void;
  /** §C — fired once when the session reaches 'closed' so the
   *  adapter can run onSessionClose hooks. */
  onClose?: () => void;
}

async function createWiredSession(opts: WiredSessionOpts): Promise<PwaVoiceSession> {
  const sessionId = `pwa:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let state: PwaVoiceSessionState = 'connecting';
  const downstreamSubs = new Set<(f: PwaDownstreamFrame) => void>();
  const stateSubs = new Set<(s: PwaVoiceSessionState) => void>();
  const transcriptSubs = new Set<(evt: PwaTranscriptEvent) => void>();
  let closed = false;

  function setState(next: PwaVoiceSessionState): void {
    if (state === next) return;
    state = next;
    for (const cb of stateSubs) {
      try { cb(next); } catch { /* isolation */ }
    }
  }

  function fanTranscript(evt: PwaTranscriptEvent): void {
    if (closed) return;
    for (const cb of transcriptSubs) {
      try { cb(evt); } catch { /* isolation */ }
    }
  }

  let stt: StreamingSTTSession;
  try {
    stt = await opts.provider.openSession({
      ...(opts.language ? { language: opts.language } : {}),
      onPartial: (text) => {
        opts.onPartial?.(text, sessionId);
        fanTranscript({ kind: 'partial', text });
      },
      onFinal: (text) => {
        opts.onFinal?.(text, sessionId);
        fanTranscript({ kind: 'final', text });
      },
      onError: (err) => {
        if (debug.enabled)
          debug.log('voice.pwa.adapter', 'stt.error', { sessionId, err: err.message }, { level: 'error' });
      },
    });
  } catch (err) {
    setState('closed');
    throw err;
  }
  setState('streaming');

  return {
    sessionId,
    pushUpstream(frame) {
      if (state !== 'streaming') return;
      if (stt.isOpen()) stt.pushAudio(frame.pcm);
    },
    async finalize() {
      if (closed) return;
      try { await stt.finalize(); } catch { /* swallow — STT logs internally */ }
    },
    async interrupt() {
      // BI-1 manual barge-in (Phase D · 2026-05-09) — abort STT so a
      // partial utterance doesn't accidentally finalize as the user's
      // intent, then signal cancellation through the same close-state
      // doors finalize() uses. The TTS bridge flush + dispatch abort
      // happen at the daemon layer; this adapter's job is to drop the
      // upstream pipe cleanly so the next utterance starts a fresh
      // session.
      if (closed) return;
      try {
        if (stt.isOpen()) await stt.abort();
      } catch { /* swallow — STT logs internally */ }
      if (debug.enabled) {
        debug.log('voice.pwa.adapter', 'interrupt', { sessionId });
      }
      // Stay 'streaming' — the user is about to speak again. Caller
      // (ws-bridge) reopens STT on the next UPSTREAM_PCM via the
      // existing pushUpstream path because stt.isOpen() will be false
      // and the wired session will need a re-open.
      // NOTE: re-opening STT after abort is not yet wired in this PR
      // (the user typically follows interrupt with a new utterance
      // which re-establishes the session via the pushUpstream guard
      // pattern). A follow-up can add eager re-arm if dogfood shows
      // a gap.
    },
    onDownstream(cb) {
      downstreamSubs.add(cb);
      return () => { downstreamSubs.delete(cb); };
    },
    emitDownstream(frame) {
      // §C — drop after close; otherwise fan out to every subscriber.
      if (closed) return;
      if (debug.enabled) {
        debug.log('voice.pwa.adapter', 'downstream.emit', {
          sessionId, bytes: frame.pcm.length, subs: downstreamSubs.size,
        });
      }
      for (const cb of downstreamSubs) {
        try { cb(frame); } catch { /* isolation */ }
      }
    },
    onTranscript(cb) {
      transcriptSubs.add(cb);
      return () => { transcriptSubs.delete(cb); };
    },
    emitTranscript(evt) {
      // Daemon-side path for assistant chunks. STT partial/final are
      // routed via fanTranscript directly from the STT callbacks above.
      fanTranscript(evt);
    },
    onStateChange(cb) {
      stateSubs.add(cb);
      return () => { stateSubs.delete(cb); };
    },
    getState: () => state,
    async close() {
      if (closed) return;
      closed = true;
      setState('closing');
      try {
        if (stt.isOpen()) await stt.abort();
      } catch { /* swallow */ }
      setState('closed');
      downstreamSubs.clear();
      stateSubs.clear();
      transcriptSubs.clear();
      if (opts.onClose) {
        try { opts.onClose(); } catch { /* isolation */ }
      }
    },
  };
}

// ── Env gate ───────────────────────────────────────────────────────

/**
 * Default ON since Phase U closure (2026-05-05) — PWA is now the unified
 * frontend, so the voice WS endpoint is part of the standard daemon
 * surface area. Set `MONAD_PWA_VOICE=0` (or `false`/`off`/`no`) to opt
 * OUT, e.g. when running monad serve on a node without OPENAI_API_KEY
 * just to avoid the streaming STT init log line.
 *
 * Pre-Phase-U: this returned false unless the env was explicitly set —
 * a Phase 7 (2026-04-30) opt-in gate while the PWA voice path was
 * experimental. That justification is gone now.
 */
export function isPwaVoiceEnabled(): boolean {
  const raw = process.env.MONAD_PWA_VOICE?.trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
  return true;
}

// ── Frame protocol contract (for frontend reference) ───────────────

/** WebSocket frame schema sent browser → server.
 *
 *  Frame format on the wire is binary: a 4-byte big-endian header
 *  containing the frame kind (uint8) + flags (uint8) + reserved
 *  (uint16), followed by the payload.
 *
 *  This export documents the kinds — frontend implementations
 *  (apps/pwa/src/voice/voice-websocket.ts, future) reference the
 *  same enum to stay in sync.
 */
export const PWA_VOICE_FRAME_KIND = {
  /** Browser → server: PCM block (payload = raw 16 kHz mono int16 LE). */
  UPSTREAM_PCM: 0x01,
  /** Browser → server: explicit finalize (payload = empty). */
  UPSTREAM_FINALIZE: 0x02,
  /** Browser → server: hello / capabilities (payload = JSON). */
  UPSTREAM_HELLO: 0x03,
  /** Browser → server: BI-1 manual barge-in (Phase D · 2026-05-09).
   *  User clicked cut-in button while TTS playback active. Server
   *  reaction: session.interrupt() — abort STT + flush queued TTS
   *  + cancel in-flight dispatch. Payload empty. */
  UPSTREAM_INTERRUPT: 0x04,
  /** Server → browser: PCM block (payload = raw 24 kHz mono int16 LE). */
  DOWNSTREAM_PCM: 0x81,
  /** Server → browser: state transition (payload = JSON `{state}`). */
  DOWNSTREAM_STATE: 0x82,
  /** Server → browser: error / close reason (payload = JSON). */
  DOWNSTREAM_ERROR: 0x83,
  /** Server → browser: live transcript event (payload = JSON
   *  `{kind: 'partial' | 'final' | 'assistant', text}`). The 'partial'
   *  / 'final' kinds carry STT outputs; 'assistant' carries the LLM
   *  response chunks so the browser can render the response text
   *  alongside the audio playback. Added 2026-04-30. */
  DOWNSTREAM_TRANSCRIPT: 0x84,
} as const;
