import type { AgentSurfaceState } from '../display/agent-surface.js';

export interface DashboardDebugWidgetLike {
  state: Record<string, unknown>;
  character?: string;
}

export interface DashboardDebugStatusLike {
  level: string;
}

export interface DashboardDebugEventLike {
  category: string;
}

export interface DashboardDebugWidgetRuntime {
  projectEvents(
    widget: DashboardDebugWidgetLike | null | undefined,
    opts: {
      items: string[];
      cursor: number;
      focused: boolean;
      level: string;
    },
  ): void;
  projectDetail(
    widget: DashboardDebugWidgetLike | null | undefined,
    opts: {
      text: string;
      focused: boolean;
      selectedEvent: DashboardDebugEventLike | null;
    },
  ): void;
  projectStack(
    widget: DashboardDebugWidgetLike | null | undefined,
    opts: {
      text: string;
      focused: boolean;
      runningAgents: number;
      level: string;
    },
  ): void;
  projectPrompts(
    widget: DashboardDebugWidgetLike | null | undefined,
    opts: {
      text: string;
      focused: boolean;
      count: number;
    },
  ): void;
  projectLogTitle(
    widget: DashboardDebugWidgetLike | null | undefined,
    opts: {
      mirrorEnabled: boolean;
      level: string;
    },
  ): void;
}

export function createDashboardDebugWidgetRuntime(): DashboardDebugWidgetRuntime {
  return {
    projectEvents(widget, opts) {
      if (!widget) return;
      widget.state.items = opts.items;
      widget.state.cursor = opts.cursor;
      widget.state.focused = opts.focused;
      widget.state.preserveAnsi = true;
      widget.character = opts.items.length > 0
        ? `Debug Events · ${opts.level} · ${opts.items.length}`
        : `Debug Events · ${opts.level}`;
    },
    projectDetail(widget, opts) {
      if (!widget) return;
      widget.state.text = opts.text;
      widget.state.focused = opts.focused;
      widget.state.preformatted = false;
      widget.character = opts.selectedEvent
        ? `Debug Detail · ${opts.selectedEvent.category}`
        : 'Debug Detail';
    },
    projectStack(widget, opts) {
      if (!widget) return;
      widget.state.text = opts.text;
      widget.state.focused = opts.focused;
      widget.state.preformatted = false;
      widget.character = opts.runningAgents > 0
        ? `Agent Activity · ${opts.runningAgents} running`
        : `Agent Activity · ${opts.level}`;
    },
    projectPrompts(widget, opts) {
      if (!widget) return;
      widget.state.text = opts.text;
      widget.state.focused = opts.focused;
      widget.state.preformatted = false;
      widget.character = opts.count > 0
        ? `Prompt Bank · ${opts.count}`
        : 'Prompt Bank';
    },
    projectLogTitle(widget, opts) {
      if (!widget) return;
      widget.character = opts.mirrorEnabled
        ? `Debug Log · ${opts.level} · live`
        : `Debug Log · ${opts.level} · idle`;
    },
  };
}
