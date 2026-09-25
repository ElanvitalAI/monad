// ── IUL Phase S·b — bg-surface adapter ──
//
// Shell Runner background surface aggregates many `ShellHandle`s into
// a `BgRollup` (`src/shell-runner/background-surface.ts`). Unlike
// inline (1 handle ↔ 1 surface), bg is N handles ↔ 1 rollup. We
// therefore register **per-handle** entries in SurfaceRegistry plus
// (optionally) a synthetic rollup entry the LLM can address as
// `{kind:'bg', bgId:'__rollup__'}`.
//
// Two entry shapes:
//
//   1. `registerBackgroundHandle(opts)` — register a single bg-mode
//      handle with `bgId = handle.id`. Caller invokes on shell spawn
//      with mode='bg'.
//
//   2. `bindBackgroundSurfaceToRegistry(surface, opts)` — wraps an
//      existing `BackgroundSurface`, taps onUpdate to register +
//      update + unregister entries as the rollup grows / shrinks.
//      Returns a handle whose `dispose()` clears the synced entries.

import type { SurfaceRegistry } from '../registry.js';
import { getSurfaceRegistry } from '../registry.js';

export interface BgEntryLike {
  readonly id: string;
  readonly status: string;
  readonly label?: string;
}

export interface BgRollupLike {
  readonly entries: readonly BgEntryLike[];
}

export interface BackgroundSurfaceLike {
  /** Latest rollup snapshot. */
  latest(): BgRollupLike | null;
  /** Detach all handles + tear down. */
  detach(): void;
}

export interface BgRegisterOpts {
  readonly registry?: SurfaceRegistry;
  readonly bgId: string;
  readonly kindTag?: string;        // 'shell-bg' default
  readonly title?: string;
  readonly visible?: boolean;
  readonly tier?: string;           // 'bg' default
  readonly zHint?: number;
}

export function registerBackgroundHandle(opts: BgRegisterOpts): void {
  const registry = opts.registry ?? getSurfaceRegistry();
  registry.register({
    addr: { kind: 'bg', bgId: opts.bgId },
    kindTag: opts.kindTag ?? 'shell-bg',
    surfaceId: opts.bgId,
    tier: opts.tier ?? 'bg',
    visible: opts.visible ?? true,
    ...(opts.title !== undefined ? { title: opts.title } : {}),
    ...(opts.zHint !== undefined ? { zHint: opts.zHint } : {}),
  });
}

export function unregisterBackgroundHandle(
  bgId: string,
  registry?: SurfaceRegistry,
): boolean {
  return (registry ?? getSurfaceRegistry()).unregister({ kind: 'bg', bgId });
}

export interface BindBackgroundOpts {
  readonly registry?: SurfaceRegistry;
  /** Synthetic id for the aggregate rollup entry (optional · default
   *  is no rollup entry — only per-handle entries). */
  readonly rollupId?: string;
  /** Per-handle title formatter. Default: `${entry.label ?? entry.id}`. */
  readonly titleOf?: (entry: BgEntryLike) => string;
}

export interface BgBindHandle {
  /** Mirror the current snapshot once. Returns the count registered. */
  syncNow(): number;
  dispose(): void;
}

/** Bind an existing BackgroundSurface to the SurfaceRegistry. Returns
 *  a handle that callers can tick from their own update loop (`syncNow`)
 *  or dispose to clear all bg-kind entries this bind owns.
 *
 *  Why no auto-onUpdate subscription: BackgroundSurface's onUpdate is
 *  set at construction (callback-style), so retrofitting requires the
 *  caller to compose. `syncNow()` lets callers tick from wherever they
 *  already react to bg events (status-bar refresh, /shell list slash). */
export function bindBackgroundSurfaceToRegistry(
  surface: BackgroundSurfaceLike,
  opts: BindBackgroundOpts = {},
): BgBindHandle {
  const registry = opts.registry ?? getSurfaceRegistry();
  const titleOf = opts.titleOf ?? defaultTitleOf;
  const owned = new Set<string>();

  const sync = (): number => {
    const snap = surface.latest();
    if (!snap) return 0;
    const seen = new Set<string>();
    for (const entry of snap.entries) {
      seen.add(entry.id);
      registerBackgroundHandle({
        registry,
        bgId: entry.id,
        title: titleOf(entry),
        visible: entry.status !== 'completed' && entry.status !== 'killed',
      });
      owned.add(entry.id);
    }
    if (opts.rollupId !== undefined) {
      registerBackgroundHandle({
        registry,
        bgId: opts.rollupId,
        kindTag: 'shell-bg-rollup',
        title: `bg-rollup(${snap.entries.length})`,
      });
      owned.add(opts.rollupId);
    }
    // Drop any previously-owned entries that disappeared.
    for (const id of [...owned]) {
      if (!seen.has(id) && id !== opts.rollupId) {
        registry.unregister({ kind: 'bg', bgId: id });
        owned.delete(id);
      }
    }
    return owned.size;
  };

  return {
    syncNow: sync,
    dispose() {
      for (const id of owned) registry.unregister({ kind: 'bg', bgId: id });
      owned.clear();
      try { surface.detach(); } catch { /* isolate */ }
    },
  };
}

function defaultTitleOf(entry: BgEntryLike): string {
  return entry.label ?? entry.id;
}
