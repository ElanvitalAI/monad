import type { AgentSurfaceState } from '../display/agent-surface.js';

export interface DashboardAgentWidgetLike {
  state: Record<string, unknown>;
  character?: string;
}

export interface DashboardAgentWidgetRuntime {
  projectRoster(
    widget: DashboardAgentWidgetLike | null | undefined,
    opts: {
      agents: readonly AgentSurfaceState[];
      cursor: number;
      focused: boolean;
      showHelp: boolean;
      filter: string;
      sort: string;
      flashCount: number;
    },
  ): void;
  projectDetail(
    widget: DashboardAgentWidgetLike | null | undefined,
    opts: {
      agent: AgentSurfaceState | null;
      focused: boolean;
    },
  ): void;
  projectLog(
    widget: DashboardAgentWidgetLike | null | undefined,
    opts: {
      agent: AgentSurfaceState | null;
      focused: boolean;
      detailTimeline: string | null;
    },
  ): void;
}

export function createDashboardAgentWidgetRuntime(): DashboardAgentWidgetRuntime {
  return {
    projectRoster(widget, opts) {
      if (!widget) return;
      widget.state.agents = opts.agents;
      widget.state.cursor = opts.cursor;
      widget.state.focused = opts.focused;
      widget.state.showHelp = opts.showHelp;
      const modes: string[] = [];
      if (opts.filter !== 'all') modes.push(opts.filter);
      if (opts.sort !== 'default') modes.push(`sort:${opts.sort}`);
      if (opts.flashCount > 0) modes.push(`${opts.flashCount} new`);
      const modeSuffix = modes.length ? ` · ${modes.join(' · ')}` : '';
      const runningCount = opts.agents.filter((agent) => agent.status === 'running').length;
      widget.character = runningCount > 0
        ? `Agents · ${runningCount}/${opts.agents.length} running${modeSuffix}`
        : `Agents · ${opts.agents.length}${modeSuffix}`;
    },
    projectDetail(widget, opts) {
      if (!widget) return;
      widget.state.agent = opts.agent;
      widget.state.focused = opts.focused;
      if (!opts.agent) widget.state.emptyLabel = 'No agent selected';
    },
    projectLog(widget, opts) {
      if (!widget) return;
      widget.state.text = opts.agent
        ? (opts.detailTimeline ?? (opts.agent.log.map((entry) => entry.text).join('\n') || '(no tool calls yet)'))
        : '(no agent selected)';
      widget.state.preformatted = true;
      widget.state.focused = opts.focused;
      const suffix = opts.detailTimeline ? ' · detail timeline' : '';
      widget.character = opts.agent ? `Agent Log · ${opts.agent.name}${suffix}` : 'Agent Log';
    },
  };
}
