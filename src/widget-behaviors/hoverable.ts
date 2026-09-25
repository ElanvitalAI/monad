import type { WidgetContext, WidgetHoverEvent } from '../widgets/types.js';

export interface HoverableState {
  hoveredItemIndex?: number | null;
}

export function hoverTint(colored: string): string {
  return `\x1b[4m${colored}\x1b[24m`;
}

export function applyHoverableListRowEvent<S extends HoverableState>(
  ev: WidgetHoverEvent,
  state: S,
  ctx: WidgetContext<S>,
  telemetryPrefix: string,
): void {
  if (ev.hit.kind !== 'list-row') return;
  if (ev.kind === 'hover-enter') {
    if (state.hoveredItemIndex !== ev.hit.itemIndex) {
      state.hoveredItemIndex = ev.hit.itemIndex;
      ctx.requestRender();
    }
    ctx.telemetry?.emit({
      kind: `${telemetryPrefix}.hover.enter`,
      data: { itemIndex: ev.hit.itemIndex },
    });
    return;
  }
  if (ev.kind === 'hover-leave') {
    if (state.hoveredItemIndex !== null && state.hoveredItemIndex !== undefined) {
      state.hoveredItemIndex = null;
      ctx.requestRender();
    }
    ctx.telemetry?.emit({
      kind: `${telemetryPrefix}.hover.leave`,
      data: { itemIndex: ev.hit.itemIndex },
    });
  }
}
