import type { PreviewBindingMode } from '../preview-pane/model.js';
import type { PreviewSource } from '../workspace-types.js';

export type DashboardPreviewSlashAction =
  | { kind: 'source'; source: PreviewSource }
  | { kind: 'binding'; binding: PreviewBindingMode }
  | { kind: 'status' }
  | { kind: 'invalid' };

export interface DashboardPreviewSlashRuntimeDeps {
  muted: (text: string) => string;
  warning: (text: string) => string;
}

export interface DashboardPreviewSlashRuntime {
  resolve(arg: string): DashboardPreviewSlashAction;
  statusLine(source: PreviewSource, binding: PreviewBindingMode): string;
  usageLine(): string;
}

export function createDashboardPreviewSlashRuntime(
  deps: DashboardPreviewSlashRuntimeDeps,
): DashboardPreviewSlashRuntime {
  return {
    resolve(arg) {
      const normalized = arg.toLowerCase();
      if (normalized === 'working' || normalized === 'w' || normalized === 'wd') {
        return { kind: 'source', source: 'working' };
      }
      if (normalized === 'obsidian' || normalized === 'o' || normalized === 'ob') {
        return { kind: 'source', source: 'obsidian' };
      }
      if (normalized === 'skill' || normalized === 'k' || normalized === 'sk') {
        return { kind: 'source', source: 'skill' };
      }
      if (normalized === 'smart' || normalized === 's') {
        return { kind: 'source', source: 'smart' };
      }
      if (normalized === 'pin' || normalized === 'p') {
        return { kind: 'binding', binding: 'pinned' };
      }
      if (normalized === 'follow' || normalized === 'f' || normalized === 'unpin') {
        return { kind: 'binding', binding: 'follow' };
      }
      if (normalized === 'status') {
        return { kind: 'status' };
      }
      return { kind: 'invalid' };
    },
    statusLine: (source, binding) => deps.muted(`preview: source=${source} binding=${binding}`),
    usageLine: () => deps.warning('  Usage: /preview working|obsidian|skill|smart|pin|follow|status'),
  };
}
