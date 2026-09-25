// M2-2 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 2) —
// TTS tier → provider+model mapping.
//
// Slider tiers (PLAN §5):
//
//   Budget   = macos-say · $0/char · offline · default for casual sleep
//   Balanced = openai-tts · $0.000015/char · cloud default
//   Better   = openai-tts-hd · $0.000030/char · higher fidelity
//   Best     = ElevenLabs eleven_flash_v2_5 · ~75ms latency · 32 languages
//   Loaded   = ElevenLabs eleven_multilingual_v2 · long-form fidelity ·
//              or eleven_v3 (multi-speaker · most expressive · 70+ lang)
//
// Voice ID (Phase 2 M2-2b) is a separate axis. This map only chooses
// the *model* (quality). The Voice ID picker lives in its own card
// and writes to modelTier.voice.tts_voice — orthogonal to this tier.

import type { VoiceCostId } from '../models/voice-costs.js';
import { VOICE_COSTS } from '../models/voice-costs.js';
import type { ModelTier } from './types.js';

export interface TtsTierSpec {
  /** Provider id ("openai-tts" / "elevenlabs-tts" / "edge-tts" / "macos-say"). */
  provider: 'openai-tts' | 'elevenlabs-tts' | 'edge-tts' | 'macos-say';
  /** Provider-side model id (forwarded to TTS provider config). */
  model: string;
  /** Key into VOICE_COSTS — used by cost projection. */
  costId: VoiceCostId;
  /** Title-cased label for slider tooltip. */
  label: string;
  /** One-liner shown on the active row. */
  rationale: string;
  /** USD per character (synced with VOICE_COSTS by module-load guard). */
  usdPerCharacter: number;
  /** `shipping` = wired end-to-end · `wip` = referenced but provider
   *  setup needed (e.g. ElevenLabs api key, edge-tts binary). */
  status: 'shipping' | 'wip';
}

export const TTS_TIER_MAP: Readonly<Record<ModelTier, TtsTierSpec>> = {
  budget: {
    provider: 'macos-say',
    model: 'system',
    costId: 'macos-say',
    label: 'macOS say (local)',
    rationale: 'Free · offline · macOS only',
    usdPerCharacter: 0,
    status: 'shipping',
  },
  balanced: {
    provider: 'openai-tts',
    model: 'tts-1',
    costId: 'openai-tts',
    label: 'OpenAI TTS',
    rationale: 'Default · $15/M chars · multi-voice',
    usdPerCharacter: 0.0000150,
    status: 'shipping',
  },
  better: {
    provider: 'openai-tts',
    model: 'tts-1-hd',
    costId: 'openai-tts-hd',
    label: 'OpenAI TTS HD',
    rationale: 'Higher fidelity · $30/M chars',
    usdPerCharacter: 0.0000300,
    status: 'shipping',
  },
  best: {
    provider: 'elevenlabs-tts',
    model: 'eleven_flash_v2_5',
    costId: 'elevenlabs-tts-flash-v2.5',
    label: 'ElevenLabs Flash v2.5',
    rationale: 'Best · ~75ms latency · 32 langs · $20/M chars',
    usdPerCharacter: 0.0000200,
    status: 'shipping',
  },
  loaded: {
    provider: 'elevenlabs-tts',
    model: 'eleven_multilingual_v2',
    costId: 'elevenlabs-tts-flash-v2.5', // pricing tier shared until VOICE_COSTS entry added
    label: 'ElevenLabs Multilingual v2',
    rationale: 'Loaded · long-form fidelity · 29 langs · ~$20/M chars',
    usdPerCharacter: 0.0000200,
    status: 'shipping',
  },
};

/** Project monthly USD given a daily char volume estimate. Pure. */
export function projectTtsMonthlyCost(
  tier: ModelTier,
  charsPerDay: number,
): number {
  if (!Number.isFinite(charsPerDay) || charsPerDay <= 0) return 0;
  return charsPerDay * 30 * TTS_TIER_MAP[tier].usdPerCharacter;
}

// Module-load guard — fail fast in dev if VOICE_COSTS drifts from the
// tier-map's usdPerCharacter mirror.
(function assertTtsCostMirror() {
  for (const tier of Object.keys(TTS_TIER_MAP) as ModelTier[]) {
    const spec = TTS_TIER_MAP[tier];
    if (spec.usdPerCharacter === 0) continue;
    const cost = VOICE_COSTS[spec.costId];
    if (cost.kind !== 'tts') {
      throw new Error(`tts-tier-map: ${tier} costId ${spec.costId} is not a TTS entry`);
    }
    if (Math.abs(cost.usdPerCharacter - spec.usdPerCharacter) > 1e-12) {
      throw new Error(
        `tts-tier-map: ${tier} usdPerCharacter ${spec.usdPerCharacter} drifted from `
        + `VOICE_COSTS[${spec.costId}] ${cost.usdPerCharacter}`,
      );
    }
  }
})();
