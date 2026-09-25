import type { HitTarget } from '../display/types.js';
import type { BrowserPaneModel } from './model.js';

export interface BrowserActionContext {
  paneId: string;
  browserId: string;
  browser: BrowserPaneModel;
}

export interface BrowserPaneLookup {
  get(id: string): BrowserPaneModel | null;
}

export function encodeBrowserScopedSubmitText(
  kind: 'wd-cd' | 'file-attach' | 'folder-attach',
  browserId: string,
  absPath: string,
): string {
  return `${kind}:@${browserId}:${absPath}`;
}

export function resolveBrowserActionContext(
  deps: {
    registry: BrowserPaneLookup;
    paneId: string;
    widgetInstanceId?: string | null;
    fallbackBrowserId?: string | null;
  },
): BrowserActionContext | null {
  const candidates = [
    deps.widgetInstanceId ?? null,
    deps.paneId,
    deps.fallbackBrowserId ?? null,
  ];
  for (const id of candidates) {
    if (!id) continue;
    const browser = deps.registry.get(id);
    if (!browser) continue;
    return {
      paneId: deps.paneId,
      browserId: id,
      browser,
    };
  }
  return null;
}

export function resolveBrowserActionContextFromHit(
  deps: {
    registry: BrowserPaneLookup;
    hit: HitTarget;
    fallbackBrowserId?: string | null;
  },
): BrowserActionContext | null {
  if (
    deps.hit.kind !== 'pane-body'
    && deps.hit.kind !== 'pane-title'
    && deps.hit.kind !== 'pane-nav-tab'
  ) {
    return null;
  }
  return resolveBrowserActionContext({
    registry: deps.registry,
    paneId: deps.hit.paneId,
    widgetInstanceId:
      deps.hit.kind === 'pane-body' || deps.hit.kind === 'pane-title'
        ? deps.hit.widgetInstanceId ?? null
        : null,
    fallbackBrowserId: deps.fallbackBrowserId ?? null,
  });
}
