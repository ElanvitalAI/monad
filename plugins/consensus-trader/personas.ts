// ── Persona pool loader ──
// Loads plugins/consensus-trader/personas.json at module-eval time
// and, when it exists, merges ~/.claude/consensus-trader/personas.json
// on top. The user file uses the same schema; entries with a matching
// `id` override the built-in, entries with a new id extend the pool.
// Ship 54 experts out of the box; users can drop in their own without
// editing the repo.

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

export interface Persona {
  id: string;
  name: string;
  role: string;
  domains: string[];
  expertise: string[];
  frameworks: string[];
  style: string;
  voice: string;
  bias: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILTIN_PATH = join(HERE, 'personas.json');
export const USER_PATH = join(homedir(), '.claude', 'consensus-trader', 'personas.json');

function readJsonArray(path: string): unknown[] {
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${path}: expected a JSON array`);
  return parsed;
}

/** Minimal shape check — every record needs an id + the renderer /
 *  runner keys. Missing arrays default to [] so partial user entries
 *  don't crash the widget. */
function normalize(raw: unknown, source: string): Persona | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (typeof r.name !== 'string' || !r.name) return null;
  return {
    id: r.id,
    name: r.name,
    role: typeof r.role === 'string' ? r.role : '',
    style: typeof r.style === 'string' ? r.style : 'custom',
    voice: typeof r.voice === 'string' ? r.voice : '',
    bias: typeof r.bias === 'string' ? r.bias : '',
    domains: Array.isArray(r.domains) ? r.domains.filter((x): x is string => typeof x === 'string') : [],
    expertise: Array.isArray(r.expertise) ? r.expertise.filter((x): x is string => typeof x === 'string') : [],
    frameworks: Array.isArray(r.frameworks) ? r.frameworks.filter((x): x is string => typeof x === 'string') : [],
  };
}

function loadPersonas(): { list: Persona[]; userCount: number; userError?: string } {
  const merged = new Map<string, Persona>();
  for (const raw of readJsonArray(BUILTIN_PATH)) {
    const p = normalize(raw, 'builtin');
    if (p) merged.set(p.id, p);
  }
  let userCount = 0;
  let userError: string | undefined;
  if (existsSync(USER_PATH)) {
    try {
      for (const raw of readJsonArray(USER_PATH)) {
        const p = normalize(raw, 'user');
        if (p) {
          merged.set(p.id, p);
          userCount++;
        }
      }
    } catch (err: any) {
      // Swallow — a broken user file shouldn't block the plugin.
      userError = err?.message || String(err);
    }
  }
  return { list: Array.from(merged.values()), userCount, userError };
}

const LOADED = loadPersonas();

/** The merged persona pool (builtin + user). Exposed as `let` (live
 *  binding) so `reloadPersonas()` can swap the backing array after
 *  the user edits their override file without restarting the TUI.
 *  Importers that hold a local reference (e.g. `const snap = PERSONAS`)
 *  miss the update — prefer re-reading the export binding when
 *  freshness matters. */
export let PERSONAS: readonly Persona[] = LOADED.list;

/** Count of personas contributed by the user override file (for the
 *  plugin's activate log). Updated by reloadPersonas. */
export let USER_PERSONA_COUNT: number = LOADED.userCount;

/** Parse error from the user file, if any. Surfaced in activate log
 *  so users notice a typo instead of silently losing their overrides.
 *  Updated by reloadPersonas — cleared when a subsequent reload
 *  succeeds. */
export let USER_PERSONA_ERROR: string | undefined = LOADED.userError;

// Index by id for O(1) lookup. Mutated in-place by reloadPersonas so
// stale Map references from callers stay valid.
const BY_ID = new Map<string, Persona>(PERSONAS.map(p => [p.id, p]));

export function getPersona(id: string): Persona | undefined {
  return BY_ID.get(id);
}

/** Re-read builtin + user persona JSON from disk and swap the
 *  PERSONAS binding + BY_ID index. Called from the plugin's
 *  `/ct-reload-personas` command (and the `R` keybinding) so users
 *  can drop new personas into `~/.claude/consensus-trader/personas.json`
 *  without restarting elanous. Returns a summary of what changed. */
export function reloadPersonas(): {
  total: number;
  userCount: number;
  userError?: string;
  added: string[];
  removed: string[];
} {
  const before = new Set(PERSONAS.map(p => p.id));
  const next = loadPersonas();
  PERSONAS = next.list;
  USER_PERSONA_COUNT = next.userCount;
  USER_PERSONA_ERROR = next.userError;
  BY_ID.clear();
  for (const p of PERSONAS) BY_ID.set(p.id, p);
  const after = new Set(PERSONAS.map(p => p.id));
  const added = [...after].filter(id => !before.has(id));
  const removed = [...before].filter(id => !after.has(id));
  return {
    total: PERSONAS.length,
    userCount: next.userCount,
    userError: next.userError,
    added,
    removed,
  };
}

/** Filter personas by case-insensitive substring match against id,
 *  name, role, style, or any domain. Empty query returns the full pool. */
export function filterPersonas(query: string): Persona[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...PERSONAS];
  return PERSONAS.filter(p => {
    const hay = [
      p.id, p.name, p.role, p.style,
      ...(p.domains || []),
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

/** One-line label for list widgets. "name · role · style". */
export function personaLabel(p: Persona): string {
  return `${p.name} · ${p.role} · ${p.style}`;
}

/** Pick `count` random personas from `pool` without replacement.
 *  Uses Math.random by default; tests inject a deterministic `rand`
 *  so the sampled set is reproducible. Returns at most `pool.length`
 *  entries when count exceeds the pool size. */
export function samplePersonas(
  pool: readonly Persona[],
  count: number,
  rand: () => number = Math.random,
): Persona[] {
  if (count <= 0 || pool.length === 0) return [];
  const n = Math.min(count, pool.length);
  // Fisher–Yates on an index array, take the first n entries.
  const indices = Array.from({ length: pool.length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
  }
  return indices.slice(0, n).map(i => pool[i]!);
}
