// PR-S1V.8 (sprint 22 Phase 3 · 2026-04-29) — Provider-agnostic
// streaming-STT interface.
//
// Mirrors the batch `STTProvider` (PR-S1V.2) shape but exposes
// session-oriented streaming so partial transcripts can flow into the
// chat input as the user speaks. Three providers ship behind this
// contract:
//
//   - openai-realtime-stt — `wss://api.openai.com/v1/realtime?intent=transcription`
//     (subprotocol-based auth · server VAD · partial+final events)
//   - gemini-live-stt     — `wss://generativelanguage.googleapis.com/...`
//     (gemini-2.5-flash live · API key in URL · serverContent transcripts)
//   - whisper-cpp-local   — subprocess `whisper-stream` CLI fallback
//     (no network · graceful unavailable when binary missing)
//
// Reference: ROADMAP-voice-harness-bidirectional §4 · PLAN §8.

// ── Common types ───────────────────────────────────────────────────

export type StreamingSTTProviderId =
  | 'openai-realtime-stt'
  | 'gemini-live-stt'
  | 'whisper-cpp-local'
  | 'elevenlabs-scribe-realtime';

export interface StreamingSTTPcmFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

// 2026-04-30 (experiment/voice-chat-realtime-rebind):
// Bumped 16000 → 24000 to match the audio-capture global default (and
// OpenAI realtime's >= 24kHz requirement). Providers that need 16k
// (whisper-cpp, gemini-live) downsample inline with sox / their own
// resampler.
export const DEFAULT_STREAMING_STT_FORMAT: StreamingSTTPcmFormat = {
  sampleRate: 24000,
  channels: 1,
  bitsPerSample: 16,
};

export interface StreamingSTTOpts {
  /** ISO 639-1 hint — providers that accept it pass through (whisper-cpp,
   *  gemini); openai-realtime detects automatically. */
  language?: string;
  /** Optional priming text — bias decoder vocabulary. */
  prompt?: string;
  /** Provider-specific model override (e.g. `gpt-4o-mini-transcribe`,
   *  `gpt-realtime-whisper` — 2026-05 GA · best accuracy + tunable latency). */
  model?: string;
  /** Fired with each partial transcript chunk. */
  onPartial?: (text: string) => void;
  /** Fired when the provider commits a final segment. */
  onFinal?: (text: string) => void;
  /** Fired on transport / API error. The session is closed afterward. */
  onError?: (err: Error) => void;
  /** Fired when the underlying transport closes (clean or otherwise). */
  onClose?: () => void;
}

export interface StreamingSTTSession {
  /** Push raw PCM audio into the session. Format must match
   *  `provider.format` (16 kHz · 16-bit signed mono by default). */
  pushAudio(pcm: Buffer): void;
  /** Tell the provider "speaker is done" — flushes server VAD,
   *  triggers a final transcript, and closes the session. Resolves
   *  when the close handshake completes. */
  finalize(): Promise<void>;
  /** ESC / cancel — drop the session immediately, no final emit. */
  abort(): Promise<void>;
  /** Whether the session is still accepting audio. */
  isOpen(): boolean;
}

export interface StreamingSTTProvider {
  readonly id: StreamingSTTProviderId;
  /** PCM format the provider expects on `pushAudio`. */
  readonly format: StreamingSTTPcmFormat;
  /** Open a fresh session. Each session is single-utterance — re-call
   *  `openSession` for the next turn. */
  openSession(opts?: StreamingSTTOpts): Promise<StreamingSTTSession>;
}

// ── Configuration union ────────────────────────────────────────────

export type StreamingSTTProviderConfig =
  | OpenAIRealtimeSTTConfig
  | GeminiLiveSTTConfig
  | WhisperCppLocalConfig
  | ElevenLabsScribeRealtimeConfig;

export interface OpenAIRealtimeSTTConfig {
  id: 'openai-realtime-stt';
  apiKey?: string;
  /** Override the transcription model (session.update payload · default
   *  `gpt-4o-mini-transcribe`). Set to `'gpt-realtime-whisper'` (2026-05
   *  GA) for best accuracy + tunable latency + domain adaptation —
   *  $0.017/audio-min vs default $0.003/min. */
  model?: string;
  /** 2026-06-02 — Override the realtime BASE model that drives the WS
   *  URL query string. Default `gpt-realtime` (current GA · supersedes
   *  the deprecated `gpt-4o-realtime-preview` preview that newer
   *  sk-proj-* keys no longer have access to). Override via user-config
   *  `voice.stt.realtimeBaseModel` (preferred · per AGENTS.md §
   *  user-config-over-env) or legacy env `OPENAI_REALTIME_BASE_MODEL`
   *  (backward-compat only). */
  realtimeBaseModel?: string;
  /** Override the WebSocket constructor — tests inject a fake. */
  WebSocketCtor?: typeof WebSocket;
}

export interface GeminiLiveSTTConfig {
  id: 'gemini-live-stt';
  apiKey?: string;
  /** Override the model (default `gemini-2.5-flash-live-preview`). */
  model?: string;
  WebSocketCtor?: typeof WebSocket;
}

export interface WhisperCppLocalConfig {
  id: 'whisper-cpp-local';
  /** Path to the `whisper-stream` binary; defaults to PATH lookup. */
  binaryPath?: string;
  /** Path to the GGUF model file. Required for production use. */
  modelPath?: string;
}

export interface ElevenLabsScribeRealtimeConfig {
  id: 'elevenlabs-scribe-realtime';
  /** Defaults to env `ELEVENLABS_API_KEY`. */
  apiKey?: string;
  /** Override the model (default `scribe_v2_realtime`; env
   *  `ELEVENLABS_STT_MODEL_ID`). */
  model?: string;
  /** Override the WebSocket constructor — tests inject a fake. */
  WebSocketCtor?: typeof WebSocket;
}

// ── Errors ─────────────────────────────────────────────────────────

export class StreamingSTTProviderUnavailableError extends Error {
  constructor(public readonly providerId: string, hint: string) {
    super(`Streaming STT provider unavailable: ${providerId} (${hint})`);
    this.name = 'StreamingSTTProviderUnavailableError';
  }
}

export class StreamingSTTProviderNotImplementedError extends Error {
  constructor(public readonly providerId: string, hint: string) {
    super(`Streaming STT provider not implemented: ${providerId} (${hint})`);
    this.name = 'StreamingSTTProviderNotImplementedError';
  }
}

// ── Factory ────────────────────────────────────────────────────────

export async function createStreamingSTTProvider(
  cfg: StreamingSTTProviderConfig,
): Promise<StreamingSTTProvider> {
  switch (cfg.id) {
    case 'openai-realtime-stt': {
      const { OpenAIRealtimeSTTProvider } = await import('./streaming-stt-providers/openai-realtime-stt.js');
      return new OpenAIRealtimeSTTProvider(cfg);
    }
    case 'gemini-live-stt': {
      const { GeminiLiveSTTProvider } = await import('./streaming-stt-providers/gemini-live-stt.js');
      return new GeminiLiveSTTProvider(cfg);
    }
    case 'whisper-cpp-local': {
      const { WhisperCppLocalProvider } = await import('./streaming-stt-providers/whisper-cpp-local.js');
      return new WhisperCppLocalProvider(cfg);
    }
    case 'elevenlabs-scribe-realtime': {
      const { ElevenLabsScribeRealtimeProvider } = await import('./streaming-stt-providers/elevenlabs-scribe-realtime.js');
      return new ElevenLabsScribeRealtimeProvider(cfg);
    }
    default: {
      const _exhaustive: never = cfg;
      throw new StreamingSTTProviderNotImplementedError(
        (_exhaustive as { id: string }).id,
        'unknown provider id',
      );
    }
  }
}

// ── Env switch ─────────────────────────────────────────────────────

/** Priority: explicit `configOverride` (from user-config) > env > fallback.
 *  Caller (e.g. dashboard boot) reads `getUserConfig().voice.stt.provider`
 *  and passes it as `configOverride`. When omitted, env (legacy
 *  `STREAMING_STT_PROVIDER`) takes over for backward-compat. */
export function resolveStreamingSTTProviderIdFromEnv(
  fallback: StreamingSTTProviderId = 'openai-realtime-stt',
  opts: { configOverride?: StreamingSTTProviderId } = {},
): StreamingSTTProviderId {
  if (opts.configOverride) return opts.configOverride;
  const raw = process.env.STREAMING_STT_PROVIDER?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'openai-realtime-stt' || raw === 'gemini-live-stt' || raw === 'whisper-cpp-local'
    || raw === 'elevenlabs-scribe-realtime') {
    return raw;
  }
  return fallback;
}

// ── Registry (UI / tier gating) ────────────────────────────────────

export interface StreamingSTTProviderInfo {
  id: StreamingSTTProviderId;
  displayName: string;
  tier: 'free' | 'paid' | 'premium';
  implemented: boolean;
  /** Whether the provider runs server-side VAD (auto turn-detection). */
  serverVad: boolean;
  description: string;
}

export const STREAMING_STT_PROVIDERS: Readonly<Record<StreamingSTTProviderId, StreamingSTTProviderInfo>> = {
  'openai-realtime-stt': {
    id: 'openai-realtime-stt',
    displayName: 'OpenAI Realtime Transcription',
    tier: 'paid',
    implemented: true,
    serverVad: true,
    description:
      'OpenAI realtime API streaming transcription — models: gpt-4o-mini-transcribe (default · $0.003/min), '
      + 'gpt-realtime-whisper (2026-05 GA · $0.017/min · best accuracy + tunable latency 0.4–3.0s + domain '
      + 'adaptation), gpt-4o-transcribe. Server VAD, partial + final events, low latency.',
  },
  'gemini-live-stt': {
    id: 'gemini-live-stt',
    displayName: 'Gemini Live Transcription',
    tier: 'paid',
    implemented: true,
    serverVad: true,
    description:
      'Gemini Live API streaming transcription (gemini-2.5-flash-live-preview). API-key in URL, serverContent.inputTranscription events.',
  },
  'whisper-cpp-local': {
    id: 'whisper-cpp-local',
    displayName: 'whisper.cpp (local stream)',
    tier: 'free',
    implemented: true,
    serverVad: false,
    description:
      'Local `whisper-stream` CLI subprocess. Requires user-installed binary + GGUF model. Free, offline, no network.',
  },
  'elevenlabs-scribe-realtime': {
    id: 'elevenlabs-scribe-realtime',
    displayName: 'ElevenLabs Scribe v2 Realtime',
    tier: 'paid',
    implemented: true,
    serverVad: false,
    description:
      'ElevenLabs Scribe v2 Realtime WebSocket STT (scribe_v2_realtime · 90+ languages · ultra-low latency). '
      + 'commit_strategy=manual — the caller\'s silence-gap finalize() commits each utterance '
      + '(Discord ships no packets during silence, so server VAD cannot close turns). '
      + 'partial_transcript / committed_transcript events. Env: ELEVENLABS_API_KEY (+ELEVENLABS_STT_MODEL_ID).',
  },
} as const;
