import type { WidgetInfo } from '../skills/tools/dashboard-widget.js';

export interface DashboardWidgetToolsBootDeps {
  initDashboardWidgetTools: (deps: {
    list: () => WidgetInfo[];
    toggleFocus: (id: string) => boolean | null;
    focusPane: (name: string) => boolean;
    listPanes: () => string[];
  }) => void;
  listWidgetInstanceIds: () => string[];
  getWidget: (id: string) => { type?: string; state?: { focused?: boolean } } | null | undefined;
  validPanes: readonly string[];
  onFocusPane: (name: string) => boolean;
  afterToggleFocus: () => void;
}

export function bootDashboardWidgetTools(
  deps: DashboardWidgetToolsBootDeps,
): void {
  deps.initDashboardWidgetTools({
    list: () => deps.listWidgetInstanceIds().map((id) => {
      const inst = deps.getWidget(id);
      const state = (inst?.state as { focused?: boolean } | undefined) ?? {};
      return {
        id,
        type: inst?.type ?? 'unknown',
        focused: !!state.focused,
      };
    }),
    toggleFocus: (id) => {
      const inst = deps.getWidget(id);
      if (!inst?.state) return null;
      const state = inst.state as { focused?: boolean };
      state.focused = !state.focused;
      deps.afterToggleFocus();
      return !!state.focused;
    },
    focusPane: (name) => {
      if (!deps.validPanes.includes(name)) return false;
      return deps.onFocusPane(name);
    },
    listPanes: () => [...deps.validPanes],
  });
}
