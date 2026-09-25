import type { DashboardVirtualWindows } from '../windowing/virtual-windows.js';
import { toDashboardKeyEvent, type DashboardKeyRouteResult } from './key-types.js';
import type { Key } from '../../tui.js';

/** KX4b — chord-only dispatcher for the VW navigation chord (^B 0..9
 *  etc.). The active VW surface is pushed as a ModalSurface via
 *  WindowRegistry.switchTo → coordinator.pushModal, so its onKey is
 *  reached through coordinator.routeKey naturally. Only the chord
 *  (a stateful multi-key interceptor, not a modal surface) stays in
 *  the dispatcher chain. Returns 'passthrough' when the chord isn't
 *  armed so keys fall through to coordinator.routeKey below. */
export function routeVirtualWindowKey(
  key: Key,
  virtualWindows: DashboardVirtualWindows,
): DashboardKeyRouteResult {
  if (!virtualWindows.router.isArmed()) return 'passthrough';

  const ev = toDashboardKeyEvent(key);
  const navResult = virtualWindows.router.handleKey(ev);
  if (navResult === 'armed' || navResult === 'consumed' || navResult === 'cancelled') {
    return 'consumed';
  }
  return 'passthrough';
}
