import type { HostHooks } from '../plugins/core/host.js';

export interface DashboardPluginBaseRuntimeDeps {
  pushChatLine: (line: string) => void;
  clearChatScroll: () => void;
  setHudSegment: (key: string, value: string, priority?: number) => void;
  clearHudSegment: (key: string) => void;
  requestDashboardRender: (pane?: string) => void;
  submitDashboardText: (text: string) => void;
}

export function createDashboardPluginBaseRuntime(
  deps: DashboardPluginBaseRuntimeDeps,
): Pick<HostHooks, 'log' | 'hudSet' | 'requestRender' | 'submitText'> {
  return {
    log: (line) => {
      deps.pushChatLine(line);
      deps.clearChatScroll();
    },
    hudSet: (key, value, priority) => {
      if (value) deps.setHudSegment(key, value, priority);
      else deps.clearHudSegment(key);
    },
    requestRender: (pane) => {
      deps.requestDashboardRender(pane);
    },
    submitText: (text) => {
      deps.submitDashboardText(text);
    },
  };
}
