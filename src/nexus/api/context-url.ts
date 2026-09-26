// NEXUS · context URL fetch handler (§6.3 · 2026-05-09).
//
// Endpoint
//   POST /v1/context/fetch-url   { url } → { ok, url, title?, text }
//
// Architecture: thin wrapper over `fetch()` + minimal HTML→text strip.
// Avoids pulling in a heavy parser (cheerio etc.) — caller is showroom
// where the user is *paste-driven* (high-fidelity reading is the LLM
// downstream, not us). Strips <script> + <style> + tags, collapses
// whitespace, caps at 50KB to keep the prompt manageable.
//
// PLAN: 내부 문서 `PLAN-cv-3-showroom-mvp-2026-05-07` §6.3

const MAX_BYTES = 50_000; // 50KB cap on returned text body
const FETCH_TIMEOUT_MS = 15_000;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function badRequest(msg: string): Response {
  return jsonResponse({ error: msg }, 400);
}

/** Strip HTML to readable text. Removes <script> + <style> blocks
 *  entirely, then strips remaining tags, decodes the most common
 *  entities, collapses whitespace. Imperfect but stable + small. */
export function htmlToText(html: string): string {
  let s = html;
  // Remove script + style + noscript bodies (not just tags).
  s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  s = s.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  s = s.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');
  // Convert <br> + block boundaries to newlines for readability.
  s = s.replace(/<\s*br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|article|section|header|footer|main|aside|blockquote)>/gi, '\n');
  // Drop remaining tags.
  s = s.replace(/<[^>]+>/g, '');
  // Decode common entities.
  const entities: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
  };
  for (const [k, v] of Object.entries(entities)) {
    s = s.split(k).join(v);
  }
  // Numeric entities (decimal + hex).
  s = s.replace(/&#(\d+);/g, (_m, n: string) => {
    const code = Number(n);
    return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : '';
  });
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => {
    const code = parseInt(h, 16);
    return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : '';
  });
  // Collapse whitespace · keep paragraph breaks.
  s = s.replace(/\r\n/g, '\n');
  s = s.replace(/[ \t\f\v]+/g, ' ');
  s = s.replace(/\n[ \t]+/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** Extract <title> content (first match · case-insensitive). */
export function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  return m[1]!
    .replace(/\s+/g, ' ')
    .trim() || null;
}

export interface ContextUrlOpts {
  /** Optional auth check. */
  checkAuth?: (req: Request) => boolean;
  /** Test seam — override fetch (e.g. fake server). */
  fetchImpl?: typeof fetch;
  /** Test seam — max bytes override. */
  maxBytes?: number;
  /** Test seam — timeout override (ms). */
  timeoutMs?: number;
}

export async function handleContextFetchUrl(
  req: Request,
  opts: ContextUrlOpts = {},
): Promise<Response> {
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('invalid json body');
  }
  const url = (body as { url?: unknown }).url;
  if (typeof url !== 'string' || url.length === 0) {
    return badRequest('url required (string)');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return badRequest('url must be a valid absolute URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return badRequest('only http/https supported');
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      headers: {
        'user-agent': 'elanous-context/1.0 (+https://github.com/ElanvitalAI/monad)',
        accept: 'text/html, text/plain;q=0.9, */*;q=0.5',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) {
      return jsonResponse(
        { error: `fetch failed`, status: res.status, statusText: res.statusText },
        502,
      );
    }
    const ctype = res.headers.get('content-type') ?? '';
    const html = await res.text();
    let text: string;
    let title: string | null = null;
    if (ctype.includes('html')) {
      title = extractTitle(html);
      text = htmlToText(html);
    } else {
      text = html.trim();
    }
    if (text.length > maxBytes) {
      text = text.slice(0, maxBytes) + `\n\n[...truncated · ${text.length - maxBytes} more chars]`;
    }
    return jsonResponse(
      {
        ok: true,
        url: parsed.toString(),
        ...(title ? { title } : {}),
        text,
        bytes: text.length,
      },
      200,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const aborted = ctrl.signal.aborted;
    return jsonResponse(
      { error: aborted ? 'fetch timeout' : 'fetch error', message: msg },
      aborted ? 504 : 502,
    );
  } finally {
    clearTimeout(timer);
  }
}
