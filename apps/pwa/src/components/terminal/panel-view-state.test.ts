import { describe, expect, test } from 'bun:test';

import {
  nextTerminalPanelView,
  terminalPanelViews,
  terminalPanelViewState,
  type TerminalPanelView,
} from './panel-view-state';

function assertConsistent(view: TerminalPanelView): void {
  const state = terminalPanelViewState(view);
  expect(state.view).toBe(view);
  expect(state.buttons.filter((button) => button.selected)).toEqual([{ view, selected: true }]);
}

describe('terminalPanelViewState', () => {
  test('derives exactly one selected button and the render target from every view', () => {
    for (const view of terminalPanelViews) assertConsistent(view);
  });

  test('keeps terminal and PTY-list selections stable and toggles observe back to terminal', () => {
    expect(nextTerminalPanelView('terminal', 'terminal')).toBe('terminal');
    expect(nextTerminalPanelView('pty-list', 'pty-list')).toBe('pty-list');
    expect(nextTerminalPanelView('terminal', 'observe')).toBe('observe');
    expect(nextTerminalPanelView('observe', 'observe')).toBe('terminal');
  });

  test('keeps a matching, selected view through every two-click button sequence', () => {
    for (const initial of terminalPanelViews) {
      for (const first of terminalPanelViews) {
        for (const second of terminalPanelViews) {
          const afterFirst = nextTerminalPanelView(initial, first);
          const afterSecond = nextTerminalPanelView(afterFirst, second);
          assertConsistent(afterFirst);
          assertConsistent(afterSecond);
        }
      }
    }
  });

  test('is deterministic for identical input', () => {
    for (const view of terminalPanelViews) {
      expect(terminalPanelViewState(view)).toEqual(terminalPanelViewState(view));
    }
  });
});
