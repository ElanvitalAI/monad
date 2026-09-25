// ── IUL Phase S·b — inline-surface adapter ──
//
// Shell Runner inline surfaces (`src/shell-runner/inline-surface.ts`)
// are created per-`ShellHandle`; there is no central registry to
// subscribe to. This adapter offers two entry shapes mirroring the
// pane-surface-adapter pattern:
//
//   1. Manual `registerInlineSurface(opts)` /
//      `unregisterInlineSurface(inlineId)` — caller-driven sync at
//      the spawn / dispose call site
//
//   2. `bindInlineSurfaceToRegistry(surface, opts)` — wraps an
//      `InlineSurface` instance, registers on bind, returns a handle
//      whose `dispose()` unregisters. Lets the dashboard wire each
//      newly-spawned surface in one line.
//
// Existing `InlineSurface.onUpdate` is the natural hook for visibility
// updates (status: completed / killed → visible:false). The wrapper
// taps onUpdate without breaking the inline surface's own consumer.

import type { SurfaceRegistry } from '../registry.js';
import { getSurfaceRegistry } from '../registry.js';

export interface InlineSurfaceLike {
  /** Latest snapshot — nullable when not yet attached. */
  latest(): { id: string; status: string; finished?: boolean } | null;
  /** detach() removes the engine subscription. We treat this as a
   *  signal that the surface is gone (caller-driven dispose). */
  detach(): void;
}

export interface InlineRegisterOpts {
  readonly registry?: SurfaceRegistry;
  readonly inlineId: string;
  readonly kindTag?: string;       // 'shell-inline' default
  readonly title?: string;
  readonly visible?: boolean;
  readonly tier?: string;          // 'inline' default
  readonly zHint?: number;
}

export function registerInlineSurface(opts: InlineRegisterOpts): void {
  const registry = opts.registry ?? getSurfaceRegistry();
  registry.register({
    addr: { kind: 'inline', inlineId: opts.inlineId },
    kindTag: opts.kindTag ?? 'shell-inline',
    surfaceId: opts.inlineId,
    tier: opts.tier ?? 'inline',
    visible: opts.visible ?? true,
    ...(opts.title !== undefined ? { title: opts.title } : {}),
    ...(opts.zHint !== undefined ? { zHint: opts.zHint } : {}),
  });
}

export function unregisterInlineSurface(
  inlineId: string,
  registry?: SurfaceRegistry,
): boolean {
  return (registry ?? getSurfaceRegistry()).unregister({ kind: 'inline', inlineId });
}

export interface BindInlineOpts extends InlineRegisterOpts {
  /** Optional callback invoked whenever the wrapped InlineSurface's
   *  underlying status flips. Receives the new visibility (true while
   *  running, false after `finished`). */
  readonly onVisibilityChange?: (visible: boolean) => void;
}

export interface InlineBindHandle {
  dispose(): void;
}

/** Bind an existing InlineSurface to the SurfaceRegistry. Returns
 *  a handle whose `dispose()` both unregisters and calls the
 *  underlying surface's `detach()`. The bind does NOT attach the
 *  inline surface to a ShellHandle — caller is responsible for
 *  the engine lifecycle; this only mirrors registry state. */
export function bindInlineSurfaceToRegistry(
  surface: InlineSurfaceLike,
  opts: BindInlineOpts,
): InlineBindHandle {
  const registry = opts.registry ?? getSurfaceRegistry();
  registerInlineSurface({ ...opts, registry });
  // Snapshot poll: callers without a true onUpdate channel can still
  // see registry state via finalize()/dispose(). InlineSurface.onUpdate
  // is opts-only at construction, so we mirror only the explicit
  // dispose path here. Visibility updates land via dashboard hooks
  // when shell-runner exposes a unified surface event bus.
  return {
    dispose() {
      try { surface.detach(); } catch { /* isolate */ }
      registry.unregister({ kind: 'inline', inlineId: opts.inlineId });
      opts.onVisibilityChange?.(false);
    },
  };
}
