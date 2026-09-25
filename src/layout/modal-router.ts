import type { Layout } from './types.js';
import { closeModal } from './host.js';
import type { WidgetHost } from '../widgets/host.js';
import type { Action, KeyEvent } from '../widgets/types.js';

export type LayoutModalRouteResult =
  | { type: 'passthrough' }
  | { type: 'handled'; layout: Layout; action: Action }
  | { type: 'closed'; layout: Layout; modalId: string; widgetId: string; reason: 'escape' | 'deactivate' | 'missing-widget' };

export function routeLayoutModalKey(
  layout: Layout,
  widgetHost: WidgetHost,
  ev: KeyEvent,
): LayoutModalRouteResult {
  if (layout.modals.length === 0) return { type: 'passthrough' };
  const modal = layout.modals[0]!;

  if (ev.name === 'escape') {
    widgetHost.dispose(modal.widgetInstanceId);
    return {
      type: 'closed',
      layout: closeModal(layout, modal.id),
      modalId: modal.id,
      widgetId: modal.widgetInstanceId,
      reason: 'escape',
    };
  }

  const def = widgetHost.defFor(modal.widgetInstanceId);
  const inst = widgetHost.get(modal.widgetInstanceId);
  const ctx = widgetHost.buildContext(modal.widgetInstanceId);
  if (!def || !inst || !ctx) {
    widgetHost.dispose(modal.widgetInstanceId);
    return {
      type: 'closed',
      layout: closeModal(layout, modal.id),
      modalId: modal.id,
      widgetId: modal.widgetInstanceId,
      reason: 'missing-widget',
    };
  }

  const action = def.onKey
    ? def.onKey(ev, inst.state, ctx as never)
    : { type: 'none' as const };

  if (action.type === 'deactivate') {
    widgetHost.dispose(modal.widgetInstanceId);
    return {
      type: 'closed',
      layout: closeModal(layout, modal.id),
      modalId: modal.id,
      widgetId: modal.widgetInstanceId,
      reason: 'deactivate',
    };
  }

  return { type: 'handled', layout, action };
}
