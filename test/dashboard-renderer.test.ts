import { describe, expect, test } from 'bun:test';

import {
  buildDashboardFooterHint,
  buildDashboardLogProjection,
  buildDashboardRenderSnapshot,
  buildDashboardViewHint,
  resolveDashboardFocusedInstanceId,
  shouldEmbedDashboardLog,
} from '../src/dashboard/render/renderer.js';
import type { PromptFrame } from '../src/display/prompt-frame.js';
import { stripAnsi } from '../src/tui.js';

describe('dashboard renderer helpers', () => {
  const promptFrame: PromptFrame = {
    inputHeight: 3,
    promptTopRow: 10,
    promptBottomRow: 12,
    topDividerRow: 9,
    bottomDividerRow: 13,
  };

  test('embeds the dashboard log only for built-in working views without plugin layouts', () => {
    expect(shouldEmbedDashboardLog(false, 1)).toBe(true);
    expect(shouldEmbedDashboardLog(false, 4)).toBe(true);
    expect(shouldEmbedDashboardLog(true, 1)).toBe(false);
  });

  test('builds a chat-only snapshot with zero grid height', () => {
    expect(buildDashboardRenderSnapshot({
      termRows: 30,
      hasPluginLayout: false,
      workingDirView: 1,
      chatOnlyMode: true,
      paneHeight: 12,
      promptFrame,
    })).toEqual({
      renderChatOnly: true,
      logEmbedded: true,
      paneHeight: 12,
      gridLayoutHeight: 0,
    });
  });

  test('uses prompt-frame grid height when the log is embedded', () => {
    expect(buildDashboardRenderSnapshot({
      termRows: 30,
      hasPluginLayout: false,
      workingDirView: 2,
      chatOnlyMode: false,
      paneHeight: 12,
      promptFrame,
    })).toEqual({
      renderChatOnly: false,
      logEmbedded: true,
      paneHeight: 12,
      gridLayoutHeight: 19,
    });
  });

  test('uses pane height when the dashboard renders a separate log zone', () => {
    expect(buildDashboardRenderSnapshot({
      termRows: 30,
      hasPluginLayout: true,
      workingDirView: 1,
      chatOnlyMode: false,
      paneHeight: 12,
      promptFrame,
    })).toEqual({
      renderChatOnly: false,
      logEmbedded: false,
      paneHeight: 12,
      gridLayoutHeight: 12,
    });
  });

  test('builds the chat-only footer hint', () => {
    const hint = stripAnsi(buildDashboardFooterHint({
      renderChatOnly: true,
      browseMode: false,
      baseView: 1,
      viewHint: '[1]',
    }));
    expect(hint).toContain('LLM chat mode');
    expect(hint).toContain('/dashboard');
  });

  test('builds the browse footer hint', () => {
    const hint = stripAnsi(buildDashboardFooterHint({
      renderChatOnly: false,
      browseMode: true,
      baseView: 1,
      viewHint: '[1] 2 3',
    }));
    expect(hint).toContain('views [1] 2 3');
    expect(hint).toContain('/view');
  });

  test('builds the sync footer hint', () => {
    const hint = stripAnsi(buildDashboardFooterHint({
      renderChatOnly: false,
      browseMode: false,
      baseView: 1,
      viewHint: '[1]',
      syncSelectionCounts: { skills: 2, servers: 3, services: 4 },
      syncModeId: 'merge',
    }));
    expect(hint).toContain('2 skills');
    expect(hint).toContain('3 servers');
    expect(hint).toContain('4 services');
    expect(hint).toContain('= 24 ops');
  });

  test('builds the dashboard view hint with the active view highlighted', () => {
    const hint = stripAnsi(buildDashboardViewHint({
      views: [
        { id: '1', shortcut: '1' },
        { id: '2', shortcut: '2' },
        { id: 'x', shortcut: undefined },
      ],
      activeViewId: '2',
    }));
    expect(hint).toContain('1');
    expect(hint).toContain('[2]');
    expect(hint).toContain('x');
  });

  test('resolves focused instance id from render mode and layout owner', () => {
    expect(resolveDashboardFocusedInstanceId({
      renderChatOnly: true,
      hasPluginLayout: false,
      pluginFocusedInstanceId: 'plugin-sync',
      workingFocusedInstanceId: 'wd-browser',
    })).toBeNull();
    expect(resolveDashboardFocusedInstanceId({
      renderChatOnly: false,
      hasPluginLayout: true,
      pluginFocusedInstanceId: 'plugin-sync',
      workingFocusedInstanceId: 'wd-browser',
    })).toBe('plugin-sync');
    expect(resolveDashboardFocusedInstanceId({
      renderChatOnly: false,
      hasPluginLayout: false,
      pluginFocusedInstanceId: 'plugin-sync',
      workingFocusedInstanceId: 'wd-browser',
    })).toBe('wd-browser');
  });

  test('builds log projection from scroll/freeze/search state', () => {
    expect(buildDashboardLogProjection({
      chatScrollOffset: -1,
      logFrozenTailIndex: 42,
      logSearchCursor: 1,
      logSearchResultsLength: 3,
    })).toEqual({
      effectiveFreeze: null,
      searchCursorState: { current: 2, total: 3 },
    });

    expect(buildDashboardLogProjection({
      chatScrollOffset: 5,
      logFrozenTailIndex: 42,
      logSearchCursor: 0,
      logSearchResultsLength: 0,
    })).toEqual({
      effectiveFreeze: 42,
      searchCursorState: null,
    });
  });
});
