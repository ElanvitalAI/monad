// M2-2b-v2 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 2) —
// GET /v1/elevenlabs/voices — server-side wrap of ElevenLabs voice
// library so the PWA picker can browse 10k+ voices without seeing
// the API key.
//
// Why daemon-side:
//   - ElevenLabs API key is sensitive (TTS billing tied to it) and
//     shouldn't ship to the browser
//   - List doesn't change minute-to-minute → server-side TTL cache
//     amortizes the API call across many PWA hits
//
// Response shape (subset of ElevenLabs spec · what the picker needs):
//   { voices: [{ id, name, category, accent?, gender?, age?,
//                description?, language?, previewUrl }] }
//
// Cache: 10-minute TTL · invalidated on signal SIGUSR2 in the future.
// Fallback: empty list when API key missing or remote 5xx — picker
// surfaces a "configure your API key" hint instead of an empty modal.

import { readSecrets } from '../config/secrets.js';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io';
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface VoiceLibraryEntry {
  id: string;
  name: string;
  /** ElevenLabs categories: 'premade' · 'cloned' · 'professional' · 'famous' · 'high_quality'. */
  category?: string;
  accent?: string;
  gender?: string;
  age?: string;
  description?: string;
  language?: string;
  /** Pre-rendered preview audio URL (~3s clip · MP3). */
  previewUrl?: string;
}

interface CacheEntry {
  fetchedAt: number;
  voices: VoiceLibraryEntry[];
  apiKeyFingerprint: string;
}

let cache: CacheEntry | null = null;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Resolve ElevenLabs API key. Priority:
 *    1. ELEVENLABS_API_KEY env (production / dev shell)
 *    2. user-config secret store key `elevenlabs.apiKey`
 *  Returns empty string when unavailable so callers can return [] +
 *  a "configure your API key" hint. */
function readApiKey(): string {
  const fromEnv = process.env.ELEVENLABS_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const secrets = readSecrets();
    const fromSecret = secrets.secrets['elevenlabs.apiKey'];
    if (typeof fromSecret === 'string' && fromSecret.trim().length > 0) {
      return fromSecret.trim();
    }
  } catch { /* secret store missing · treat as no key */ }
  return '';
}

function apiKeyFingerprint(key: string): string {
  // Cheap non-cryptographic fingerprint for cache invalidation when
  // the user rotates the key — we don't store the key itself anywhere.
  if (!key) return 'none';
  let h = 0;
  for (let i = 0; i < key.length; i++) h = ((h << 5) - h) + key.charCodeAt(i) | 0;
  return `fp:${(h >>> 0).toString(16)}`;
}

/** Map a raw ElevenLabs voice payload to the subset the picker uses.
 *  The remote API returns more fields (settings · samples · etc.) —
 *  we drop them to keep the wire payload small. */
function mapVoice(raw: unknown): VoiceLibraryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.voice_id === 'string' ? r.voice_id : null;
  const name = typeof r.name === 'string' ? r.name : null;
  if (!id || !name) return null;
  const labels = (r.labels && typeof r.labels === 'object' && !Array.isArray(r.labels))
    ? r.labels as Record<string, unknown>
    : {};
  const entry: VoiceLibraryEntry = {
    id,
    name,
    ...(typeof r.category === 'string' ? { category: r.category } : {}),
    ...(typeof labels.accent === 'string' ? { accent: labels.accent } : {}),
    ...(typeof labels.gender === 'string' ? { gender: labels.gender } : {}),
    ...(typeof labels.age === 'string' ? { age: labels.age } : {}),
    ...(typeof labels.description === 'string' ? { description: labels.description } : {}),
    ...(typeof labels.language === 'string' ? { language: labels.language } : {}),
    ...(typeof r.preview_url === 'string' ? { previewUrl: r.preview_url } : {}),
  };
  return entry;
}

interface FetchOpts {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  now?: () => number;
  /** Skip cache (tests). */
  bypassCache?: boolean;
}

/** Refresh-aware fetcher · returns cached voices when fresh, otherwise
 *  hits ElevenLabs. Pure / injectable so the daemon handler stays a
 *  thin shell. */
export async function getVoiceLibrary(
  opts: FetchOpts = {},
): Promise<{ voices: VoiceLibraryEntry[]; fromCache: boolean; configured: boolean }> {
  const now = (opts.now ?? Date.now)();
  const apiKey = readApiKey();
  const fp = apiKeyFingerprint(apiKey);

  if (!opts.bypassCache && cache && cache.apiKeyFingerprint === fp && now - cache.fetchedAt < CACHE_TTL_MS) {
    return { voices: cache.voices, fromCache: true, configured: apiKey.length > 0 };
  }

  if (!apiKey) {
    cache = { fetchedAt: now, voices: [], apiKeyFingerprint: 'none' };
    return { voices: [], fromCache: false, configured: false };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = (opts.baseUrl ?? ELEVENLABS_BASE).replace(/\/+$/, '');
  try {
    const res = await fetchImpl(`${baseUrl}/v1/voices`, {
      headers: { 'xi-api-key': apiKey },
    });
    if (!res.ok) {
      // Cache empty so we don't hammer ElevenLabs on every PWA mount
      // while the key is invalid.
      cache = { fetchedAt: now, voices: [], apiKeyFingerprint: fp };
      return { voices: [], fromCache: false, configured: true };
    }
    const body = (await res.json()) as { voices?: unknown[] };
    const voices: VoiceLibraryEntry[] = [];
    if (Array.isArray(body.voices)) {
      for (const raw of body.voices) {
        const mapped = mapVoice(raw);
        if (mapped) voices.push(mapped);
      }
    }
    cache = { fetchedAt: now, voices, apiKeyFingerprint: fp };
    return { voices, fromCache: false, configured: true };
  } catch {
    // Network blip — keep whatever's cached + report.
    if (cache && cache.apiKeyFingerprint === fp) {
      return { voices: cache.voices, fromCache: true, configured: true };
    }
    cache = { fetchedAt: now, voices: [], apiKeyFingerprint: fp };
    return { voices: [], fromCache: false, configured: true };
  }
}

/** Reset the in-memory cache · test seam. */
export function __resetElevenLabsCacheForTests(): void {
  cache = null;
}

// ── HTTP handler ───────────────────────────────────────────────────

export async function handleElevenLabsVoicesGet(): Promise<Response> {
  const result = await getVoiceLibrary();
  return jsonResponse({
    voices: result.voices,
    configured: result.configured,
    fromCache: result.fromCache,
    cacheTtlMs: CACHE_TTL_MS,
  }, 200);
}
