export interface DashboardScratchSlashRuntimeDeps {
  muted: (text: string) => string;
  warning: (text: string) => string;
}

export interface DashboardScratchSlashRuntime {
  reopenedLine(): string;
  alreadyOpenLine(): string;
  popupLine(opened: boolean): string;
  popupPromotedLine(): string;
  popupUsageLine(): string;
  closedLine(): string;
  clearedLine(): string;
  emptyDumpLine(): string;
  dumpHeaderLine(title?: string | null): string;
  memoOpenedLine(): string;
  usageLine(): string;
}

export function createDashboardScratchSlashRuntime(
  deps: DashboardScratchSlashRuntimeDeps,
): DashboardScratchSlashRuntime {
  return {
    reopenedLine: () => deps.muted('  scratch pane reopened'),
    alreadyOpenLine: () => deps.muted('  scratch pane is already open'),
    popupLine: (opened) => deps.muted(`  scratch companion popup ${opened ? 'opened' : 'closed'}`),
    popupPromotedLine: () => deps.muted('  scratch companion promoted to foreground pane'),
    popupUsageLine: () => deps.warning('  usage: /scratch popup [open|close|toggle|promote]'),
    closedLine: () => deps.muted('  scratch pane closed (Ctrl+B Ctrl+S to reopen)'),
    clearedLine: () => deps.muted('  scratchpad cleared'),
    emptyDumpLine: () => deps.muted('  (scratchpad is empty)'),
    dumpHeaderLine: (title) => deps.muted(`── scratchpad${title ? ` · ${title}` : ''} ──`),
    memoOpenedLine: () => deps.muted('  memo companion popup opened'),
    usageLine: () => deps.warning('  Usage: /scratch <text> | /scratch + <text> | /scratch memo | /scratch clear | /scratch dump'),
  };
}
