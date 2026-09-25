import type { DashboardAssistantRenderState } from './assistant-render-state-runtime.js';
import type { ControlSignalBus, ControlSignalScope } from '../input/control-signal.js';
import { buildTurnOutputTextBlocks } from '../input/turn-output-block.js';
import {
  buildTurnOutputMediaPreview,
  type TurnOutputMediaPreview,
} from '../input/turn-output-media-preview.js';
import { shouldStopTurnOutputSink } from '../input/turn-output-sink-policy.js';

export interface DashboardAssistantMediaPreviewPayload {
  preview: TurnOutputMediaPreview;
  sourceText: string;
}

export interface DashboardAssistantMediaPreviewOpenDeps {
  chatLines: string[];
  muted: (text: string) => string;
  warning: (text: string) => string;
  setChatScrollBottom: () => void;
  draw: () => void;
}

export function buildDashboardAssistantMediaPreviewPayload(
  state: DashboardAssistantRenderState,
): DashboardAssistantMediaPreviewPayload | null {
  if (state.lastAssistantRaw === null) return null;
  const preview = buildTurnOutputMediaPreview(buildTurnOutputTextBlocks(state.lastAssistantRaw));
  if (!preview) return null;
  return {
    preview,
    sourceText: state.lastAssistantRaw,
  };
}

export async function runDashboardAssistantMediaPreviewOpen(
  deps: DashboardAssistantMediaPreviewOpenDeps & {
    state: DashboardAssistantRenderState;
    openPreviewSurface?: (
      preview: TurnOutputMediaPreview,
    ) => Promise<boolean | void> | boolean | void;
    openTarget: (url: string) => Promise<void> | void;
    controlSignalBus?: ControlSignalBus;
    controlSignalScope?: ControlSignalScope;
    controlSignalWindowMs?: number;
  },
): Promise<void> {
  const payload = buildDashboardAssistantMediaPreviewPayload(deps.state);
  if (!payload) {
    deps.chatLines.push(deps.warning('(no media preview in last assistant output)'));
    deps.setChatScrollBottom();
    deps.draw();
    return;
  }
  if (
    deps.controlSignalBus
    && deps.controlSignalScope
    && shouldStopTurnOutputSink({
      signalBus: deps.controlSignalBus,
      scope: deps.controlSignalScope,
      sinkKind: payload.preview.kind === 'picture' ? 'picture' : 'video',
      windowMs: deps.controlSignalWindowMs,
    })
  ) {
    deps.chatLines.push(
      deps.warning(`(${payload.preview.kind} preview stopped by control signal)`),
    );
    deps.setChatScrollBottom();
    deps.draw();
    return;
  }
  if (deps.openPreviewSurface) {
    try {
      const handled = await deps.openPreviewSurface(payload.preview);
      if (handled !== false) {
        deps.chatLines.push(
          deps.muted(`(previewed ${payload.preview.kind}: ${payload.preview.label})`),
        );
        deps.setChatScrollBottom();
        deps.draw();
        return;
      }
    } catch {
      // Fall back to external open target path.
    }
  }
  await deps.openTarget(payload.preview.url);
  deps.chatLines.push(
    deps.muted(`(opened ${payload.preview.kind} preview: ${payload.preview.label})`),
  );
  deps.setChatScrollBottom();
  deps.draw();
}
