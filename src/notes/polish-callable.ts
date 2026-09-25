// R-OCR.1.4 follow-up (2026-05-09) — production polish callable.
//
// Wraps streamLLM with a vision-LLM-backed prompt that takes the
// raw OCR markdown + the original image and returns a polished
// markdown:
//   - typo fix (OCR mis-glyphs corrected from semantic context)
//   - structure normalize (heading hierarchy · list bullets ·
//     consistent indentation)
//   - concise summary tag at top (optional)
//
// Production caller (runNexus) wires this via
//   notesFromImage: { polish: createNotesPolishCallable() }
// so polishMode='enrich' actually polishes (vs the silent
// degrade-to-minimal that landed in the original R-OCR.1).
//
// Cross-ref:
//   src/nexus/api/notes-from-image.ts (PolishCallable type · consumer)
//   src/ocr/llm-vision.ts (sibling — same streamLLM-with-image pattern)
//   내부 문서 `ROADMAP-pwa-pre-ios-gap-2026-05-09` §R-OCR.1.4

import { streamLLM, resolveDefaultProvider, stripLocalLlmSpec } from '../llm.js';
import type { LLMMessage } from '../llm.js';
import { isVisionCapableModel, type LlmBrand } from '../llm-vision-capability.js';
import type { PolishCallable, PolishImage } from '../nexus/api/notes-from-image.js';

const DEFAULT_PROMPT = `다음은 OCR 도구가 추출한 markdown 본문이야. 그리고 원본 이미지도 첨부했어.
원본 이미지를 참고해서 다음을 수정한 polished markdown 을 출력해줘:

1. OCR 오인식으로 보이는 글자를 문맥상 자연스럽게 보정 (특히 한글/한자/영문 혼재 시).
2. 헤딩 계층, 리스트, 표 구조를 markdown 으로 일관되게 정리.
3. 빈 줄·들여쓰기 normalize.
4. 본문 위에 한 줄 요약 (## 또는 그 위 헤딩 한 줄) 추가.

출력은 polished markdown 만. 설명 / preamble / "Here is the polished markdown:" / fences 없이 순수 markdown body 만.`;

const DEFAULT_MAX_TOKENS = 4096;

interface FactoryOpts {
  /** Override the prompt. */
  prompt?: string;
  /** Override the max tokens budget. Default 4096 covers ~3 pages
   *  of dense markdown with summary. */
  maxTokens?: number;
  /** Test seam — replace `streamLLM` with a stub. */
  llm?: typeof streamLLM;
  /** Test seam — override the default provider/model resolver to
   *  bypass the env-dependent vision-capability check. */
  resolveProvider?: () => { name: string; defaultModel: string; available(): boolean };
}

function providerNameToBrand(name: string): LlmBrand | null {
  const known: readonly LlmBrand[] = ['anthropic', 'openai', 'openai-codex', 'grok', 'gemini', 'local', 'openrouter'];
  return known.includes(name as LlmBrand) ? (name as LlmBrand) : null;
}

/** Returns true when the active default LLM provider/model can
 *  receive image bytes in user messages. The notes-from-image
 *  handler can use this to skip building the polish path entirely
 *  (instead of building the message + getting a 400 from the
 *  provider). */
export function isVisionPolishAvailable(opts: Pick<FactoryOpts, 'resolveProvider'> = {}): boolean {
  try {
    const provider = (opts.resolveProvider ?? resolveDefaultProvider)();
    if (!provider.available()) return false;
    const brand = providerNameToBrand(provider.name);
    if (!brand) return false;
    return isVisionCapableModel(brand, stripLocalLlmSpec(provider.defaultModel), 'userMessage');
  } catch {
    return false;
  }
}

/** Build a PolishCallable that invokes the active multimodal LLM
 *  (Claude · gpt-5 · Gemini · Grok · local Qwen-VL / Gemma 4) with
 *  the raw markdown + image. Throws when:
 *   - no vision-capable provider available (caller catches → degrade)
 *   - the LLM returns an empty / whitespace-only string
 *
 *  The handler in `notes-from-image.ts` already swallows polish
 *  exceptions and falls back to raw markdown with usedLlmPolish=false,
 *  so any throw here surfaces as a clean degrade. */
export function createNotesPolishCallable(opts: FactoryOpts = {}): PolishCallable {
  const llm = opts.llm ?? streamLLM;
  const prompt = opts.prompt ?? DEFAULT_PROMPT;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const resolveProvider = opts.resolveProvider;

  return async (input: { rawMarkdown: string; image: PolishImage; language?: string }): Promise<string> => {
    if (!isVisionPolishAvailable(resolveProvider ? { resolveProvider } : {})) {
      throw new Error('vision_polish_unavailable: default LLM provider/model not vision-capable');
    }
    if (!input.image.base64 || input.image.base64.length === 0) {
      throw new Error('polish_empty_image: no image bytes provided');
    }

    const userText = [
      prompt,
      input.language ? `\n\n언어 hint: ${input.language}` : '',
      `\n\n=== OCR raw markdown ===\n${input.rawMarkdown.trim() || '(empty)'}`,
    ].join('');

    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'image', mediaType: input.image.mediaType, base64: input.image.base64 },
          { type: 'text', text: userText },
        ],
      },
    ];

    const polished = await llm(messages, () => { /* no-op · need final string */ }, {
      maxTokens,
    });
    if (!polished || polished.trim().length === 0) {
      throw new Error('polish_empty_response: LLM returned no content');
    }
    return polished;
  };
}
