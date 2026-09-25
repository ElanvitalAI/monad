import type { ApprovalModalRouter } from '../../approval-modal.js';
import { toDashboardKeyEvent } from './key-types.js';
import type { DashboardKeyRouteResult } from './key-types.js';
import type { Key } from '../../tui.js';

export function routeApprovalModalKey(key: Key, router: ApprovalModalRouter): DashboardKeyRouteResult {
  if (router.current() === null) return 'passthrough';
  router.handleKey(toDashboardKeyEvent(key));
  return 'consumed';
}
