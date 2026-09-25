import { createExecutionSurface, type ExecutionSurfaceHandle, type ExecutionSurfaceSpec } from '../display/index.js';
import type { DisplayEventBus } from '../display/events.js';
import type { DisplayHandle } from '../display/types.js';
import type { FocusManager } from '../primitives/focus-manager/index.js';
import type { HostHooks } from '../plugins/core/host.js';

export interface DashboardPluginExecutionRuntimeDeps {
  computePreviewTerminalDims: () => { cols: number; rows: number };
  display: DisplayHandle;
  focusManager: FocusManager;
  displayEvents: DisplayEventBus;
  requestDashboardRender: (pane?: string) => void;
  pushChatLine: (line: string) => void;
  clearChatScroll: () => void;
  onExecutionSurfaceExit: (id: string) => void;
  registerExecutionSurface: (handle: ExecutionSurfaceHandle) => void;
  setActiveExecutionSurfaceId: (id: string | null) => void;
  setPreviewTerminalDims: (dims: { cols: number; rows: number }) => void;
  setWorkingFocusPreview: () => void;
  formatExecutionExitLine: (id: string, code: number | null) => string;
  createSurface?: typeof createExecutionSurface;
}

export function createDashboardPluginExecutionRuntime(
  deps: DashboardPluginExecutionRuntimeDeps,
): NonNullable<HostHooks['execution']> {
  return {
    spawn: (spec: ExecutionSurfaceSpec) => {
      const dims = deps.computePreviewTerminalDims();
      const handle = (deps.createSurface ?? createExecutionSurface)({
        ...spec,
        placement: spec.placement ?? 'preview',
        cols: spec.cols ?? dims.cols,
        rows: spec.rows ?? dims.rows,
      }, {
        display: deps.display,
        focusManager: deps.focusManager,
        owner: 'plugin:host',
        events: deps.displayEvents,
        onExit: (id, code) => {
          deps.pushChatLine(deps.formatExecutionExitLine(id, code));
          deps.clearChatScroll();
          deps.onExecutionSurfaceExit(id);
          deps.requestDashboardRender('preview');
        },
      });
      deps.registerExecutionSurface(handle);
      deps.setActiveExecutionSurfaceId(handle.id);
      handle.start();
      deps.setPreviewTerminalDims(dims);
      deps.setWorkingFocusPreview();
      deps.requestDashboardRender('preview');
      return handle;
    },
  };
}
