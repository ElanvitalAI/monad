// NEXUS · notes-from-image endpoint (R-OCR.1).
//
// PWA `/chat` 카메라 → "Save as note" flow 의 server-side entrypoint.
// 사진 → OCR (capability-driven registry · default Upstage) → markdown
// skeleton → (옵션) LLM Vision polish → 사용자 review modal 로 반환.
//
// Endpoint shape
//   POST /v1/notes/from-image
//   Content-Type: multipart/form-data
//     image:        Blob          (required · image/* mime)
//     filename:     string        (optional · default 'image.bin')
//     polishMode:   'minimal'     (default · raw OCR markdown)
//                 | 'enrich'      (LLM Vision polish · typo / 구조 / tags)
//     language:     ISO-639       (optional · OCR language hint)
//
// Response (200)
//   {
//     ok:            true,
//     markdown:      string,      ← review modal 의 editable buffer
//     provider:      string,      ← 어느 OCR provider 가 돌았는지 (e.g. 'upstage')
//     polishMode:    'minimal' | 'enrich',
//     usedLlmPolish: boolean,     ← enrich 요청이 실제로 polish 됐는지 (실패 시 false)
//     costEstimate:  { ocrUsd: number, polishUsd: number }
//   }
//
// Decision history (HANDOFF 내부 문서)
//   D-1.4 → polishMode chooseable (default 'minimal'). enrich 은 LLM Vision
//          비용을 매번 부담시키지 않으면서 사용자 자율성 + cost control.
//   D-3   → save destination = knowledgeWrite (R-OCR.3). 본 엔드포인트는
//          markdown 만 반환 · 저장 자체는 별도 /v1/notes/save 가 담당.
//
// Lessons baked in
//   - feedback_post_route_must_be_in_method_block — http-server 라우팅이
//     `method !== 'GET'` 블록 안에 등록되어야 함 (R-OCR.1.2 책임).
//   - feedback_dep_inject_seam_must_be_wired — `opts.registry ??
//     getDefaultOcrRegistry()` fallback 만으로는 production 에서 wire 가
//     끊겨도 silently fallback 으로 작동. runNexus 가 명시 wire (R-OCR.1.3).
//
// Cross-ref:
//   src/ocr/index.ts (OcrRegistry · bootDefaultOcrProviders · UpstageProvider)
//   src/nexus/api/notification-action.ts (sibling handler 패턴)
//   내부 문서 `ROADMAP-pwa-pre-ios-gap-2026-05-09` §R-OCR.1

import type { OcrRegistry, OcrResult, OcrStrength } from '../../ocr/index.js';
import type { NotesMetricsCollector } from '../../notes/metrics.js';
import { debug } from '../../debug/log.js';

export type PolishMode = 'minimal' | 'enrich';

/** Image bytes + mime — what the polish callable receives. Decoupled
 *  from `LLMMessage` so tests don't need to construct full message
 *  arrays; the production wire is a thin adapter that builds the
 *  user message + calls streamLLM. */
export interface PolishImage {
  mediaType: string;
  base64: string;
}

/** LLM polish callable. Receives the OCR-raw markdown + the original
 *  image (for vision-capable models) and returns polished markdown.
 *  Production wires a streamLLM-backed adapter; tests pass a stub
 *  that returns deterministic text. Should throw on failure — the
 *  handler catches and degrades to passthrough (raw markdown). */
export type PolishCallable = (input: {
  rawMarkdown: string;
  image: PolishImage;
  language?: string;
}) => Promise<string>;

export interface NotesFromImageOpts {
  /** OCR provider registry. runNexus wires this from the default
   *  singleton after `bootDefaultOcrProviders()`. When omitted the
   *  endpoint returns 503 — explicit "not wired" rather than silent
   *  fallback (feedback_dep_inject_seam_must_be_wired lesson). */
  registry?: OcrRegistry;
  /** LLM Vision polish callable. When omitted, polishMode='enrich'
   *  silently degrades to 'minimal' (raw markdown) and the response
   *  carries `usedLlmPolish: false`. Production wires a streamLLM
   *  adapter; tests pass a stub. */
  polish?: PolishCallable;
  /** Auth check — same shape as sibling endpoints. PWA service
   *  worker POSTs without auth; production pairs this endpoint with
   *  a Tailscale-only listener. Tests pass undefined. */
  checkAuth?: (req: Request) => boolean;
  /** Wall-clock seam for tests. Defaults to Date.now. */
  now?: () => number;
  /** R-OCR.4 metric collector. When wired, every OCR request (success
   *  or failure) bumps the appropriate counter. Optional so tests
   *  can omit it entirely without breaking the handler. */
  metrics?: NotesMetricsCollector;
}

/** CORS headers for the PWA dev-mode cross-origin caller (apps/pwa
 *  served from `:3000` calling NEXUS on `:31415`). Same shape as
 *  sibling endpoints (`/v1/showroom/role-judge`, `/v1/audio/stt`) so
 *  the PWA dev fetch wrapper doesn't need per-endpoint CORS quirks. */
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-max-age': '600',
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

function badRequest(reason: string): Response {
  return jsonResponse({ ok: false, error: 'bad_request', reason }, 400);
}

/** Map OCR provider failure stages to HTTP status codes. Auth +
 *  unavailable → 503 (transient/config); unsupported → 415; the rest
 *  bubble as 502 (upstream issue). */
function statusForOcrStage(stage: 'auth' | 'network' | 'http' | 'parse' | 'unsupported' | 'unavailable'): number {
  if (stage === 'auth' || stage === 'unavailable') return 503;
  if (stage === 'unsupported') return 415;
  return 502;
}

/** Estimate OCR cost — uses the picked provider's declared
 *  costPerPageUsd. Camera intake = single page; multi-page PDF cost
 *  estimation is deferred until R-OCR ships PDF support. */
function estimateOcrCost(costPerPageUsd: number): number {
  // Round to 4 decimal places to keep the response stable across
  // floating-point noise (the registry already declares 0.01 / 0.0015
  // / 0.03 — none of which need higher precision).
  return Math.round(costPerPageUsd * 10_000) / 10_000;
}

/** Estimate LLM polish cost — placeholder. Real per-token billing
 *  needs the polish callable to surface usage; v1 returns 0 with
 *  `usedLlmPolish` carrying the boolean signal. The R-OCR.4 metrics
 *  arc replaces this with actual usage capture. */
function estimatePolishCost(_used: boolean): number {
  return 0;
}

/** Coerce body field `polishMode` to our union. Anything outside
 *  the allowed set falls back to 'minimal' (the safe default). */
function coercePolishMode(raw: FormDataEntryValue | null): PolishMode {
  if (raw === 'enrich') return 'enrich';
  return 'minimal';
}

/** POST /v1/notes/from-image — OCR a camera capture and return
 *  markdown ready for the review modal. */
export async function handleNotesFromImage(
  req: Request,
  opts: NotesFromImageOpts,
): Promise<Response> {
  // CORS preflight — return early before auth so the browser can
  // probe before sending credentials.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }

  const ct = req.headers.get('content-type') ?? '';
  if (!ct.startsWith('multipart/form-data')) {
    return badRequest('expected multipart/form-data');
  }

  // Dep-injection seam — feedback_dep_inject_seam_must_be_wired:
  // when runNexus forgets to wire the registry, return 503 explicitly
  // rather than silently lazy-init an empty default that would 404
  // every request after.
  if (!opts.registry) {
    return jsonResponse({ ok: false, error: 'ocr_registry_not_wired' }, 503);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return badRequest(`failed to parse multipart body: ${(err as Error).message}`);
  }

  const fileField = form.get('image');
  if (!(fileField instanceof Blob)) {
    return badRequest('image field must be a Blob');
  }
  // Empty Blob (size 0) — Upstage rejects with HTTP 400; surface as
  // bad_request before even calling out.
  if (fileField.size === 0) {
    return badRequest('image is empty');
  }

  const filenameField = form.get('filename');
  const filename = typeof filenameField === 'string' && filenameField.length > 0
    ? filenameField
    : (fileField instanceof File ? fileField.name : 'image.bin');

  const mimeType = fileField.type || 'application/octet-stream';

  const polishMode = coercePolishMode(form.get('polishMode'));

  const languageField = form.get('language');
  const language = typeof languageField === 'string' && languageField.length > 0
    ? languageField
    : undefined;

  // R-OCR.5 (2026-05-09) — caller-driven provider preference. The
  // multipart body's `strengths` field (comma-separated · e.g.
  // 'context-aware,diagrams') is appended to the registry's pick
  // requirements. Each match adds +5 to the matching provider's
  // score, so a 'context-aware' request shifts the pick from
  // Upstage (no overlap) to LLMVisionProvider (declares it). PWA
  // 'LLM 비전' toggle wires this on.
  const strengthsField = form.get('strengths');
  const callerStrengths = typeof strengthsField === 'string'
    ? strengthsField.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const baseStrengths = ['korean', ...callerStrengths] as readonly OcrStrength[];

  // Pick an OCR provider matching the camera-intake requirements:
  // markdown output (PWA review modal renders markdown directly) +
  // korean strength (primary user) + image input + caller-supplied
  // strengths (R-OCR.5 — 'context-aware' / 'diagrams' shift the pick
  // toward LLM Vision provider over Upstage).
  const picked = await opts.registry.pick({
    outputs: ['markdown'],
    strengths: baseStrengths,
    inputs: ['image/*'],
    ...(language ? { languages: [language] } : {}),
  });
  if (!picked) {
    return jsonResponse({ ok: false, error: 'no_ocr_provider_available' }, 503);
  }

  if (debug.enabled) {
    debug.log('notes-from-image.pick', picked.provider.name, {
      score: picked.score,
      ranking: picked.ranking.map((r) => ({ name: r.provider.name, score: r.score })),
      polishMode,
      callerStrengths,
      filename,
      mimeType,
      size: fileField.size,
    });
  }

  let ocrResult: OcrResult;
  try {
    ocrResult = await picked.provider.run({
      file: fileField,
      filename,
      mimeType,
      preferredOutput: 'markdown',
      ...(language ? { languageHint: language } : {}),
    });
  } catch (err) {
    opts.metrics?.recordOcr({ provider: picked.provider.name, polishMode, ok: false });
    return jsonResponse({
      ok: false,
      error: 'ocr_provider_threw',
      provider: picked.provider.name,
      reason: (err as Error).message ?? String(err),
    }, 502);
  }

  if (!ocrResult.ok) {
    opts.metrics?.recordOcr({ provider: ocrResult.provider, polishMode, ok: false });
    return jsonResponse({
      ok: false,
      error: 'ocr_failed',
      provider: ocrResult.provider,
      stage: ocrResult.stage,
      reason: ocrResult.message,
    }, statusForOcrStage(ocrResult.stage));
  }
  // Successful OCR — record before the polish step so 'ocr ran' and
  // 'polish ran' are tracked separately when polish is wired later.
  opts.metrics?.recordOcr({ provider: ocrResult.provider, polishMode, ok: true });
  // 2026-05-09 dogfood diagnostic — log the response shape so the
  // next "OCR 결과 없음" report has actual numbers (markdown chars,
  // text chars, html chars). The pick event alone left us guessing
  // whether the upstream succeeded at all.
  if (debug.enabled) {
    debug.log('notes-from-image.ocr.ok', ocrResult.provider, {
      polishMode,
      markdownChars: ocrResult.markdown.length,
      textChars: ocrResult.text.length,
      htmlChars: ocrResult.html.length,
    });
  }

  // Markdown fallback: prefer markdown → text → html-stripped (last
  // resort). 2026-05-09 dogfood discovered that Upstage `document-
  // parse` returns HTML-only when `output_formats` isn't set; even
  // after that fix, defense-in-depth here protects against future
  // providers that emit only HTML or text. The HTML strip is
  // intentionally simple — most camera notes have flat content.
  let rawMarkdown = ocrResult.markdown;
  if (rawMarkdown.length === 0) rawMarkdown = ocrResult.text;
  if (rawMarkdown.length === 0 && ocrResult.html.length > 0) {
    rawMarkdown = ocrResult.html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  const ocrCost = estimateOcrCost(picked.provider.capabilities.costPerPageUsd);

  // polishMode='minimal' → return raw OCR markdown directly.
  // polishMode='enrich' but no polish callable wired → degrade to
  // raw markdown with usedLlmPolish=false (caller can re-request via
  // a follow-up endpoint or surface the missing capability in UI).
  if (polishMode === 'minimal' || !opts.polish) {
    return jsonResponse({
      ok: true,
      markdown: rawMarkdown,
      provider: ocrResult.provider,
      polishMode,
      usedLlmPolish: false,
      costEstimate: { ocrUsd: ocrCost, polishUsd: 0 },
    }, 200);
  }

  // polishMode='enrich' — feed the raw markdown + original image bytes
  // to the LLM Vision polish callable. On failure, degrade to raw
  // markdown rather than 502 — the OCR result is still useful.
  const arrayBuf = await fileField.arrayBuffer();
  const base64 = Buffer.from(arrayBuf).toString('base64');
  const image: PolishImage = { mediaType: mimeType, base64 };

  let polished: string;
  try {
    polished = await opts.polish({
      rawMarkdown,
      image,
      ...(language ? { language } : {}),
    });
  } catch (err) {
    debug.log('notes-from-image.polish.error', picked.provider.name, {
      message: (err as Error).message ?? String(err),
    }, { level: 'error' });
    return jsonResponse({
      ok: true,
      markdown: rawMarkdown,
      provider: ocrResult.provider,
      polishMode,
      usedLlmPolish: false,
      polishError: (err as Error).message ?? String(err),
      costEstimate: { ocrUsd: ocrCost, polishUsd: 0 },
    }, 200);
  }

  // Polish callable returned an empty / whitespace-only string — keep
  // the raw markdown so the user sees something. usedLlmPolish=false
  // signals the degradation in the response payload.
  const finalMarkdown = polished.trim().length > 0 ? polished : rawMarkdown;
  const usedLlmPolish = polished.trim().length > 0;

  return jsonResponse({
    ok: true,
    markdown: finalMarkdown,
    provider: ocrResult.provider,
    polishMode,
    usedLlmPolish,
    costEstimate: {
      ocrUsd: ocrCost,
      polishUsd: estimatePolishCost(usedLlmPolish),
    },
  }, 200);
}
