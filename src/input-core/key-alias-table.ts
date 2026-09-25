// Q4 (substrate Occam refactor, 2026-05-03) — central key alias table.
//
// Replaces the per-binding pipe syntax (`'C-k|C-ㅏ'`) that bindings
// used to declare jamo aliases inline. Bindings now declare a single
// canonical (latin) form; the alias table resolves alternate forms
// (Korean 2-set jamo by default, plus user-config overrides) at lookup
// time so a binding registered as `'C-k'` matches both `Ctrl+k` and
// `Ctrl+ㅏ` events without per-binding repetition.
//
// Layering:
//   1. Built-in defaults — Korean 2-set jamo → latin (this file).
//   2. User overrides — `~/.config/monad/key-aliases.json` (loaded at
//      bootstrap; missing-file = empty overrides, never an error).
//   User entries override built-ins on conflict.
//
// Reference:
//   내부 문서 `REQUIREMENTS-substrate-occam-2026-05-03`
//     §2.15 (rule), Q4 (decision)
//   내부 문서 `PLAN-substrate-rebuild-2026-05-03` §3 (this phase)

/** Built-in Korean 2-set IME jamo → latin mapping. Each entry maps the
 *  jamo character that the IME emits when the user has 한 mode on, to
 *  the latin character on the same physical key. Bindings declare the
 *  latin form; events with the jamo name resolve through this table.
 *
 *  Layout source: standard 두벌식 (KSX 5002) jamo positions on a
 *  qwerty keyboard. Hangul 자 (vowel) and 모 (consonant) chars both
 *  included so all printable letter keys round-trip.
 *
 *  Notes:
 *  - Capital jamo variants (e.g. 'ㅒ' 'ㅖ' 'ㄲ' 'ㄸ' …) are NOT
 *    included; they require Shift, which the binding's modifier flags
 *    already match independently of the name field.
 *  - Lookup is case-insensitive on both sides — see resolveKeyAlias. */
const KOREAN_2SET_BUILTIN: ReadonlyArray<readonly [jamo: string, latin: string]> = [
  // top row · qwerty
  ['ㅂ', 'q'], ['ㅈ', 'w'], ['ㄷ', 'e'], ['ㄱ', 'r'], ['ㅅ', 't'],
  ['ㅛ', 'y'], ['ㅕ', 'u'], ['ㅑ', 'i'], ['ㅐ', 'o'], ['ㅔ', 'p'],
  // home row · asdfghjkl
  ['ㅁ', 'a'], ['ㄴ', 's'], ['ㅇ', 'd'], ['ㄹ', 'f'], ['ㅎ', 'g'],
  ['ㅗ', 'h'], ['ㅓ', 'j'], ['ㅏ', 'k'], ['ㅣ', 'l'],
  // bottom row · zxcvbnm
  ['ㅋ', 'z'], ['ㅌ', 'x'], ['ㅊ', 'c'], ['ㅍ', 'v'], ['ㅠ', 'b'],
  ['ㅜ', 'n'], ['ㅡ', 'm'],
] as const;

let userOverrides = new Map<string, string>();
let aliasIndex = new Map<string, string>();

function rebuildAliasIndex(): void {
  aliasIndex = new Map();
  for (const [alias, canonical] of KOREAN_2SET_BUILTIN) {
    aliasIndex.set(alias.toLowerCase(), canonical.toLowerCase());
  }
  // User overrides win.
  for (const [alias, canonical] of userOverrides) {
    aliasIndex.set(alias.toLowerCase(), canonical.toLowerCase());
  }
}

rebuildAliasIndex();

/** Resolve a key name through the alias table. Returns the canonical
 *  form if `name` is registered as an alias; for non-alias inputs,
 *  returns the lowercased name (callers compare canonical lowercase
 *  forms downstream).
 *
 *  Used by the coordinator's `matchesKey` to normalize incoming
 *  KeyEvent.name before comparing against a binding's declared key. */
export function resolveKeyAlias(name: string | undefined): string {
  if (!name) return '';
  const lower = name.toLowerCase();
  return aliasIndex.get(lower) ?? lower;
}

/** True when `name` is a registered alias (i.e. resolves to a different
 *  canonical form). */
export function isKeyAlias(name: string | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  const canonical = aliasIndex.get(lower);
  return canonical !== undefined && canonical !== lower;
}

/** Replace the user-config alias overrides. Pass an empty Map to clear.
 *  Used by the user-config loader at bootstrap and on config reload. */
export function setUserKeyAliases(overrides: ReadonlyMap<string, string>): void {
  userOverrides = new Map();
  for (const [alias, canonical] of overrides) {
    userOverrides.set(alias.toLowerCase(), canonical.toLowerCase());
  }
  rebuildAliasIndex();
}

/** Schema for the user-config JSON file. */
export interface KeyAliasConfig {
  /** Map of alias → canonical, e.g. `{ "<vk-pause>": "f1" }`. */
  aliases?: Record<string, string>;
}

/** Load user-config alias overrides from a JSON file. Missing file or
 *  malformed JSON = silent no-op (caller proceeds with built-ins only).
 *  Returns true on successful load, false on missing/invalid file. */
export async function loadUserKeyAliasesFromFile(
  configPath: string,
): Promise<boolean> {
  try {
    const fs = await import('node:fs/promises');
    const raw = await fs.readFile(configPath, 'utf-8');
    const data = JSON.parse(raw) as KeyAliasConfig;
    if (!data.aliases) return true;
    const map = new Map<string, string>();
    for (const [k, v] of Object.entries(data.aliases)) {
      if (typeof k === 'string' && typeof v === 'string') {
        map.set(k, v);
      }
    }
    setUserKeyAliases(map);
    return true;
  } catch {
    return false;
  }
}

/** Test helper — clear user overrides, leaving Korean 2-set built-ins
 *  in place. */
export function __resetKeyAliasesForTests(): void {
  userOverrides = new Map();
  rebuildAliasIndex();
}

/** Test/debug helper — snapshot the current alias index. */
export function __debugAliasIndex(): ReadonlyMap<string, string> {
  return new Map(aliasIndex);
}
