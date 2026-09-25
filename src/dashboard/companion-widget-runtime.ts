export interface DashboardClipboardEntryView {
  id: string;
  text: string;
  ts: number;
}

export interface DashboardDetailViewerProjection {
  title: string;
  lines: string[];
}

export interface DashboardWidgetLike {
  state: Record<string, unknown>;
  character?: string;
}

export interface DashboardCompanionWidgetRuntime {
  projectClipboardWidget(
    widget: DashboardWidgetLike | null | undefined,
    entries: readonly DashboardClipboardEntryView[],
    cursor: number,
  ): void;
  projectMemoWidget(widget: DashboardWidgetLike | null | undefined): void;
  projectDetailWidget(
    widget: DashboardWidgetLike | null | undefined,
    detail: DashboardDetailViewerProjection,
  ): void;
}

export function createDashboardCompanionWidgetRuntime(): DashboardCompanionWidgetRuntime {
  return {
    projectClipboardWidget(widget, entries, cursor) {
      if (!widget) return;
      widget.state.mode = 'clipboard';
      widget.state.clipHistory = entries;
      widget.state.clipCursor = Math.max(0, cursor);
      widget.state.focused = false;
      widget.character = `Clipboard · ${entries.length}`;
    },
    projectMemoWidget(widget) {
      if (!widget) return;
      widget.state.mode = 'memo';
      widget.state.memoShowHelp = true;
      widget.state.memoCursorStyle = 'inverse';
      widget.state.focused = false;
      widget.character = 'Memo · Ctrl+S save / Esc cancel';
    },
    projectDetailWidget(widget, detail) {
      if (!widget) return;
      widget.state.mode = 'preview';
      widget.state.previewLines = detail.lines;
      widget.state.scroll = 0;
      widget.state.focused = false;
      widget.character = detail.title ? `Detail · ${detail.title}` : 'Detail';
    },
  };
}
