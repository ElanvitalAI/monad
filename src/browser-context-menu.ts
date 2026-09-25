// ─────────────────────────────────────────────────────────────────
// Browser pane context menu — CMX-2 first production consumer of
// MenuProviderRegistry (PLAN-context-menu-primitive.md §9 Phase 3).
//
// Role
// ────
//   Provides menus for `pane-body:browser` (file actions against the
//   cursor entry / selection) and `pane-title:browser` (pane-level
//   actions via the buildPaneTitleMenu template · CMX-0 @template
//   marker). Wires consistently with DS-3a/4a/4c: caller owns the
//   action handlers via injected callbacks; this module is pure
//   over opts.
//
// Menu shape for pane-body:browser
// ────────────────────────────────
//   - Attach to chat                      (absPath · file only)
//   - Copy absolute path                  (absPath · always)
//   - ─────────
//   - Open in preview                     (absPath · file only · disabled for dirs)
//   - Reveal in system                    (absPath · always · macOS only today)
//
//   Dirs get a reduced menu (Copy path + Reveal only — Attach /
//   Open are marked disabled rather than hidden so the user sees
//   the action exists). Empty listing (no cursor entry) returns
//   null from the provider so the right-click falls through.
//
// Menu shape for pane-title:browser
// ─────────────────────────────────
//   Reuses buildPaneTitleMenu. Browser is the primary dashboard
//   pane · canClose / canDetach are false. canRename is also false
//   (browser doesn't have a user-facing title). canSplit follows
//   split-capable config. Leaves the menu sparse; CMX-5 wires
//   VW pane titles where Close / Detach actually apply.

import type {
  MenuProviderRegistry,
  MenuProvider,
  MenuBuildContext,
} from './ui/context-menu-providers.js';
import {
  buildPaneTitleMenu,
  type Menu,
  type MenuItem,
} from './ui/context-menu-registry.js';
import type { HitTarget } from './display/types.js';
import type { WorkingDirState } from './working-dir/index.js';
import type { BrowserActionContext } from './browser-pane/actions.js';

/** Payload shape attached to each pane-body:browser item. Handler
 *  extracts absPath + isDir without a second working-dir lookup —
 *  AppKit representedObject pattern (CMX-0). */
export interface BrowserBodyMenuPayload {
  readonly absPath: string;
  readonly isDir: boolean;
  readonly name: string;
  readonly itemIndex: number;
  readonly browserId: string;
}

export interface BrowserContextMenuDeps {
  /** Live working-dir state. Provider reads `cursor` + `entries` +
   *  `selected` on every right-click to build a snapshot menu. */
  readonly workingDirState: WorkingDirState;
  /** Optional cursor override. Lets foreground modal consumers reuse
   *  the browser menu shape while sourcing the active row from a
   *  modal-local browser widget instance rather than the background
   *  dashboard browser. */
  readonly getCursorIndex?: (browserId?: string) => number | null;
  readonly resolveActionContext?: (hit: HitTarget) => BrowserActionContext | null;
  /** Invoked by the pane-title 'pane.split.h' / 'pane.split.v' ids.
   *  Optional · omit to leave split items disabled. */
  readonly onSplit?: (direction: 'horizontal' | 'vertical') => void;
  /** Production paneId the browser widget reports in HitTarget.
   *  Dashboard spawns with `id: 'wd-browser'` (dashboard.ts:5300)
   *  so real hits arrive as `{kind:'pane-body', paneId:'wd-browser'}`.
   *  Pre-2026-04-22 provider register keys used `'pane-body:browser'`
   *  which never matched production hits → browser context menu
   *  never appeared in production. Default matches production; test
   *  fixtures using `'browser'` must pass the same string here. */
  readonly paneId?: string;
}

const DEFAULT_BROWSER_PANE_ID = 'wd-browser';

/** Build a pane-body:browser provider. Returns null when the
 *  working-dir listing is empty — caller's right-click falls
 *  through to modal forwarding. */
export function createBrowserBodyMenuProvider(
  deps: BrowserContextMenuDeps,
): MenuProvider {
  return (hit: HitTarget, _ctx: MenuBuildContext): Menu | null => {
    const actionContext = deps.resolveActionContext?.(hit) ?? {
      paneId: deps.paneId ?? DEFAULT_BROWSER_PANE_ID,
      browserId: deps.paneId ?? DEFAULT_BROWSER_PANE_ID,
      browser: deps.workingDirState,
    };
    const wd = actionContext.browser;
    const pointerIdx =
      hit.kind === 'pane-body' && hit.hit?.kind === 'list-row'
        ? hit.hit.itemIndex
        : hit.kind === 'modal-body' && typeof hit.itemIndex === 'number'
          ? hit.itemIndex
          : null;
    // Prefer selection (multi-file) · fall back to cursor entry.
    // We show a single menu for the "primary" entry — selection
    // just means the action applies to the full set when run.
    const cursorIndex = pointerIdx ?? deps.getCursorIndex?.(actionContext.browserId) ?? wd.cursor;
    const cursor = cursorIndex == null ? null : wd.entries[cursorIndex];
    if (!cursor) return null;
    // `..` has no actionable semantics (navigate-only) — skip menu.
    if (cursor.name === '..') return null;

    const payload: BrowserBodyMenuPayload = {
      absPath: cursor.absPath,
      isDir: cursor.isDir,
      name: cursor.name,
      itemIndex: cursorIndex,
      browserId: actionContext.browserId,
    };
    const items: MenuItem[] = [
      {
        kind: 'command',
        id: 'browser.attach',
        label: cursor.isDir ? 'Attach from directory' : 'Attach to chat',
        payload,
      },
      {
        kind: 'command',
        id: 'browser.copy-path',
        label: 'Copy absolute path',
        payload,
      },
      { kind: 'separator' },
      {
        kind: 'command',
        id: 'browser.open',
        label: cursor.isDir ? 'Enter directory' : 'Open in preview',
        payload,
      },
      {
        kind: 'command',
        id: 'browser.reveal',
        label: 'Reveal in system',
        payload,
      },
    ];

    const title = cursor.isDir
      ? `${cursor.name}/`
      : cursor.name;
    return { id: `pane-body:${cursor.absPath}`, title, items };
  };
}

/** Build a pane-title:browser provider. Uses buildPaneTitleMenu
 *  template with conservative flags (browser is the primary pane).
 *  Returns null when no pane-title actions are configured — kept
 *  present but conservative so consumers see the primitive is
 *  wired even if nothing's enabled yet. */
export function createBrowserTitleMenuProvider(
  deps: BrowserContextMenuDeps,
): MenuProvider {
  const paneId = deps.paneId ?? DEFAULT_BROWSER_PANE_ID;
  return (): Menu | null => {
    // Browser is the primary dashboard pane — Close / Detach /
    // Rename are false. Only Split applies and only when handler
    // is wired.
    const canSplit = deps.onSplit !== undefined;
    if (!canSplit) return null;
    return buildPaneTitleMenu({
      paneId,
      canClose: false,
      canRename: false,
      canSplit: true,
      canDetach: false,
    });
  };
}

/** Register both providers with a MenuProviderRegistry using the
 *  production paneId (`'wd-browser'` default · overridable via
 *  deps.paneId). Returns a disposer that removes both. Idempotent
 *  per DS-4c wire pattern. */
export function registerBrowserContextMenus(
  providers: MenuProviderRegistry,
  deps: BrowserContextMenuDeps,
): () => void {
  const paneId = deps.paneId ?? DEFAULT_BROWSER_PANE_ID;
  const unregBody = providers.register(
    `pane-body:${paneId}`,
    createBrowserBodyMenuProvider(deps),
  );
  const unregTitle = providers.register(
    `pane-title:${paneId}`,
    createBrowserTitleMenuProvider(deps),
  );
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    try { unregBody(); } catch { /* swallow */ }
    try { unregTitle(); } catch { /* swallow */ }
  };
}
