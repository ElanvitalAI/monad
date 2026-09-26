// PR-S1V.2 (sprint 21-Parallel-Voice · 2026-04-29) — Provider-agnostic
// STT interface + factory.
//
// PCM Buffer (PR-S1V.1 의 audio-capture output) → transcript text 의
// boundary. Cloud (OpenAI Whisper · ElevenLabs Scribe) 와 local
// (whisper.cpp · 후속) 모두 같은 contract 위에서 plug-in. elanous 의
// platform-free architecture (PLAN §4.1) 의 STT layer.
//
// 본 PR (Path A) 은 batch only 구현 — `transcribeBatch` 는 mandatory,
// `transcribeStream` 은 optional. 다음 PR (PR-S1V.2-stream) 에서
// `transcribeStream` 추가 시 본 interface 변경 0 (forward-compatible).
//
// 차용 ref:
//   - gemini-cli `packages/core/src/voice/transcriptionProvider.ts:1-30`
//     — provider interface 의 분리 + EventEmitter pattern (단 elanous 는
//     batch-first 의 다른 shape · gemini 는 streaming-first).
//   - gemini-cli `packages/core/src/voice/transcriptionFactory.ts`
//     — runtime provider 선택 패턴.
//   - hermes `tools/transcription_tools.py` — 5 STT providers
//     (faster-whisper · Groq · OpenAI · Mistral · xAI) singleton dispatch.
//     elanous 는 OpenAI Whisper 부터 시작 + 후속 PR 로 ElevenLabs · local.

// ── Common types ────────────────────────────────────────────────────

export type STTProviderId =
  | 'openai-whisper'
  | 'openai-realtime'
  | 'elevenlabs-scribe'
  | 'whisper-cpp';

export type STTOpts = {
  /** ISO 639-1 language hint (e.g., 'en', 'ko'). Improves accuracy. */
  language?: string;
  /** Priming text — bias decoder toward expected vocabulary. */
  prompt?: string;
  /** Sampling temperature (0.0 deterministic — provider-specific upper bound). */
  temperature?: number;
};

export type STTResult = {
  /** Final transcript. */
  text: string;
  /** Detected language (when provider returns it). */
  language?: string;
  /** Duration of the input audio in milliseconds (when known). */
  durationMs?: number;
};

export type STTPartialResult = {
  /** Partial transcript so far. */
  text: string;
  /** True when this is the last chunk for the current utterance. */
  isFinal: boolean;
};

// ── Provider interface (forward-compatible · batch + optional stream) ──

export interface STTProvider {
  readonly id: STTProviderId;

  /**
   * Transcribe a complete PCM buffer to text. The audio must be
   * 16 kHz · 16-bit signed little-endian · mono raw PCM (matches
   * PR-S1V.1's audio-capture output) — providers wrap this into the
   * format their API accepts (e.g., WAV).
   */
  transcribeBatch(audio: Buffer, opts?: STTOpts): Promise<STTResult>;

  /**
   * Optional streaming variant — providers that support realtime APIs
   * (gpt-4o-mini-transcribe over WebSocket, ElevenLabs streaming) can
   * implement this to yield partial results as audio is sent.
   *
   * Not implemented in PR-S1V.2 (batch-only scope). The voice-input-bridge
   * (PR-S1V.4) caller should `if (provider.transcribeStream)` and fall
   * back to `transcribeBatch` when undefined.
   */
  transcribeStream?(
    audio: AsyncIterable<Buffer>,
    opts?: STTOpts,
  ): AsyncIterable<STTPartialResult>;
}

// ── Provider configuration union ────────────────────────────────────

export type STTProviderConfig =
  | OpenAIWhisperConfig
  | OpenAIRealtimeConfig
  | ElevenLabsScribeConfig;

export type OpenAIWhisperConfig = {
  id: 'openai-whisper';
  apiKey?: string;
  /** Default: `whisper-1`. Override to e.g. `gpt-4o-transcribe`. */
  model?: string;
  /** Default: `https://api.openai.com`. Override for proxies / Azure. */
  baseUrl?: string;
};

export type OpenAIRealtimeConfig = {
  id: 'openai-realtime';
  apiKey?: string;
  model?: string;
};

export type ElevenLabsScribeConfig = {
  id: 'elevenlabs-scribe';
  apiKey?: string;
};

// ── Factory ─────────────────────────────────────────────────────────

/**
 * Create an `STTProvider` from a config. Provider implementations are
 * lazy-imported so unused backends don't get pulled into the bundle.
 *
 * In PR-S1V.2 only `openai-whisper` is implemented; other ids throw
 * `STTProviderNotImplementedError` so the caller can detect and fall
 * back. PR-S1V.2-stream (`openai-realtime`) and the Premium tier
 * (`elevenlabs-scribe`) follow.
 */
export async function createSTTProvider(
  cfg: STTProviderConfig,
): Promise<STTProvider> {
  switch (cfg.id) {
    case 'openai-whisper': {
      const { OpenAIWhisperProvider } = await import(
        './stt-providers/openai-whisper.js'
      );
      return new OpenAIWhisperProvider(cfg);
    }
    case 'openai-realtime':
      throw new STTProviderNotImplementedError(
        'openai-realtime',
        'streaming WebSocket variant is implemented in PR-S1V.2-stream',
      );
    case 'elevenlabs-scribe':
      throw new STTProviderNotImplementedError(
        'elevenlabs-scribe',
        'Premium provider is implemented in a follow-up PR',
      );
    default: {
      // Exhaustive switch — `cfg` is `never` here at compile time.
      const _exhaustive: never = cfg;
      throw new STTProviderNotImplementedError(
        (_exhaustive as { id: string }).id,
        'unknown provider id',
      );
    }
  }
}

export class STTProviderNotImplementedError extends Error {
  constructor(public readonly providerId: string, hint: string) {
    super(`STT provider not implemented: ${providerId} (${hint})`);
    this.name = 'STTProviderNotImplementedError';
  }
}

// ── Provider registry (read-only metadata for UI / tier gating) ─────

export type STTProviderInfo = {
  id: STTProviderId;
  /** Human-readable name shown in UI / docs. */
  displayName: string;
  /** Minimum tier the provider is gated to (Free/Paid/Premium). */
  tier: 'free' | 'paid' | 'premium';
  /** Whether this provider is implemented yet in this build. */
  implemented: boolean;
  /** Brief description of the provider's strengths. */
  description: string;
};

export const STT_PROVIDERS: Readonly<Record<STTProviderId, STTProviderInfo>> = {
  'openai-whisper': {
    id: 'openai-whisper',
    displayName: 'OpenAI Whisper',
    tier: 'paid',
    implemented: true,
    description:
      'OpenAI Whisper REST API — accurate, multilingual, batch transcription. Default for Paid tier.',
  },
  'openai-realtime': {
    id: 'openai-realtime',
    displayName: 'OpenAI Realtime STT (gpt-4o-mini-transcribe / gpt-realtime-whisper)',
    tier: 'paid',
    implemented: false,
    description:
      'OpenAI Realtime API — WebSocket streaming, partial transcripts, low latency, server VAD. '
      + 'Default model = gpt-4o-mini-transcribe ($0.003/min). Premium model = gpt-realtime-whisper '
      + '(2026-05 GA, $0.017/min, tunable latency 0.4–3.0s, domain adaptation, optional logprobs/timestamps). '
      + 'Both share the same WebSocket spec (24 kHz mono PCM, session.audio.input.transcription, '
      + 'transcription.delta / completed events). Implemented in streaming-stt/.',
  },
  'elevenlabs-scribe': {
    id: 'elevenlabs-scribe',
    displayName: 'ElevenLabs Scribe',
    tier: 'premium',
    implemented: false,
    description:
      'ElevenLabs Scribe — multilingual + speaker diarization. Premium tier default.',
  },
  'whisper-cpp': {
    id: 'whisper-cpp',
    displayName: 'whisper.cpp (local)',
    tier: 'free',
    implemented: false,
    description:
      'Local whisper.cpp inference — offline, privacy-first. Free tier fallback (future).',
  },
} as const;
