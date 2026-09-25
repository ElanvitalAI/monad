import type { Action, DisplayKeyRouteResult } from '../../display/types.js';

export type DashboardDisplayKeyRouteResult =
  | { type: 'handled' }
  | { type: 'passthrough' };

export interface DashboardDisplayKeyRouteDeps {
  invokeHandler: (invoke: () => void) => void | Promise<void>;
  runCommand: (command: string) => void | Promise<void>;
  runAction: (action: Action) => void | Promise<void>;
  redraw: () => void;
}

export async function handleDashboardDisplayKeyRoute(
  route: DisplayKeyRouteResult,
  deps: DashboardDisplayKeyRouteDeps,
): Promise<DashboardDisplayKeyRouteResult> {
  switch (route.type) {
    case 'handler':
      await deps.invokeHandler(route.invoke);
      deps.redraw();
      return { type: 'handled' };
    case 'chord-armed':
      deps.redraw();
      return { type: 'handled' };
    case 'command':
      await deps.runCommand(route.command);
      return { type: 'handled' };
    case 'action':
      await deps.runAction(route.action);
      return { type: 'handled' };
    case 'consumed':
      deps.redraw();
      return { type: 'handled' };
    case 'passthrough':
      return { type: 'passthrough' };
  }
}
