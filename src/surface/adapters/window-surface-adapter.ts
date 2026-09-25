// ── IUL Phase S·a · B-13-α — WindowRegistry ↔ SurfaceRegistry wiring ──
//
// Bridges Virtual Window lifecycle (`window:create` / `window:close` /
// `window:rename` events emitted by `WindowRegistry.subscribe`) into
// `SurfaceRegistry` as `kind:'window'` surfaces. This closes the Phase
// P7-B gap where `SaveLayout` / `LoadLayout` / `ApplyLayoutPreset` and
// `GetUIState({kind:'window'})` / `ObserveSurface({kind:'window'})` all
// need a first-class address for a VW as a whole (separate from any
// individual pane it contains).
//
// Default visible=true · tier='window' string fallback (Phase Z doesn't
// yet model a window band; 'window' sorts after 'pane' and before
// 'modal' in practice because SurfaceRegistry's coerceZTier handles
// unknowns as 'modal' — acceptable default for now).
//
// Ownership: terminal-team turf. Widget-team SYNC #245 confirmed no
// consumer in widget-team code (`grep switch(addr.kind)` → 0 sites in
// widget-team tree), so this adapter is additive + safe.

import { debug } from '../../debug/log.js';
import type { RegistryEvent, WindowRegistry } from '../../virtual-windows/window-registry.js';
import type { VirtualWindow } from '../../virtual-windows/virtual-window.js';
import type { SurfaceRegistry } from '../registry.js';
import { getSurfaceRegistry } from '../registry.js';

export interface WireWindowSurfacesOpts {
  readonly windowRegistry: WindowRegistry;
  /** Default `getSurfaceRegistry()` singleton. */
  readonly surfaceRegistry?: SurfaceRegistry;
  /** Title formatter. Default `win:<id>` fallback. */
  readonly titleOf?: (win: VirtualWindow) => string;
  /** kindTag for the SurfaceRegistry entry. Default `window`. */
  readonly kindTag?: string;
}

export interface WireWindowSurfacesHandle {
  /** Count of currently mirrored windows (tests + diagnostics). */
  size(): number;
  /** Unsubscribe + unregister every mirrored entry. Idempotent. */
  dispose(): void;
}

/** Subscribe to WindowRegistry lifecycle events and mirror each live
 *  VW into SurfaceRegistry as `{kind:'window', windowId}`. `window:rename`
 *  events update the title in place. `window:close` unregisters. */
export function wireWindowSurfaces(
  opts: WireWindowSurfacesOpts,
): WireWindowSurfacesHandle {
  const surfReg = opts.surfaceRegistry ?? getSurfaceRegistry();
  const kindTag = opts.kindTag ?? 'window';
  const titleOf = opts.titleOf ?? defaultTitleOf;
  const owned = new Set<number>();

  const register = (windowId: number, title?: string): void => {
    if (owned.has(windowId)) return;
    surfReg.register({
      addr: { kind: 'window', windowId },
      kindTag,
      surfaceId: `win:${windowId}`,
      tier: 'window',
      visible: true,
      ...(title !== undefined ? { title } : {}),
    });
    owned.add(windowId);
    if (debug.enabled) {
      debug.log('window.surface.register', String(windowId), { title, owned: owned.size });
    }
  };

  const unregister = (windowId: number): void => {
    if (!owned.has(windowId)) return;
    surfReg.unregister({ kind: 'window', windowId });
    owned.delete(windowId);
    if (debug.enabled) {
      debug.log('window.surface.unregister', String(windowId), { owned: owned.size });
    }
  };

  // Prime with any windows already in the registry when we wire up
  // (dashboard boot order: WindowRegistry may spawn one VW before the
  // surface-wiring block runs, per dashboard.ts ordering).
  for (const win of opts.windowRegistry.list()) {
    register(win.id, titleOf(win));
  }

  const unsub = opts.windowRegistry.subscribe((ev: RegistryEvent) => {
    switch (ev.type) {
      case 'window:create': {
        register(ev.windowId, ev.title);
        break;
      }
      case 'window:close': {
        unregister(ev.windowId);
        break;
      }
      case 'window:rename': {
        // Update title in place — register is idempotent by id, so
        // we re-register after unregistering to refresh the stored
        // descriptor. Cheaper alternatives (surface registry has an
        // `update` method) are preferable when available.
        if (owned.has(ev.windowId)) {
          try {
            surfReg.update({ addr: { kind: 'window', windowId: ev.windowId }, title: ev.title });
          } catch {
            // Fallback: churn register entry.
            surfReg.unregister({ kind: 'window', windowId: ev.windowId });
            surfReg.register({
              addr: { kind: 'window', windowId: ev.windowId },
              kindTag,
              surfaceId: `win:${ev.windowId}`,
              tier: 'window',
              visible: true,
              title: ev.title,
            });
          }
          if (debug.enabled) {
            debug.log('window.surface.rename', String(ev.windowId), { title: ev.title });
          }
        }
        break;
      }
      default:
        // window:switch / pane:* events don't affect window surface
        // lifecycle — leave them to other adapters.
        break;
    }
  });

  return {
    size: () => owned.size,
    dispose() {
      unsub();
      for (const id of owned) surfReg.unregister({ kind: 'window', windowId: id });
      owned.clear();
    },
  };
}

function defaultTitleOf(win: VirtualWindow): string {
  return win.title ?? `win:${win.id}`;
}
