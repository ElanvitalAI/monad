export interface DashboardViewSlashListEntry {
  active: boolean;
  id: string;
  label: string;
  enabled: boolean;
  shortcut?: string | null;
  baseView: string;
}

export interface DashboardViewSlashRuntimeDeps {
  muted: (text: string) => string;
  success: (text: string) => string;
  warning: (text: string) => string;
}

export interface DashboardViewSlashRuntime {
  listLines(entries: readonly DashboardViewSlashListEntry[]): string[];
  closedPaneLines(labels: readonly string[]): string[];
  reloadedLine(): string;
  savedLine(): string;
  restoredLine(): string;
  resetLine(): string;
  exportedLine(): string;
  usageLine(): string;
}

export function createDashboardViewSlashRuntime(
  deps: DashboardViewSlashRuntimeDeps,
): DashboardViewSlashRuntime {
  return {
    listLines: (entries) =>
      entries.map((entry) => {
        const state = entry.enabled ? 'on' : 'off';
        const marker = entry.active ? '*' : ' ';
        return deps.muted(`  ${marker} ${entry.id} ${entry.label} [${state}] shortcut=${entry.shortcut ?? '-'} base=${entry.baseView}`);
      }),
    closedPaneLines: (labels) => [
      deps.muted(`  current view closed panes: ${labels.join(', ')}`),
      deps.muted('  restore: Menu -> Add Surface -> Current View or pane title menu'),
    ],
    reloadedLine: () => deps.muted('  dashboard view config reloaded'),
    savedLine: () => deps.success('  dashboard view config saved'),
    restoredLine: () => deps.success('  current starter panes restored'),
    resetLine: () => deps.success('  dashboard view config reset to built-in defaults'),
    exportedLine: () => deps.muted('  dashboard view config exported to detail viewer'),
    usageLine: () => deps.warning('  Usage: /view <id|label|shortcut>|list|next|prev|reload|save|restore|reset|export'),
  };
}
