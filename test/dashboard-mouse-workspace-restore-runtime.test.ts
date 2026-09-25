import { describe, expect, mock, test } from 'bun:test';

import { createMouseWorkspaceRestoreRuntime } from '../src/dashboard/input/mouse-workspace-restore-runtime.js';

function runtimeDeps() {
  return {
    workspaceHost: {
      restoreMember: mock((_ownerId: string, _surfaceId: string) => {}),
    },
    companionPopupHost: {
      ownerId: 'dashboard-main',
      includes: mock((_key: string) => false),
      markOpen: mock((_key: string) => {}),
    },
    openDebugWindow: mock(() => {}),
    openDebugWorkbenchModal: mock(() => {}),
    syncCompanionPopups: mock(() => {}),
    openConversationModal: mock(async (_sessionId: string) => true),
    redraw: mock(() => {}),
  };
}

describe('createMouseWorkspaceRestoreRuntime', () => {
  test('restores debug window through dedicated opener', async () => {
    const deps = runtimeDeps();
    const runtime = createMouseWorkspaceRestoreRuntime(deps);

    await runtime.onWorkspaceRestore?.('debug-window');

    expect(deps.workspaceHost.restoreMember).toHaveBeenCalledWith('dashboard-main', 'debug-window');
    expect(deps.openDebugWindow).toHaveBeenCalled();
    expect(deps.redraw).toHaveBeenCalled();
  });

  test('reopens companion popup when surface belongs to same owner', async () => {
    const deps = runtimeDeps();
    deps.companionPopupHost.includes = mock((key: string) => key === 'clipboard');
    const runtime = createMouseWorkspaceRestoreRuntime(deps);

    await runtime.onWorkspaceRestore?.('companion:dashboard-main::clipboard');

    expect(deps.companionPopupHost.markOpen).toHaveBeenCalledWith('clipboard');
    expect(deps.syncCompanionPopups).toHaveBeenCalled();
    expect(deps.workspaceHost.restoreMember).not.toHaveBeenCalled();
  });

  test('routes conversation modal restores through async opener', async () => {
    const deps = runtimeDeps();
    const runtime = createMouseWorkspaceRestoreRuntime(deps);

    await runtime.onWorkspaceRestore?.('conversation-modal:s123');

    expect(deps.openConversationModal).toHaveBeenCalledWith('s123');
    expect(deps.workspaceHost.restoreMember).not.toHaveBeenCalled();
  });

  test('falls back to workspace restore for ordinary surfaces', async () => {
    const deps = runtimeDeps();
    const runtime = createMouseWorkspaceRestoreRuntime(deps);

    await runtime.onWorkspaceRestore?.('memo');

    expect(deps.workspaceHost.restoreMember).toHaveBeenCalledWith('dashboard-main', 'memo');
    expect(deps.redraw).toHaveBeenCalled();
  });
});
