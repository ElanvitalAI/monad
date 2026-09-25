// ── VW-term-infra Bundle B-4 · P6-3 — LegacyArtifactProvider ──
//
// Pluggable read-only scanner interface · lets the unified
// ArtifactStore expose artifacts that were saved BEFORE the B-2 /
// B-3 migration (e.g. `~/.monad/timelines/rec-*.cast` from Bundle 8T
// pre-migration runs · `widget-timeline-*.cast` from widget-team 8W)
// without rewriting or copying files.
//
// Keeps each provider tiny + testable: each knows its directory +
// filename convention + synthesizes `ArtifactMeta` from fs stat. No
// write path — a provider NEVER mutates legacy files; migration
// (actually copying data into `artifacts/<kind>/`) is out-of-scope
// for B-4 · user-driven for now.
//
// Store integration (store.ts `legacyProviders` deps):
//   - `list(kind)` merges `scanKind(kind)` (canonical directory) with
//     every provider whose `provider.kind === kind`
//   - `list()` without kind calls every provider
//   - Dedup by `path` string — if a user manually moves a legacy file
//     into the canonical directory, it appears once (canonical wins)

import type { ArtifactKind, ArtifactListing } from './types.js';

/** Minimal fs shape · each provider injects this (default realFs).
 *  Aligned with the main store `ArtifactFs` but narrower — providers
 *  only read. */
export interface LegacyProviderFs {
  existsSync(p: string): boolean;
  readdirSync(p: string): readonly string[];
  statSync(p: string): { readonly mtimeMs: number; readonly size: number };
}

export interface LegacyArtifactProvider {
  /** Which canonical kind this provider surfaces (one per provider
   *  instance · makes merge logic in the store a simple filter). */
  readonly kind: ArtifactKind;
  /** Scan + synthesize listings. Returns `[]` when directory missing
   *  — never throws for empty state. File-level errors are silently
   *  skipped so a corrupt entry doesn't break the whole list. */
  list(): readonly ArtifactListing[];
}

/** Merge a set of providers with main-store listings. Dedup by `path`
 *  · main-store wins on collision (canonical beats legacy). Sort by
 *  `createdAt` ascending so newest goes last (consistent with store
 *  behavior). Exported for the store's internal use + tests. */
export function mergeLegacyListings(
  main: readonly ArtifactListing[],
  providers: readonly LegacyArtifactProvider[],
  kindFilter?: ArtifactKind,
): readonly ArtifactListing[] {
  const byPath = new Map<string, ArtifactListing>();
  for (const l of main) byPath.set(l.path, l);
  for (const provider of providers) {
    if (kindFilter && provider.kind !== kindFilter) continue;
    for (const l of provider.list()) {
      if (!byPath.has(l.path)) byPath.set(l.path, l);
    }
  }
  const merged = [...byPath.values()];
  merged.sort((a, b) => a.meta.createdAt - b.meta.createdAt);
  return merged;
}
