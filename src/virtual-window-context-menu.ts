import type {
  MenuProviderRegistry,
  MenuProvider,
  MenuBuildContext,
} from './ui/context-menu-providers.js';
import type { Menu } from './ui/context-menu-registry.js';
import type { HitTarget } from './display/types.js';
import type { PaneContentKind } from './virtual-windows/pane-content.js';

export interface VirtualWindowTitleMenuPayload {
  readonly windowId: string;
  readonly paneId: string;
}

export interface VirtualWindowTitleMenuProviderDeps {
  resolvePaneKind?: (payload: VirtualWindowTitleMenuPayload) => PaneContentKind | null;
  isCompanionOpen?: (
    payload: VirtualWindowTitleMenuPayload,
    key: 'clipboard' | 'memo' | 'detail',
  ) => boolean;
}

const POPUP_RETURN_CAPABLE_KINDS = new Set<PaneContentKind>([
  'vw-browser',
  'vw-preview',
  'terminal-slot',
  'scratch',
]);

export function createVirtualWindowTitleMenuProvider(
  deps: VirtualWindowTitleMenuProviderDeps = {},
): MenuProvider {
  return (hit: HitTarget, _ctx: MenuBuildContext): Menu | null => {
    if (hit.kind !== 'vw-pane-title') return null;
    const payload: VirtualWindowTitleMenuPayload = {
      windowId: String(hit.windowId),
      paneId: hit.paneId,
    };
    const kind = deps.resolvePaneKind?.(payload) ?? null;
    const clipboardOpen = deps.isCompanionOpen?.(payload, 'clipboard') ?? false;
    const memoOpen = deps.isCompanionOpen?.(payload, 'memo') ?? false;
    const detailOpen = deps.isCompanionOpen?.(payload, 'detail') ?? false;
    const items: Menu['items'] = [
      {
        kind: 'command',
        id: 'vw.selector',
        label: 'Open pane/window selector…',
        payload,
      },
      { kind: 'separator' },
      {
        kind: 'command',
        id: 'vw.clipboard-companion',
        label: clipboardOpen ? 'Hide clipboard companion' : 'Show clipboard companion',
        payload,
      },
      {
        kind: 'command',
        id: 'vw.memo-companion',
        label: memoOpen ? 'Hide memo companion' : 'Show memo companion',
        payload,
      },
      {
        kind: 'command',
        id: 'vw.detail-companion',
        label: detailOpen ? 'Hide detail companion' : 'Show detail companion',
        payload,
      },
    ];
    if (kind && POPUP_RETURN_CAPABLE_KINDS.has(kind)) {
      items.push({
        kind: 'command',
        id: 'vw.return-popup',
        label: 'Return to popup',
        payload,
      });
    }
    return {
      id: `vw-pane-title:${payload.windowId}:${payload.paneId}`,
      title: 'Pane',
      items,
    };
  };
}

export function registerVirtualWindowContextMenus(
  providers: MenuProviderRegistry,
  deps: VirtualWindowTitleMenuProviderDeps = {},
): () => void {
  const unreg = providers.register('vw-pane-title:*', createVirtualWindowTitleMenuProvider(deps));
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    try { unreg(); } catch { /* swallow */ }
  };
}
