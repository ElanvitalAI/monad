// M3-3 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 3) —
// Natural-language tier switch detector + apply planner.
//
// Pillar 5 (PLAN §3.5 / §4.5) — user says "이번 회의는 의료 용어 많아"
// in chat · elanous detects the intent · proposes a preset/tier switch
// with cost preview · auto-reverts when the session ends.
//
// This file is split into three layers:
//   1. `detectTierIntentFromChat` — pure orchestrator over an injected
//      LlmRunner that returns one of:
//        - `apply-preset` (e.g. medical_dictation for next session)
//        - `increase-quality` (bump every voice surface one tick)
//        - `decrease-cost`   (drop every voice surface one tick)
//        - `none`            (nothing tier-related)
//      with a confirmation message the chat UI can echo verbatim.
//   2. `planNlTierSwitch` — turns the detection into a concrete apply
//      plan (which tier slots to overwrite · projected monthly cost
//      delta · suggested revert mode) without touching disk.
//   3. Both helpers are pure; the apply step (writing the override)
//      lives in `session-override.ts` so the timeline is testable in
//      isolation.

import {
  buildPresetSuggestMessages,
  type LlmRunner,
} from './preset-suggest-llm.js';
import {
  getPreset,
  type PresetId,
} from './preset-catalog.js';
import {
  MODEL_TIERS,
  modelTierRank,
  type ModelTier,
} from './types.js';

export type NlTierIntent =
  | 'apply-preset'
  | 'increase-quality'
  | 'decrease-cost'
  | 'none';

export interface NlTierDetection {
  intent: NlTierIntent;
  /** Populated when `intent = 'apply-preset'`. */
  preset?: PresetId;
  /** Populated when `intent = 'increase-quality' | 'decrease-cost'` —
   *  delta against the current surface tier (-2..+2). */
  tierDelta?: number;
  /** Human-readable rationale extracted from the model. */
  rationale: string;
  /** Source provenance — caller uses this for telemetry / UX badges. */
  source: 'llm' | 'fallback';
  /** Raw model reply (diagnostic only). */
  rawReply?: string;
}

const INTENT_VALUES: readonly NlTierIntent[] = [
  'apply-preset',
  'increase-quality',
  'decrease-cost',
  'none',
];

const VALID_PRESETS = new Set<string>([
  'casual_chat',
  'meeting',
  'medical_dictation',
  'live_caption',
  'sleep_mode',
]);

function isPresetId(v: unknown): v is PresetId {
  return typeof v === 'string' && VALID_PRESETS.has(v);
}

function isNlTierIntent(v: unknown): v is NlTierIntent {
  return typeof v === 'string' && (INTENT_VALUES as readonly string[]).includes(v);
}

export function buildNlTierIntentMessages(text: string): ReturnType<typeof buildPresetSuggestMessages> {
  return [
    {
      role: 'system',
      content: [
        'You decide whether the user\'s chat message is asking elanous to change voice / LLM tier settings.',
        'Respond with ONE single-line JSON object — no fences, no commentary.',
        '',
        'Schema:',
        '  {"intent": "<intent>", "preset": "<id or null>", "tierDelta": <-2..2 or null>, "rationale": "short string"}',
        '',
        'intent must be one of:',
        '  - "apply-preset"      — switch to a named use-case preset',
        '  - "increase-quality"  — bump tier up (more accurate / loaded)',
        '  - "decrease-cost"     — drop tier down (cheaper / budget)',
        '  - "none"              — message is not about model tier',
        '',
        'preset must be exactly one of (null when intent is not apply-preset):',
        '  casual_chat, meeting, medical_dictation, live_caption, sleep_mode',
        '',
        'tierDelta: integer in -2..+2 (positive = upgrade, negative = downgrade). Use null when intent is "apply-preset" or "none".',
        '',
        'Examples:',
        '  User: "정확도 더 높여줘"  → {"intent":"increase-quality","preset":null,"tierDelta":1,"rationale":"User wants higher accuracy."}',
        '  User: "이번 회의는 의료 용어 많아"   → {"intent":"apply-preset","preset":"medical_dictation","tierDelta":null,"rationale":"Medical/legal context."}',
        '  User: "비용 좀 줄여줘"   → {"intent":"decrease-cost","preset":null,"tierDelta":-1,"rationale":"User asked to reduce cost."}',
        '  User: "오늘 점심 뭐 먹지" → {"intent":"none","preset":null,"tierDelta":null,"rationale":"Unrelated to model selection."}',
      ].join('\n'),
    },
    { role: 'user', content: text },
  ];
}

/** Parse the LLM reply into an NlTierDetection. Tolerates code fences
 *  + leading prose + missing optional fields. Returns null on
 *  unrecoverable parse error. */
export function parseNlTierIntentReply(raw: string): NlTierDetection | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const stripped = raw.replace(/```(?:json)?/g, '').trim();
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(stripped.slice(first, last + 1)); }
  catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const r = parsed as Record<string, unknown>;
  if (!isNlTierIntent(r.intent)) return null;
  const detection: NlTierDetection = {
    intent: r.intent,
    rationale: typeof r.rationale === 'string' ? r.rationale : '',
    source: 'llm',
  };
  if (r.preset !== null && r.preset !== undefined) {
    if (!isPresetId(r.preset)) return null;
    detection.preset = r.preset;
  }
  if (r.tierDelta !== null && r.tierDelta !== undefined) {
    if (typeof r.tierDelta !== 'number' || !Number.isFinite(r.tierDelta)) return null;
    const clamped = Math.max(-2, Math.min(2, Math.round(r.tierDelta)));
    detection.tierDelta = clamped;
  }
  return detection;
}

export interface DetectTierIntentOpts {
  /** Hard wall-clock cap (ms). Default 5000. */
  timeoutMs?: number;
}

/** Run the LLM-backed detector. Failure → returns `{intent: 'none',
 *  source: 'fallback'}` so callers don't have to handle null. */
export async function detectTierIntentFromChat(
  text: string,
  runLlm: LlmRunner,
  opts: DetectTierIntentOpts = {},
): Promise<NlTierDetection> {
  const fallback: NlTierDetection = { intent: 'none', rationale: '', source: 'fallback' };
  if (typeof text !== 'string' || text.trim().length === 0) return fallback;
  let raw: string;
  try {
    raw = await withTimeout(runLlm(buildNlTierIntentMessages(text)), opts.timeoutMs ?? 5000);
  } catch { return fallback; }
  const parsed = parseNlTierIntentReply(raw);
  if (!parsed) return fallback;
  return { ...parsed, rawReply: raw };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('nl-tier-switch timeout')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e: unknown) => { clearTimeout(t); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}

// ── Plan layer — detection → apply plan ─────────────────────────────

export interface CurrentTierSlots {
  stt: ModelTier;
  llm: ModelTier;
  tts: ModelTier;
}

export interface NlTierApplyPlan {
  /** A no-op plan exists for intent='none' or when the proposed tier
   *  delta would push every surface off the scale. The chat hook
   *  short-circuits when this is true. */
  isNoop: boolean;
  /** Surfaces to overwrite — only fields the planner actually wants
   *  changed. Sparse so the override doesn't pin uninteresting slots. */
  apply: Partial<CurrentTierSlots>;
  /** Optional cap to drop with the preset (decision M7 cousins). */
  monthlyUsdCap?: number;
  /** The detection passed through so the chat hook can echo
   *  rationale. */
  detection: NlTierDetection;
  /** Suggested human-friendly confirmation message · ≥1 line · always
   *  populated (even for no-op so caller can show "OK · 이미 그 tier 입니다"). */
  confirmMessage: string;
}

/** Plan a tier switch given the detection + current resolved tiers.
 *  Pure function — no IO, no time-of-day logic. */
export function planNlTierSwitch(
  detection: NlTierDetection,
  current: CurrentTierSlots,
): NlTierApplyPlan {
  if (detection.intent === 'none') {
    return {
      isNoop: true,
      apply: {},
      detection,
      confirmMessage: 'No tier change detected.',
    };
  }
  if (detection.intent === 'apply-preset' && detection.preset) {
    const spec = getPreset(detection.preset);
    const apply: Partial<CurrentTierSlots> = {};
    if (spec.tiers.stt) apply.stt = spec.tiers.stt;
    if (spec.tiers.llm) apply.llm = spec.tiers.llm;
    if (spec.tiers.tts) apply.tts = spec.tiers.tts;
    return {
      isNoop: Object.keys(apply).length === 0,
      apply,
      ...(typeof spec.monthlyUsdCap === 'number' ? { monthlyUsdCap: spec.monthlyUsdCap } : {}),
      detection,
      confirmMessage:
        `OK · "${spec.label}" preset 으로 잠깐 전환할게요. 세션 끝나면 자동 복귀합니다.`,
    };
  }
  // increase-quality / decrease-cost — shift each surface by tierDelta.
  const delta = detection.tierDelta ?? (detection.intent === 'increase-quality' ? 1 : -1);
  const apply: Partial<CurrentTierSlots> = {};
  for (const surface of ['stt', 'llm', 'tts'] as const) {
    const cur = current[surface];
    const nextRank = modelTierRank(cur) + delta;
    if (nextRank < 0 || nextRank >= MODEL_TIERS.length) continue;
    const next = MODEL_TIERS[nextRank];
    if (next === cur) continue;
    apply[surface] = next;
  }
  const isNoop = Object.keys(apply).length === 0;
  const verb = detection.intent === 'increase-quality' ? '한 단계 정확도 ↑' : '한 단계 비용 ↓';
  return {
    isNoop,
    apply,
    detection,
    confirmMessage: isNoop
      ? '이미 한계 tier 라서 더 이상 이동할 곳이 없어요.'
      : `OK · STT/LLM/TTS 를 ${verb} 로 잠깐 전환할게요. 세션 끝나면 자동 복귀합니다.`,
  };
}
