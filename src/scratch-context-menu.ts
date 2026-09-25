// ─────────────────────────────────────────────────────────────────
// Scratch pane context menu — CMX-5.1 second non-pill consumer of
// MenuProviderRegistry, mirrors browser-context-menu.ts layout.
//
// Role
// ────
//   Provides a menu for `pane-body:wd-scratch`. Actions target the
//   live `scratchLines` buffer owned by dashboard.ts (DS-4a landed
//   it as the append target; CMX-5.1 now offers meta-operations
//   against the same buffer from right-click).
//
// Actions (MVP)
// ─────────────
//   - Clear scratch            (predicate: disabled when empty)
//   - Copy all to clipboard    (predicate: disabled when empty)
//   - Export to /tmp file      (always enabled · writes timestamped file)
//
// Why CMX-3 predicate
// ───────────────────
//   Classic VSCode-style "grey Paste when clipboard empty" pattern.
//   The menu is registered once at pane mount; predicates evaluate
//   at right-click time against `buildContext()` — no caller-side
//   rebuild when scratchLines changes between renders. This file is
//   the first production consumer of the predicate feature (CMX-3
//   unit tests proved the mechanism; this proves it's ergonomic).
//
// Design note · payload carries state snapshot
// ──────────────────────────────────────────────
//   CMX-0 `payload` on each item captures `{ lineCount, totalBytes }`
//   at build time so the onPick handler can render an accurate
//   receipt ("copied 12 lines · 847 bytes") without a second
//   scratchLines read. Payload shape is `ScratchMenuPayload`.

import type {
  MenuProviderRegistry,
  MenuProvider,
  MenuBuildContext,
} from './ui/context-menu-providers.js';
import type {
  Menu,
  MenuItem,
} from './ui/context-menu-registry.js';
import type { HitTarget } from './display/types.js';

/** Payload attached to every scratch-menu item at build time. Lets
 *  the onPick handler narrow without a second scratchLines read. */
export interface ScratchMenuPayload {
  readonly lineCount: number;
  readonly totalBytes: number;
}

/** Build context keys this provider expects. Dashboard must include
 *  `scratchLineCount: number` on every buildContext call — it's the
 *  single source of truth the predicates read. */
export interface ScratchMenuBuildContext extends MenuBuildContext {
  readonly scratchLineCount?: unknown;  // Narrowed at predicate time.
}

export interface ScratchContextMenuDeps {
  /** Live getter — returns the current scratch line count. Invoked
   *  at menu build time (provider.resolve) to populate the payload.
   *  Dashboard wires this to `() => scratchLines.length`. */
  readonly getLineCount: () => number;
  /** Live getter — returns total bytes in scratch. Optional; when
   *  omitted, the payload reports 0 bytes. */
  readonly getTotalBytes?: () => number;
}

/** Predicate: disable when scratch is empty. Exported for test
 *  inspection + reuse. Reads `scratchLineCount` from the eval ctx
 *  passed at show time; falls back to `true` (disabled) if the key
 *  is missing — fail-safe since an empty-scratch action is a no-op. */
export function isScratchEmpty(ctx: MenuBuildContext): boolean {
  const raw = (ctx as { scratchLineCount?: unknown }).scratchLineCount;
  if (typeof raw !== 'number') return true;
  return raw <= 0;
}

/** Build the pane-body:wd-scratch Menu. Pure over deps + hit.
 *  Returns a Menu snapshot with item payloads capturing the current
 *  scratch summary so onPick can print a receipt. */
export function createScratchBodyMenuProvider(
  deps: ScratchContextMenuDeps,
): MenuProvider {
  return (_hit: HitTarget, _ctx: MenuBuildContext): Menu | null => {
    const lineCount = deps.getLineCount();
    const totalBytes = deps.getTotalBytes?.() ?? 0;
    const payload: ScratchMenuPayload = { lineCount, totalBytes };

    const items: MenuItem[] = [
      {
        kind: 'command',
        id: 'scratch.clear',
        label: `Clear scratch${lineCount > 0 ? ` (${lineCount} lines)` : ''}`,
        payload,
        // CMX-3 predicate · disabled when empty. Evaluated at show
        // time against buildContext · dashboard updates
        // scratchLineCount on every right-click via its buildContext
        // closure, so this stays accurate without a menu rebuild.
        disabled: isScratchEmpty,
      },
      {
        kind: 'command',
        id: 'scratch.copy-all',
        label: 'Copy all to clipboard',
        payload,
        disabled: isScratchEmpty,
      },
      { kind: 'separator' },
      {
        kind: 'command',
        id: 'scratch.export',
        label: 'Export to /tmp file',
        payload,
        // Always enabled — empty export is valid (produces empty file).
      },
    ];

    return { id: 'pane-body:wd-scratch', title: 'Scratch', items };
  };
}

/** Register the scratch provider with a registry. Returns a disposer
 *  that unregisters. Mirrors registerBrowserContextMenus pattern. */
export function registerScratchContextMenus(
  providers: MenuProviderRegistry,
  deps: ScratchContextMenuDeps,
): () => void {
  const unreg = providers.register(
    'pane-body:wd-scratch',
    createScratchBodyMenuProvider(deps),
  );
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    try { unreg(); } catch { /* swallow */ }
  };
}
