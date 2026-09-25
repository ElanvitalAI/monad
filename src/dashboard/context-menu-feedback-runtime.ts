export type DashboardCompanionKind = 'clipboard' | 'memo' | 'detail';

export interface DashboardContextMenuFeedbackRuntimeDeps {
  pushMutedLine: (line: string) => void;
  setChatScrollBottom: () => void;
  draw: () => void;
}

export interface DashboardContextMenuFeedbackRuntime {
  onVwCompanionToggled(windowId: number, kind: DashboardCompanionKind, opened: boolean): void;
  onDashboardCompanionToggled(kind: DashboardCompanionKind, opened: boolean): void;
  onStarterPanesRestored(): void;
}

export function createDashboardContextMenuFeedbackRuntime(
  deps: DashboardContextMenuFeedbackRuntimeDeps,
): DashboardContextMenuFeedbackRuntime {
  const commit = (line: string): void => {
    deps.pushMutedLine(line);
    deps.setChatScrollBottom();
    deps.draw();
  };

  return {
    onVwCompanionToggled: (windowId, kind, opened) => {
      commit(`  VW ${kind} companion ${opened ? 'opened' : 'closed'} · win:${windowId}`);
    },
    onDashboardCompanionToggled: (kind, opened) => {
      commit(`  ${opened ? 'opened' : 'closed'} ${kind} companion`);
    },
    onStarterPanesRestored: () => {
      commit('  restored closed starter panes for the current view');
    },
  };
}
