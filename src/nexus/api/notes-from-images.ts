// NEXUS · notes-from-images endpoint (R-OCR follow-up · batch · 2026-05-09).
//
// Batch sibling of `/v1/notes/from-image` (singular). Same multipart
// shape, but the `image` and `filename` fields can repeat — the
// handler iterates per pair, calls the single-image OCR logic, and
// returns an aggregated `{ results: [...] }` envelope. Each entry
// matches the singular endpoint's response body 1:1 so the PWA can
// render a list of review cards without redundant per-call wiring.
//
// Endpoint shape
//   POST /v1/notes/from-images
//   Content-Type: multipart/form-data
//     image:        Blob × N      (required · same image/* mime rules)
//     filename:     string × N    (optional · paired by index w/ image)
//     polishMode:   'minimal'     (default · per-batch)
//                 | 'enrich'
//     language:     ISO-639       (per-batch)
//     strengths:    csv           (per-batch · 손글씨 / context-aware / …)
//
// Response (200)
//   {
//     ok:         true,
//     results:    Array<{
//       index:        number,                    // 0-based pairing
//       ok:           boolean,
//       markdown?:    string,                    // when ok=true
//       provider?:    string,
//       polishMode?:  'minimal' | 'enrich',
//       usedLlmPolish?: boolean,
//       costEstimate?: { ocrUsd: number, polishUsd: number },
//       error?:       string,                    // when ok=false
//       reason?:      string,
//     }>,
//     succeeded:  number,    // count of ok=true entries
//     failed:     number,    // count of ok=false entries
//     polishMode: 'minimal' | 'enrich',
//   }
//
// Why a sibling endpoint (not a flag on the existing one):
//   - Response shape diverges enough (`results: []` envelope) that
//     keeping a single endpoint would make the success path branchier
//     than necessary. Two endpoints, one shape each, easier to test.
//   - Multipart already supports repeated fields; the singular handler
//     reads `form.get('image')` (first only) so adding `getAll`
//     branching there would silently change semantics for callers
//     that pass multiple images by accident.
//   - Independent route lets future async/streaming variants land here
//     without disturbing the singular response contract.
//
// Cross-ref:
//   src/nexus/api/notes-from-image.ts (singular sibling · same flow)
//   내부 문서 `ROADMAP-pwa-pre-ios-gap-2026-05-09` §R-OCR follow-up

import type { OcrRegistry, OcrResult, OcrStrength } from '../../ocr/index.js';
import type { NotesMetricsCollector } from '../../notes/metrics.js';
import { debug } from '../../debug/log.js';
import type { PolishCallable, PolishImage, PolishMode } from './notes-from-image.js';

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

export interface NotesFromImagesOpts {
  registry?: OcrRegistry;
  polish?: PolishCallable;
  checkAuth?: (req: Request) => boolean;
  metrics?: NotesMetricsCollector;
  /** Hard cap on images per request — protects against unbounded
   *  multipart bodies. Defaults to 8 (single review session is
   *  unlikely to capture more than a handful at once · LLM Vision
   *  costs accumulate quickly past that). */
  maxImages?: number;
}

interface PerImageResult {
  index: number;
  ok: boolean;
  markdown?: string;
  provider?: string;
  polishMode?: PolishMode;
  usedLlmPolish?: boolean;
  costEstimate?: { ocrUsd: number; polishUsd: number };
  error?: string;
  reason?: string;
  filename?: string;
}

function coercePolishMode(raw: FormDataEntryValue | null): PolishMode {
  if (raw === 'enrich') return 'enrich';
  return 'minimal';
}

function estimateOcrCost(costPerPageUsd: number): number {
  return Math.round(costPerPageUsd * 10_000) / 10_000;
}

/** POST /v1/notes/from-images — batch OCR. Calls into the same
 *  capability-driven registry the singular sibling uses; iterates
 *  serially so a per-image failure doesn't cascade into the rest. */
export async function handleNotesFromImages(
  req: Request,
  opts: NotesFromImagesOpts,
): Promise<Response> {
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
  if (!opts.registry) {
    return jsonResponse({ ok: false, error: 'ocr_registry_not_wired' }, 503);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return badRequest(`failed to parse multipart body: ${(err as Error).message}`);
  }

  const imageFields: Blob[] = [];
  for (const f of form.getAll('image')) {
    if (f instanceof Blob) imageFields.push(f);
  }
  if (imageFields.length === 0) {
    return badRequest('image field required (Blob)');
  }
  const max = opts.maxImages ?? 8;
  if (imageFields.length > max) {
    return badRequest(`too_many_images (limit ${max}, got ${imageFields.length})`);
  }
  const filenameFields = form.getAll('filename').filter((f): f is string => typeof f === 'string');

  const polishMode = coercePolishMode(form.get('polishMode'));
  const languageField = form.get('language');
  const language = typeof languageField === 'string' && languageField.length > 0
    ? languageField
    : undefined;
  const strengthsField = form.get('strengths');
  const callerStrengths = typeof strengthsField === 'string'
    ? strengthsField.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const baseStrengths = ['korean', ...callerStrengths] as readonly OcrStrength[];

  const results: PerImageResult[] = [];
  let succeeded = 0;
  let failed = 0;

  // Serial iteration — keeps cost predictable + avoids piling N
  // concurrent Upstage / LLM Vision requests onto the user's quota
  // for a single batch. Provider pick is per-image so a mixed batch
  // (some w/ handwriting, some w/o) can still route each to its best
  // provider; the batch-level strengths set is the floor.
  for (let i = 0; i < imageFields.length; i += 1) {
    const file = imageFields[i]!;
    const filename = (filenameFields[i] && filenameFields[i]!.length > 0)
      ? filenameFields[i]!
      : (file instanceof File ? file.name : `image-${i}.bin`);
    const mimeType = file.type || 'application/octet-stream';

    if (file.size === 0) {
      results.push({ index: i, ok: false, error: 'bad_request', reason: 'image is empty', filename });
      failed += 1;
      continue;
    }

    const picked = await opts.registry.pick({
      outputs: ['markdown'],
      strengths: baseStrengths,
      inputs: ['image/*'],
      ...(language ? { languages: [language] } : {}),
    });
    if (!picked) {
      results.push({ index: i, ok: false, error: 'no_ocr_provider_available', filename });
      failed += 1;
      continue;
    }

    let ocrResult: OcrResult;
    try {
      ocrResult = await picked.provider.run({
        file,
        filename,
        mimeType,
        preferredOutput: 'markdown',
        ...(language ? { languageHint: language } : {}),
      });
    } catch (err) {
      opts.metrics?.recordOcr({ provider: picked.provider.name, polishMode, ok: false });
      results.push({
        index: i,
        ok: false,
        error: 'ocr_provider_threw',
        reason: (err as Error).message ?? String(err),
        provider: picked.provider.name,
        filename,
      });
      failed += 1;
      continue;
    }

    if (!ocrResult.ok) {
      opts.metrics?.recordOcr({ provider: ocrResult.provider, polishMode, ok: false });
      results.push({
        index: i,
        ok: false,
        error: 'ocr_failed',
        reason: ocrResult.message,
        provider: ocrResult.provider,
        filename,
      });
      failed += 1;
      continue;
    }
    opts.metrics?.recordOcr({ provider: ocrResult.provider, polishMode, ok: true });

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

    if (polishMode === 'minimal' || !opts.polish) {
      results.push({
        index: i,
        ok: true,
        markdown: rawMarkdown,
        provider: ocrResult.provider,
        polishMode,
        usedLlmPolish: false,
        costEstimate: { ocrUsd: ocrCost, polishUsd: 0 },
        filename,
      });
      succeeded += 1;
      continue;
    }

    // polishMode='enrich' — feed raw markdown + image to polish callable.
    const arrayBuf = await file.arrayBuffer();
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
      debug.log('notes-from-images.polish.error', picked.provider.name, {
        index: i,
        message: (err as Error).message ?? String(err),
      }, { level: 'error' });
      results.push({
        index: i,
        ok: true,
        markdown: rawMarkdown,
        provider: ocrResult.provider,
        polishMode,
        usedLlmPolish: false,
        costEstimate: { ocrUsd: ocrCost, polishUsd: 0 },
        filename,
      });
      succeeded += 1;
      continue;
    }
    const finalMarkdown = polished.trim().length > 0 ? polished : rawMarkdown;
    const usedLlmPolish = polished.trim().length > 0;
    results.push({
      index: i,
      ok: true,
      markdown: finalMarkdown,
      provider: ocrResult.provider,
      polishMode,
      usedLlmPolish,
      costEstimate: {
        ocrUsd: ocrCost,
        polishUsd: 0, // matches singular sibling — placeholder until usage capture
      },
      filename,
    });
    succeeded += 1;
  }

  return jsonResponse({
    ok: true,
    results,
    succeeded,
    failed,
    polishMode,
  }, 200);
}
