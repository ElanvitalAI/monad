// M2-3 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 2) —
// PWA mirror of `src/model-tier/preset-catalog.ts`.
//
// Same drift-defense pattern as the tier map mirrors — PWA tsconfig
// can't see parent src/, so we duplicate the 5-entry catalog here.
// Edit both files together when adding presets.

import type { ModelTier } from './model-tier-spec';

export type PresetId =
  | 'casual_chat'
  | 'meeting'
  | 'medical_dictation'
  | 'live_caption'
  | 'sleep_mode';

export interface PresetSpec {
  id: PresetId;
  label: string;
  icon: string;
  description: string;
  tiers: {
    stt?: ModelTier;
    tts?: ModelTier;
    llm?: ModelTier;
  };
  ttsVoice?: {
    default?: string;
    chat?: string;
    digest?: string;
    alert?: string;
    discord?: string;
  };
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
