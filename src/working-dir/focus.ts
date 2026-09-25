// ── Working-dir workspace focus model (Phase 4a) ──
// Tiny pure helpers that the dashboard event loop uses to cycle pane
// focus inside the working-dir workspace. Keeping them out of the
// shell means tests can exhaustively cover the pane-per-view table
// without spinning a TUI.
//
// Each view exposes a different subset of panes — switching views
// while focus is on a pane that the new view doesn't render would
// strand the focus off-screen, so `repairFocus` is the single source
// of truth for deciding where focus goes after a view change (or any
// other state change that might have invalidated it).

import type { PaneFocus, WorkingDirView } from '../workspace-types.js';

/** Panes that the given view actually renders, in the natural left-
 *  to-right / top-to-bottom tab order used by `Tab` cycling. `input`
 *  is never included — it's always reachable via `i`/`Enter`.
 *
 *  Session 9 (Skill view) renumbered everything to a fixed 4-mode
 *  system. The old `browser | log` single-row view was dropped; the
 *  dense 4-pane layout is now the default Normal view.
 *
 *  V1: Normal    — browser + preview + sessions, log  (default)
 *  V2: Obsidian  — Working | Preview | Obsidian / Log | Scratch
 *  V3: Skill     — Skill Browser | Skill File | Preview / Log | Scratch | Working
 *  V4: (Retired · Surface-unification v2.2 V2.2-5 Part 2 · 2026-05-11) —
 *  scheduler view 폐기. V4 진입 시 V1 fallback (workflow runs surface 가
 *  recurring jobs 흡수). WorkingDirView 자체에서 4 를 dropping 하는 건
 *  별 라운드 BACKLOG. */
export function paneSetForView(view: WorkingDirView): PaneFocus[] {
  switch (view) {
    case 1: return ['browser', 'preview', 'sessions-sidebar', 'log'];
    case 2: return ['browser', 'preview', 'obsidian', 'log', 'scratch'];
    case 3: return ['skill-browser', 'skill-file', 'preview', 'log', 'scratch', 'browser'];
    case 4: return ['browser', 'preview', 'sessions-sidebar', 'log']; // V1 fallback
  }
}

/** Pane that Escape-on-empty-input drops into. First pane in tab
 *  order keeps the behavior predictable across views. */
export function firstPaneOfView(view: WorkingDirView): PaneFocus {
  return paneSetForView(view)[0]!;
}

/** Cycle pane focus. `dir=1` is Tab (forward), `dir=-1` is Shift+Tab.
 *  If `current` is not in the view's pane set (e.g. the user was on
 *  `preview` in view 1 and switched to view 2), we land on the first
 *  pane rather than preserving an off-screen cursor. */
export function nextPaneFocus(current: PaneFocus, view: WorkingDirView, dir: 1 | -1): PaneFocus {
  const panes = paneSetForView(view);
  if (panes.length === 0) return 'input';
  const i = panes.indexOf(current);
  if (i < 0) return panes[0]!;
  const n = panes.length;
  return panes[(i + dir + n) % n]!;
}

/** After a view change, repair focus if it points at a pane the new
 *  view doesn't render. `input` is always valid (not view-dependent). */
export function repairFocus(current: PaneFocus, view: WorkingDirView): PaneFocus {
  if (current === 'input') return current;
  const panes = paneSetForView(view);
  return panes.includes(current) ? current : panes[0]!;
}
