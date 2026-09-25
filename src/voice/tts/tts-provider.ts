// PR-S1V.6 (sprint 22 Phase 1 · 2026-04-29) — Provider-agnostic TTS
// interface + factory.
//
// Mirror of `src/voice/stt-provider.ts` for the synthesis side: text →
// 24 kHz · 16-bit signed mono PCM Buffer (matches `audio-player.ts`'s
// stdin contract). Cloud (OpenAI TTS · ElevenLabs Flash v2.5) and local
// (macOS `say` · Edge TTS) plug in behind one contract so the auto-TTS
// controller (Phase 2) and `/voice-chat` mode (Phase 4) don't care
// which backend is doing the synthesis.
//
// Streaming-first: `synthesizeStream` yields PCM chunks as they arrive
// from the provider. Providers that only return one final blob fall
// back via `synthesizeBatch`. The auto-TTS controller calls whichever
// is available — `if (provider.synthesizeStream) ... else ...`.
//
// Reference: ROADMAP-voice-harness-bidirectional §2.2 · PLAN §6.2.

// ── Common types ───────────────────────────────────────────────────

export type TTSProviderId =
  | 'openai-tts'
  | 'elevenlabs-tts'
  | 'edge-tts'
  | 'macos-say';

export interface TTSOpts {
  /** Provider-specific voice id. Each provider has its own default
   *  Korean voice — leave undefined to use it. */
  voice?: string;
  /** ISO 639-1 language hint (e.g., 'ko', 'en'). Some providers ignore;
   *  ElevenLabs / OpenAI infer from text. */
  language?: string;
  /** Playback rate multiplier (0.5 .. 2.0). Provider-specific clamping. */
  speed?: number;
}

/** PCM format the provider emits. Defaults match `audio-player.ts`. */
export interface TTSPcmFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

export const DEFAULT_TTS_PCM_FORMAT: TTSPcmFormat = {
  sampleRate: 24000,
  channels: 1,
  bitsPerSample: 16,
};

export interface TTSResult {
  /** Concatenated 24 kHz · 16-bit signed mono PCM Buffer. */
  pcm: Buffer;
  /** Format the buffer is in. Always matches `DEFAULT_TTS_PCM_FORMAT`
   *  unless a provider opts out — auto-TTS asserts the format match. */
  format: TTSPcmFormat;
  /** Character count of the input text — bridge to cost-tracker. */
  charCount: number;
}

export interface TTSStreamChunk {
  /** PCM chunk in the format declared by the stream's first chunk. */
  pcm: Buffer;
}

// ── Provider interface ─────────────────────────────────────────────

export interface TTSProvider {
  readonly id: TTSProviderId;
  /** Format the provider emits. Used by callers to spawn audio-player
   *  with a matching `start({ sampleRate, channels, bitsPerSample })`. */
  readonly format: TTSPcmFormat;

  /** Synthesize the full text in one call, returning a single PCM
   *  Buffer. Mandatory — all providers implement this. */
  synthesizeBatch(text: string, opts?: TTSOpts): Promise<TTSResult>;

  /** Optional streaming path. Yields PCM chunks as the provider sends
   *  them. Implemented by `openai-tts` and `elevenlabs-tts`; `edge-tts`
   *  and `macos-say` synthesize-then-stream (full file → chunked
   *  reader, identical wire shape but no first-byte latency benefit). */
  synthesizeStream?(
    text: string,
    opts?: TTSOpts,
  ): AsyncIterable<TTSStreamChunk>;
}

// ── Configuration union ────────────────────────────────────────────

export type TTSProviderConfig =
  | OpenAITTSConfig
  | ElevenLabsTTSConfig
  | EdgeTTSConfig
  | MacosSayConfig;

export interface OpenAITTSConfig {
  id: 'openai-tts';
  apiKey?: string;
  /** Default `tts-1`. Override to `tts-1-hd` (~2x cost, higher fidelity). */
  model?: string;
  /** Default `alloy`. OpenAI voices: alloy/echo/fable/onyx/nova/shimmer. */
  voice?: string;
  baseUrl?: string;
}

export interface ElevenLabsTTSConfig {
  id: 'elevenlabs-tts';
  apiKey?: string;
  /** Default voice id (Korean — set via env in dogfood). */
  voiceId?: string;
  /** Default `eleven_flash_v2_5` (low latency, multi-lingual). */
  modelId?: string;
}

export interface EdgeTTSConfig {
  id: 'edge-tts';
  /** Default `ko-KR-SunHiNeural` (Female, Friendly). */
  voice?: string;
  /** Path to the `edge-tts` binary. Defaults to `edge-tts` on PATH. */
  binaryPath?: string;
}

export interface MacosSayConfig {
  id: 'macos-say';
  /** Default `Yuna` (macOS Korean voice). */
  voice?: string;
}

// ── Factory ────────────────────────────────────────────────────────

/** Async lazy-import factory — same pattern as `createSTTProvider`.
 *  Unimplemented providers throw `TTSProviderNotImplementedError` so
 *  callers can detect and skip without crashing the whole subsystem. */
export async function createTTSProvider(
  cfg: TTSProviderConfig,
): Promise<TTSProvider> {
  switch (cfg.id) {
    case 'openai-tts': {
      const { OpenAITTSProvider } = await import('./tts-providers/openai-tts.js');
      return new OpenAITTSProvider(cfg);
    }
    case 'elevenlabs-tts': {
      const { ElevenLabsTTSProvider } = await import('./tts-providers/elevenlabs-tts.js');
      return new ElevenLabsTTSProvider(cfg);
    }
    case 'edge-tts': {
      const { EdgeTTSProvider } = await import('./tts-providers/edge-tts.js');
      return new EdgeTTSProvider(cfg);
    }
    case 'macos-say': {
      const { MacosSayProvider } = await import('./tts-providers/macos-say.js');
      return new MacosSayProvider(cfg);
    }
    default: {
      const _exhaustive: never = cfg;
      throw new TTSProviderNotImplementedError(
        (_exhaustive as { id: string }).id,
        'unknown provider id',
      );
    }
  }
}

export class TTSProviderNotImplementedError extends Error {
  constructor(public readonly providerId: string, hint: string) {
    super(`TTS provider not implemented: ${providerId} (${hint})`);
    this.name = 'TTSProviderNotImplementedError';
  }
}

export class TTSProviderUnavailableError extends Error {
  constructor(public readonly providerId: string, hint: string) {
    super(`TTS provider unavailable: ${providerId} (${hint})`);
    this.name = 'TTSProviderUnavailableError';
  }
}

// ── Env switch ─────────────────────────────────────────────────────

/** Resolve the configured provider id. Priority:
 *  explicit `configOverride` (from user-config) > env (`TTS_PROVIDER`)
 *  > fallback. Used by the auto-TTS controller (Phase 2) and
 *  scripts/tts-test.ts. */
export function resolveTTSProviderIdFromEnv(
  fallback: TTSProviderId = 'openai-tts',
  opts: { configOverride?: TTSProviderId } = {},
): TTSProviderId {
  if (opts.configOverride) return opts.configOverride;
  const raw = process.env.TTS_PROVIDER?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'openai-tts' || raw === 'elevenlabs-tts' || raw === 'edge-tts' || raw === 'macos-say') {
    return raw;
  }
  return fallback;
}

// ── Registry (UI / tier gating) ────────────────────────────────────

export interface TTSProviderInfo {
  id: TTSProviderId;
  displayName: string;
  tier: 'free' | 'paid' | 'premium';
  implemented: boolean;
  /** Whether the provider can stream PCM as it synthesizes. False for
   *  providers that emit one final blob (macOS `say`, edge-tts file out). */
  streaming: boolean;
  description: string;
}

export const TTS_PROVIDERS: Readonly<Record<TTSProviderId, TTSProviderInfo>> = {
  'openai-tts': {
    id: 'openai-tts',
    displayName: 'OpenAI TTS',
    tier: 'paid',
    implemented: true,
    streaming: true,
    description:
      'OpenAI /v1/audio/speech (tts-1 default · tts-1-hd HQ option). Streaming PCM, multilingual including Korean. Default for Paid tier.',
  },
  'elevenlabs-tts': {
    id: 'elevenlabs-tts',
    displayName: 'ElevenLabs Flash v2.5',
    tier: 'premium',
    implemented: true,
    streaming: true,
    description:
      'ElevenLabs Flash v2.5 streaming TTS · low-latency, premium voice quality, ~$20/1M chars. Default for Premium tier.',
  },
  'edge-tts': {
    id: 'edge-tts',
    displayName: 'Microsoft Edge TTS',
    tier: 'free',
    implemented: true,
    streaming: false,
    description:
      'Free Microsoft Edge Read Aloud voices (via `edge-tts` Python CLI). Korean voices: ko-KR-SunHiNeural / ko-KR-InJoonNeural / ko-KR-HyunsuMultilingualNeural.',
  },
  'macos-say': {
    id: 'macos-say',
    displayName: 'macOS say',
    tier: 'free',
    implemented: true,
    streaming: false,
    description:
      'System `say` command on macOS (Korean voice: Yuna). System fallback when no API key or network is available; macOS only.',
  },
} as const;
