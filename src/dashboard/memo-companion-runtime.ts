export interface DashboardMemoCommitResult {
  kind: 'saved' | 'discarded';
  lines?: string[];
}

export interface DashboardMemoCompanionRuntimeDeps {
  readLines: () => string[];
  resetEditor: () => void;
  close: () => void;
  publishSaved: (lines: string[]) => void;
  pushSavedLine: (lineCount: number) => void;
  pushDiscardedLine: () => void;
  pushCancelledLine: () => void;
}

export interface DashboardMemoCompanionRuntime {
  commit(): DashboardMemoCommitResult;
  cancel(): void;
}

export function createDashboardMemoCompanionRuntime(
  deps: DashboardMemoCompanionRuntimeDeps,
): DashboardMemoCompanionRuntime {
  return {
    commit() {
      const liveLines = deps.readLines();
      const body = liveLines.join('\n');
      if (body.trim()) {
        const lines = liveLines.slice();
        deps.publishSaved(lines);
        deps.pushSavedLine(lines.length);
        deps.resetEditor();
        deps.close();
        return { kind: 'saved', lines };
      }
      deps.pushDiscardedLine();
      deps.resetEditor();
      deps.close();
      return { kind: 'discarded' };
    },
    cancel() {
      deps.resetEditor();
      deps.close();
      deps.pushCancelledLine();
    },
  };
}
