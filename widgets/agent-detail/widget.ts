// ── Agent detail widget ──
// Shows the selected AgentSurfaceState, including live tool trail while
// running and final result/error after completion.
//
// Phase 3a (2026-04-20) — first widget to migrate to the new
// `behaviors` surface. Scroll keys are now delegated to the reusable
// `Scrollable` mixin; the widget's own onKey is removed. Dashboard
// pane handler still intercepts h/l (pane navigation) and y/e (copy/
// export using dashboard-local state like agentRosterFilter); those
// move in Phase 7 after state cleanup.

import type { Widget } from '../../src/widgets/types.js';
import type { AgentSurfaceState } from '../../src/display/index.js';
import { renderAgentDetail } from '../../src/display/index.js';
import { C, truncate, visibleWidth } from '../../src/tui.js';
import { paneTitle } from '../../src/panes/pane-title.js';
import { Scrollable } from '../../src/widget-behaviors/index.js';

export interface AgentDetailState {
  agent: AgentSurfaceState | null;
  scroll: number;
  /** Set by render() — Scrollable behavior reads this to clamp the
   *  scroll on End / page-down. When absent the body height is
   *  unknown and G/End becomes a no-op (matches pre-migration
   *  behavior where scroll clamp happened in render). */
  maxScroll?: number;
  emptyLabel?: string;
}

export interface AgentDetailConfig {
  agent?: AgentSurfaceState | null;
  emptyLabel?: string;
}

const agentDetailWidget: Widget<AgentDetailState, AgentDetailConfig> = {
  type: 'agent-detail',
  description: 'Native sub-agent detail view with live tool trail and final output',
  defaultCharacter: 'Agent Detail',

  // Phase 3a: declarative keymap. Scrollable handles j/k/↑↓, g/G,
  // Home/End, PgUp/PgDn, Ctrl+d/u against state.scroll — clamped to
  // [0, maxScroll] when the latter is present.
  behaviors: [Scrollable],

  initialState(config) {
    return {
      agent: config?.agent ?? null,
      scroll: 0,
      emptyLabel: config?.emptyLabel,
    };
  },

  render(state, ctx, character) {
    const lines: string[] = [];
    const w = ctx.width;
    const h = ctx.height;
    if (h < 1 || w < 1) return lines;

    const hasTitle = h >= 2;
    if (hasTitle) lines.push(paneTitle(title(character, state.agent), ctx.focused, w));
    const bodyH = Math.max(0, h - lines.length);
    if (bodyH === 0) return lines;

    const body = state.agent
      ? renderAgentDetail(state.agent, { theme: ctx.theme }).split('\n')
      : [
          C.muted(`  ${state.emptyLabel ?? 'No agent selected'}`),
          '',
          C.muted('  Move the cursor in the agent list to preview details.'),
        ];

    const maxScroll = Math.max(0, body.length - bodyH);
    state.maxScroll = maxScroll;  // Scrollable.G / End reads this.
    state.scroll = Math.max(0, Math.min(state.scroll, maxScroll));
    const visible = body.slice(state.scroll, state.scroll + bodyH);
    for (const row of visible) lines.push(fit(row, w));
    while (lines.length < h) lines.push(' '.repeat(w));
    return lines;
  },

  // Widget-specific onKey removed — Scrollable behavior handles every
  // key the old onKey did, plus G/End/PgDn/PgUp/Ctrl+d/u (which the
  // old onKey lacked). Dashboard pane handler keeps h/l nav and y/e
  // copy/export; those use dashboard-local state (agentRosterFilter,
  // chatLines, etc.) and move to the widget in Phase 7.
  onMouse(ev, state) {
    switch (ev.type) {
      case 'scroll-up':
        state.scroll = Math.max(0, state.scroll - 1);
        return { type: 'refresh' };
      case 'scroll-down':
        state.scroll = Math.min(state.maxScroll ?? state.scroll + 1, state.scroll + 1);
        return { type: 'refresh' };
      default:
        return { type: 'none' };
    }
  },

  // WR-1 (2026-04-20 · IUL Phase W prereq) — opt-in state observation.
  // Emits on scroll + agent-swap transitions so timeline recorder can
  // trace "user read agent X at scroll Y at time T" sequences.
  onStateChange(prev, next, ctx) {
    if (prev.scroll !== next.scroll) {
      ctx.telemetry?.emit({
        kind: 'agent-detail.scroll.change',
        data: { from: prev.scroll, to: next.scroll },
      });
    }
    if (prev.agent?.id !== next.agent?.id) {
      ctx.telemetry?.emit({
        kind: 'agent-detail.agent.swap',
        data: {
          from: prev.agent?.id ?? null,
          to: next.agent?.id ?? null,
        },
      });
    }
  },

  // WR-2 (Bundle 5W) — agent identity + scroll position. Agent-swap
  // is the dominant transition; scroll moves are second-order.
  snapshotHash(state): string {
    return `${state.agent?.id ?? 'none'}:${state.scroll}`;
  },

  describeSurface(state, ctx): string {
    if (!state.agent) return `${ctx.character} · (no agent selected)`;
    const parts = [ctx.character, `agent "${state.agent.name}"`];
    if (state.scroll > 0) parts.push(`scroll ${state.scroll}`);
    return parts.join(' · ');
  },

  configSchema() {
    return {
      type: 'object',
      properties: {
        agent: {
          type: ['object', 'null'],
          additionalProperties: true,
          description: 'Agent surface snapshot rendered in the detail pane.',
        },
        emptyLabel: {
          type: 'string',
          description: 'Fallback message when no agent is selected.',
        },
      },
      additionalProperties: false,
    };
  },
};

function title(character: string, agent: AgentSurfaceState | null): string {
  if (!agent) return character;
  const name = agent.name.length > 28 ? agent.name.slice(0, 25) + '...' : agent.name;
  return `${character} · ${name}`;
}

function fit(line: string, width: number): string {
  const shown = visibleWidth(line) > width ? truncate(line, width) : line;
  return shown + ' '.repeat(Math.max(0, width - visibleWidth(shown)));
}

export default agentDetailWidget;
