// ── List widget ──
// Generic array-of-rows renderer with cursor + optional selection set.
// Reusable across skills / servers / services / personas / anything.
// Pure: same (state, ctx, character) → same lines. Scroll-offset
// adjust happens inside render so callers never touch offsets directly.
//
// Phase 7 Batch C (2026-04-20) — list widget declares the Cursorable
// behavior so pane handlers using `dispatchKeyToWidget` get j/k/g/G/
// Home/End routed declaratively. The existing onKey is retained for
// direct-call sites (5 other list-backed panes: wd-browser /
// wd-obsidian / wd-skill-browser / wd-skill-file / wd-working-browser)
// that still invoke widget.onKey without the dispatcher. When
// dispatcher routes a key, Cursorable claims j/k/g/G first so the
// onKey fallback only sees space/a — no conflict.

import type { Widget, WidgetHitDescriptor } from '../../src/widgets/types.js';
import { C, visibleWidth } from '../../src/tui.js';
import { paneTitle } from '../../src/panes/pane-title.js';
import {
  cursorable,
  hoverTint,
  applyHoverableListRowEvent,
} from '../../src/widget-behaviors/index.js';

export interface ListWidgetState {
  items: string[];
  cursor: number;
  offset: number;
  selected: Set<string>;
  /** Optional prefix icon per item (same index as items). Empty string = no icon. */
  icons?: string[];
  /** True when this widget is the focused one — drives cursor color. */
  focused: boolean;
  /** When true, items may already contain ANSI color codes; the widget
   *  skips its own focus/dim wrap for non-cursor non-selected rows so
   *  the per-item coloring (file icons, syntax-tinted names, etc.)
   *  shines through. Cursor + selection still highlight the row to
   *  preserve the usual TUI affordance. Defaults to false. */
  preserveAnsi?: boolean;
  /** Arc C · v2 — optional parallel array: when `submitText[idx]` is
   *  a non-empty string, double-click / Enter on that row submits
   *  that string instead of `items[idx]`. Lets the host attach extra
   *  routing info (e.g. `folder-attach:<abs-path>`) without the
   *  widget knowing about file semantics. Fallback to `items[idx]`
   *  preserves the pre-Arc-C submit behavior for every other
   *  consumer. */
  submitText?: Array<string | undefined>;
  /** IDX-F5d Phase 2.β (2026-04-22) — currently-hovered item index.
   *  Written by `onHover(enter/leave)`; read by `render()` to paint a
   *  subtle underline tint on the hovered row (skipped when cursor /
   *  selected already provide stronger affordance). `null` = no
   *  active hover. `undefined` (pre-first-hover) is treated as null. */
  hoveredItemIndex?: number | null;
}

export interface ListWidgetConfig {
  items?: string[];
  icons?: string[];
  character?: string;
}

/** Translate a pane-local row into the absolute item index it
 *  represents, honoring scroll offset + the fixed title row.
 *
 *  Contract:
 *    • `localRow === 0` → title row → null (not a body hit)
 *    • body rows → `state.offset + bodyRow` clamped to items range
 *    • past-end rows → null (padded rows the widget painted as empty)
 *
 *  Shared by `onMouse` (click / double-click) and `describeHit` so
 *  drag / hover / ctx-menu consumers read the same index the click
 *  handler would compute. Pure — no state mutation — to keep it
 *  safely callable from read-only contexts. */
function rowToIndex(state: ListWidgetState, localRow: number): number | null {
  const bodyRow = localRow - 1;
  if (bodyRow < 0) return null;
  const targetIdx = state.offset + bodyRow;
  if (targetIdx < 0 || targetIdx >= state.items.length) return null;
  return targetIdx;
}

const listWidget: Widget<ListWidgetState, ListWidgetConfig> = {
  type: 'list',
  description: 'Array renderer with cursor + multi-select',
  defaultCharacter: 'List',

  // Phase 7 Batch C: declarative cursor keymap. Cursorable handles
  // j/k/↑↓, g/G, Home/End against state.cursor via the items.length
  // injector. Widget onKey still handles space/a for select-toggle +
  // select-all, and retains the j/k/g/G path as a fallback for
  // direct-call sites that haven't migrated to the dispatcher.
  behaviors: [
    cursorable<ListWidgetState>({
      getItemCount: (s) => s.items.length,
    }),
  ],

  initialState(config) {
    return {
      items: config?.items ?? [],
      icons: config?.icons,
      cursor: 0,
      offset: 0,
      selected: new Set(),
      focused: false,
    };
  },

  render(state, ctx, character) {
    const lines: string[] = [];
    const w = ctx.width;
    const h = ctx.height;
    if (h < 1) return lines;

    const hasTitle = h >= 2;
    const titleRow = hasTitle ? paneTitle(character, ctx.focused, w) : '';
    if (titleRow) lines.push(titleRow);

    const bodyH = Math.max(0, h - (titleRow ? 1 : 0));
    if (bodyH === 0) return lines;

    // Scroll-offset adjust — keep cursor in view
    let offset = state.offset;
    if (state.cursor < offset) offset = state.cursor;
    if (state.cursor >= offset + bodyH) offset = state.cursor - bodyH + 1;
    offset = Math.max(0, Math.min(offset, Math.max(0, state.items.length - bodyH)));
    // Record back — mutation is confined to this field, caller can ignore
    state.offset = offset;

    for (let i = 0; i < bodyH; i++) {
      const idx = offset + i;
      if (idx >= state.items.length) {
        lines.push(' '.repeat(w));
        continue;
      }
      const item = state.items[idx]!;
      const icon = state.icons?.[idx] ?? '';
      const isCur = idx === state.cursor;
      const isSel = state.selected.has(item);
      // IDX-F5d Phase 2.β — hover tint suppressed when cursor or
      // selected already provide stronger affordance · avoids
      // redundant highlighting on the same row.
      const isHov = !isCur && !isSel && state.hoveredItemIndex === idx;
      const mark = isSel ? '\u25CF' : '\u25CB';  // ● / ○
      const raw = icon ? ` ${mark} ${icon} ${item}` : ` ${mark} ${item}`;
      const padded = raw + ' '.repeat(Math.max(0, w - visibleWidth(raw)));

      if (isCur && ctx.focused) lines.push(C.cursor(padded));
      else if (isCur) lines.push(C.cursorAlt(padded));
      else if (isSel) lines.push(C.success(padded));
      else if (isHov) lines.push(hoverTint(ctx.focused ? C.text(padded) : C.subtext(padded)));
      else if (state.preserveAnsi) lines.push(padded);     // keep per-item colors
      else if (ctx.focused) lines.push(C.text(padded));
      else lines.push(C.subtext(padded));
    }
    return lines;
  },

  onKey(ev, state) {
    switch (ev.name) {
      case 'j': case 'down':
        state.cursor = Math.min(state.cursor + 1, state.items.length - 1);
        return { type: 'refresh' };
      case 'k': case 'up':
        state.cursor = Math.max(state.cursor - 1, 0);
        return { type: 'refresh' };
      case 'g': case 'home':
        state.cursor = 0;
        state.offset = 0;
        return { type: 'refresh' };
      case 'G': case 'end':
        state.cursor = Math.max(0, state.items.length - 1);
        return { type: 'refresh' };
      case 'space': case '*': {
        const name = state.items[state.cursor];
        if (name) {
          state.selected.has(name) ? state.selected.delete(name) : state.selected.add(name);
          state.cursor = Math.min(state.cursor + 1, state.items.length - 1);
        }
        return { type: 'refresh' };
      }
      case 'a': {
        if (state.selected.size === state.items.length) state.selected.clear();
        else state.items.forEach(i => state.selected.add(i));
        return { type: 'refresh' };
      }
      default:
        return { type: 'none' };
    }
  },

  /** Mouse handler — click-to-select rows and scroll-wheel navigation.
   *  Row 0 is the title (not clickable); rows 1..N map to items
   *  `offset..offset+N-1`. A click on an empty row past the end is a
   *  no-op. Scroll wheel nudges the cursor by 3 which matches the
   *  other LC widgets (select-view / list-view).
   *
   *  MD6 — double-click activates: the cursor moves to the clicked row
   *  and the widget returns `{ type: 'submit', text }` so the dashboard
   *  dispatches it through `dispatchSidebarSubmit` — the same code
   *  path Enter takes. This is what makes wd-browser usable with only
   *  the mouse (single click = survey, double click = open).
   *
   *  IDX-F5d (2026-04-22) — click / double-click use the shared
   *  `rowToIndex` helper that `describeHit` also calls; this removes
   *  a subtle duplication that caused the click path to fire but the
   *  drag path (routed elsewhere) to miss the same (row→index) math. */
  onMouse(ev, state) {
    if (ev.type === 'scroll-up') {
      state.cursor = Math.max(0, state.cursor - 3);
      return { type: 'refresh' };
    }
    if (ev.type === 'scroll-down') {
      state.cursor = Math.min(Math.max(0, state.items.length - 1), state.cursor + 3);
      return { type: 'refresh' };
    }
    if (ev.type === 'click' || ev.type === 'double-click') {
      const targetIdx = rowToIndex(state, ev.row);
      if (targetIdx !== null) {
        state.cursor = targetIdx;
        if (ev.type === 'double-click') {
          // Arc C · v2 — host may override the submitted text per row
          // via the optional `submitText` parallel array. Used by the
          // dashboard wd-browser to tag folder rows with a
          // `folder-attach:<abs-path>` prefix so dispatchSidebarSubmit
          // can open the folder picker modal. Falls back to the raw
          // item label so non-file consumers (agent-roster,
          // scheduler-task-list, etc.) keep their current behavior.
          const override = state.submitText?.[targetIdx];
          const text = override && override.length > 0
            ? override
            : state.items[targetIdx]!;
          return { type: 'submit', text };
        }
        return { type: 'refresh' };
      }
    }
    return { type: 'none' };
  },

  /** IDX-F5d (2026-04-22) — widget-owned hit-test refinement.
   *
   *  Converts pane-local `(localRow, localCol)` into a `list-row`
   *  descriptor carrying the absolute item index the row resolves to.
   *  The wiring layer (`getPaneHitTarget`) calls this and stores the
   *  result under `HitTarget.pane-body.hit`, making mouse events
   *  self-describing for drag / hover / context-menu consumers that
   *  don't have widget-internal state access.
   *
   *  Null return paths:
   *    • click landed on the title row (bodyRow < 0)
   *    • click landed past the end of the visible items
   *    • state.items is empty (nothing to hit)
   *
   *  Column is unused today — lists are row-addressed — but the
   *  parameter is kept so future list variants (split columns, multi-
   *  column mosaic) can refine to `{kind:'table-cell', row, col}`
   *  without breaking the method signature. */
  describeHit(state, _ctx, localRow, _localCol) {
    const idx = rowToIndex(state, localRow);
    if (idx === null) return null;
    return { kind: 'list-row', itemIndex: idx };
  },

  /** IDX-F5d Phase 2.β (2026-04-22) — hover event receiver.
   *
   *  Tracks `state.hoveredItemIndex` so `render()` can paint a subtle
   *  underline on the hovered row (suppressed when the row is already
   *  cursor / selected). Emits telemetry on enter / leave so the
   *  Phase W timeline recorder can reconstruct hover history.
   *
   *  Requests a render on every enter / leave because the visual
   *  transition depends on the field this handler just changed.
   *  hover-over fires on every pointer tick inside the same row —
   *  no-op there since the field didn't change. */
  onHover(ev, state, ctx) {
    applyHoverableListRowEvent(ev, state, ctx, 'list');
  },

  // WR-1 (2026-04-20 · IUL Phase W prereq) — opt-in state observation.
  // Emits telemetry on cursor + selection changes so timeline recorders
  // + debug dashboards can reconstruct list interaction without
  // re-parsing ANSI. Telemetry sink is optional; absent → no-op.
  onStateChange(prev, next, ctx) {
    if (prev.cursor !== next.cursor) {
      ctx.telemetry?.emit({
        kind: 'list.cursor.change',
        data: { from: prev.cursor, to: next.cursor, total: next.items.length },
      });
    }
    if (prev.selected !== next.selected) {
      ctx.telemetry?.emit({
        kind: 'list.selection.change',
        data: { count: next.selected.size },
      });
    }
  },

  // WR-2 (Bundle 5W · 2026-04-20) — observation extras.
  // Hash covers cursor + selection count + focus bit + total items —
  // enough to distinguish "something interesting changed" from "same
  // frame". Includes `items.length` so row-set replacement also bumps
  // the hash (list-swap scenarios like filter apply).
  snapshotHash(state): string {
    return `${state.cursor}:${state.selected.size}:${state.focused ? 1 : 0}:${state.items.length}`;
  },

  // Human summary — one line per DESIGN §1.5. Selected count only
  // appears when non-zero to keep the default case terse.
  describeSurface(state, ctx): string {
    const parts = [ctx.character, `${state.items.length} items`, `cursor ${state.cursor}`];
    if (state.selected.size > 0) parts.push(`${state.selected.size} selected`);
    return parts.join(' · ');
  },

  configSchema() {
    return {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'string' },
          description: 'Row labels · one per list entry.',
        },
        icons: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional per-row icon prefix · parallel array to items · empty string = no icon.',
        },
        character: {
          type: 'string',
          description: 'Widget character / title override · falls back to defaultCharacter.',
        },
      },
      additionalProperties: false,
    };
  },
};

export default listWidget;
