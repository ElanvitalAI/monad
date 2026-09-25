// M2-3 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 2) —
// Use-case preset catalog.
//
// A preset bundles tier + voice id + budget cap so 1-click "Medical
// dictation" applies the right STT / LLM / TTS / voice all at once.
// Users who don't want to think in 3-axis terms get curated bundles;
// power users still drag individual sliders.
//
// PLAN §3.3 catalog (5 presets · expandable):
//
//   casual_chat          — STT budget · LLM cheap · TTS budget · no cap
//   meeting              — STT balanced · LLM balanced · TTS balanced · $5/mo
//   medical_dictation    — STT loaded · LLM best · TTS best · $20/mo
//   live_caption         — STT balanced (low-latency) · LLM 0 · TTS 0
//   sleep_mode           — STT 0 · LLM local · TTS 0 (cost guard active)
//
// Phase 2 stores `modelTier.preset = <id>` and **expands** at apply
// time — the preset's tier values are written directly into the
// surface slots so subsequent slider drags can fine-tune from the
// preset's starting point (cleaner than carrying a preset → tier
// indirection through every resolver).

import type { ModelTier, TtsVoiceContextConfig } from './types.js';

export type PresetId =
  | 'casual_chat'
  | 'meeting'
  | 'medical_dictation'
  | 'live_caption'
  | 'sleep_mode';

export interface PresetSpec {
  id: PresetId;
  /** Title-cased human label. */
  label: string;
  /** Emoji prefix used by the PWA preset card grid. */
  icon: string;
  /** One-sentence description shown in the card body. */
  description: string;
  /** Tier overrides this preset applies. Undefined = leave alone. */
  tiers: {
    stt?: ModelTier;
    tts?: ModelTier;
    llm?: ModelTier;
  };
  /** Optional voice-id per-context. */
  ttsVoice?: TtsVoiceContextConfig;
  /** Optional monthly USD cap to set on apply. */
  monthlyUsdCap?: number;
}

export const PRESETS: Readonly<Record<PresetId, PresetSpec>> = {
  casual_chat: {
    id: 'casual_chat',
    label: 'Casual chat',
    icon: '💬',
    description: 'Day-to-day messaging · cheap STT / LLM · no read-back.',
    tiers: { stt: 'budget', llm: 'budget', tts: 'budget' },
  },
  meeting: {
    id: 'meeting',
    label: 'Meeting notes',
    icon: '📋',
    description: 'Balanced accuracy for transcripts · standard LLM summarization.',
    tiers: { stt: 'balanced', llm: 'balanced', tts: 'balanced' },
    monthlyUsdCap: 5,
  },
  medical_dictation: {
    id: 'medical_dictation',
    label: 'Medical / legal dictation',
    icon: '🏥',
    description: 'Loaded STT (timestamps + jargon adaptation) · Best LLM · ElevenLabs voice.',
    tiers: { stt: 'loaded', llm: 'best', tts: 'best' },
    monthlyUsdCap: 20,
  },
  live_caption: {
    id: 'live_caption',
    label: 'Live captioning',
    icon: '🎬',
    description: 'Low-latency STT · LLM disabled · no read-back.',
    tiers: { stt: 'balanced', llm: 'budget', tts: 'budget' },
  },
  sleep_mode: {
    id: 'sleep_mode',
    label: 'Sleep mode',
    icon: '🌙',
    description: 'Cost zero · local-only models · no API calls.',
    tiers: { stt: 'budget', llm: 'budget', tts: 'budget' },
    monthlyUsdCap: 0,
  },
};

/** All preset ids in canonical display order. */
export const PRESET_IDS: readonly PresetId[] = [
  'casual_chat',
  'meeting',
  'medical_dictation',
  'live_caption',
  'sleep_mode',
];

export function isPresetId(v: unknown): v is PresetId {
  return typeof v === 'string' && (PRESET_IDS as readonly string[]).includes(v);
}

export function getPreset(id: PresetId): PresetSpec {
  return PRESETS[id];
}
