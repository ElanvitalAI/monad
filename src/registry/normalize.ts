// RFC #2161 Phase 1 — string normalization on top of Layer A catalog.
//
// Three pure helpers all callers should funnel through:
//   - `normalizeProviderId(input)` — alias → canonical id ('claude' →
//     'anthropic'). Returns `null` when the input doesn't match any
//     provider id or alias (so callers can decide whether that's a
//     soft fallback or a hard error).
//   - `inferProviderFromModel(modelId)` — model id prefix → provider id
//     (e.g. 'claude-opus-4-7' → 'anthropic'). Pattern fallback honors
//     each provider's `_patterns.yaml`.
//   - `resolveFamilyShortcut(shortcut)` — short alias from workflow yaml
//     ('opus', 'haiku') → canonical model id, when an explicit
//     `familyShortcut` is set on a model spec.
//
// All three operate on the catalog snapshot from `loader.ts`. Tests
// inject a custom catalog via the optional `cat` parameter.

import { getCatalog } from './loader.js';
import type { Catalog, ModelSpec } from './types.js';

// ── normalizeProviderId ──────────────────────────────────────────────

/** Lower-cases the input (case-insensitive lookup) and folds it through
 *  the catalog's alias index. Returns the canonical provider id, or
 *  `null` when no match (caller decides fallback). */
export function normalizeProviderId(
  input: string | null | undefined,
  cat: Catalog = getCatalog(),
): string | null {
  if (!input || typeof input !== 'string') return null;
  const lowered = input.toLowerCase().trim();
  if (!lowered) return null;
  // Direct id hit.
  if (cat.providers.has(lowered)) return lowered;
  // Alias scan — provider yaml's `aliases` field.
  for (const p of cat.providers.values()) {
    if (p.aliases.some((a) => a.toLowerCase() === lowered)) return p.id;
  }
  return null;
}

// ── inferProviderFromModel ───────────────────────────────────────────

/** Two-stage inference:
 *   1) explicit ModelSpec — look up by exact model id; return its
 *      `provider`. Catches every shipping model.
 *   2) prefix scan — walk every provider's `modelPrefixes` (provider
 *      yaml) plus per-provider `_patterns.yaml` prefixes. Longest match
 *      wins so 'codex-' beats 'c' if both were registered.
 *  Returns `null` when neither stage matches. */
export function inferProviderFromModel(
  model: string | null | undefined,
  cat: Catalog = getCatalog(),
): string | null {
  if (!model || typeof model !== 'string') return null;
  const lowered = model.toLowerCase().trim();
  if (!lowered) return null;

  // Stage 1 — explicit model spec.
  const exact = cat.models.get(lowered);
  if (exact) return exact.provider;
  // Try the input as-is too (model ids are case-sensitive on the wire,
  // but our cache keys lowercase them via this helper's input only).
  for (const m of cat.models.values()) {
    if (m.id.toLowerCase() === lowered) return m.provider;
  }

  // Stage 2 — prefix scan.
  let bestProvider: string | null = null;
  let bestPrefixLen = 0;

  // 2a — provider-level prefixes (provider.yaml `modelPrefixes`).
  for (const p of cat.providers.values()) {
    for (const prefix of p.modelPrefixes) {
      const lp = prefix.toLowerCase();
      if (lowered.startsWith(lp) && lp.length > bestPrefixLen) {
        bestProvider = p.id;
        bestPrefixLen = lp.length;
      }
    }
  }

  // 2b — _patterns.yaml prefixes (long-tail).
  for (const pat of cat.patterns.values()) {
    for (const entry of pat.prefixes) {
      const lp = entry.prefix.toLowerCase();
      if (lowered.startsWith(lp) && lp.length > bestPrefixLen) {
        bestProvider = pat.provider;
        bestPrefixLen = lp.length;
      }
    }
  }

  return bestProvider;
}

// ── resolveFamilyShortcut ────────────────────────────────────────────

/** Workflow yaml `model: opus` style shortcut → canonical model id.
 *  Multi-shortcut conflict (two models both claim `familyShortcut: opus`)
 *  resolves by latest `releaseDate` (or, if none, first registration).
 *  Returns `null` when no model declares the shortcut. */
export function resolveFamilyShortcut(
  shortcut: string | null | undefined,
  cat: Catalog = getCatalog(),
): string | null {
  if (!shortcut || typeof shortcut !== 'string') return null;
  const lowered = shortcut.toLowerCase().trim();
  if (!lowered) return null;
  let winner: ModelSpec | null = null;
  for (const m of cat.models.values()) {
    if (!m.familyShortcut) continue;
    if (m.familyShortcut.toLowerCase() !== lowered) continue;
    if (!winner) {
      winner = m;
      continue;
    }
    // Prefer non-deprecated.
    const winnerDeprecated = winner.deprecated != null;
    const candDeprecated = m.deprecated != null;
    if (winnerDeprecated && !candDeprecated) {
      winner = m;
      continue;
    }
    if (!winnerDeprecated && candDeprecated) continue;
    // Both same deprecation status — pick the one with later releaseDate.
    if (m.releaseDate && winner.releaseDate && m.releaseDate > winner.releaseDate) {
      winner = m;
    } else if (m.releaseDate && !winner.releaseDate) {
      winner = m;
    }
  }
  return winner?.id ?? null;
}

// ── Convenience: Layer A → effective capabilities ────────────────────

/** Resolve effective capabilities for (provider, model) pair. Provider
 *  default ⊕ model partial override per RFC §5.2.1. Returns `null` when
 *  either side is unknown. */
export function effectiveCapabilities(
  providerId: string,
  modelId: string | null | undefined,
  cat: Catalog = getCatalog(),
) {
  const p = cat.providers.get(providerId);
  if (!p) return null;
  if (!modelId) return p.capabilities;
  const m = cat.models.get(modelId.toLowerCase().trim());
  if (!m || !m.capabilities) return p.capabilities;
  return { ...p.capabilities, ...m.capabilities };
}
