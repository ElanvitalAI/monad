import type { SearchModalHandle } from '../chat/search/modal.js';
import { attachSurfaceToWorkspace } from '../display/workspace-affinity.js';
import type { ThemeTokens } from '../theme/tokens.js';
import type { WindowRegistry } from '../virtual-windows/window-registry.js';
import type { VirtualWindow } from '../virtual-windows/virtual-window.js';
import {
  createWindowPickerModal,
  type OpenWindowPickerOpts,
} from '../window-picker-modal.js';

export interface OpenDashboardWindowPickerPopupDeps {
  registry: WindowRegistry;
  ownerWorkspaceId?: string;
  termSize: () => { cols: number; rows: number };
  getTheme: () => ThemeTokens | undefined;
  pushModalSurface: (surface: import('../display/modal-stack.js').ModalSurface) => { dispose: () => void };
  setAgentSearchModal: (modal: SearchModalHandle | null) => void;
  onEmptyWindows: () => void;
  onAcceptMain?: () => void;
  onAcceptWindow: (window: VirtualWindow) => void;
  redraw: () => void;
  createWindowPickerModal?: (opts: OpenWindowPickerOpts) => SearchModalHandle;
}

export function openDashboardWindowPickerPopup(
  deps: OpenDashboardWindowPickerPopupDeps,
): void {
  const windows = deps.registry.list();
  if (windows.length === 0) {
    deps.onEmptyWindows();
    return;
  }

  const createWindowPickerModalImpl =
    deps.createWindowPickerModal ?? createWindowPickerModal;
  const { cols, rows } = deps.termSize();
  const pickerItems = windows.length + 1;
  const compact = pickerItems <= 3;
  const width = compact
    ? Math.min(38, Math.max(30, cols - 18))
    : Math.min(60, Math.max(40, cols - 6));
  const visibleRows = Math.min(compact ? pickerItems : 9, pickerItems);
  const height = compact ? visibleRows + 3 : visibleRows + 3;
  const bounds = {
    row: Math.max(1, Math.floor((rows - height) / 2)),
    col: Math.max(1, Math.floor((cols - width) / 2)),
    width,
    height,
  };
  let handle: { dispose: () => void } | null = null;
  const picker = createWindowPickerModalImpl({
    registry: deps.registry,
    bounds,
    width,
    maxVisible: visibleRows,
    theme: deps.getTheme(),
    onAccept: (window) => {
      if (window === 'main') deps.onAcceptMain?.();
      else deps.onAcceptWindow(window);
      deps.setAgentSearchModal(null);
      handle?.dispose();
      deps.redraw();
    },
    onCancel: () => {
      deps.setAgentSearchModal(null);
      handle?.dispose();
      deps.redraw();
    },
  });
  attachSurfaceToWorkspace(picker.surface, deps.ownerWorkspaceId);
  handle = deps.pushModalSurface(picker.surface);
  deps.setAgentSearchModal(picker);
  deps.redraw();
}
