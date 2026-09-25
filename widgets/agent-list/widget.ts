// ── Agent list widget ──
// Native roster view for AgentSurfaceState snapshots. The dashboard can
// keep its scratch-pane adapter, while plugins and future responsive
// layouts can place this widget directly in panes or modals.
//
// Phase 7 Batch B (2026-04-20) — agent-list adopts the Cursorable
// behavior. j/k/g/G/Home/End move state.cursor via the reusable mixin.
// The widget keeps its own onKey for enter (submits agent:<id>) and
// onMouse for scroll-wheel / click-to-cursor / double-click-open.
// Dashboard's agent-roster pane handler still owns the dashboard-
// local rendering keys (s/F/x/d/a/?/h/l) and bridges agentRosterCursor
// <-> state.cursor around dispatch until that state moves too.

import type { Widget } from '../../src/widgets/types.js';
import type { AgentSurfaceState } from '../../src/display/index.js';
import { renderAgentRoster } from '../../src/display/index.js';
import { renderRosterCheatsheet } from '../../src/display/agent-surface.js';
import { globalAgentFlash } from '../../src/display/agent-flash.js';
import { C, truncate, visibleWidth } from '../../src/tui.js';
import { paneTitle } from '../../src/panes/pane-title.js';
import {
  cursorable,
  hoverTint,
  applyHoverableListRowEvent,
} from '../../src/widget-behaviors/index.js';

export interface AgentListState {
  agents: AgentSurfaceState[];
  cursor: number;
  offset: number;
  emptyLabel?: string;
  hoveredItemIndex?: number | null;
  /** PFC-S2 P3: when true, reserve the bottom 8 rows for the
   *  cheatsheet overlay. Toggled by the dashboard's `?` handler;
   *  the widget itself is passive. The overlay is skipped silently
   *  when the body budget is too small (< 10 rows). */
  showHelp?: boolean;
}

export interface AgentListConfig {
  agents?: AgentSurfaceState[];
  cursor?: number;
  emptyLabel?: string;
  showHelp?: boolean;
}

const agentListWidget: Widget<AgentListState, AgentListConfig> = {
  type: 'agent-list',
  description: 'Native sub-agent roster with cursor, status, elapsed time, and tool counts',
  defaultCharacter: 'Agents',

  // Phase 7 Batch B: declarative cursor keymap. Cursorable handles
  // j/k/↑↓, g/G, Home/End against state.cursor — clamped to
  // [0, agents.length - 1] via the getItemCount injector.
  behaviors: [
    cursorable<AgentListState>({
      getItemCount: (s) => s.agents.length,
    }),
  ],

  initialState(config) {
    return {
      agents: config?.agents ?? [],
      cursor: Math.max(0, config?.cursor ?? 0),
      offset: 0,
      emptyLabel: config?.emptyLabel,
      showHelp: config?.showHelp ?? false,
    };
  },

  render(state, ctx, character) {
    const lines: string[] = [];
    const w = ctx.width;
    const h = ctx.height;
    if (h < 1 || w < 1) return lines;

    const hasTitle = h >= 2;
    if (hasTitle) lines.push(paneTitle(character, ctx.focused, w));

    if (state.agents.length === 0) {
      const empty = state.emptyLabel
        ? [
            C.muted(`  ${state.emptyLabel}`),
            '',
            C.muted('  Agent() calls will appear here.'),
          ]
        : renderAgentRoster([], 0, { theme: ctx.theme });
      appendWindow(lines, empty, w, h);
      return lines;
    }

    state.cursor = clamp(state.cursor, 0, state.agents.length - 1);
    const bodyBudget = Math.max(0, h - lines.length);
    if (bodyBudget <= 0) return lines;

    const rendered = renderAgentRoster(state.agents, state.cursor, {
      theme: ctx.theme,
      isFlashing: (id) => globalAgentFlash.isFlashing(id),
    });
    const header = rendered.slice(0, 2);
    const rows = rendered.slice(2);

    for (const row of header) {
      if (lines.length >= h) return lines;
      lines.push(fit(row, w));
    }

    // PFC-S2 P3: reserve the bottom 8 rows for the help overlay when
    // toggled. Only applied if the roster still has at least 2 body
    // rows after the reservation — tiny panes drop the overlay to
    // keep the list usable.
    const helpLines = state.showHelp && bodyBudget >= 10
      ? renderRosterCheatsheet(ctx.theme)
      : [];
    const reservedBottom = helpLines.length;
    const visibleRows = Math.max(0, h - lines.length - reservedBottom);
    let offset = state.offset;
    if (state.cursor < offset) offset = state.cursor;
    if (state.cursor >= offset + visibleRows) offset = state.cursor - visibleRows + 1;
    offset = clamp(offset, 0, Math.max(0, state.agents.length - visibleRows));
    state.offset = offset;

    const visible = rows.slice(offset, offset + visibleRows);
    for (let i = 0; i < visible.length && lines.length < h; i++) {
      const idx = offset + i;
      const fitted = fit(visible[i]!, w);
      const isHovered = idx === state.hoveredItemIndex && idx !== state.cursor;
      lines.push(isHovered ? hoverTint(fitted) : fitted);
    }
    while (lines.length < h - reservedBottom) lines.push(' '.repeat(w));
    if (reservedBottom > 0) {
      for (const hl of helpLines) {
        if (lines.length >= h) break;
        lines.push(fit(hl, w));
      }
    }
    return lines;
  },

  // Phase 7 Batch B: j/k/g/G/Home/End moved to the Cursorable behavior.
  // Widget onKey retains enter (submit agent:<id>) — that action is
  // widget-specific and not a generic cursor behavior.
  onKey(ev, state) {
    if (ev.name === 'enter') {
      const agent = state.agents[state.cursor];
      return agent ? { type: 'submit', text: `agent:${agent.id}` } : { type: 'none' };
    }
    return { type: 'none' };
  },

  /** MD6 — scroll wheel + click-to-cursor + double-click-to-open.
   *  The rendered layout has a 1-row title plus a 2-row header
   *  (delimiter / column names) before the agent rows start, so
   *  agent index = bodyRow - 3 relative to widget-local row. */
  onMouse(ev, state) {
    const max = state.agents.length - 1;
    if (max < 0) return { type: 'none' };
    if (ev.type === 'scroll-up') {
      state.cursor = Math.max(0, state.cursor - 3);
      return { type: 'refresh' };
    }
    if (ev.type === 'scroll-down') {
      state.cursor = Math.min(max, state.cursor + 3);
      return { type: 'refresh' };
    }
    if (ev.type === 'click' || ev.type === 'double-click') {
      const targetIdx = rowToAgentIndex(state, ev.row);
      if (targetIdx === null) return { type: 'none' };
      state.cursor = targetIdx;
      if (ev.type === 'double-click') {
        const agent = state.agents[targetIdx]!;
        return { type: 'submit', text: `agent:${agent.id}` };
      }
      return { type: 'refresh' };
    }
    return { type: 'none' };
  },

  /** IDX-F5d Phase 2 (2026-04-22) — hit refinement. Like list, returns
   *  a `list-row` descriptor so consumers can read `itemIndex` without
   *  caring about agent-list's 2-row header quirk — that detail is
   *  fully absorbed by `rowToAgentIndex`. */
  describeHit(state, _ctx, localRow, _localCol) {
    const idx = rowToAgentIndex(state, localRow);
    if (idx === null) return null;
    return { kind: 'list-row', itemIndex: idx };
  },

  onHover(ev, state, ctx) {
    applyHoverableListRowEvent(ev, state, ctx, 'agent-list');
  },

  // WR-4 (S3.A · 2026-04-27 · UI Core closure) — opt-in state observation.
  // Cursor + roster size are the meaningful transitions. hoveredItemIndex
  // is transient pointer state and showHelp is UI-only; both excluded
  // from telemetry to keep the sink quiet. replayState is omitted —
  // pure data state (no animation handles · no external subscriptions),
  // so the host default `ctx.setState` does the right thing per peer
  // pattern (list / table / agent-detail / 7 others).
  onStateChange(prev, next, ctx) {
    if (prev.cursor !== next.cursor) {
      ctx.telemetry?.emit({
        kind: 'agent-list.cursor.change',
        data: { from: prev.cursor, to: next.cursor, total: next.agents.length },
      });
    }
    if (prev.agents.length !== next.agents.length) {
      ctx.telemetry?.emit({
        kind: 'agent-list.roster.change',
        data: { from: prev.agents.length, to: next.agents.length },
      });
    }
  },

  // Hash covers cursor + roster size + help-overlay flag. offset is
  // derived from cursor inside render() so it isn't part of the
  // discriminator; hoveredItemIndex is transient.
  snapshotHash(state): string {
    return `${state.cursor}:${state.agents.length}:${state.showHelp ? 1 : 0}`;
  },

  // One-line LLM summary — roster size + cursor position, with the
  // help-overlay bit when active so an agent reading the surface knows
  // why the body looks shorter than usual.
  describeSurface(state, ctx): string {
    const parts = [ctx.character, `${state.agents.length} agents`, `cursor ${state.cursor}`];
    if (state.showHelp) parts.push('help-overlay');
    return parts.join(' · ');
  },

  configSchema() {
    return {
      type: 'object',
      properties: {
        agents: {
          type: 'array',
          description: 'Agent roster snapshots shown in the list.',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              status: { type: 'string' },
            },
            required: ['id'],
          },
        },
        cursor: {
          type: 'number',
          description: 'Initial selected agent index.',
        },
        emptyLabel: {
          type: 'string',
          description: 'Fallback message when no agents are present.',
        },
        showHelp: {
          type: 'boolean',
          description: 'Whether to reserve space for the roster cheatsheet overlay.',
        },
      },
      additionalProperties: false,
    };
  },
};

/** Shared by onMouse + describeHit. Uniquely: agent-list paints a
 *  2-row header (delimiter + column names) above the agent rows, so
 *  the offset is always 3 (title + 2-row header). */
function rowToAgentIndex(
  state: { offset: number; agents: readonly unknown[] },
  localRow: number,
): number | null {
  const bodyRow = localRow - 3;
  if (bodyRow < 0) return null;
  const targetIdx = state.offset + bodyRow;
  if (targetIdx < 0 || targetIdx >= state.agents.length) return null;
  return targetIdx;
}

function appendWindow(lines: string[], rows: string[], width: number, height: number): void {
  for (const row of rows) {
    if (lines.length >= height) return;
    lines.push(fit(row, width));
  }
  while (lines.length < height) lines.push(' '.repeat(width));
}

function fit(line: string, width: number): string {
  const shown = visibleWidth(line) > width ? truncate(line, width) : line;
  return shown + ' '.repeat(Math.max(0, width - visibleWidth(shown)));
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export default agentListWidget;
