import type { DashboardAssistantRenderState } from './assistant-render-state-runtime.js';
import type { ControlSignalBus, ControlSignalScope } from '../input/control-signal.js';
import type { TurnOutputMediaPreview } from '../input/turn-output-media-preview.js';
import { runDashboardAssistantMediaPreviewOpen } from './assistant-media-preview-runtime.js';

export interface DashboardMediaRuntimeDeps {
  chatLines: string[];
  setChatScrollBottom: () => void;
  draw: () => void;
  muted: (text: string) => string;
  warning: (text: string) => string;
  getAssistantState: () => DashboardAssistantRenderState;
  openPreviewSurface?: (
    preview: TurnOutputMediaPreview,
  ) => Promise<boolean | void> | boolean | void;
  openTarget: (url: string) => Promise<void> | void;
  controlSignalBus?: ControlSignalBus;
  controlSignalScope?: ControlSignalScope;
  controlSignalWindowMs?: number;
}

export interface DashboardMediaRuntime {
  openLastAssistantMediaPreview: () => Promise<void>;
}

export function createDashboardMediaRuntime(
  deps: DashboardMediaRuntimeDeps,
): DashboardMediaRuntime {
  return {
    openLastAssistantMediaPreview: () => runDashboardAssistantMediaPreviewOpen({
      chatLines: deps.chatLines,
      setChatScrollBottom: deps.setChatScrollBottom,
      draw: deps.draw,
      muted: deps.muted,
      warning: deps.warning,
      state: deps.getAssistantState(),
      openPreviewSurface: deps.openPreviewSurface,
      openTarget: deps.openTarget,
      controlSignalBus: deps.controlSignalBus,
      controlSignalScope: deps.controlSignalScope,
      controlSignalWindowMs: deps.controlSignalWindowMs,
    }),
  };
}
