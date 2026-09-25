import type { RenderCtx } from '../plugins/core/types.js';
import type { WidgetDef, WidgetInstance } from '../widgets/types.js';

export function renderWidgetBodyWithoutTitle<S>(
  def: WidgetDef<S>,
  inst: WidgetInstance<S>,
  ctx: RenderCtx,
): string[] {
  if (ctx.height <= 0 || ctx.width <= 0) return [];
  const full = def.render(inst.state, {
    ...ctx,
    height: ctx.height + 1,
  }, inst.character);
  const body = full.slice(1, 1 + ctx.height);
  while (body.length < ctx.height) body.push(' '.repeat(ctx.width));
  return body;
}

export function contentOnlyMouseRow(localRow: number): number {
  return localRow + 1;
}
