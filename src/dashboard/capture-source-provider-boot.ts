import type { VwPaneProviderDeps } from '../capture/providers/vw-pane-provider.js';
import type { AgentSessionProviderDeps } from '../capture/providers/agent-session-provider.js';
import type { EmbodiedAgentSession } from '../agent/embodiment.js';
import type { TransportObserver } from '../agent/transport-observer.js';

export interface DashboardCaptureWindowPaneLike {
  id: string | number;
  content: {
    title?: string | null;
    kind?: string | null;
  };
}

export interface DashboardCaptureWindowLike {
  // WindowRegistry mints numeric ids (`WindowId = number`); the earlier
  // `string | number` was drift that no longer matched VirtualWindow.
  id: number;
  title: string;
  listPanes(): DashboardCaptureWindowPaneLike[];
}

export interface DashboardCaptureSessionLike {
  // Mirrors the capture layer's `AgentSessionListEntry` contract — a
  // live embodied session with its (optional) pane/window placement.
  session: EmbodiedAgentSession;
  paneId?: string;
  windowId?: number;
}

export interface DashboardCaptureSourceProviderBootDeps<Registry, VwProvider, AgentProvider, BrowserProvider> {
  defaultCaptureSourceRegistry: () => Registry;
  createVwPaneProvider: (deps: VwPaneProviderDeps) => VwProvider;
  createAgentSessionProvider: (deps: AgentSessionProviderDeps) => AgentProvider;
  createBrowserCdpProvider: (deps: {
    getClient: () => undefined;
  }) => BrowserProvider;
  registerProvider: (registry: Registry, provider: VwProvider | AgentProvider | BrowserProvider) => void;
  getWindows: () => DashboardCaptureWindowLike[];
  listSessions: () => readonly DashboardCaptureSessionLike[];
  findObserver: (sessionId: string) => TransportObserver | undefined;
}

export function bootDashboardCaptureSourceProviders<
  Registry,
  VwProvider,
  AgentProvider,
  BrowserProvider,
>(
  deps: DashboardCaptureSourceProviderBootDeps<Registry, VwProvider, AgentProvider, BrowserProvider>,
): void {
  const registry = deps.defaultCaptureSourceRegistry();
  deps.registerProvider(registry, deps.createVwPaneProvider({
    getWindows: () => deps.getWindows().map((window) => ({
      id: window.id,
      title: window.title,
      panes: window.listPanes().map((pane) => ({
        id: String(pane.id),
        title: pane.content.title ?? '',
        kind: pane.content.kind ?? 'unknown',
      })),
    })),
  }));
  deps.registerProvider(registry, deps.createAgentSessionProvider({
    listSessions: () => deps.listSessions().map((entry) => ({
      session: entry.session,
      paneId: entry.paneId,
      windowId: entry.windowId,
    })),
    findObserver: deps.findObserver,
  }));
  deps.registerProvider(registry, deps.createBrowserCdpProvider({
    getClient: () => undefined,
  }));
}
