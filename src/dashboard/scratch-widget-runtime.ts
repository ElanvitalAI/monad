import type { ScratchSurfaceState } from '../display/types.js';

export interface DashboardScratchWidgetLike {
  state: Record<string, unknown>;
  character?: string;
}

// Surface-unification v2.2 V2.2-5 Part 2 (2026-05-11) — `projectScheduler`
// method retired together with the dashboard scheduler view.
export interface DashboardScratchWidgetRuntime {
  projectPreview(
    widget: DashboardScratchWidgetLike | null | undefined,
    focused: boolean,
    scratchOffset: number,
    scratchTitle: string,
    scratchLines: readonly string[],
    displayScratch: ScratchSurfaceState | null,
  ): void;
}

export function createDashboardScratchWidgetRuntime(): DashboardScratchWidgetRuntime {
  return {
    projectPreview(widget, focused, scratchOffset, scratchTitle, scratchLines, displayScratch) {
      if (!widget) return;
      const externalScratch = displayScratch && displayScratch.mode !== 'agents'
        ? displayScratch
        : null;
      const lines = externalScratch?.lines ?? scratchLines;
      const title = externalScratch?.title ?? scratchTitle;
      widget.state.mode = 'preview';
      widget.state.previewLines = [...lines];
      widget.state.scroll = scratchOffset;
      widget.state.focused = focused;
      widget.character = title ? `Scratch · ${title}` : 'Scratch';
    },
  };
}
