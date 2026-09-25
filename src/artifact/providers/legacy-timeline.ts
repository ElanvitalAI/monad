// ── VW-term-infra Bundle B-4 · P6-3 — Legacy timeline provider ──
//
// Scans a legacy directory (default `~/.monad/timelines/`) for
// asciicast `.cast` files saved BEFORE Bundle B-3's timeline
// migration · synthesizes `ArtifactMeta` from filename + fs stat ·
// surfaces them via `ArtifactStore.list('timeline')`.
//
// Recognised patterns:
//   - `rec-<id>.cast`                → Bundle 8T pre-migration
//   - `widget-timeline-<iso>.cast`   → widget-team 8W slash `/iul-
//                                      timeline stop` output
//   - Anything else with `.cast` extension is skipped (no origin
//     extraction rule → can't synthesize reliable meta).
//
// No write path · read-only scanner. Migration (copying / moving
// files into `artifacts/timeline/`) is user-driven · out-of-scope
// for B-4.

import * as nodeFs from 'node:fs';
import path from 'node:path';

import type { ArtifactListing, ArtifactMeta } from '../types.js';
import type { LegacyArtifactProvider, LegacyProviderFs } from '../legacy-provider.js';

function realProviderFs(): LegacyProviderFs {
  return {
    existsSync: (p) => nodeFs.existsSync(p),
    readdirSync: (p) => nodeFs.readdirSync(p),
    statSync: (p) => {
      const s = nodeFs.statSync(p);
      return { mtimeMs: s.mtimeMs, size: s.size };
    },
  };
}

export interface LegacyTimelineOriginPatterns {
  /** Default: /^rec-(.+)\.cast$/ */
  readonly recPattern?: RegExp;
  /** Default: /^widget-timeline-(.+)\.cast$/ */
  readonly widgetPattern?: RegExp;
}

export interface LegacyTimelineProviderOpts {
  readonly dir: string;
  readonly fs?: LegacyProviderFs;
  readonly now?: () => number;
  readonly origins?: LegacyTimelineOriginPatterns;
}

const DEFAULT_REC_PATTERN = /^rec-(.+)\.cast$/;
const DEFAULT_WIDGET_PATTERN = /^widget-timeline-(.+)\.cast$/;

export function createLegacyTimelineProvider(
  opts: LegacyTimelineProviderOpts,
): LegacyArtifactProvider {
  const fs = opts.fs ?? realProviderFs();
  const nowFn = opts.now ?? (() => Date.now());
  const recPattern = opts.origins?.recPattern ?? DEFAULT_REC_PATTERN;
  const widgetPattern = opts.origins?.widgetPattern ?? DEFAULT_WIDGET_PATTERN;

  function classify(filename: string): { origin: string; producer: string; tags: string[] } | null {
    const rec = recPattern.exec(filename);
    if (rec) {
      return {
        origin: rec[1]!,
        producer: 'bundle-8t-legacy',
        tags: ['legacy', 'widget-timeline', 'pre-artifact-migration'],
      };
    }
    const widget = widgetPattern.exec(filename);
    if (widget) {
      return {
        origin: widget[1]!,
        producer: 'widget-team-8w-legacy',
        tags: ['legacy', 'widget-timeline', '8w-slash'],
      };
    }
    return null;
  }

  return {
    kind: 'timeline',
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
        if (!name.endsWith('.cast')) continue;
        if (name.endsWith('.meta.json')) continue;    // skip any colocated meta files
        const match = classify(name);
        if (!match) continue;
        const full = path.join(opts.dir, name);
        let mtimeMs = nowFn();
        let size = 0;
        try {
          const st = fs.statSync(full);
          mtimeMs = st.mtimeMs;
          size = st.size;
        } catch {
          // Proceed with synthesized timestamp + 0 size on stat failure.
        }
        const meta: ArtifactMeta = {
          kind: 'timeline',
          origin: match.origin,
          createdAt: mtimeMs,
          sizeBytes: size,
          description: 'Legacy recording (pre-unified-store migration)',
          producer: match.producer,
          tags: match.tags,
        };
        listings.push({ path: full, meta });
      }
      listings.sort((a, b) => a.meta.createdAt - b.meta.createdAt);
      return listings;
    },
  };
}
