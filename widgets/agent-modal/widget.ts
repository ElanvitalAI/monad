// ── Agent modal widget ──
// Same state contract as agent-detail, with a modal-oriented title and
// compact footer hint. Layout/modal ownership remains outside the widget.
//
// WR-4 stateless · no observation hooks needed (S3.A · 2026-04-27).
// Internal state is just `{ agent, scroll, footer }` — `agent` is a
// reference passed in by the caller (agent-detail owns the recording
// surface), `scroll` is transient UI position, and `footer` is config-
// derived. Recorder relies on the host default state-hash + setState
// fallback; nothing here would benefit from a per-widget hook.

import type { WidgetDef } from '../../src/widgets/types.js';
import type { AgentSurfaceState } from '../../src/display/index.js';
import { renderAgentDetail } from '../../src/display/index.js';
import { C, truncate, visibleWidth } from '../../src/tui.js';

export interface AgentModalState {
  agent: AgentSurfaceState | null;
  scroll: number;
  footer?: string;
}

export interface AgentModalConfig {
  agent?: AgentSurfaceState | null;
  footer?: string;
}

const agentModalWidget: WidgetDef<AgentModalState, AgentModalConfig> = {
  type: 'agent-modal',
  description: 'Modal-ready sub-agent detail view for responsive small-screen fallback',
  defaultCharacter: 'Agent',

  initialState(config) {
    return {
      agent: config?.agent ?? null,
      scroll: 0,
      footer: config?.footer,
    };
  },

  render(state, ctx) {
    const w = ctx.width;
    const h = ctx.height;
    if (h < 1 || w < 1) return [];

    const footer = C.muted(state.footer ?? 'j/k scroll');
    const bodyH = Math.max(0, h - 1);
    const body = state.agent
      ? renderAgentDetail(state.agent, { theme: ctx.theme }).split('\n')
      : [C.muted('No agent selected')];
    const maxScroll = Math.max(0, body.length - bodyH);
    state.scroll = Math.max(0, Math.min(state.scroll, maxScroll));

    const lines = body.slice(state.scroll, state.scroll + bodyH).map(line => fit(line, w));
    while (lines.length < bodyH) lines.push(' '.repeat(w));
    lines.push(fit(footer, w));
    return lines;
  },

  onKey(ev, state) {
    switch (ev.name) {
      case 'j': case 'down':
        state.scroll += 1;
        return { type: 'refresh' };
      case 'k': case 'up':
        state.scroll = Math.max(0, state.scroll - 1);
        return { type: 'refresh' };
      case 'pagedown':
        state.scroll += 10;
        return { type: 'refresh' };
      case 'pageup':
        state.scroll = Math.max(0, state.scroll - 10);
        return { type: 'refresh' };
      case 'g': case 'home':
        state.scroll = 0;
        return { type: 'refresh' };
      default:
        return { type: 'none' };
    }
  },

  onMouse(ev, state) {
    switch (ev.type) {
      case 'scroll-down':
        state.scroll += 1;
        return { type: 'refresh' };
      case 'scroll-up':
        state.scroll = Math.max(0, state.scroll - 1);
        return { type: 'refresh' };
      default:
        return { type: 'none' };
    }
  },

  configSchema() {
    return {
      type: 'object',
      properties: {
        agent: {
          type: ['object', 'null'],
          additionalProperties: true,
          description: 'Agent surface snapshot passed through from the host.',
        },
        footer: {
          type: 'string',
          description: 'Optional footer hint rendered on the last row.',
        },
      },
      additionalProperties: false,
    };
  },
};

function fit(line: string, width: number): string {
  const shown = visibleWidth(line) > width ? truncate(line, width) : line;
  return shown + ' '.repeat(Math.max(0, width - visibleWidth(shown)));
}

export default agentModalWidget;
