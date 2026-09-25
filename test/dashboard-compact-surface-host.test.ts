import { describe, expect, test } from 'bun:test';

import { createCompactSurfaceHost } from '../src/dashboard/compact-surface-host.js';

function mkDeps() {
  const events: string[] = [];
  let chatOnly = false;
  const views = [
    { id: '1', label: 'Normal', shortcut: '1' },
    { id: 'agents', label: 'Agents', shortcut: '4' },
  ];
  return {
    events,
    deps: {
      buildDockSurfaceCatalogTargets: () => [
        { id: 'pane:browser', label: 'Browser popup', description: 'Open Browser as a popup', group: 'Panes' as const },
      ],
      openCatalogSurfaceById: (surfaceId: string) => { events.push(`surface:${surfaceId}`); },
      setChatOnlyMode: (next: boolean) => { chatOnly = next; },
      getChatOnlyMode: () => chatOnly,
      onChatOnlyEnabled: () => { events.push('chat:on'); },
      onChatOnlyDisabled: () => { events.push('chat:off'); },
      describeViewStarterPackage: (view: { label: string }) => `Starter: ${view.label}`,
      getViews: () => views,
      getActiveViewId: () => '1',
      getClosedStarterCount: () => 1,
      getCompactMode: () => 'compact' as const,
      restoreStarterPanes: () => { events.push('restore'); },
      resetDashboardViewsConfig: () => { events.push('reset'); },
      activateView: (view: { id: string }) => { events.push(`view:${view.id}`); },
    },
  };
}

describe('createCompactSurfaceHost', () => {
  test('exposes surface targets and dispatches surface opens', () => {
    const h = mkDeps();
    const host = createCompactSurfaceHost(h.deps);
    expect(host.getDockMenuSurfaceTargets().map((item) => item.id)).toEqual(['pane:browser']);
    host.openDockSurface('pane:browser');
    expect(h.events).toEqual(['surface:pane:browser']);
  });

  test('toggles chat-only through lifecycle hooks', () => {
    const h = mkDeps();
    const host = createCompactSurfaceHost(h.deps);
    host.toggleChatOnly();
    host.toggleChatOnly();
    expect(h.events).toEqual(['chat:on', 'chat:off']);
  });

  test('builds compact-aware dashboard views and routes action rows', () => {
    const h = mkDeps();
    const host = createCompactSurfaceHost(h.deps);
    expect(host.getDashboardViews().map((item) => item.id)).toEqual([
      '1',
      'action:view-restore',
      'action:view-reset',
    ]);
    host.applyDashboardView('action:view-restore');
    host.applyDashboardView('action:view-reset');
    host.applyDashboardView('agents');
    expect(h.events).toEqual(['restore', 'reset', 'view:agents']);
  });
});
