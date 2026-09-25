import type { ThemeTokens } from '../theme/tokens.js';
import type { SearchModalHandle } from '../chat/search/modal.js';

export interface DashboardFolderAttachModalRuntimeDeps {
  termSize: () => { cols: number; rows: number };
  createFolderPickerModal: (opts: {
    folderPath: string;
    bounds: { row: number; col: number; width: number; height: number };
    width: number;
    maxVisible: number;
    onAccept: (item: { absPath: string }) => void;
    onCancel: () => void;
    theme: ThemeTokens;
  }) => Promise<SearchModalHandle>;
  attachFilePathToken: (absPath: string) => Promise<string>;
  pushModal: (surface: SearchModalHandle['surface']) => { dispose(): void } | null;
  getTheme: () => ThemeTokens;
  draw: () => void;
}

export function openDashboardFolderAttachModal(
  folderAbsPath: string,
  onToken: (token: string) => void,
  deps: DashboardFolderAttachModalRuntimeDeps,
): void {
  const { cols, rows } = deps.termSize();
  const width = Math.min(90, Math.max(50, cols - 6));
  const visibleRows = Math.min(15, Math.max(6, rows - 8));
  const height = visibleRows + 4;
  const bounds = {
    row: Math.max(1, Math.floor((rows - height) / 2)),
    col: Math.max(1, Math.floor((cols - width) / 2)),
    width,
    height,
  };
  let modalHandle: { dispose(): void } | null = null;
  let tokenSettled = false;
  const settle = (token: string): void => {
    if (tokenSettled) return;
    tokenSettled = true;
    try { onToken(token); } catch {}
  };

  void deps.createFolderPickerModal({
    folderPath: folderAbsPath,
    bounds,
    width,
    maxVisible: visibleRows,
    onAccept: (item) => {
      modalHandle?.dispose();
      modalHandle = null;
      void (async () => {
        const token = await deps.attachFilePathToken(item.absPath);
        settle(token);
      })();
    },
    onCancel: () => {
      modalHandle?.dispose();
      modalHandle = null;
      settle('');
    },
    theme: deps.getTheme(),
  }).then((handle) => {
    modalHandle = deps.pushModal(handle.surface);
    deps.draw();
  }).catch(() => {
    settle('');
  });
}
