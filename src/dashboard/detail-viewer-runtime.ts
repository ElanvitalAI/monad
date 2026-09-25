export interface DashboardDetailViewerSnapshot {
  title: string;
  lines: string[];
}

export interface DashboardDetailViewerRuntimeDeps {
  setOpen: (open: boolean) => void;
  requestRender: () => void;
}

export interface DashboardDetailViewerRuntime {
  snapshot(): DashboardDetailViewerSnapshot;
  set(title: string, lines: string[]): void;
  clear(): void;
  close(): void;
}

export function createDashboardDetailViewerRuntime(
  deps: DashboardDetailViewerRuntimeDeps,
): DashboardDetailViewerRuntime {
  let title = '';
  let lines: string[] = [];

  return {
    snapshot: () => ({ title, lines: [...lines] }),
    set(nextTitle, nextLines) {
      title = nextTitle;
      lines = [...nextLines];
      deps.setOpen(true);
      deps.requestRender();
    },
    clear() {
      title = '';
      lines = [];
      deps.requestRender();
    },
    close() {
      deps.setOpen(false);
    },
  };
}
