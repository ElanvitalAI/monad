import { describe, expect, test } from 'bun:test';

import { registerDashboardPaneArtifactRuntimes } from '../src/dashboard/pane-artifact-runtime-registration.js';

describe('registerDashboardPaneArtifactRuntimes', () => {
  test('registers artifact, recording, pane, and pane-watch runtimes from shared dashboard state', () => {
    const artifactCalls: unknown[] = [];
    const recordingCalls: unknown[] = [];
    const paneCalls: unknown[] = [];
    const watchCalls: unknown[] = [];

    const artifactStore = { kind: 'artifact-store' };
    const widgetHost = { kind: 'widget-host' };
    const paneVisualStateStore = { kind: 'pane-visual-state-store' };

    registerDashboardPaneArtifactRuntimes({
      artifactStore: artifactStore as never,
      widgetHost: widgetHost as never,
      paneVisualStateStore: paneVisualStateStore as never,
      registerArtifact: ((opts) => { artifactCalls.push(opts); }) as never,
      registerRecording: ((opts) => { recordingCalls.push(opts); }) as never,
      registerPane: ((opts) => { paneCalls.push(opts); }) as never,
      registerPaneWatchCompare: ((opts) => { watchCalls.push(opts); }) as never,
    });

    expect(artifactCalls).toEqual([{ store: artifactStore }]);
    expect(recordingCalls).toEqual([{ widgetHost, artifactStore }]);
    expect(paneCalls).toEqual([{ store: paneVisualStateStore }]);
    expect(watchCalls).toEqual([{}]);
  });
});
