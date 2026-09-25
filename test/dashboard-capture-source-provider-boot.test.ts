import { describe, expect, test } from 'bun:test';

import { bootDashboardCaptureSourceProviders } from '../src/dashboard/capture-source-provider-boot.js';

describe('bootDashboardCaptureSourceProviders', () => {
  test('registers vw, agent-session, and browser-cdp providers with projected inputs', () => {
    const registered: unknown[] = [];
    const registry = { kind: 'registry' };

    bootDashboardCaptureSourceProviders({
      defaultCaptureSourceRegistry: () => registry,
      createVwPaneProvider: (deps) => ({
        type: 'vw',
        windows: deps.getWindows(),
      }),
      createAgentSessionProvider: (deps) => ({
        type: 'agent',
        sessions: deps.listSessions(),
        observer: deps.findObserver('sess-1'),
      }),
      createBrowserCdpProvider: (deps) => ({
        type: 'browser',
        client: deps.getClient(),
      }),
      registerProvider: (_registry, provider) => { registered.push(provider); },
      getWindows: () => [{
        id: 7,
        title: 'VW',
        listPanes: () => [
          { id: 'p1', content: { title: 'Preview', kind: 'vw-preview' } },
        ],
      }],
      listSessions: () => [{
        session: { id: 'sess-1' },
        paneId: 'pane-1',
        windowId: 7,
      }],
      findObserver: (sessionId) => ({ id: `observer:${sessionId}` }),
    });

    expect(registered).toEqual([
      {
        type: 'vw',
        windows: [{
          id: 7,
          title: 'VW',
          panes: [{ id: 'p1', title: 'Preview', kind: 'vw-preview' }],
        }],
      },
      {
        type: 'agent',
        sessions: [{
          session: { id: 'sess-1' },
          paneId: 'pane-1',
          windowId: 7,
        }],
        observer: { id: 'observer:sess-1' },
      },
      {
        type: 'browser',
        client: undefined,
      },
    ]);
  });
});
