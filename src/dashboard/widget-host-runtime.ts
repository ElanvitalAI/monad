import { debug } from '../debug/log.js';
import type { DisplayHandle } from '../display/types.js';
import type { SurfaceDescriptor } from '../surface/index.js';
import type { WidgetHost, WidgetHostHooks } from '../widgets/host.js';

export interface DashboardWidgetHostRuntimeDeps {
  pushDebugLine: (line: string) => void;
  clearChatScroll: () => void;
  requestDashboardRender: () => void;
  display: DisplayHandle;
  getWidgetHost: () => Pick<WidgetHost, 'scheduleNextFrameIfAnimating'> | null;
  getWidgetSurfaceDescriptor: (id: string) => SurfaceDescriptor | undefined;
  scheduleTimeout?: (cb: () => void, delayMs: number) => void;
}

export function createDashboardWidgetHostRuntime(
  deps: DashboardWidgetHostRuntimeDeps,
): WidgetHostHooks {
  let framePending = false;

  return {
    log: (line) => {
      deps.pushDebugLine(line);
      deps.clearChatScroll();
    },
    requestRender: () => {
      deps.requestDashboardRender();
    },
    display: deps.display,
    scheduleFrame: (delayMs: number) => {
      if (framePending) return;
      framePending = true;
      if (debug.enabled) {
        debug.log('animation.frame.tickler', 'queued', { delayMs });
      }
      (deps.scheduleTimeout ?? defaultScheduleTimeout)(() => {
        framePending = false;
        deps.requestDashboardRender();
        deps.getWidgetHost()?.scheduleNextFrameIfAnimating(delayMs);
      }, delayMs);
    },
    zInfoFor: (id: string): { tier?: string; zIndex?: number } | undefined => {
      try {
        const desc = deps.getWidgetSurfaceDescriptor(id);
        if (!desc) return undefined;
        return {
          ...(desc.tier !== undefined ? { tier: desc.tier } : {}),
          ...(desc.zHint !== undefined ? { zIndex: desc.zHint } : {}),
        };
      } catch {
        return undefined;
      }
    },
  };
}

function defaultScheduleTimeout(cb: () => void, delayMs: number): void {
  setTimeout(cb, delayMs);
}
