import type { NavCallbacks } from '../virtual-windows/navigation.js';

type VwControlCallbacks = Pick<
  NavCallbacks,
  'onPicker' | 'onCloseWindow' | 'onSyncInputBarToggle' | 'onZoomToggle' | 'onLastFocusedPane'
>;

export interface DashboardVirtualWindowControlRuntimeDeps {
  openWindowPicker: () => void;
  getCurrentWindow: () => {
    id: number;
    isLocalComposerActive: () => boolean;
    setLocalComposerActive: (next: boolean) => void;
    toggleZoom: () => boolean;
    focusLastPane: () => string | null;
  } | null | undefined;
  closeWindow: (windowId: number) => void;
  pushMutedLine: (line: string) => void;
  draw: () => void;
}

export function createDashboardVirtualWindowControlRuntime(
  deps: DashboardVirtualWindowControlRuntimeDeps,
): VwControlCallbacks {
  return {
    onPicker: () => { deps.openWindowPicker(); },
    onCloseWindow: () => {
      const w = deps.getCurrentWindow();
      if (w) deps.closeWindow(w.id);
    },
    onSyncInputBarToggle: () => {
      const w = deps.getCurrentWindow();
      if (!w) {
        deps.pushMutedLine('No foreground virtual window for local input.');
        return;
      }
      const next = !w.isLocalComposerActive();
      w.setLocalComposerActive(next);
      deps.pushMutedLine(`  vw:${w.id} local composer: ${next ? 'on' : 'off'}`);
      deps.draw();
    },
    onZoomToggle: () => {
      const w = deps.getCurrentWindow();
      if (!w) return;
      const zoomed = w.toggleZoom();
      deps.pushMutedLine(`  vw:${w.id} zoom: ${zoomed ? 'on' : 'off'}`);
      deps.draw();
    },
    onLastFocusedPane: () => {
      const w = deps.getCurrentWindow();
      if (!w) return;
      const target = w.focusLastPane();
      if (!target) deps.pushMutedLine('  no previous pane to swap to');
      deps.draw();
    },
  };
}
