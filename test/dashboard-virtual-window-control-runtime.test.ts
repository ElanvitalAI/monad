import { describe, expect, test } from 'bun:test';

import { createDashboardVirtualWindowControlRuntime } from '../src/dashboard/virtual-window-control-runtime.js';

describe('createDashboardVirtualWindowControlRuntime', () => {
  test('routes picker and close callbacks', () => {
    const events: string[] = [];
    const runtime = createDashboardVirtualWindowControlRuntime({
      openWindowPicker: () => { events.push('picker'); },
      getCurrentWindow: () => ({
        id: 7,
        isLocalComposerActive: () => false,
        setLocalComposerActive: () => {},
        toggleZoom: () => false,
        focusLastPane: () => null,
      }),
      closeWindow: (windowId) => { events.push(`close:${windowId}`); },
      pushMutedLine: () => {},
      draw: () => {},
    });

    runtime.onPicker?.();
    runtime.onCloseWindow?.();
    expect(events).toEqual(['picker', 'close:7']);
  });

  test('handles local composer, zoom, and last-focused-pane actions', () => {
    const lines: string[] = [];
    const actions: string[] = [];
    let active = false;
    const runtime = createDashboardVirtualWindowControlRuntime({
      openWindowPicker: () => {},
      getCurrentWindow: () => ({
        id: 3,
        isLocalComposerActive: () => active,
        setLocalComposerActive: (next) => { active = next; actions.push(`composer:${next}`); },
        toggleZoom: () => true,
        focusLastPane: () => null,
      }),
      closeWindow: () => {},
      pushMutedLine: (line) => { lines.push(line); },
      draw: () => { actions.push('draw'); },
    });

    runtime.onSyncInputBarToggle?.();
    runtime.onZoomToggle?.();
    runtime.onLastFocusedPane?.();

    expect(actions).toEqual(['composer:true', 'draw', 'draw', 'draw']);
    expect(lines).toEqual([
      '  vw:3 local composer: on',
      '  vw:3 zoom: on',
      '  no previous pane to swap to',
    ]);
  });

  test('logs a friendly message when no foreground window exists for local input', () => {
    const lines: string[] = [];
    const runtime = createDashboardVirtualWindowControlRuntime({
      openWindowPicker: () => {},
      getCurrentWindow: () => null,
      closeWindow: () => {},
      pushMutedLine: (line) => { lines.push(line); },
      draw: () => {},
    });

    runtime.onSyncInputBarToggle?.();
    runtime.onZoomToggle?.();
    runtime.onLastFocusedPane?.();
    runtime.onCloseWindow?.();

    expect(lines).toEqual(['No foreground virtual window for local input.']);
  });
});
