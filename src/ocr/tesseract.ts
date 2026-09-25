// Tesseract OCR — offline / free fallback provider built on the
// `tesseract.js` WASM port of the upstream Tesseract engine.
//
// Why optional: tesseract.js ships ~15 MB of WASM + language data
// per recognized language (e.g. `eng.traineddata` ~13 MB). Forcing it
// into every monad-agent install would balloon the install footprint
// for users who never run offline OCR. So it's loaded lazily at
// runtime and the provider's `isAvailable()` returns false when the
// module isn't installed.
//
// Enable on a host:
//   bun add tesseract.js
//   # then any OcrRegistry.pick({strengths:['offline']}) will route
//   # to this provider when Upstage is unavailable or excluded.
//
// Cross-ref:
//   src/ocr/provider.ts — OcrProvider base class + scoring
//   src/ocr/index.ts    — bootDefaultOcrProviders() registers this
//   내부 문서 `BACKLOG-showroom-cv-3-post-dm-stage-4-2026-05-09` (C3)

import { OcrProvider, ocrFailure } from './provider.js';
import type { OcrCapabilities, OcrInput, OcrResult } from './types.js';

/** Tesseract follows ISO-639-2/T 3-letter codes joined with `+`
 *  (e.g. `'eng+kor'`). The provider accepts caller `languageHint`
 *  values in either 2-letter (`'ko'`) or 3-letter (`'kor'`) form
 *  and maps them. `'*'` in capabilities means auto-detect is *not*
 *  supported (Tesseract requires an explicit language list); the
 *  registry still scores us as a multilingual provider via the
 *  declared language list below. */
const ISO2_TO_ISO3: Record<string, string> = {
  en: 'eng',
  ko: 'kor',
  ja: 'jpn',
  'zh-cn': 'chi_sim',
  'zh-tw': 'chi_tra',
  zh: 'chi_sim',
  de: 'deu',
  fr: 'fra',
  es: 'spa',
  it: 'ita',
  pt: 'por',
  ru: 'rus',
};

export const TESSERACT_CAPABILITIES: OcrCapabilities = {
  // Subset of the 100+ traineddata Tesseract ships; biased toward the
  // languages monad-agent users have shipped photos in. Tesseract
  // happily handles others when invoked with the right code; declare
  // the common cases so the registry's language match scores cleanly.
  languages: ['eng', 'kor', 'jpn', 'chi_sim', 'chi_tra', 'deu', 'fra', 'spa'],
  outputs: ['text', 'confidence'],
  inputs: ['image/*'],
  strengths: ['offline', 'free', 'multilingual'],
  // Zero per-page cost — that's the whole reason this provider
  // exists. The registry's cost-penalty scoring will pick this over
  // any paid provider when the caller doesn't explicitly require a
  // strength only the paid one has.
  costPerPageUsd: 0,
  emitsConfidence: true,
};

/** Minimal contract the provider needs from a tesseract.js install.
 *  Implementations can stub this in tests without pulling the real
 *  WASM module (which is heavy + slow to boot). */
export interface TesseractRecognizer {
  (
    input: Buffer | Uint8Array | Blob,
    language: string,
  ): Promise<{ text: string; confidence?: number }>;
}

export interface TesseractProviderOpts {
  /** Test seam — inject a fake recognizer so tests don't need the
   *  tesseract.js WASM module installed. Production callers leave
   *  this empty; the provider lazy-loads `tesseract.js` on first
   *  `isAvailable()` invocation. */
  recognize?: TesseractRecognizer;
  /** Default Tesseract language list (3-letter ISO codes joined with
   *  `+`). Used when the caller doesn't supply `languageHint`.
   *  Defaults to `'eng+kor'` since that covers the bulk of user
   *  intake photos. */
  defaultLanguage?: string;
}

/** Lazy-loaded singleton so we only attempt the import once per
 *  process. `undefined` = not yet probed · `null` = probed + missing
 *  · function = available. */
let cachedRecognizer: TesseractRecognizer | null | undefined;

async function loadTesseractRecognizer(): Promise<TesseractRecognizer | null> {
  if (cachedRecognizer !== undefined) return cachedRecognizer;
  try {
    const moduleName = 'tesseract.js';
    const mod = await (import(moduleName) as Promise<{
      recognize: (img: unknown, lang: string) => Promise<{
        data: { text?: string; confidence?: number };
      }>;
    }>);
    cachedRecognizer = async (input, language) => {
      const ret = await mod.recognize(input, language);
      return {
        text: ret?.data?.text ?? '',
        confidence: ret?.data?.confidence,
      };
    };
  } catch {
    cachedRecognizer = null;
  }
  return cachedRecognizer;
}

/** Test seam — reset the lazy-load cache between unit tests so
 *  `isAvailable()` probes again. Not exported from index.ts. */
export function __resetTesseractCacheForTests(): void {
  cachedRecognizer = undefined;
}

function resolveLanguage(hint: string | undefined, defaultLang: string): string {
  if (!hint) return defaultLang;
  const lower = hint.toLowerCase();
  // Already-3-letter code (e.g. 'kor', 'chi_sim') — pass through.
  if (lower.length >= 3 && !ISO2_TO_ISO3[lower]) return hint;
  return ISO2_TO_ISO3[lower] ?? defaultLang;
}

export class TesseractProvider extends OcrProvider {
  readonly name = 'tesseract';
  readonly capabilities = TESSERACT_CAPABILITIES;

  private readonly injectedRecognizer: TesseractRecognizer | null;
  private readonly defaultLanguage: string;

  constructor(opts: TesseractProviderOpts = {}) {
    super();
    this.injectedRecognizer = opts.recognize ?? null;
    this.defaultLanguage = opts.defaultLanguage ?? 'eng+kor';
  }

  async isAvailable(): Promise<boolean> {
    if (this.injectedRecognizer) return true;
    return (await loadTesseractRecognizer()) !== null;
  }

  async run(input: OcrInput): Promise<OcrResult> {
    const mime = (input.mimeType ?? '').toLowerCase();
    if (mime && !mime.startsWith('image/')) {
      return ocrFailure(
        this.name,
        'unsupported',
        `tesseract.js only accepts image/* inputs, got mimeType=${mime}`,
      );
    }

    const recognize = this.injectedRecognizer ?? (await loadTesseractRecognizer());
    if (!recognize) {
      return ocrFailure(
        this.name,
        'unavailable',
        'tesseract.js is not installed — run `bun add tesseract.js` to enable offline OCR',
      );
    }

    const language = resolveLanguage(input.languageHint, this.defaultLanguage);
    try {
      const { text, confidence } = await recognize(input.file, language);
      const trimmed = (text ?? '').trim();
      return {
        ok: true,
        provider: this.name,
        text: trimmed,
        markdown: trimmed,  // plain text passes as Markdown
        html: '',
        raw: confidence !== undefined ? { confidence, language } : { language },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return ocrFailure(this.name, 'parse', `tesseract recognize failed: ${message}`);
    }
  }
}
