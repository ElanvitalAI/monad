// ─────────────────────────────────────────────────────────────────
// Context-menu dashboard wire — CMX-2 (PLAN-context-menu-primitive.md
// §6.4).
//
// Role
// ────
//   Single entry point that composes the 3 standalone modules into
//   one object dashboard.ts can mount / dispose:
//     - ContextMenuRegistry (Menu data + handles + showMenu)
//     - MenuProviderRegistry (HitKey → Menu lookup)
//     - onPick callback dispatch (caller-injected action handler)
//
//   Dashboard's right-click dispatcher calls `onMouse(ev)` AFTER
//   hitTarget attachment. When the hit resolves to a provider-
//   supplied menu, we register it transiently, show it at the
//   cursor position, and forward the MenuResult to onPick. No menu
//   → return false (dispatcher falls through to legacy paths).
//
// Why this shape
// ──────────────
//   - Dashboard's touch stays small (~12 LOC · same magnitude as
//     DragSession wire · drag-session-dashboard-wire.ts).
//   - Composition logic + unit-testable seams live here.
//   - Parallel to `wireDragSessionToDashboard` — the two primitives
//     expose the same dispose / onMouse pattern so future
//     cross-primitive state sharing (e.g. "close context menu when
//     drag begins") has a consistent surface.
//
// Non-goals
// ─────────
//   - Rendering (registry presenter handles it).
//   - Key routing (ModalLifecycle 'menu' tier routes via routeToModal
//     · no dispatcher touch needed).
//   - Provider registration (the dashboard registers providers
//     elsewhere at pane/widget init · this wire only resolves them).

import type { DisplayMouseEvent } from './display/types.js';
import type {
  ContextMenuRegistry,
  MenuHandle,
  MenuResult,
} from './ui/context-menu-registry.js';
import type {
  MenuProviderRegistry,
  MenuBuildContext,
} from './ui/context-menu-providers.js';
import { debug } from './debug/log.js';
import { normalizeWorkspaceOwnerId } from './display/workspace-affinity.js';

export interface ContextMenuDashboardWireOpts {
  /** Headless registry that owns Menu data + handles. Typically
   *  `getDashboardContextMenuRegistry()`. */
  readonly registry: ContextMenuRegistry;
  /** Provider lookup. Registered at pane/widget mount time by
   *  feature owners. */
  readonly providers: MenuProviderRegistry;
  /** Called when the user picks a menu entry OR dismisses. The wire
   *  passes the hit that opened the menu + the result. Consumers
   *  dispatch actions keyed on `(hitKey, result.value)`. Fire-and-
   *  forget — async handlers OK. */
  readonly onPick: (
    ev: DisplayMouseEvent,
    result: MenuResult,
  ) => void | Promise<void>;
  /** Optional live context passed to every MenuProvider invocation.
   *  Consumers wire this to read clipboard / selection / focused pane
   *  on-demand. Default: empty record. */
  readonly buildContext?: () => MenuBuildContext;
  /** Resolve workspace affinity for the popup opened from this mouse
   *  event. Defaults to dashboard-main when omitted. */
  readonly ownerWorkspaceIdForEvent?: (ev: DisplayMouseEvent) => string | undefined;
}

export interface ContextMenuDashboardWire {
  /** Dashboard calls this AFTER mouseWiring.handleMouse attached the
   *  hitTarget. Returns `true` when the event was consumed (dispatcher
   *  should stop). Returns `false` on:
   *    - Non-right-click event types
   *    - Right-click on an unknown / unprovidered hit
   *    - Missing hitTarget (dispatcher classifier didn't populate) */
  onMouse(ev: DisplayMouseEvent): boolean;
  /** Release resources. Currently a no-op (registry + providers are
   *  owned by dashboard, not this wire), but kept for symmetry with
   *  the DragSession wire's dispose chain. */
  dispose(): void;
}

export function wireContextMenuToDashboard(
  opts: ContextMenuDashboardWireOpts,
): ContextMenuDashboardWire {
  // Transient handles — one per open show cycle. Stored so we can
  // unregister after the menu resolves (keeps the registry clean
  // rather than accumulating stale handles).
  const transientHandles = new Set<MenuHandle>();
  let disposed = false;

  const onMouse = (ev: DisplayMouseEvent): boolean => {
    if (disposed) return false;
    if (ev.type !== 'right-click') return false;
    if (!ev.hitTarget) return false;

    const ctx = opts.buildContext?.() ?? {};
    const menu = opts.providers.resolve(ev.hitTarget, ctx);
    if (!menu) return false;

    const handle = opts.registry.registerMenu(menu);
    transientHandles.add(handle);

    if (debug.enabled) {
      debug.log('context-menu-wire.show', ev.hitTarget.kind, {
        row: ev.row,
        col: ev.col,
        itemCount: menu.items.length,
      });
    }

    // Position: registry uses 0-indexed (x, y) — translate from
    // DisplayMouseEvent 1-indexed (col, row).
    const pos = { x: Math.max(0, ev.col - 1), y: Math.max(0, ev.row - 1) };

    // CMX-3 · pass the same ctx the provider received through to
    // the presenter. Any predicate-based `disabled` fields
    // evaluate against it at flatten time so "grey out Paste
    // when clipboard empty" works without menu rebuilds.
    const showOpts = {
      context: ctx,
      singleInstance: true,
      ownerWorkspaceId: normalizeWorkspaceOwnerId(
        opts.ownerWorkspaceIdForEvent?.(ev),
      ),
    };

    // Kick off the show; `showMenu` is async. We don't await — the
    // return value `true` (consumed) propagates synchronously; the
    // result is handled in the .then() block. Errors rejected from
    // showMenu are swallowed (registry caller logs its own) so the
    // host mouse chain never crashes.
    opts.registry.showMenu(handle, pos, showOpts).then(
      (result) => {
        transientHandles.delete(handle);
        opts.registry.unregisterMenu(handle);
        if (debug.enabled) {
          debug.log('context-menu-wire.pick', String(result.reason), {
            value: result.value,
          });
        }
        try { void opts.onPick(ev, result); }
        catch { /* host owns its error surface */ }
      },
      () => {
        transientHandles.delete(handle);
        try { opts.registry.unregisterMenu(handle); }
        catch { /* swallow */ }
      },
    );

    return true;
  };

  return {
    onMouse,
    dispose() {
      if (disposed) return;
      disposed = true;
      // Clean up any still-open transient handles (should normally
      // be empty — showMenu resolves async on dismiss/pick).
      for (const h of transientHandles) {
        try { opts.registry.unregisterMenu(h); }
        catch { /* swallow */ }
      }
      transientHandles.clear();
    },
  };
}
