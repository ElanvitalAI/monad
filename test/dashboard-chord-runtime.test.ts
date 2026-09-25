import { describe, expect, mock, test } from 'bun:test';

import { createDashboardChordRuntime } from '../src/dashboard/input/dashboard-chord-runtime.js';
import type { SessionsSidebarState } from '../src/session/sidebar-widget.js';

describe('createDashboardChordRuntime', () => {
  test('focusSessions refreshes, focuses sidebar, and marks the focused session read', async () => {
    const calls: string[] = [];
    const run = createDashboardChordRuntime<string>({
      focusBrowser: () => {},
      focusObsidian: () => {},
      reopenScratch: () => {},
      toggleBell: () => {},
      refreshSessionCardsInto: () => { calls.push('refresh'); },
      focusSessionsSidebar: () => { calls.push('focus-sidebar'); },
      getSessionsSidebarState: () => undefined,
      focusSessionSidebarCursor: () => ({ sessionId: 'sess-1' }),
      cycleSessionSidebarCursor: () => ({ sessionId: null }),
      markNotificationRead: (sessionId) => { calls.push(`read:${sessionId}`); },
      closeFocusedPane: () => false,
      focusedPaneLabel: () => 'Browser',
      onPaneClosed: () => {},
      reopenPanes: () => {},
      onPanesReopened: () => {},
      getOpenPaneModalTarget: () => 'input',
      openPaneModal: () => {},
      toggleLogZoom: () => {},
      openPreviewTerminal: () => {},
      getPreviewTerminal: () => null,
      getTerminalExpanded: () => false,
      setTerminalExpanded: () => {},
      resetPreviewTerminalDims: () => {},
      focusPreviewAfterTerminalExpand: () => {},
      onPreviewTerminalExpandChanged: () => {},
      onMissingPreviewTerminal: () => {},
    });

    await run({ kind: 'focus-sessions' });

    expect(calls).toEqual(['refresh', 'focus-sidebar', 'read:sess-1', 'refresh']);
  });

  test('cycleSessions uses sidebar state and refocuses the sidebar', async () => {
    const calls: string[] = [];
    const state = {} as SessionsSidebarState;
    const run = createDashboardChordRuntime<string>({
      focusBrowser: () => {},
      focusObsidian: () => {},
      reopenScratch: () => {},
      toggleBell: () => {},
      refreshSessionCardsInto: () => { calls.push('refresh'); },
      focusSessionsSidebar: () => { calls.push('focus-sidebar'); },
      getSessionsSidebarState: () => state,
      focusSessionSidebarCursor: () => ({ sessionId: null }),
      cycleSessionSidebarCursor: () => ({ sessionId: 'sess-2' }),
      markNotificationRead: (sessionId) => { calls.push(`read:${sessionId}`); },
      closeFocusedPane: () => false,
      focusedPaneLabel: () => 'Browser',
      onPaneClosed: () => {},
      reopenPanes: () => {},
      onPanesReopened: () => {},
      getOpenPaneModalTarget: () => 'input',
      openPaneModal: () => {},
      toggleLogZoom: () => {},
      openPreviewTerminal: () => {},
      getPreviewTerminal: () => null,
      getTerminalExpanded: () => false,
      setTerminalExpanded: () => {},
      resetPreviewTerminalDims: () => {},
      focusPreviewAfterTerminalExpand: () => {},
      onPreviewTerminalExpandChanged: () => {},
      onMissingPreviewTerminal: () => {},
    });

    await run({ kind: 'cycle-sessions', delta: 1 });

    expect(calls).toEqual(['refresh', 'read:sess-2', 'refresh', 'focus-sidebar']);
  });

  test('closePane emits close message only on successful close', async () => {
    const onPaneClosed = mock((_label: string) => {});
    const run = createDashboardChordRuntime<string>({
      focusBrowser: () => {},
      focusObsidian: () => {},
      reopenScratch: () => {},
      toggleBell: () => {},
      refreshSessionCardsInto: () => {},
      focusSessionsSidebar: () => {},
      getSessionsSidebarState: () => undefined,
      focusSessionSidebarCursor: () => ({ sessionId: null }),
      cycleSessionSidebarCursor: () => ({ sessionId: null }),
      markNotificationRead: () => {},
      closeFocusedPane: () => true,
      focusedPaneLabel: () => 'Preview',
      onPaneClosed,
      reopenPanes: () => {},
      onPanesReopened: () => {},
      getOpenPaneModalTarget: () => 'input',
      openPaneModal: () => {},
      toggleLogZoom: () => {},
      openPreviewTerminal: () => {},
      getPreviewTerminal: () => null,
      getTerminalExpanded: () => false,
      setTerminalExpanded: () => {},
      resetPreviewTerminalDims: () => {},
      focusPreviewAfterTerminalExpand: () => {},
      onPreviewTerminalExpandChanged: () => {},
      onMissingPreviewTerminal: () => {},
    });

    await run({ kind: 'close-pane' });

    expect(onPaneClosed).toHaveBeenCalledWith('Preview');
  });

  test('togglePreviewTerminalExpand flips expand state and announces it', async () => {
    const setTerminalExpanded = mock((_next: boolean) => {});
    const onPreviewTerminalExpandChanged = mock((_next: boolean) => {});
    const run = createDashboardChordRuntime<string>({
      focusBrowser: () => {},
      focusObsidian: () => {},
      reopenScratch: () => {},
      toggleBell: () => {},
      refreshSessionCardsInto: () => {},
      focusSessionsSidebar: () => {},
      getSessionsSidebarState: () => undefined,
      focusSessionSidebarCursor: () => ({ sessionId: null }),
      cycleSessionSidebarCursor: () => ({ sessionId: null }),
      markNotificationRead: () => {},
      closeFocusedPane: () => false,
      focusedPaneLabel: () => 'Preview',
      onPaneClosed: () => {},
      reopenPanes: () => {},
      onPanesReopened: () => {},
      getOpenPaneModalTarget: () => 'input',
      openPaneModal: () => {},
      toggleLogZoom: () => {},
      openPreviewTerminal: () => {},
      getPreviewTerminal: () => ({ isAlive: true } as { isAlive: true }),
      getTerminalExpanded: () => false,
      setTerminalExpanded,
      resetPreviewTerminalDims: () => {},
      focusPreviewAfterTerminalExpand: () => {},
      onPreviewTerminalExpandChanged,
      onMissingPreviewTerminal: () => {},
    });

    await run({ kind: 'toggle-preview-terminal-expand' });

    expect(setTerminalExpanded).toHaveBeenCalledWith(true);
    expect(onPreviewTerminalExpandChanged).toHaveBeenCalledWith(true);
  });

  test('togglePreviewTerminalExpand reports missing terminal when none is alive', async () => {
    const onMissingPreviewTerminal = mock(() => {});
    const run = createDashboardChordRuntime<string>({
      focusBrowser: () => {},
      focusObsidian: () => {},
      reopenScratch: () => {},
      toggleBell: () => {},
      refreshSessionCardsInto: () => {},
      focusSessionsSidebar: () => {},
      getSessionsSidebarState: () => undefined,
      focusSessionSidebarCursor: () => ({ sessionId: null }),
      cycleSessionSidebarCursor: () => ({ sessionId: null }),
      markNotificationRead: () => {},
      closeFocusedPane: () => false,
      focusedPaneLabel: () => 'Preview',
      onPaneClosed: () => {},
      reopenPanes: () => {},
      onPanesReopened: () => {},
      getOpenPaneModalTarget: () => 'input',
      openPaneModal: () => {},
      toggleLogZoom: () => {},
      openPreviewTerminal: () => {},
      getPreviewTerminal: () => null,
      getTerminalExpanded: () => false,
      setTerminalExpanded: () => {},
      resetPreviewTerminalDims: () => {},
      focusPreviewAfterTerminalExpand: () => {},
      onPreviewTerminalExpandChanged: () => {},
      onMissingPreviewTerminal,
    });

    await run({ kind: 'toggle-preview-terminal-expand' });

    expect(onMissingPreviewTerminal).toHaveBeenCalled();
  });
});
