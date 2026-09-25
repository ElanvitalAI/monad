// Widget routing — public barrel.

export { createPaneKeyRouter } from './widget-key-router.js';
export type { KeyRouterResult, PaneHandler, PaneKeyRouter } from './types.js';
export {
  PANE_WIDGET_MAPPINGS,
  widgetIdForPane,
  type PaneWidgetMapping,
} from './pane-to-widget.js';
export { dispatchKeyToWidget, type WidgetHostLike } from './widget-dispatcher.js';
