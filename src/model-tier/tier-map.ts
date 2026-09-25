// M1-1 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 1) —
// STT tier → concrete provider + model mapping.
//
// Each tier resolves to a (provider, model, costId) triple plus the
// short rationale strings the slider/CLI surface to the user. The
// `usdPerMinAudio` field is duplicated from `VOICE_COSTS` for inline
// preview — a test (`tier-map.test.ts`) keeps the two in sync so price
// edits in `voice-costs.ts` can't silently drift.
//
// Slider shape (PLAN §3.2):
//
//   Budget       Balanced     Better            Best                Loaded
//     │             │            │                 │                   │
//   whisper-cpp  gpt-4o-mini   gpt-4o-trans     gpt-realtime         gpt-realtime
//   (local · 0)  -transcribe   cribe            -whisper              -whisper +
//                $0.003/min    $0.006/min       $0.017/min            logprobs + ts
//                                                                     (~+50% bill)
//
// `budget` is intentionally local-first (WIP — `whisper-cpp-local`
// provider isn't shipping a daemon-mode binary install yet; the
// resolver returns `status: 'wip'` so UI can grey out / advise install).
// When a user picks `budget` today, callers may fall back to the
// previous tick at runtime — but the tier vocabulary itself is correct.
//
// `loaded` shares the `best` cost id today; the +logprobs/+timestamps
// surcharge ($0.025/min in PLAN) is a request-option add-on tracked in
// `loadedExtraUsdPerMin`. When OpenAI publishes a discrete SKU we'll
// promote it to its own VOICE_COSTS entry.

import type { VoiceCostId } from '../models/voice-costs.js';
import { VOICE_COSTS } from '../models/voice-costs.js';
import type { StreamingSTTProviderId } from '../voice/streaming-stt/streaming-stt-provider.js';
import type { ModelTier } from './types.js';

// ── Per-tier spec ──────────────────────────────────────────────────

export interface SttTierSpec {
  /** Streaming provider id (matches `StreamingSTTProviderId`). */
  provider: StreamingSTTProviderId;
  /** Provider-side model id (`gpt-4o-mini-transcribe`, `gpt-realtime-whisper`,
   *  ...). Pushed verbatim to `session.audio.input.transcription.model`. */
  model: string;
  /** Key into `VOICE_COSTS` — used by cost-tracker + cost-estimate. */
  costId: VoiceCostId;
  /** Title-cased label shown next to the slider tick. */
  label: string;
  /** One-line strength shown in the hover tooltip / CLI status row. */
  rationale: string;
  /** Cents-per-audio-minute mirror of VOICE_COSTS — kept in sync by test. */
  usdPerMinAudio: number;
  /** Add-on USD/min from request-level extras (loaded tier surcharge).
   *  Zero when the tier doesn't enable extras. */
  loadedExtraUsdPerMin: number;
  /** `shipping` = wired end-to-end today · `wip` = referenced but the
   *  provider isn't installable yet (UI may suggest install steps).
   *  `budget` is `wip` today (whisper.cpp local binary not bundled). */
  status: 'shipping' | 'wip';
}

// ── STT map ────────────────────────────────────────────────────────

export const STT_TIER_MAP: Readonly<Record<ModelTier, SttTierSpec>> = {
  budget: {
    provider: 'whisper-cpp-local',
    model: 'whisper.cpp',
    // No dedicated voice-costs entry for local — gpt-4o-mini-transcribe
    // is the closest fallback when the binary is missing and the
    // resolver downgrades to the streaming provider. The estimator uses
    // `usdPerMinAudio: 0` so the projection still treats Budget as free.
    costId: 'gpt-4o-mini-transcribe',
    label: 'Local (whisper.cpp)',
    rationale: 'Offline · $0/min · install local whisper.cpp first',
    usdPerMinAudio: 0,
    loadedExtraUsdPerMin: 0,
    status: 'wip',
  },
  balanced: {
    provider: 'openai-realtime-stt',
    model: 'gpt-4o-mini-transcribe',
    costId: 'gpt-4o-mini-transcribe',
    label: 'OpenAI mini transcribe',
    rationale: 'Sensible default · streaming · $0.003/min',
    usdPerMinAudio: 0.003,
    loadedExtraUsdPerMin: 0,
    status: 'shipping',
  },
  better: {
    provider: 'openai-realtime-stt',
    model: 'gpt-4o-transcribe',
    costId: 'gpt-4o-transcribe',
    label: 'OpenAI gpt-4o transcribe',
    rationale: 'Higher accuracy · still streaming · $0.006/min',
    usdPerMinAudio: 0.006,
    loadedExtraUsdPerMin: 0,
    status: 'shipping',
  },
  best: {
    provider: 'openai-realtime-stt',
    model: 'gpt-realtime-whisper',
    costId: 'gpt-realtime-whisper',
    label: 'OpenAI gpt-realtime-whisper',
    rationale: 'Best accuracy · domain adaptation · $0.017/min',
    usdPerMinAudio: 0.017,
    loadedExtraUsdPerMin: 0,
    status: 'shipping',
  },
  loaded: {
    provider: 'openai-realtime-stt',
    model: 'gpt-realtime-whisper',
    costId: 'gpt-realtime-whisper',
    label: 'OpenAI gpt-realtime-whisper · loaded',
    rationale: 'Loaded · logprobs + timestamps + tightest latency · ~$0.025/min',
    usdPerMinAudio: 0.017,
    // PLAN slider example puts the loaded surcharge at +$0.008/min
    // (0.017 → 0.025). Tracked here until OpenAI publishes a discrete
    // SKU we can fold into VOICE_COSTS.
    loadedExtraUsdPerMin: 0.008,
    status: 'shipping',
  },
} as const;

/** Effective USD/audio-min for a tier (base + loaded surcharge). */
export function sttTierEffectiveUsdPerMin(tier: ModelTier): number {
  const spec = STT_TIER_MAP[tier];
  return spec.usdPerMinAudio + spec.loadedExtraUsdPerMin;
}

// ── Invariant guards (cheap · evaluated at module load) ────────────

// Every non-local tier's `usdPerMinAudio` must equal the value in
// VOICE_COSTS. The unit test enforces this; this assert is the
// development-time safety net.
(function assertCostMirror() {
  for (const tier of Object.keys(STT_TIER_MAP) as ModelTier[]) {
    const spec = STT_TIER_MAP[tier];
    if (spec.usdPerMinAudio === 0) continue;
    const cost = VOICE_COSTS[spec.costId];
    if (cost.kind !== 'stt') {
      throw new Error(`tier-map: ${tier} costId ${spec.costId} is not an STT entry`);
    }
    if (Math.abs(cost.usdPerMinAudio - spec.usdPerMinAudio) > 1e-9) {
      throw new Error(
        `tier-map: ${tier} usdPerMinAudio ${spec.usdPerMinAudio} drifted from `
        + `VOICE_COSTS[${spec.costId}] ${cost.usdPerMinAudio}`,
      );
    }
  }
})();
