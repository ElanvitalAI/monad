import { topModalSurface } from '../../display/modal-stack.js';
import type { ModalSurface } from '../../display/modal-stack.js';
import type { DisplayMouseEvent } from '../../display/types.js';
import type { DashboardMouseWiringDeps } from './mouse-wiring.js';

export interface MouseModalSurfaceRuntimeDeps {
  openWindowPicker: () => void;
  getFocusStack: () => readonly string[];
  surfaceAt: (id: string) => ModalSurface | null | undefined;
  getTopBlockingModalSurface: () => ModalSurface | null;
  routeModalMouse: (surface: ModalSurface, ev: DisplayMouseEvent) => boolean;
}

export interface MouseModalSurfaceRuntime
  extends Pick<
    DashboardMouseWiringDeps,
    'onWindowPillClick' | 'getTopModalSurface' | 'getTopBlockingModalSurface' | 'routeModalMouse'
  > {}

export function createMouseModalSurfaceRuntime(
  deps: MouseModalSurfaceRuntimeDeps,
): MouseModalSurfaceRuntime {
  return {
    onWindowPillClick: () => {
      deps.openWindowPicker();
    },
    getTopModalSurface: () =>
      topModalSurface({
        focusStack: deps.getFocusStack(),
        surfaceAt: (id) => deps.surfaceAt(id),
      }),
    getTopBlockingModalSurface: deps.getTopBlockingModalSurface,
    routeModalMouse: deps.routeModalMouse,
  };
}
