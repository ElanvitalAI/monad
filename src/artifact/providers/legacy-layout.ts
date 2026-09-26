// ── VW-term-infra Bundle B-5 · P6-4 — Legacy layout provider ──
//
// Scans `~/.elanous/layouts/` for `*.layout.json` files saved BEFORE
// Bundle B-5's layout migration · synthesizes `ArtifactMeta` from
// filename + optional JSON parse · surfaces them via
// `ArtifactStore.list('layout')`.
//
// Optional JSON parse extracts `label` (→ description) and
// `createdAt` (→ timeline ordering). Parse failure falls back to
// filename slug + fs stat mtime so a broken layout doesn't break
// enumeration.
//
// Read-only · same pattern as legacy-timeline provider (B-4).

import * as nodeFs from 'node:fs';
import path from 'node:path';

import type { ArtifactListing, ArtifactMeta } from '../types.js';
import type { LegacyArtifactProvider, LegacyProviderFs } from '../legacy-provider.js';

const LAYOUT_EXT = '.layout.json';

/** Narrow fs shape — legacy-layout needs all the standard provider
 *  ops PLUS `readFileSync(utf8)` so we can peek `label` / `createdAt`
 *  off the spec. Provider-local type keeps this explicit. */
export interface LegacyLayoutProviderFs extends LegacyProviderFs {
  readFileSync(p: string, encoding: 'utf8'): string;
}

function realProviderFs(): LegacyLayoutProviderFs {
  return {
    existsSync: (p) => nodeFs.existsSync(p),
    readdirSync: (p) => nodeFs.readdirSync(p),
    statSync: (p) => {
      const s = nodeFs.statSync(p);
      return { mtimeMs: s.mtimeMs, size: s.size };
    },
    readFileSync: (p) => nodeFs.readFileSync(p, 'utf8'),
  };
}

export interface LegacyLayoutProviderOpts {
  readonly dir: string;
  readonly fs?: LegacyLayoutProviderFs;
  readonly now?: () => number;
}

export function createLegacyLayoutProvider(
  opts: LegacyLayoutProviderOpts,
): LegacyArtifactProvider {
  const fs = opts.fs ?? realProviderFs();
  const nowFn = opts.now ?? (() => Date.now());

  return {
    kind: 'layout',
    list(): readonly ArtifactListing[] {
      if (!fs.existsSync(opts.dir)) return [];
      let entries: readonly string[];
      try {
        entries = fs.readdirSync(opts.dir);
      } catch {
        return [];
      }
      const listings: ArtifactListing[] = [];
      for (const name of entries) {
        if (!name.endsWith(LAYOUT_EXT)) continue;
        const slug = name.slice(0, -LAYOUT_EXT.length);
        if (slug.length === 0) continue;
        const full = path.join(opts.dir, name);

        // fs stat fallback for createdAt / sizeBytes.
        let mtimeMs = nowFn();
        let size = 0;
        try {
          const st = fs.statSync(full);
          mtimeMs = st.mtimeMs;
          size = st.size;
        } catch {
          // Proceed with synthesized values.
        }

        // Optional JSON parse to pull label + authoritative createdAt.
        // Broken JSON is tolerated — skip the parse, keep stat values.
        let label: string | undefined;
        let specCreatedAt: number | undefined;
        try {
          const raw = fs.readFileSync(full, 'utf8');
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (typeof parsed.label === 'string' && parsed.label.length > 0) {
            label = parsed.label;
          }
          if (typeof parsed.createdAt === 'number' && Number.isFinite(parsed.createdAt)) {
            specCreatedAt = parsed.createdAt;
          }
        } catch {
          // Silent · stat fallback already set.
        }

        const meta: ArtifactMeta = {
          kind: 'layout',
          origin: slug,
          createdAt: specCreatedAt ?? mtimeMs,
          sizeBytes: size,
          description: label ?? `Legacy layout ${slug}`,
          producer: 'vwt-3a-legacy',
          tags: ['legacy', 'layout'],
        };
        listings.push({ path: full, meta });
      }
      listings.sort((a, b) => a.meta.createdAt - b.meta.createdAt);
      return listings;
    },
  };
}
