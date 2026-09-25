// PR-S1V.5 (sprint 21-Parallel-Voice · 2026-04-29) — Voice provider
// pricing table.
//
// Single source of truth for STT/TTS API pricing so the dispersed
// constants (e.g. `WHISPER_USD_PER_MIN` in `scripts/smoke-voice-stt.ts:21`
// added pre-S1V.5) stop drifting. Production code that records voice
// usage routes through `costForVoiceUsage(...)` so the only thing a
// reviewer has to update when a provider raises prices is this file.
//
// Prices verified against provider docs at the date noted in each row.
// When a provider raises prices, update the constant + the date comment;
// downstream `cost-tracker.ts` reads via this helper so no other file
// needs touching.
//
// Reference: PLAN-pr-s1v5-pwa-voice-wiring-2026-04-29.md §4.3.1.

// ── Provider pricing entries ───────────────────────────────────────

interface SttProviderCost {
  readonly kind: 'stt';
  readonly usdPerMinAudio: number;
}

interface TtsProviderCost {
  readonly kind: 'tts';
  readonly usdPerCharacter: number;
}

type ProviderCost = SttProviderCost | TtsProviderCost;

export const VOICE_COSTS = {
  // OpenAI Whisper batch — used by `src/voice/stt-providers/openai-whisper.ts`.
  // $0.006 per minute · platform.openai.com/docs/pricing (2026-04 verified).
  'openai-whisper': {
    kind: 'stt',
    usdPerMinAudio: 0.006,
  },
  // OpenAI gpt-4o-mini-transcribe streaming — PR-S1V.2-stream scope.
  // $0.003 per minute (50 % cheaper than Whisper) · 2026-04 verified.
  'gpt-4o-mini-transcribe': {
    kind: 'stt',
    usdPerMinAudio: 0.003,
  },
  // OpenAI gpt-4o-transcribe streaming — higher-fidelity sibling of
  // gpt-4o-mini-transcribe. $0.006 per audio minute · 2026-05 verified.
  // Wired as the `better` tier in `src/model-tier/tier-map.ts`.
  'gpt-4o-transcribe': {
    kind: 'stt',
    usdPerMinAudio: 0.006,
  },
  // OpenAI gpt-realtime-whisper streaming — 2026-05 OpenAI voice model
  // refresh (developers.openai.com/api/docs/models/gpt-realtime-whisper).
  // $0.017 per audio minute · WebSocket realtime API · streaming deltas +
  // server VAD · tunable latency 0.4–3.0s · domain adaptation via short
  // keyword lists · session.audio.input.transcription.model. Higher
  // accuracy than gpt-4o-mini-transcribe but ~5.7× cost — opt-in only
  // (set user-config `voice.stt.model = 'gpt-realtime-whisper'`).
  'gpt-realtime-whisper': {
    kind: 'stt',
    usdPerMinAudio: 0.017,
  },
  // ElevenLabs Scribe (premium tier) — Tier 1 license gate.
  // $0.0125 per minute · elevenlabs.io/pricing (2026-04 verified).
  // scribe_v2_realtime (streaming WS) 도 이 항목으로 계상 — 갭 #1 배선
  // (2026-07-12). 실제 realtime 단가가 분리 공시되면 여기서 갱신.
  'elevenlabs-scribe': {
    kind: 'stt',
    usdPerMinAudio: 0.0125,
  },
  // Gemini Live API 오디오 입력 (gemini-2.5-flash-live) — 토큰 과금을
  // 분당으로 환산한 근사치: 오디오 32 tokens/sec × 60 s × $3.00/1M
  // input-audio tokens ≈ $0.0058/min (ai.google.dev/pricing 기준 ·
  // 2026-07-12 산출). 과소계상(무기록)보다 근사가 낫다 — 단가 개정 시
  // 이 파일만 갱신.
  'gemini-live-stt': {
    kind: 'stt',
    usdPerMinAudio: 0.0058,
  },
  // ElevenLabs Flash v2.5 TTS — premium tier read-back.
  // $0.0000200 per character (~$20 per 1M chars) · 2026-04 verified.
  'elevenlabs-tts-flash-v2.5': {
    kind: 'tts',
    usdPerCharacter: 0.0000200,
  },
  // OpenAI TTS tts-1 — Phase 1 default TTS provider · paid tier.
  // $0.0000150 per character (~$15 per 1M chars) · platform.openai.com/docs/pricing
  // (2026-04 verified).
  'openai-tts': {
    kind: 'tts',
    usdPerCharacter: 0.0000150,
  },
  // OpenAI TTS tts-1-hd — higher-fidelity option · paid tier.
  // $0.0000300 per character (~$30 per 1M chars) · 2026-04 verified.
  'openai-tts-hd': {
    kind: 'tts',
    usdPerCharacter: 0.0000300,
  },
  // Microsoft Edge TTS — free Read-Aloud voices (no API key) · cost 0.
  // The `edge-tts` Python CLI talks to Microsoft's free service used by
  // the Edge browser's Read Aloud feature.
  'edge-tts': {
    kind: 'tts',
    usdPerCharacter: 0,
  },
  // macOS `say` — local synthesis · cost 0 by definition.
  'macos-say': {
    kind: 'tts',
    usdPerCharacter: 0,
  },
} as const satisfies Record<string, ProviderCost>;

export type VoiceCostId = keyof typeof VOICE_COSTS;

export function isVoiceCostId(id: string): id is VoiceCostId {
  return Object.prototype.hasOwnProperty.call(VOICE_COSTS, id);
}

// ── Cost computation ───────────────────────────────────────────────

export interface SttUsage {
  providerId: VoiceCostId;
  durationMs: number;
}

export interface TtsUsage {
  providerId: VoiceCostId;
  charCount: number;
}

/** Compute USD cost for a single STT call. Throws when `providerId`
 *  is not an STT entry — callers shouldn't be passing TTS ids in by
 *  mistake, and the throw beats a silently-zero return that hides the
 *  bug in monthly totals. */
export function costForStt(usage: SttUsage): number {
  const entry = VOICE_COSTS[usage.providerId];
  if (entry.kind !== 'stt') {
    throw new Error(`voice-costs: ${usage.providerId} is not an STT provider`);
  }
  return (usage.durationMs / 60_000) * entry.usdPerMinAudio;
}

export function costForTts(usage: TtsUsage): number {
  const entry = VOICE_COSTS[usage.providerId];
  if (entry.kind !== 'tts') {
    throw new Error(`voice-costs: ${usage.providerId} is not a TTS provider`);
  }
  return usage.charCount * entry.usdPerCharacter;
}
