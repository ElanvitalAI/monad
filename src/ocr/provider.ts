// OCR provider — abstract base. Concrete providers (Upstage,
// Tesseract, Apple VisionKit, ...) extend this and declare their
// capabilities. The registry's pick() walks all available providers
// scoring how well each one matches a caller's requirements.

import type {
  OcrCapabilities,
  OcrInput,
  OcrRequirements,
  OcrResult,
} from './types.js';

/** Score weights — tuned so output-format match dominates (~10x
 *  cost penalty), strength match is secondary, language match is
 *  tertiary, and cost is a tie-breaker. The numbers are arbitrary
 *  but the *ratio* is the contract: format > strength > language >
 *  cost. Tests pin these so future tweaks don't silently change
 *  the picker's behavior. */
export const SCORE_WEIGHT_OUTPUT = 10;
export const SCORE_WEIGHT_STRENGTH = 5;
export const SCORE_WEIGHT_LANGUAGE = 3;
export const SCORE_WEIGHT_INPUT = 2;
/** Cost penalty: subtract `costPerPageUsd * COST_PENALTY_PER_USD`
 *  from the score. A $0.01 difference subtracts 1 point — the same
 *  as one missing language match — so a marginally cheaper provider
 *  with otherwise equal capabilities wins. */
export const COST_PENALTY_PER_USD = 100;

export abstract class OcrProvider {
  /** Stable identifier — used by `OcrResult.provider`, registry
   *  lookup, telemetry. Lowercase kebab-case. */
  abstract readonly name: string;

  /** Declarative capability surface. The registry reads this to
   *  score against caller requirements; providers should NOT make
   *  this dynamic (env-availability is a separate concern — see
   *  `isAvailable`). */
  abstract readonly capabilities: OcrCapabilities;

  /** Cheap availability check — usually env / dependency presence.
   *  Sync or async; the registry awaits the result. Providers that
   *  need a network probe should cache aggressively (one second per
   *  registry pass is plenty). */
  abstract isAvailable(): boolean | Promise<boolean>;

  /** Run OCR on a single input. Implementations should:
   *  - Validate the mime type against `capabilities.inputs`. Return
   *    `{ok:false, stage:'unsupported'}` for mismatches rather than
   *    throwing.
   *  - Map provider-native errors into the standard `stage` enum.
   *  - Always set `provider: this.name` on the result.
   *  - Default empty strings for output fields the provider doesn't
   *    emit (text='', markdown='', html='') so callers don't branch
   *    on undefined. */
  abstract run(input: OcrInput): Promise<OcrResult>;

  /** Score the provider's match against caller requirements. Higher
   *  = better; negative = poor fit. The base implementation walks
   *  the declarative capabilities; subclasses rarely need to
   *  override. Returns `null` when a hard filter (cost ceiling /
   *  required async) excludes the provider entirely. */
  matchScore(requirements: OcrRequirements): number | null {
    // Hard filters first.
    if (requirements.maxCostPerPageUsd !== undefined
      && this.capabilities.costPerPageUsd > requirements.maxCostPerPageUsd) {
      return null;
    }
    if (requirements.requireAsync && !this.capabilities.async) {
      return null;
    }

    let score = 0;

    if (requirements.outputs && requirements.outputs.length > 0) {
      const have = new Set(this.capabilities.outputs);
      for (const want of requirements.outputs) {
        if (have.has(want)) score += SCORE_WEIGHT_OUTPUT;
      }
    }
    if (requirements.strengths && requirements.strengths.length > 0) {
      const have = new Set(this.capabilities.strengths);
      for (const want of requirements.strengths) {
        if (have.has(want)) score += SCORE_WEIGHT_STRENGTH;
      }
    }
    if (requirements.languages && requirements.languages.length > 0) {
      const have = new Set(this.capabilities.languages);
      for (const want of requirements.languages) {
        if (have.has(want) || have.has('*')) score += SCORE_WEIGHT_LANGUAGE;
      }
    }
    if (requirements.inputs && requirements.inputs.length > 0) {
      const have = new Set(this.capabilities.inputs);
      for (const want of requirements.inputs) {
        if (have.has(want) || have.has('*')) score += SCORE_WEIGHT_INPUT;
      }
    }

    // Cost penalty — applies even when no requirement is set so a
    // free provider beats a paid one in the empty-requirements
    // fallback path.
    score -= this.capabilities.costPerPageUsd * COST_PENALTY_PER_USD;

    return score;
  }
}

/** Convenience helper for building consistent failure results
 *  inside provider implementations. */
export function ocrFailure(
  provider: string,
  stage: 'auth' | 'network' | 'http' | 'parse' | 'unsupported' | 'unavailable',
  message: string,
  status?: number,
): OcrResult {
  return status !== undefined
    ? { ok: false, provider, stage, status, message }
    : { ok: false, provider, stage, message };
}
