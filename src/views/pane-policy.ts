// ── Responsive working-dir pane policy ──
// Pure visibility/focus rules layered on top of working-dir views.
// The view owns the canonical pane set; this module decides which of
// those panes are renderable for the current terminal size and user
// close/zoom state.

import type { PaneFocus, WorkingDirView } from '../workspace-types.js';
import { paneSetForView } from '../working-dir/focus.js';

export type CompactLevel =
  | 'wide'       // ≥120 cols × ≥30 rows  — show everything
  | 'medium'     // ≥96  cols × ≥24 rows  — hide scratch
  | 'small'      // ≥72  cols × ≥18 rows  — hide helpers (keeps log)
  | 'tiny'       // below small, above tablet — keep primary + log
  | 'tabletTwo'  // <80  cols or <26 rows — keep required + secondary only
  | 'tabletMini';// <54  cols or <20 rows — keep required only

export type PaneOmitReason = 'user-closed' | 'too-narrow' | 'too-short' | 'zoomed' | 'modal-deferred';

export interface PaneViewport {
  cols: number;
  rows: number;
}

export interface PaneVisibilityOptions {
  closed?: ReadonlySet<PaneFocus>;
  zoomed?: PaneFocus | null;
  keepFocus?: PaneFocus;
  panes?: readonly PaneFocus[];
  omitOrder?: readonly PaneFocus[];
  primary?: PaneFocus;
  /** New: explicit 2nd-priority pane. When the viewport is at
   *  `tabletTwo`, this pane survives alongside `primary`. */
  secondary?: PaneFocus;
  /** ST4 — panes that act as a row's leadColumn. They are hidden on
   *  compact levels below `medium` so narrow terminals give the full
   *  row width to the main cells. `compileDashboardViewLayout`
   *  gracefully redistributes the `leadFrac` remainder when the pane
   *  is missing from `visiblePanes`, so we simply exclude the pane
   *  from the visible set and let the compiler do the rest. */
  leadColumnPanes?: readonly PaneFocus[];
  /** Phase T-1 — tablet mode. When true, behave like `tabletMini` and
   *  promote `log` to primary regardless of the view's default
   *  primary, so the layout collapses to "log + input prompt" with
   *  everything else reachable via `Ctrl+M <pane>`. Orthogonal to the
   *  viewport — `/tablet` manual toggle uses this even on wide
   *  terminals. `keepFocus` still overrides so a user can briefly peek
   *  at another pane without leaving tablet mode. */
  tabletMode?: boolean;
}

export interface OmittedPane {
  pane: PaneFocus;
  reason: PaneOmitReason;
}

export interface PaneVisibility {
  view: WorkingDirView;
  compactLevel: CompactLevel;
  primary: PaneFocus;
  /** Present when caller supplied options.secondary and it's part
   *  of the view's pane set. Read by UI that shows "required +
   *  secondary" labels. */
  secondary?: PaneFocus;
  visible: PaneFocus[];
  omitted: OmittedPane[];
  /** tabletMini / tabletTwo only — panes hidden but reachable by
   *  `Ctrl+M <pane>` to pop as a modal. Empty on larger viewports. */
  modalDeferred: PaneFocus[];
}

export const PRIMARY_PANE_BY_VIEW: Record<WorkingDirView, PaneFocus> = {
  1: 'browser',
  2: 'browser',
  3: 'skill-browser',
  // V4 (scheduler) retired 2026-05-11 (Surface-unification v2.2 V2.2-5
  // Part 2) — it now falls back to the V1 pane set (see
  // `paneSetForView`), so its primary pane is `browser`, not the
  // no-longer-rendered `scheduler-board`.
  4: 'browser',
};

export const OMIT_ORDER_BY_VIEW: Record<WorkingDirView, PaneFocus[]> = {
  1: ['sessions-sidebar', 'preview', 'log', 'browser'],
  2: ['scratch', 'obsidian', 'preview', 'log', 'browser'],
  3: ['scratch', 'browser', 'skill-file', 'preview', 'log', 'skill-browser'],
  // V4 mirrors the V1 fallback pane set after the scheduler retirement.
  4: ['sessions-sidebar', 'preview', 'log', 'browser'],
};

const HELPER_PANES = new Set<PaneFocus>([
  'scratch',
  'obsidian',
  'browser',
  'skill-file',
  'scheduler-inspector',
  'scheduler-paused',
  'scheduler-active',
  'scheduler-ready',
  'agent-detail',
  'agent-log',
  'debug-detail',
  'debug-stack',
  'debug-prompts',
  'sessions-sidebar',
]);

/** ST4 — leadColumn (e.g. sessions-sidebar on View 1) steals 20 % of
 *  the row width. On cramped terminals that starves the main content,
 *  so we only render it at `wide` / `medium`. Tablet levels already
 *  prune everything except primary+secondary, so they're handled
 *  there; this gate only affects `small` and `tiny`. */
export function leadColumnVisibleForLevel(level: CompactLevel): boolean {
  return level === 'wide' || level === 'medium';
}

export function compactLevelForViewport(viewport: PaneViewport): CompactLevel {
  const cols = Math.max(0, viewport.cols);
  const rows = Math.max(0, viewport.rows);
  // Ordered narrow-first so the first match wins. Tablet thresholds
  // sit inside the existing 'tiny' band so they pre-empt it.
  if (cols < 54 || rows < 20) return 'tabletMini';
  if (cols < 80 || rows < 26) return 'tabletTwo';
  if (cols < 72 || rows < 18) return 'tiny';
  if (cols < 96 || rows < 24) return 'small';
  if (cols < 120 || rows < 30) return 'medium';
  return 'wide';
}

export function isCloseablePane(view: WorkingDirView, pane: PaneFocus): boolean {
  if (pane === 'input') return false;
  if (pane === PRIMARY_PANE_BY_VIEW[view]) return false;
  return paneSetForView(view).includes(pane);
}

export function visiblePanesForView(
  view: WorkingDirView,
  viewport: PaneViewport,
  options: PaneVisibilityOptions = {},
): PaneVisibility {
  const all = [...(options.panes ?? paneSetForView(view))];
  const viewPrimary = options.primary && all.includes(options.primary)
    ? options.primary
    : all.includes(PRIMARY_PANE_BY_VIEW[view])
      ? PRIMARY_PANE_BY_VIEW[view]
      : all[0] ?? PRIMARY_PANE_BY_VIEW[view];
  // Phase T-1 — tablet mode promotes `log` to primary and collapses
  // everything else into modal-deferred (same treatment as
  // `tabletMini`). Reported in the returned `primary` field so
  // downstream callers (paneStateSnapshot, focus routing) see a
  // coherent picture.
  const tabletMode = options.tabletMode === true;
  const primary: PaneFocus = tabletMode && all.includes('log') ? 'log' : viewPrimary;
  const effectiveCompactLevel: CompactLevel = tabletMode ? 'tabletMini' : compactLevelForViewport(viewport);
  const compactLevel = compactLevelForViewport(viewport);
  const keepFocus = options.keepFocus && all.includes(options.keepFocus) ? options.keepFocus : null;
  const closed = options.closed ?? new Set<PaneFocus>();
  const omitted = new Map<PaneFocus, PaneOmitReason>();

  const mark = (pane: PaneFocus, reason: PaneOmitReason): void => {
    if (pane === primary) return;
    if (keepFocus === pane) return;
    if (!omitted.has(pane)) omitted.set(pane, reason);
  };

  const secondary = options.secondary && all.includes(options.secondary) ? options.secondary : undefined;

  if (options.zoomed && all.includes(options.zoomed)) {
    for (const pane of all) {
      if (pane !== options.zoomed) omitted.set(pane, 'zoomed');
    }
    return {
      view,
      compactLevel,
      primary,
      secondary,
      visible: [options.zoomed],
      omitted: all.filter(p => p !== options.zoomed).map(pane => ({ pane, reason: 'zoomed' })),
      modalDeferred: [],
    };
  }

  for (const pane of all) {
    if (closed.has(pane) && pane !== primary) {
      omitted.set(pane, 'user-closed');
    }
  }

  const omitOrder = [...(options.omitOrder ?? OMIT_ORDER_BY_VIEW[view])];
  const reasonForWidth: PaneOmitReason = viewport.cols < 96 ? 'too-narrow' : 'too-short';
  const modalDeferred = new Set<PaneFocus>();

  // Tablet levels — aggressive prune but record what was pruned so
  // Ctrl+M can re-open. Uses `modal-deferred` reason to distinguish
  // from "user-closed" + "zoomed".
  if (effectiveCompactLevel === 'tabletMini') {
    for (const pane of all) {
      if (pane === primary) continue;
      if (pane === keepFocus) continue;
      omitted.set(pane, 'modal-deferred');
      modalDeferred.add(pane);
    }
  } else if (effectiveCompactLevel === 'tabletTwo') {
    for (const pane of all) {
      if (pane === primary) continue;
      if (pane === secondary) continue;
      if (pane === keepFocus) continue;
      omitted.set(pane, 'modal-deferred');
      modalDeferred.add(pane);
    }
  } else if (effectiveCompactLevel === 'medium') {
    mark('scratch', viewport.cols < 120 ? 'too-narrow' : 'too-short');
  } else if (effectiveCompactLevel === 'small') {
    for (const pane of omitOrder) {
      if (pane === primary) continue;
      if (pane === 'log') continue;
      if (HELPER_PANES.has(pane) || pane === 'scratch') mark(pane, reasonForWidth);
    }
  } else if (effectiveCompactLevel === 'tiny') {
    for (const pane of omitOrder) {
      if (pane === primary || pane === keepFocus) continue;
      mark(pane, viewport.cols < 72 ? 'too-narrow' : 'too-short');
    }
  }

  // ST4 — leadColumn gate. Kicks in at `small` and below (tablet
  // levels already demoted everything via modal-deferred; `wide` /
  // `medium` leave leadColumn intact). Reuses `reasonForWidth` so the
  // omitted entry's reason matches neighboring compact prunes.
  if (!leadColumnVisibleForLevel(compactLevel) && options.leadColumnPanes && options.leadColumnPanes.length > 0) {
    for (const pane of options.leadColumnPanes) {
      if (!all.includes(pane)) continue;
      if (pane === primary) continue;
      if (pane === keepFocus) continue;
      if (!omitted.has(pane)) omitted.set(pane, reasonForWidth);
    }
  }

  let visible = all.filter(p => !omitted.has(p));
  if (visible.length === 0) visible = [primary];
  if (keepFocus && !visible.includes(keepFocus) && !closed.has(keepFocus)) {
    visible.push(keepFocus);
    omitted.delete(keepFocus);
    modalDeferred.delete(keepFocus);
  }

  return {
    view,
    compactLevel,
    primary,
    secondary,
    visible,
    omitted: all
      .filter(pane => omitted.has(pane))
      .map(pane => ({ pane, reason: omitted.get(pane)! })),
    modalDeferred: [...modalDeferred],
  };
}

export function isPaneVisible(
  pane: PaneFocus,
  view: WorkingDirView,
  viewport: PaneViewport,
  options: PaneVisibilityOptions = {},
): boolean {
  if (pane === 'input') return true;
  return visiblePanesForView(view, viewport, options).visible.includes(pane);
}

export function repairFocusForVisiblePanes(
  current: PaneFocus,
  view: WorkingDirView,
  viewport: PaneViewport,
  options: PaneVisibilityOptions = {},
): PaneFocus {
  if (current === 'input') return current;
  const visibility = visiblePanesForView(view, viewport, { ...options, keepFocus: current });
  if (visibility.visible.includes(current)) return current;
  return visibility.visible[0] ?? PRIMARY_PANE_BY_VIEW[view];
}

export function nextVisiblePaneFocus(
  current: PaneFocus,
  view: WorkingDirView,
  dir: 1 | -1,
  viewport: PaneViewport,
  options: PaneVisibilityOptions = {},
): PaneFocus {
  const visible = visiblePanesForView(view, viewport, options).visible;
  if (visible.length === 0) return PRIMARY_PANE_BY_VIEW[view];
  const i = visible.indexOf(current);
  if (i < 0) return visible[0]!;
  const n = visible.length;
  return visible[(i + dir + n) % n]!;
}
