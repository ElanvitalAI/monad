import { initDashboardContextMenuRegistry } from './context-menu/registry.js';
import type { ModalSurface } from '../display/modal-stack.js';
import type { ThemeTokens } from '../theme/tokens.js';

export interface DashboardContextMenuRegistryBootDeps {
  termSize: () => { cols: number; rows: number };
  /** Mount a modal surface — mirrors the registry's `pushSurface`
   *  contract (typically `display.pushModal`, whose richer
   *  `{ id, dispose }` return is structurally compatible). */
  pushSurface: (surface: ModalSurface) => { dispose: () => void };
  redraw: () => void;
  getTheme: () => ThemeTokens;
  initRegistry?: typeof initDashboardContextMenuRegistry;
}

export function bootDashboardContextMenuRegistry(
  deps: DashboardContextMenuRegistryBootDeps,
): void {
  (deps.initRegistry ?? initDashboardContextMenuRegistry)({
    termSize: deps.termSize,
    pushSurface: deps.pushSurface,
    redraw: deps.redraw,
    getTheme: deps.getTheme,
  });
}
