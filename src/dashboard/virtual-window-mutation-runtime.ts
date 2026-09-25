import type { NavCallbacks } from '../virtual-windows/navigation.js';

type VwMutationCallbacks = Pick<
  NavCallbacks,
  'onNewWindow' | 'onModalWindowToggle' | 'onRenameWindow' | 'onRenamePane'
>;

export interface DashboardVirtualWindowMutationRuntimeDeps {
  spawnWindow: () => { id: number } | null;
  getForegroundSession: () => { id: string } | null | undefined;
  detachSession: (id: string) => void;
  getLatestBackgroundSession: () => { id: string } | null | undefined;
  attachSession: (id: string, dims: { termCols: number; termRows: number }) => void;
  termSize: () => { cols: number; rows: number };
  getCurrentWindow: () => {
    id: number;
    title: string;
    focused: string;
    getPaneDisplayTitle: (paneId: string) => string;
  } | null | undefined;
  renameWindow: (windowId: number, next: string) => boolean;
  renamePane: (windowId: number, paneId: string, next: string) => void;
  openRenameModal: (spec: {
    title: string;
    current: string;
    onSubmit: (next: string) => void;
    onCancel: () => void;
  }) => void;
  pushMutedLine: (line: string) => void;
  pushWarningLine: (line: string) => void;
  draw: () => void;
}

export function createDashboardVirtualWindowMutationRuntime(
  deps: DashboardVirtualWindowMutationRuntimeDeps,
): VwMutationCallbacks {
  return {
    onNewWindow: () => {
      try {
        const w = deps.spawnWindow();
        if (!w) return;
        deps.pushMutedLine(`  new virtual window: win:${w.id} (terminal)`);
      } catch (e) {
        deps.pushWarningLine(
          `  new virtual window failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    onModalWindowToggle: () => {
      try {
        const fg = deps.getForegroundSession();
        if (fg) {
          deps.detachSession(fg.id);
          deps.pushMutedLine(`  detached session ${fg.id} (ptytoggle)`);
          return;
        }
        const latest = deps.getLatestBackgroundSession();
        if (latest) {
          const { cols: tc, rows: tr } = deps.termSize();
          deps.attachSession(latest.id, { termCols: tc, termRows: tr });
          deps.pushMutedLine(`  reattached session ${latest.id} (ptytoggle)`);
          return;
        }
        deps.pushMutedLine('  no terminal session to toggle.');
      } catch (e) {
        deps.pushWarningLine(
          `  session toggle failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    onRenameWindow: () => {
      const w = deps.getCurrentWindow();
      if (!w) return;
      deps.openRenameModal({
        title: 'Rename window',
        current: w.title,
        onSubmit: (next) => {
          const ok = deps.renameWindow(w.id, next);
          if (ok) deps.pushMutedLine(`  win:${w.id} → ${next}`);
          deps.draw();
        },
        onCancel: () => { deps.draw(); },
      });
    },
    onRenamePane: () => {
      const w = deps.getCurrentWindow();
      if (!w) return;
      const paneId = w.focused;
      const current = w.getPaneDisplayTitle(paneId);
      deps.openRenameModal({
        title: 'Rename pane (empty = clear)',
        current,
        onSubmit: (next) => {
          deps.renamePane(w.id, paneId, next);
          deps.pushMutedLine(`  pane:${paneId.slice(0, 6)} → ${next}`);
          deps.draw();
        },
        onCancel: () => { deps.draw(); },
      });
    },
  };
}
