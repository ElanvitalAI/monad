import type { WidgetInspectorOps } from '../skills/tools/widget-inspector.js';
import type { WidgetHostLike } from '../widget-routing/widget-dispatcher.js';

export interface DashboardWidgetInspectorBootDeps {
  initWidgetInspectorTools: (ops: WidgetInspectorOps) => void;
  host: WidgetHostLike;
  draw: () => void;
}

export function bootDashboardWidgetInspector(
  deps: DashboardWidgetInspectorBootDeps,
): void {
  deps.initWidgetInspectorTools({
    host: deps.host,
    afterCall: () => deps.draw(),
  });
}
