// OCR module — shared types.
//
// The provider abstraction is capability-driven: each concrete
// provider declares what it can do (languages · output formats ·
// strengths · cost), and the registry's `pick(requirements)` walks
// available providers scoring how well each matches the caller's
// needs. Adding a new provider (Tesseract.js · Apple VisionKit ·
// Google Cloud Vision · Naver CLOVA · LLM Vision) becomes a single
// file: extend `OcrProvider`, declare capabilities, implement
// `run`. No registry / dispatcher edits needed.

/** Output format the OCR provider can return. The registry uses
 *  these to satisfy a caller's `requirements.outputs` set. */
export type OcrOutput =
  | 'text'        // plain concatenated text
  | 'markdown'    // GFM markdown (headers · bullets · tables)
  | 'html'        // semantic HTML (when the provider preserves it)
  | 'layout'      // page → element tree (paragraphs · regions)
  | 'tables'      // structured tables (rows × cols)
  | 'bboxes'      // word-level bounding boxes
  | 'confidence'; // per-word or per-element confidence scores

/** Common strength a provider is known to handle better than
 *  baseline. The registry boosts a provider's score when the
 *  caller's `requirements.strengths` overlap. */
export type OcrStrength =
  | 'handwriting'    // 손글씨
  | 'tables'         // table layout preservation
  | 'korean'         // Hangul / Hanja
  | 'chinese'        // Hanzi / Kanji
  | 'multilingual'   // language-agnostic auto-detect
  | 'forms'          // key-value extraction
  | 'low-quality'    // noisy / rotated / blurry scans
  | 'pdf-multipage'  // large PDFs
  | 'free'           // no API cost
  | 'offline'        // runs without network (browser / local)
  | 'context-aware'  // understands meaning + structure (LLM Vision)
  | 'diagrams';      // diagrams · flowcharts · mixed-media (LLM Vision)

/** Input mime type prefix the provider accepts. `'*'` = anything. */
export type OcrInputType = 'image/*' | 'application/pdf' | '*' | string;

export interface OcrCapabilities {
  /** ISO-639 language codes the provider can recognize.
   *  `'*'` = auto-detect / language-agnostic. */
  readonly languages: readonly string[];
  /** Output formats the provider can emit. */
  readonly outputs: readonly OcrOutput[];
  /** Input mime prefixes the provider accepts. */
  readonly inputs: readonly OcrInputType[];
  /** Strengths over baseline OCR. */
  readonly strengths: readonly OcrStrength[];
  /** Approx cost per page in USD. 0 = free. Used as a tie-breaker
   *  when match scores are equal. */
  readonly costPerPageUsd: number;
  /** True when the provider supports an async / batch endpoint for
   *  large inputs (typically multi-page PDF). */
  readonly async?: boolean;
  /** True when the provider returns explicit confidence scores. */
  readonly emitsConfidence?: boolean;
}

/** Caller request shape. Same surface across providers; provider-
 *  specific tuning rides in `providerOpts`. */
export interface OcrInput {
  /** File blob to process. Buffer / Uint8Array / Blob — the
   *  provider normalizes. */
  file: Buffer | Uint8Array | Blob;
  /** Original filename (the multipart `filename=` field; some
   *  providers parse the extension to pick a parser). */
  filename: string;
  /** Mime type. Defaults to `application/octet-stream`. */
  mimeType?: string;
  /** Caller's preferred output. The provider returns its best
   *  approximation when the format isn't native. */
  preferredOutput?: 'text' | 'markdown' | 'html';
  /** Optional language hint (ISO-639). Empty / undefined = auto. */
  languageHint?: string;
  /** Test seam — replace global fetch (only relevant for network-
   *  bound providers like Upstage). */
  fetchImpl?: typeof fetch;
  /** Provider-specific escape hatch. Each provider documents its
   *  accepted shape; callers usually leave this empty. */
  providerOpts?: Record<string, unknown>;
}

/** Standardized success result. Empty strings for fields the
 *  provider didn't emit, never `undefined` — callers can switch on
 *  `.length` without nullable guards. */
export interface OcrSuccess {
  ok: true;
  /** Which provider ran. Useful for observability + telemetry. */
  provider: string;
  text: string;
  markdown: string;
  html: string;
  /** Provider-specific full payload (layout · bboxes · scores). */
  raw: Record<string, unknown>;
}

/** Standardized failure result. Same `stage` discriminator across
 *  providers so callers branch once. */
export interface OcrFailure {
  ok: false;
  provider: string;
  /** Where the failure happened. `unsupported` = the provider
   *  doesn't support the input shape (e.g. PDF on an image-only
   *  provider). */
  stage: 'auth' | 'network' | 'http' | 'parse' | 'unsupported' | 'unavailable';
  status?: number;
  message: string;
}

export type OcrResult = OcrSuccess | OcrFailure;

/** Caller's selection criteria for `OcrRegistry.pick`. Partial — the
 *  registry scores providers based on overlap; missing fields don't
 *  penalize. */
export interface OcrRequirements {
  outputs?: readonly OcrOutput[];
  strengths?: readonly OcrStrength[];
  languages?: readonly string[];
  inputs?: readonly OcrInputType[];
  /** Hard cost ceiling per page (USD). Providers above this are
   *  filtered out entirely (not just penalized). */
  maxCostPerPageUsd?: number;
  /** When true, only providers with `async=true` qualify. */
  requireAsync?: boolean;
}
