// Local LLM parameter preset registry.
//
// Reads the bundled `src/llm/local-manager/presets.yaml` file (built-in
// vendor-recommended sampling/output/behaviour for each model family)
// and merges in any user override at `~/.monad/local-llm-presets.yaml`.
// Exposes `findPresetForModel(modelId)` for runtime lookup +
// `listPresets()` for UI/inspection.
//
// Design rails:
//   - Built-in presets ship with the binary; YAML is the source of
//     truth so vendor-recipe changes are a doc-only edit (no recompile).
//   - User override file is optional; entries with the same `id` win
//     over built-in (same precedence rule as monad's other registries).
//   - Match precedence is REGISTRY ORDER — first match wins. The
//     catch-all `openai-default` belongs last in the YAML.
//   - The `null` preset shape (`NULL_PRESET`) lets callers express
//     "user opted out of presets entirely" without special-casing.
//
// 2026-05-05 introduction (replaces hardcoded `isQwenLocal` regex in
// LocalProvider.streamChat). User-decision rationale: parameter tuning
// will eventually surface in UI, so the data needs to be document-
// addressable rather than scattered through code.

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/** Match rule for binding a preset to model ids. `pattern` is treated
 *  as a regex when `regex: true`, otherwise a case-insensitive
 *  substring. Multiple match rules per preset OR together. */
export interface PresetMatch {
  readonly pattern: string;
  readonly regex?: boolean;
}

/** Sampling parameters surfaced to the OpenAI-compat request body.
 *  Every field is optional — omitted fields fall through to provider
 *  / runtime defaults. */
export interface PresetSampling {
  readonly temperature?: number;
  readonly top_p?: number;
  readonly top_k?: number;
  readonly min_p?: number;
  readonly presence_penalty?: number;
}

/** Output budget params. `max_tokens` maps to the OpenAI-compat
 *  field of the same name. */
export interface PresetOutput {
  readonly max_tokens?: number;
}

/** Provider/runtime behaviour toggles. Today only the qwen
 *  `/no_think` auto-prepend lives here; this is the surface where
 *  future cross-cutting behaviours land (e.g. enable_thinking when LM
 *  Studio fixes the hard-switch, or per-family system-prompt prefix). */
export interface PresetBehaviors {
  readonly auto_prepend_no_think?: boolean;
}

/** A complete preset entry as authored in YAML. */
export interface LlmParamPreset {
  readonly id: string;
  readonly name: string;
  readonly matches: readonly PresetMatch[];
  readonly source?: string;
  readonly notes?: string;
  readonly sampling: PresetSampling;
  readonly output: PresetOutput;
  readonly behaviors: PresetBehaviors;
}

/** Preset shape for "user opted out — apply no overrides". Returned
 *  by `findPresetForModel` only when the registry has no matching
 *  pattern at all (which shouldn't happen in practice because the
 *  catch-all `openai-default` preset matches everything). Also used
 *  by callers passing `localPresetMode: 'none'`. */
export const NULL_PRESET: LlmParamPreset = {
  id: 'none',
  name: 'No tuning (bare provider defaults)',
  matches: [],
  sampling: {},
  output: {},
  behaviors: {},
};

interface RawRegistry {
  version?: number;
  presets?: unknown[];
}

let cached: LlmParamPreset[] | null = null;

/** Path to the built-in YAML, resolved relative to THIS source file
 *  so it works regardless of cwd. ESM-safe via `import.meta.url`. */
function builtinPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, 'presets.yaml');
}

function userOverridePath(): string {
  return join(homedir(), '.monad', 'local-llm-presets.yaml');
}

function loadFile(path: string): LlmParamPreset[] {
  if (!existsSync(path)) return [];
  let raw: RawRegistry;
  try {
    raw = parseYaml(readFileSync(path, 'utf8')) as RawRegistry;
  } catch {
    return [];
  }
  if (!raw || !Array.isArray(raw.presets)) return [];
  const out: LlmParamPreset[] = [];
  for (const p of raw.presets) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Partial<LlmParamPreset>;
    if (typeof r.id !== 'string' || !r.id) continue;
    if (typeof r.name !== 'string') continue;
    if (!Array.isArray(r.matches)) continue;
    out.push({
      id: r.id,
      name: r.name,
      matches: r.matches.map((m) => ({
        pattern: String((m as PresetMatch).pattern ?? ''),
        ...(((m as PresetMatch).regex === true) ? { regex: true } : {}),
      })),
      ...(typeof r.source === 'string' ? { source: r.source } : {}),
      ...(typeof r.notes === 'string' ? { notes: r.notes } : {}),
      sampling: { ...(r.sampling ?? {}) },
      output: { ...(r.output ?? {}) },
      behaviors: { ...(r.behaviors ?? {}) },
    });
  }
  return out;
}

function loadAll(): LlmParamPreset[] {
  if (cached) return cached;
  const builtin = loadFile(builtinPath());
  const override = loadFile(userOverridePath());
  if (override.length === 0) {
    cached = builtin;
    return cached;
  }
  // Same-id entries: user override wins. Otherwise concat with
  // override entries placed BEFORE builtin so user-authored patterns
  // get first crack at matching (registry order = match precedence).
  const overrideIds = new Set(override.map((p) => p.id));
  const merged: LlmParamPreset[] = [
    ...override,
    ...builtin.filter((p) => !overrideIds.has(p.id)),
  ];
  cached = merged;
  return cached;
}

/** Snapshot of all known presets (built-in + user override merged).
 *  Returns a new array each call — caller can sort/filter freely. */
export function listPresets(): LlmParamPreset[] {
  return [...loadAll()];
}

/** Compile a single match rule to a RegExp. Substring matches are
 *  escaped first so `.` / `*` / etc in raw model ids don't blow up. */
function compileMatch(m: PresetMatch): RegExp {
  if (m.regex) return new RegExp(m.pattern, 'i');
  const escaped = m.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
}

/** Find the FIRST preset whose any match rule fires against `modelId`.
 *  When effective thinking is known, Qwen selects its existing thinking
 *  or non-thinking preset from that state instead of the model name.
 *  Returns `NULL_PRESET` only when nothing matches (catch-all entry
 *  in the built-in YAML normally guarantees a hit). */
export function findPresetForModel(modelId: string, effectiveThinking?: boolean): LlmParamPreset {
  const all = loadAll();
  let matched: LlmParamPreset | undefined;
  for (const p of all) {
    for (const m of p.matches) {
      try {
        if (compileMatch(m).test(modelId)) {
          matched = p;
          break;
        }
      } catch {
        // Malformed regex in YAML — skip this match rule, keep walking.
      }
    }
    if (matched) break;
  }
  if (!matched || effectiveThinking === undefined) return matched ?? NULL_PRESET;
  const qwenPresets = all.filter((preset) =>
    preset.id === 'qwen3-thinking' || preset.id === 'qwen3-instruct',
  );
  const isQwen = qwenPresets.some((preset) => preset.matches.some((match) => {
    try {
      return compileMatch(match).test(modelId);
    } catch {
      return false;
    }
  }));
  if (!isQwen) return matched;
  return qwenPresets.find((preset) => preset.id === (
    effectiveThinking ? 'qwen3-thinking' : 'qwen3-instruct'
  )) ?? matched;
}

/** Build a synthetic preset from user-supplied parameter overrides.
 *  Used when `user-config.llm.localPresetMode === 'custom'` so the
 *  rest of LocalProvider has a uniform PresetXxx shape to consume. */
export function customPresetFromUserParams(custom: {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  presence_penalty?: number;
  max_tokens?: number;
  auto_prepend_no_think?: boolean;
} = {}): LlmParamPreset {
  return {
    id: 'custom',
    name: 'Custom (user-defined)',
    matches: [],
    sampling: {
      ...(custom.temperature !== undefined ? { temperature: custom.temperature } : {}),
      ...(custom.top_p !== undefined ? { top_p: custom.top_p } : {}),
      ...(custom.top_k !== undefined ? { top_k: custom.top_k } : {}),
      ...(custom.min_p !== undefined ? { min_p: custom.min_p } : {}),
      ...(custom.presence_penalty !== undefined
        ? { presence_penalty: custom.presence_penalty } : {}),
    },
    output: {
      ...(custom.max_tokens !== undefined ? { max_tokens: custom.max_tokens } : {}),
    },
    behaviors: {
      ...(custom.auto_prepend_no_think !== undefined
        ? { auto_prepend_no_think: custom.auto_prepend_no_think } : {}),
    },
  };
}

/** Reset the cache · test isolation. Production callers shouldn't
 *  need this — preset content is static across a process lifetime. */
export function _resetPresetCacheForTesting(): void {
  cached = null;
}
