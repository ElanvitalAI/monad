// LLM Vision OCR provider — uses the active multimodal LLM (Anthropic
// Claude · OpenAI gpt-4o/gpt-5 · Gemini · Grok · local Qwen-VL/Gemma)
// as an OCR backend. Strengths over a dedicated OCR API:
//
//   - context-aware: understands what it sees (mixed text + diagrams,
//     handwriting, code blocks, low-quality scans). The model rewrites
//     ambiguous glyphs from semantic context — fewer "오" instead of
//     "오늘", fewer "1" instead of "I".
//   - diagrams: ASCII-arts a flowchart-friendly markdown for visual
//     content that traditional OCR drops or HTML-tables.
//   - markdown native: emits GFM markdown directly (no html → md
//     post-processing layer).
//
// Tradeoffs vs. Upstage:
//   - Cost: $0.005 - 0.05/image (depends on model · larger images more)
//     vs. Upstage's $0.01/page. Roughly comparable; LLM scales worse on
//     bulk PDF.
//   - Speed: 3-15s vs. Upstage's 1-3s. Acceptable for single-image
//     dogfood; not for batch.
//   - Determinism: lower (model temperature). Re-OCR may drift slightly.
//
// Routing: registry's `pick(requirements)` scores Upstage and this
// provider on the same axes. To prefer LLM Vision, callers pass
// `strengths: ['context-aware']` (or `'diagrams'`) — the +5 each adds
// 10+ points of signal over Upstage's `'korean'` strength alone.
//
// Cross-ref:
//   src/llm.ts (streamLLM · ContentBlock · LLMMessage)
//   src/llm-vision-capability.ts (isVisionCapableModel)
//   src/ocr/upstage.ts (sibling provider)
//   내부 문서 `ROADMAP-pwa-pre-ios-gap-2026-05-09` §R-OCR (R5)

import { OcrProvider, ocrFailure } from './provider.js';
import type {
  OcrCapabilities,
  OcrInput,
  OcrResult,
} from './types.js';
import { streamLLM, resolveDefaultProvider, stripLocalLlmSpec } from '../llm.js';
import type { LLMMessage } from '../llm.js';
import { isVisionCapableModel, type LlmBrand } from '../llm-vision-capability.js';

const DEFAULT_PROMPT = `You are an OCR assistant. Extract ALL visible text from the attached image and emit it as well-formed GitHub-flavored markdown:

- Preserve heading hierarchy (use # / ## / ### for visual hierarchy in the image).
- Tables → GFM markdown tables.
- Lists → markdown bullets (- ) or numbered (1. ) lists when the source uses them.
- Code blocks → fenced with the language hint when obvious.
- Diagrams / flowcharts → describe in markdown using indented bullets or a brief description.
- Preserve hangul, kanji, latin, numbers, punctuation faithfully. When a glyph is ambiguous, infer from context.
- Do NOT add explanatory commentary, summaries, or "Here is the extracted text:" preambles.
- Output ONLY the markdown body. No frontmatter, no fences around the whole document, no preamble, no postscript.`;

const DEFAULT_MAX_TOKENS = 4096;

export const LLM_VISION_CAPABILITIES: OcrCapabilities = {
  // Vision LLMs are language-agnostic at the model layer; '*' lets
  // the registry's pick() match any languageHint without penalty.
  languages: ['*', 'ko', 'en', 'ja', 'zh'],
  outputs: ['text', 'markdown'],
  inputs: ['image/*'],
  strengths: [
    'context-aware',
    'diagrams',
    'handwriting',
    'multilingual',
    'low-quality',
  ],
  // Mid-range cost estimate. Vision pricing varies per model; we tune
  // for the most common monad config (claude/gpt-5/gemini Pro family).
  // Used only as a tie-breaker in registry.pick().
  costPerPageUsd: 0.02,
  async: false,
  emitsConfidence: false,
};

interface LLMVisionProviderOpts {
  /** Override the prompt (default extracts faithfully). Tests use this
   *  to inject a deterministic prompt or to swap in domain-specific
   *  instructions ("preserve LaTeX", "highlight numbers", …). */
  prompt?: string;
  /** Override the max tokens budget. Default 4096 covers ~3 pages of
   *  dense text. */
  maxTokens?: number;
  /** Test seam — replace `streamLLM` with a deterministic stub. */
  llm?: typeof streamLLM;
}

async function bytesToBase64(file: Buffer | Uint8Array | Blob): Promise<string> {
  if (typeof Blob !== 'undefined' && file instanceof Blob) {
    const buf = await file.arrayBuffer();
    return Buffer.from(buf).toString('base64');
  }
  // Buffer extends Uint8Array so a single branch covers both.
  return Buffer.from(file as Uint8Array).toString('base64');
}

/** Map a `LLMProvider.name` to the `LlmBrand` shape that
 *  `isVisionCapableModel` expects. The provider names today are
 *  identical to the LlmBrand values (see `src/llm.ts` providers); this
 *  helper keeps the cast explicit so a future rename surfaces here
 *  rather than as a silent `false`. */
function providerNameToBrand(name: string): LlmBrand | null {
  const known: readonly LlmBrand[] = ['anthropic', 'openai', 'openai-codex', 'grok', 'gemini', 'local', 'openrouter'];
  return known.includes(name as LlmBrand) ? (name as LlmBrand) : null;
}

export class LLMVisionProvider extends OcrProvider {
  readonly name = 'llm-vision';
  readonly capabilities = LLM_VISION_CAPABILITIES;

  constructor(private readonly opts: LLMVisionProviderOpts = {}) { super(); }

  /** Available when the resolved default provider + model accept image
   *  bytes in user messages. Conservative — when we can't determine
   *  capability, return false so the registry picks Upstage. */
  isAvailable(): boolean {
    try {
      const provider = resolveDefaultProvider();
      if (!provider.available()) return false;
      const brand = providerNameToBrand(provider.name);
      if (!brand) return false;
      // `provider.defaultModel` may carry a 'local-llm:<base>:' prefix
      // when the user configured a local model. The vision-capability
      // matcher expects the bare model id ('mlx-community/gemma-4-...'
      // / 'qwen3-vl-...') so strip the wrapper before lookup.
      const model = stripLocalLlmSpec(provider.defaultModel);
      return isVisionCapableModel(brand, model, 'userMessage');
    } catch {
      return false;
    }
  }

  async run(input: OcrInput): Promise<OcrResult> {
    const mime = input.mimeType ?? '';
    if (mime && !mime.toLowerCase().startsWith('image/')) {
      return ocrFailure(this.name, 'unsupported', `mime ${mime} not supported by LLMVisionProvider (image/* only)`);
    }
    let base64: string;
    try {
      base64 = await bytesToBase64(input.file);
    } catch (e) {
      return ocrFailure(this.name, 'parse', `base64 encode failed: ${(e as Error).message}`);
    }

    const prompt = this.opts.prompt ?? DEFAULT_PROMPT;
    const maxTokens = this.opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    const llm = this.opts.llm ?? streamLLM;

    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'image', mediaType: mime || 'image/jpeg', base64 },
          { type: 'text', text: prompt },
        ],
      },
    ];

    let markdown: string;
    try {
      markdown = await llm(messages, () => { /* no-op · we want the final string */ }, {
        maxTokens,
      });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      // Map the most common failure modes to standard OcrFailure stages.
      if (/auth|unauthor|api[\s-]?key/i.test(msg)) {
        return ocrFailure(this.name, 'auth', `LLM auth failed: ${msg}`);
      }
      if (/network|fetch|ENOTFOUND|ECONNREFUSED/i.test(msg)) {
        return ocrFailure(this.name, 'network', `LLM network error: ${msg}`);
      }
      return ocrFailure(this.name, 'http', `LLM call failed: ${msg}`);
    }

    return {
      ok: true,
      provider: this.name,
      text: markdown,
      markdown,
      html: '',
      raw: { provider: 'llm-vision', maxTokens },
    };
  }
}
