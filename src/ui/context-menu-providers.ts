// CMX-1 · Menu provider registry — HitKey → Menu lookup.
//
// Role
// ────
//   Sits between the right-click dispatcher (dashboard-mouse-wiring)
//   and the Menu registry (context-menu-registry.ts). Right-click
//   arrives with a classified HitTarget; the dispatcher computes a
//   HitKey from it; the provider registry returns the Menu to show
//   (or null to skip). The Menu is then handed to
//   registry.registerMenu → showMenu.
//
// Why a separate module
// ─────────────────────
//   The `ContextMenuRegistry` is the data + display primitive — it
//   knows nothing about hit targets. The dispatcher is the UX
//   primitive — it knows nothing about what menu to show. This
//   module is the ONLY layer that knows the mapping
//   (HitKey → MenuProvider). Separating it lets us:
//     - Register providers from anywhere (pane mount time · widget
//       init · plugin load) without touching the dispatcher.
//     - Swap whole provider sets per workspace / per user (future
//       · plugin-contributed menus).
//     - Test menu resolution without a dashboard harness.
//
// HitKey convention (PLAN §8.2)
// ──────────────────────────────
//   'pill:<PillName>'          — status-bar pill (e.g. 'pill:model')
//   'pane-body:<paneId>'       — specific pane body
//   'pane-body:*'              — any pane body (wildcard fallback)
//   'pane-title:<paneId>'      — specific pane title
//   'pane-title:*'             — any pane title
//   'pane-nav-tab:<paneId>'    — specific pane nav tab
//   'pane-nav-tab:*'           — any pane nav tab
//   'input:<inputId>'          — specific input (e.g. 'input:chat-main')
//   'input:*'                  — any input
//   'vw-pane-body:<windowId>:<paneId>' — VW pane body
//   'vw-pane-body:*'           — any VW pane body
//   'vw-pane-title:<windowId>:<paneId>' — VW pane title
//   'vw-pane-title:*'          — any VW pane title
//   'status-bar'               — status bar (no specifier)
//
// Resolve order (first-match wins)
// ─────────────────────────────────
//   1. Specific match (with paneId/inputId/pillName)
//   2. Wildcard match (kind:*)
//   3. null (no provider → dispatcher renders no menu)

// NOTE · use display HitTarget (not input-core). Right-click events
// flow in as DisplayMouseEvent from dashboard-mouse-wiring, and the
// display union has superset kinds (modal-body / modal-button) the
// input-core mirror lacks today. CMX-2 dispatcher passes
// `ev.hitTarget` directly without translation.
import type { HitTarget } from '../display/types.js';
import type { Menu } from './context-menu-registry.js';
import {
  hitKeyFromHit,
  legacyHitKeyAliasesFromHit,
  wildcardHitKeyFromHit,
} from '../surface/hit-projection.js';

/** Opaque HitKey. Use `hitKey(hit)` to derive one from a HitTarget;
 *  direct string literals are allowed but typos compile-pass — stay
 *  with the helper for refactor safety. */
export type HitKey = string;

/** Build the canonical HitKey from a HitTarget. Handles every display
 *  HitTarget kind including modal-body / modal-button. VW pane keys
 *  include `windowId`; `resolve()` still accepts the pre-R8g
 *  paneId-only aliases for backward compatibility. */
export function hitKey(hit: HitTarget): HitKey {
  return hitKeyFromHit(hit);
}

/** Wildcard key corresponding to a hit kind. Used by `resolve` when
 *  a specific match is absent. Returns null for kinds that don't
 *  carry a specifier (status-bar). */
export function wildcardKey(hit: HitTarget): HitKey | null {
  return wildcardHitKeyFromHit(hit);
}

/** Caller-injectable build context. Providers may consult this to
 *  make dynamic decisions (e.g. disable "Paste" if clipboard empty).
 *  MVP leaves this as an open record — callers extend the type as
 *  needed without breaking existing providers.
 *
 *  Structurally identical to `MenuEvalContext` exported from
 *  `context-menu-registry.ts` (CMX-3) — the two names mark intent
 *  (build-time vs eval-time) but share the same shape so a ctx can
 *  be passed unchanged from provider into predicate-based disabled
 *  fields. */
export type MenuBuildContext = Readonly<Record<string, unknown>>;

/** A provider is a pure fn from (hit, ctx) → Menu | null. Returning
 *  null means "no menu for this hit" — the dispatcher falls back to
 *  the wildcard key and ultimately to no menu. */
export type MenuProvider = (
  hit: HitTarget,
  ctx: MenuBuildContext,
) => Menu | null;

export interface MenuProviderRegistry {
  /** Register a provider for a specific HitKey. Returns a dispose fn
   *  — symmetric with drag-session-wire's subscribe pattern. Calling
   *  dispose twice is a no-op. Registering the same key twice is
   *  legal — the latest registration wins, but dispose of the older
   *  still removes it. */
  register(key: HitKey, provider: MenuProvider): () => void;
  /** Look up a menu for the given hit. Tries specific match first,
   *  then wildcard, then returns null. Providers that return null
   *  are treated as "skip" — resolver continues to the next level. */
  resolve(hit: HitTarget, ctx?: MenuBuildContext): Menu | null;
  /** Count of registered providers. Useful for tests + boot-time
   *  sanity checks. */
  size(): number;
  /** Clear every registration. Test helper. */
  clear(): void;
}

export function createMenuProviderRegistry(): MenuProviderRegistry {
  // Multi-registration per key · latest-wins on resolve, all dispose
  // fns still work independently (each one removes its own entry).
  const byKey = new Map<HitKey, MenuProvider[]>();

  function register(key: HitKey, provider: MenuProvider): () => void {
    let list = byKey.get(key);
    if (!list) {
      list = [];
      byKey.set(key, list);
    }
    list.push(provider);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const cur = byKey.get(key);
      if (!cur) return;
      const idx = cur.indexOf(provider);
      if (idx >= 0) cur.splice(idx, 1);
      if (cur.length === 0) byKey.delete(key);
    };
  }

  function lookup(key: HitKey): MenuProvider | null {
    const list = byKey.get(key);
    if (!list || list.length === 0) return null;
    return list[list.length - 1]!;  // latest-wins
  }

  function resolve(
    hit: HitTarget,
    ctx: MenuBuildContext = {},
  ): Menu | null {
    // 1. canonical specific match, then any compatibility aliases.
    const specificKeys = [hitKey(hit), ...legacyHitKeyAliasesFromHit(hit)];
    for (const key of specificKeys) {
      const specific = lookup(key);
      if (!specific) continue;
      const menu = specific(hit, ctx);
      if (menu) return menu;
    }
    // 2. wildcard match
    const wk = wildcardKey(hit);
    if (wk) {
      const wild = lookup(wk);
      if (wild) {
        const menu = wild(hit, ctx);
        if (menu) return menu;
      }
    }
    // 3. no match
    return null;
  }

  function size(): number {
    let n = 0;
    for (const list of byKey.values()) n += list.length;
    return n;
  }

  function clear(): void {
    byKey.clear();
  }

  return { register, resolve, size, clear };
}
