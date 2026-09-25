export interface DashboardWindowSlashListEntry {
  id: number;
  title: string;
  paneCount: number;
  isCurrent: boolean;
}

export interface DashboardWindowSlashRuntimeDeps {
  accent: (text: string) => string;
  muted: (text: string) => string;
  success: (text: string) => string;
  error: (text: string) => string;
  warning: (text: string) => string;
}

export interface DashboardWindowSlashRuntime {
  helpLines(): string[];
  listLines(windows: readonly DashboardWindowSlashListEntry[]): string[];
  spawnedLine(kind: 'scratch' | 'browser' | 'preview' | 'browser-preview' | 'iul' | 'acp' | 'sim', id: number, title: string): string;
  spawnFailedLine(kind: 'new' | 'browser' | 'preview' | 'browser-preview' | 'iul' | 'acp' | 'sim', message: string): string;
  switchInvalidIdLine(): string;
  switchMissingLine(id: number): string;
  switchedLine(id: number): string;
  closeAllLine(count: number): string;
  closeInvalidLine(): string;
  closeMissingLine(id: number): string;
  closedLine(id: number): string;
  companionLine(action: 'open' | 'close' | 'toggle', opened: boolean, key: string, windowId: number): string;
  unknownSubcommandLine(sub: string): string;
}

export function createDashboardWindowSlashRuntime(
  deps: DashboardWindowSlashRuntimeDeps,
): DashboardWindowSlashRuntime {
  return {
    helpLines: () => [
      '',
      deps.accent('\u276f /workspace'),
      deps.muted('Usage  (aliases: /ws · /window · /win — all equivalent):'),
      deps.muted('  /workspace list             List every workspace (title, pane count, fg/bg).'),
      deps.muted('  /workspace new [title]      Spawn a new workspace with an empty scratch pane.'),
      deps.muted('  /workspace browser [title]  Spawn a new workspace with a browser pane clone.'),
      deps.muted('  /workspace preview [title]  Spawn a new workspace with a preview pane clone.'),
      deps.muted('  /workspace browser-preview [title]  Spawn a workspace with browser + preview panes.'),
      deps.muted('  /workspace iul [title]      Spawn an IUL UX Lab workspace with sidebar tabs.'),
      deps.muted('  /workspace acp [title]      Spawn an ACP channel browser shell workspace.'),
      deps.muted('  /workspace sim [title]      Spawn a test simulator shell workspace.'),
      deps.muted('  /workspace switch <id>      Bring workspace <id> to foreground.'),
      deps.muted('  /workspace close <id|all>   Close workspace <id>, or "all" to drop every workspace.'),
      deps.muted('  /workspace closeall         Same as /workspace close all — drop every workspace at once.'),
      deps.muted('  /workspace picker           Open the workspace picker modal (Enter=switch, Esc=cancel).'),
      deps.muted('  /workspace companion <clipboard|memo|detail> [open|close|toggle] [id]'),
      '',
      deps.muted('Shortcuts for switching:'),
      deps.muted('  Alt+1..9 / Alt+N / Alt+P  Fast-switch (armed when ≥2 windows exist).'),
      deps.muted('  Alt+0                     Open window picker modal.'),
      deps.muted('  Ctrl+B 1..9 / n / p / 0   tmux-style prefix chord alternatives.'),
      deps.muted('  Ctrl+B Tab                Jump to last-focused pane (alt-tab).'),
      deps.muted('  Ctrl+B X                  Close foreground window.'),
      deps.muted('  Click 🪟 status pill      Opens the window picker.'),
      deps.muted('  Right-click pane          Pane + window selector popup (VW-U4).'),
    ],
    listLines: (windows) => {
      if (windows.length === 0) {
        return [deps.muted('  No workspaces. Use /workspace new or the WindowCreate tool.')];
      }
      return windows.map((window) => {
        const marker = window.isCurrent ? deps.success('fg') : deps.muted('bg');
        return `  ${marker}  win:${window.id}  ${window.title}  (${window.paneCount} pane${window.paneCount === 1 ? '' : 's'})`;
      });
    },
    spawnedLine: (kind, id, title) => {
      const label = kind === 'scratch'
        ? 'scratch pane'
        : kind === 'browser'
          ? 'browser pane clone'
          : kind === 'preview'
            ? 'preview pane clone'
            : kind === 'iul'
            ? 'IUL UX Lab shell'
            : kind === 'acp'
              ? 'ACP channel browser'
              : kind === 'sim'
                ? 'simulation shell'
              : 'browser + preview panes';
      return deps.muted(`  spawned win:${id} "${title}" (${label})`);
    },
    spawnFailedLine: (kind, message) => {
      return deps.error(`  /workspace ${kind} failed: ${message}`);
    },
    switchInvalidIdLine: () => deps.warning('  /workspace switch <id> — integer id required. Run /workspace list.'),
    switchMissingLine: (id) => deps.warning(`  no window with id ${id}`),
    switchedLine: (id) => deps.muted(`  switched to win:${id}`),
    closeAllLine: (count) => deps.muted(`  closed ${count} window${count === 1 ? '' : 's'}`),
    closeInvalidLine: () => deps.warning('  /workspace close <id|all> — integer id or "all" required.'),
    closeMissingLine: (id) => deps.warning(`  no window with id ${id}`),
    closedLine: (id) => deps.muted(`  closed win:${id}`),
    companionLine: (action, opened, key, windowId) => {
      const verb = action === 'toggle'
        ? (opened ? 'opened' : 'closed')
        : action === 'open'
          ? 'opened'
          : 'closed';
      return deps.muted(`  ${verb} ${key} companion for win:${windowId}`);
    },
    unknownSubcommandLine: (sub) => deps.warning(`  Unknown /workspace subcommand: ${sub}. Try /workspace help.`),
  };
}
