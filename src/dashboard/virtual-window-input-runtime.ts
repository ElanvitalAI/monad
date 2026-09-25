import type { InitDashboardVirtualWindowsOpts } from './windowing/virtual-windows.js';
import type { PaneVisibility } from '../panes/visual-state.js';
import {
  defaultVirtualWindowBoundsForHostChrome,
  reservedBottomRowsForHostChrome,
} from './host-chrome-policy.js';
import { DEFAULT_HOST_CHROME_PROFILE, type HostChromeProfile } from '../display/host-chrome-profile.js';

type VwInputRuntimeOpts = Pick<
  InitDashboardVirtualWindowsOpts,
  | 'onLocalInputSubmit'
  | 'onOpenLocalInputTargetPicker'
  | 'onShowSelector'
  | 'onShowContextMenu'
  | 'extraSkipWindowWhen'
  | 'visibilityResolverFactory'
  | 'defaultBounds'
>;

export interface DashboardVirtualWindowInputRuntimeDeps {
  // method 문법(bivariant 파라미터) — 구체 WindowRegistry / VirtualWindow 를
  // 그대로 수용한다. arrow-property 는 broadcast:unknown·listPanes 반환이
  // 구체 타입으로 contravariant 하게 좁혀지며 튕긴다.
  getRegistry: () => {
    get(windowId: number): {
      deliverBroadcastToFocused(broadcast: unknown): number;
      deliverBroadcastToPane(paneId: string, broadcast: unknown): number;
      deliverBroadcastToAll(broadcast: unknown): number;
      getPaneDisplayTitle(paneId: string): string;
      listPanes(): unknown[];
    } | null | undefined;
  };
  pushMutedLine: (line: string) => void;
  openLocalInputTargetPopup: (windowId: number, seedQuery: string) => void;
  openSelectorPopup: (windowId: number, col: number, row: number) => void;
  routeContextMenu: (req: {
    type: 'right-click';
    row: number;
    col: number;
    hitTarget: { kind: 'vw-pane-title'; windowId: string; paneId: string };
  }) => boolean;
  // method 문법(bivariant) — 구체 (w: VirtualWindow) => boolean 술어를 수용.
  skipWindowWhen(w: unknown): boolean;
  resolvePaneVisibility: (windowId: number, paneId: string) => PaneVisibility;
  termSize: () => { cols: number; rows: number };
}

export function createDashboardVirtualWindowInputRuntime(
  deps: DashboardVirtualWindowInputRuntimeDeps,
): VwInputRuntimeOpts {
  return {
    onLocalInputSubmit: (windowId, req) => {
      const w = deps.getRegistry().get(windowId);
      if (!w) return;
      if (req.target.kind === 'focused') {
        const delivered = w.deliverBroadcastToFocused(req.broadcast);
        deps.pushMutedLine(`  vw:${windowId} @focused → delivered=${delivered} skipped=${Math.max(0, 1 - delivered)}`);
        return;
      }
      if (req.target.kind === 'pane') {
        const delivered = w.deliverBroadcastToPane(req.target.paneId, req.broadcast);
        const label = w.getPaneDisplayTitle(req.target.paneId) || req.target.paneId.slice(0, 6);
        deps.pushMutedLine(`  vw:${windowId} @${label} → delivered=${delivered} skipped=${Math.max(0, 1 - delivered)}`);
        return;
      }
      const delivered = w.deliverBroadcastToAll(req.broadcast);
      const total = w.listPanes().length;
      deps.pushMutedLine(
        `  vw:${windowId} @all → delivered=${delivered}`
        + ` skipped=${Math.max(0, total - delivered)}`,
      );
    },
    onOpenLocalInputTargetPicker: (req) => {
      // seedQuery 는 optional(string|undefined) — 없으면 빈 seed 로(동작 동일).
      deps.openLocalInputTargetPopup(req.windowId, req.seedQuery ?? '');
    },
    onShowSelector: (windowId, _paneId, col, row) => {
      deps.openSelectorPopup(windowId, col, row);
    },
    onShowContextMenu: (windowId, paneId, col, row) => {
      const consumed = deps.routeContextMenu({
        type: 'right-click',
        row,
        col,
        hitTarget: { kind: 'vw-pane-title', windowId: String(windowId), paneId },
      });
      if (!consumed) deps.openSelectorPopup(windowId, col, row);
    },
    extraSkipWindowWhen: deps.skipWindowWhen,
    visibilityResolverFactory: (windowId) => (paneId) =>
      deps.resolvePaneVisibility(windowId, paneId),
    defaultBounds: (profile?: HostChromeProfile) => {
      const activeProfile = profile ?? DEFAULT_HOST_CHROME_PROFILE;
      return defaultVirtualWindowBoundsForHostChrome(deps.termSize(), {
        reservedBottomRows: reservedBottomRowsForHostChrome(activeProfile),
      });
    },
  };
}
