import type { ViewSurfaceHandle } from '../ui/modal-adapter.js';
import type { WindowRegistry } from '../virtual-windows/window-registry.js';
import type { WindowId } from '../virtual-windows/addressing.js';
import type { LocalInputTarget } from '../virtual-windows/virtual-window.js';
import {
  createVwLocalInputTargetPopup,
  type VwLocalInputTargetPopupOpts,
} from '../virtual-windows/vw-local-input-target-popup.js';
import {
  createVwRenameModal,
  type VwRenameModalOpts,
} from '../virtual-windows/vw-rename-modal.js';

export interface OpenVwLocalInputTargetPopupDeps {
  registry: WindowRegistry;
  windowId: WindowId;
  seedQuery?: string;
  stateStore: Map<number, { query: string; cursor: number }>;
  getCurrentDispose: () => (() => void) | null;
  setCurrentDispose: (dispose: (() => void) | null) => void;
  termSize: () => { cols: number; rows: number };
  pushModalSurface: (surface: import('../display/modal-stack.js').ModalSurface) => { dispose: () => void };
  onTargetPick: (target: LocalInputTarget) => void;
  redraw: () => void;
  createPopup?: (opts: VwLocalInputTargetPopupOpts) => ViewSurfaceHandle | null;
}

export function openVwLocalInputTargetPopupLauncher(
  deps: OpenVwLocalInputTargetPopupDeps,
): void {
  const existing = deps.getCurrentDispose();
  if (existing) {
    try { existing(); } catch { /* ignore */ }
    deps.setCurrentDispose(null);
  }

  const state = deps.stateStore.get(deps.windowId) ?? { query: '', cursor: 0 };
  if (deps.seedQuery !== undefined) {
    state.query = deps.seedQuery;
    state.cursor = 0;
  }
  deps.stateStore.set(deps.windowId, state);

  const { cols, rows } = deps.termSize();
  const popup = (deps.createPopup ?? createVwLocalInputTargetPopup)({
    registry: deps.registry,
    sourceWindowId: deps.windowId,
    termCols: cols,
    termRows: rows,
    query: () => state.query,
    cursor: () => state.cursor,
    onQueryChange: (next) => {
      state.query = next;
      deps.redraw();
    },
    onCursorChange: (next) => {
      state.cursor = next;
      deps.redraw();
    },
    onPick: (target) => {
      deps.onTargetPick(target);
      state.query = '';
      state.cursor = 0;
      deps.setCurrentDispose(null);
      deps.redraw();
    },
    onCancel: () => {
      deps.setCurrentDispose(null);
      deps.redraw();
    },
  });
  if (!popup) return;
  popup.surface.onKey = (ev) => popup.handleKey(ev);
  const modalHandle = deps.pushModalSurface(popup.surface);
  deps.setCurrentDispose(() => {
    try { popup.dispose(); } catch { /* ignore */ }
    try { modalHandle.dispose(); } catch { /* ignore */ }
  });
  deps.redraw();
}

export interface OpenVwRenameModalDeps {
  title: string;
  current: string;
  onSubmit: (next: string) => void;
  onCancel?: () => void;
  getCurrentDispose: () => (() => void) | null;
  setCurrentDispose: (dispose: (() => void) | null) => void;
  termSize: () => { cols: number; rows: number };
  pushModalSurface: (surface: import('../display/modal-stack.js').ModalSurface) => { dispose: () => void };
  redraw: () => void;
  createModal?: (opts: VwRenameModalOpts) => ViewSurfaceHandle;
}

export function openVwRenameModalLauncher(
  deps: OpenVwRenameModalDeps,
): void {
  const existing = deps.getCurrentDispose();
  if (existing) {
    try { existing(); } catch { /* ignore */ }
    deps.setCurrentDispose(null);
  }

  const { cols, rows } = deps.termSize();
  const modal = (deps.createModal ?? createVwRenameModal)({
    title: deps.title,
    current: deps.current,
    termCols: cols,
    termRows: rows,
    onSubmit: (next) => {
      deps.setCurrentDispose(null);
      deps.onSubmit(next);
    },
    onCancel: () => {
      deps.setCurrentDispose(null);
      deps.onCancel?.();
    },
  });
  modal.surface.onKey = (ev) => modal.handleKey(ev);
  const modalHandle = deps.pushModalSurface(modal.surface);
  deps.setCurrentDispose(() => {
    try { modal.dispose(); } catch { /* ignore */ }
    try { modalHandle.dispose(); } catch { /* ignore */ }
  });
  deps.redraw();
}
