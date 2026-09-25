// OCR module — public surface.
//
// Architecture:
//   types.ts     — capability declarations + result shapes
//   provider.ts  — abstract OcrProvider class + scoring
//   registry.ts  — name → provider map · pick(requirements)
//   upstage.ts   — concrete UpstageProvider + low-level runUpstageOcr
//
// Adding a new provider (Tesseract · Apple VisionKit · Google Cloud
// Vision · LLM Vision · Naver CLOVA) = single new file extending
// OcrProvider; declare its capabilities, implement run(), register
// it. The registry/provider scoring already handles dispatch.

export type {
  OcrCapabilities,
  OcrInput,
  OcrOutput,
  OcrStrength,
  OcrInputType,
  OcrRequirements,
  OcrResult,
  OcrSuccess,
  OcrFailure,
} from './types.js';

export {
  OcrProvider,
  ocrFailure,
  SCORE_WEIGHT_OUTPUT,
  SCORE_WEIGHT_STRENGTH,
  SCORE_WEIGHT_LANGUAGE,
  SCORE_WEIGHT_INPUT,
  COST_PENALTY_PER_USD,
} from './provider.js';

export {
  OcrRegistry,
  getDefaultOcrRegistry,
  setDefaultOcrRegistry,
  type PickResult,
} from './registry.js';

// Concrete providers — re-exported so callers don't have to know
// the file layout.
export {
  UpstageProvider,
  UPSTAGE_CAPABILITIES,
  // Low-level imperative API (kept for callers that want to skip
  // the provider abstraction · matches the Python origin shape).
  runUpstageOcr,
  resolveUpstageApiKey,
  type UpstageOcrOpts,
  type UpstageOcrResult,
  type UpstageOcrSuccess,
  type UpstageOcrError,
  type UpstageModel,
  type ParseMode,
} from './upstage.js';

export { LLMVisionProvider, LLM_VISION_CAPABILITIES } from './llm-vision.js';

export {
  TesseractProvider,
  TESSERACT_CAPABILITIES,
  type TesseractRecognizer,
  type TesseractProviderOpts,
} from './tesseract.js';

import { OcrRegistry, getDefaultOcrRegistry } from './registry.js';
import { UpstageProvider } from './upstage.js';
import { LLMVisionProvider } from './llm-vision.js';
import { TesseractProvider } from './tesseract.js';

/** Boot the default registry with the production providers. Idempotent
 *  — calling more than once just re-registers (which overwrites by
 *  name so no duplicates accumulate). Production daemons call this
 *  once during `runNexus`; tests use their own registry instead.
 *
 *  Order matters only for tie-breaking when match-scores are equal:
 *  Upstage first wins on a generic photo (markdown output + korean
 *  strength), LLM Vision wins when the caller requests `'context-aware'`
 *  or `'diagrams'` (R-OCR.5), and Tesseract wins when `'offline'` or
 *  `'free'` is requested (C3 · 2026-05-11). Tesseract's `isAvailable()`
 *  returns false when `tesseract.js` isn't installed so registering it
 *  unconditionally is safe — the picker just skips it. */
export function bootDefaultOcrProviders(): OcrRegistry {
  const reg = getDefaultOcrRegistry();
  reg.register(new UpstageProvider());
  reg.register(new LLMVisionProvider());
  reg.register(new TesseractProvider());
  return reg;
}
