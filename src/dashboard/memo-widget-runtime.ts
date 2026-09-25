export interface DashboardMemoWidgetLike {
  state?: Record<string, unknown>;
}

export interface DashboardMemoWidgetRuntime {
  seed(widget: DashboardMemoWidgetLike | null | undefined, lines?: readonly string[]): void;
  readLines(widget: DashboardMemoWidgetLike | null | undefined): string[];
}

export function createDashboardMemoWidgetRuntime(): DashboardMemoWidgetRuntime {
  return {
    seed(widget, lines = ['']) {
      const state = widget?.state;
      if (!state) return;
      state.mode = 'memo';
      state.memoLines = lines.length > 0 ? [...lines] : [''];
      state.memoLineIdx = 0;
      state.memoColIdx = 0;
      state.memoDirty = false;
      state.memoShowHelp = true;
      state.memoCursorStyle = 'inverse';
    },
    readLines(widget) {
      const raw = widget?.state?.memoLines;
      if (Array.isArray(raw) && raw.every((line) => typeof line === 'string')) {
        return raw as string[];
      }
      return [''];
    },
  };
}
