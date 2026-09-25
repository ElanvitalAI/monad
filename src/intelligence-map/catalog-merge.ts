// PLAN-model-intelligence-router-2026-07-10 · Part A / Phase A4 —
// Candidate → catalog merge + HITL apply.
//
// The classifier (A3) emits `ModelCandidate`s with `classification.source =
// 'auto'`. This module (1) merges them into a `ModelCatalog` as a PURE
// transform (for preview / discovery-mission proposal), and (2) applies an
// approved set to disk, promoting their provenance to `manual`.
//
// Safety (PLAN §8): auto candidates are advisory. Nothing here flips a
// model to the active pin — it only extends the catalog the router reads
// from. `mergeCandidates` with `promote:false` keeps `source:'auto'` so a
// preview shows what WOULD change; `applyApprovedCandidates` uses
// `promote:true` (human approved) and persists.

import { loadCatalog, persistCatalog, type CatalogIoOpts } from './model-catalog.js';
import type { ModelCandidate } from './model-classifier.js';
import type { ModelCatalog, ModelEntry } from './types.js';

export interface MergeOpts {
  now?: number;
  /** true = mark merged entries `manual` (human-approved); false = keep
   *  the candidate's `auto` provenance (preview / unapproved). */
  promote?: boolean;
}

export interface MergeResult {
  catalog: ModelCatalog;
  added: string[];
  updated: string[];
}

/** Fill a candidate's missing REQUIRED ModelEntry fields with safe
 *  defaults so it can live in the catalog. Numeric unknowns default to 0
 *  (priced later by a human on approval); local inferred from provider. */
function materialize(c: ModelCandidate, source: 'auto' | 'manual', now: number): ModelEntry {
  const local = c.local ?? (c.provider === 'local' || c.provider === 'ollama');
  return {
    id: c.id,
    provider: c.provider,
    family: c.family ?? c.id,
    contextWindow: c.contextWindow ?? 0,
    inputPerMtok: c.inputPerMtok ?? 0,
    outputPerMtok: c.outputPerMtok ?? 0,
    local,
    tags: c.tags ?? [],
    bestFor: c.bestFor ?? [],
    ...(c.tier ? { tier: c.tier } : {}),
    ...(c.variantOf ? { variantOf: c.variantOf } : {}),
    ...(c.effortAxis ? { effortAxis: c.effortAxis } : {}),
    ...(c.releasedAt ? { releasedAt: c.releasedAt } : {}),
    classification: {
      source,
      ...(c.classification.confidence !== undefined ? { confidence: c.classification.confidence } : {}),
      at: c.classification.at ?? new Date(now).toISOString(),
    },
  };
}

/** Merge candidates into a catalog. PURE — returns a new catalog + a
 *  diff of ids added / updated. Existing entries are FILLED (only
 *  currently-undefined fields are taken from the candidate) so a manual
 *  edit is never clobbered by a later auto pass; provenance updates to
 *  `manual` only when `promote` is set. */
export function mergeCandidates(
  catalog: ModelCatalog,
  candidates: readonly ModelCandidate[],
  opts: MergeOpts = {},
): MergeResult {
  const now = opts.now ?? Date.now();
  const source = opts.promote ? 'manual' : 'auto';
  const byId = new Map(catalog.models.map((m) => [m.id, m]));
  const added: string[] = [];
  const updated: string[] = [];

  for (const c of candidates) {
    const existing = byId.get(c.id);
    if (!existing) {
      byId.set(c.id, materialize(c, source, now));
      added.push(c.id);
      continue;
    }
    // Fill only undefined fields — never overwrite curated data.
    const fresh = materialize(c, source, now);
    const merged: ModelEntry = { ...fresh, ...pruneUndefined(existing) };
    // Provenance: promote wins (approved), else keep whatever was there.
    merged.classification = opts.promote
      ? fresh.classification
      : (existing.classification ?? fresh.classification);
    byId.set(c.id, merged);
    updated.push(c.id);
  }

  return {
    catalog: { version: 1, updated: now, models: [...byId.values()] },
    added,
    updated,
  };
}

function pruneUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(obj) as (keyof T)[]) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

export interface ApplyResult extends MergeResult {
  path: string;
}

/** Load the catalog, merge an APPROVED candidate set (promoted to
 *  `manual`), and persist. Use only after human approval (A4 HITL). */
export async function applyApprovedCandidates(
  candidates: readonly ModelCandidate[],
  opts: CatalogIoOpts & { now?: number } = {},
): Promise<ApplyResult> {
  const { catalog } = loadCatalog(opts);
  const merged = mergeCandidates(catalog, candidates, { now: opts.now, promote: true });
  const path = await persistCatalog(merged.catalog, opts);
  return { ...merged, path };
}
