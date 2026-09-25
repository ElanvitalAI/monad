// M2-2b-v2 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 2) —
// PWA client wrap of /v1/elevenlabs/voices. Returns null on offline /
// 5xx · empty list when the daemon reports configured=false (caller
// surfaces an "Add your API key" hint).
//
// 10k+ voices would normally need pagination, but ElevenLabs already
// returns the full catalog in a single response under most plans.
// We hold the result in module-level memo so the picker re-renders
// (typing in the search box) don't re-fetch.

import type { DaemonHttpConfig } from './model-tier-sync';

export interface VoiceLibraryEntry {
  id: string;
  name: string;
  category?: string;
  accent?: string;
  gender?: string;
  age?: string;
  description?: string;
  language?: string;
  previewUrl?: string;
}

export interface VoiceLibrary {
  voices: VoiceLibraryEntry[];
  configured: boolean;
  fromCache: boolean;
}

let memo: { fetchedAt: number; lib: VoiceLibrary } | null = null;
const MEMO_TTL_MS = 60_000;

export function __resetVoiceLibraryMemoForTests(): void {
  memo = null;
}

export async function fetchVoiceLibrary(
  cfg: DaemonHttpConfig,
  opts: { now?: number; bypassMemo?: boolean } = {},
): Promise<VoiceLibrary | null> {
  if (!cfg.baseUrl) return null;
  const now = opts.now ?? Date.now();
  if (!opts.bypassMemo && memo && now - memo.fetchedAt < MEMO_TTL_MS) {
    return memo.lib;
  }
  try {
    const url = cfg.baseUrl.replace(/\/$/, '') + '/v1/elevenlabs/voices';
    const headers: Record<string, string> = {};
    if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const body = await res.json() as {
      voices?: VoiceLibraryEntry[];
      configured?: boolean;
      fromCache?: boolean;
    };
    const lib: VoiceLibrary = {
      voices: Array.isArray(body.voices) ? body.voices : [],
      configured: body.configured === true,
      fromCache: body.fromCache === true,
    };
    memo = { fetchedAt: now, lib };
    return lib;
  } catch {
    return null;
  }
}

/** Filter voices by free-form query — matches against name, accent,
 *  gender, age, description, language. Empty query → all voices. */
export function filterVoices(
  voices: readonly VoiceLibraryEntry[],
  query: string,
): VoiceLibraryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...voices];
  return voices.filter((v) => {
    const hay = [
      v.name, v.category, v.accent, v.gender, v.age,
      v.description, v.language, v.id,
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
}

const RECENT_KEY = 'monad.tts-voice.recent';
const RECENT_CAP = 5;

/** Track recently-used voice ids. The picker surfaces these as a
 *  shortcut row above the full catalog so power users don't search
 *  for their go-to voices every time. */
export function loadRecentVoiceIds(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(0, RECENT_CAP);
  } catch {
    return [];
  }
}

export function rememberRecentVoiceId(id: string): void {
  if (typeof localStorage === 'undefined') return;
  if (!id || typeof id !== 'string') return;
  const trimmed = id.trim();
  if (!trimmed) return;
  const existing = loadRecentVoiceIds().filter((x) => x !== trimmed);
  const next = [trimmed, ...existing].slice(0, RECENT_CAP);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); }
  catch { /* quota */ }
}
