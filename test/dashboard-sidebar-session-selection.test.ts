import { describe, expect, test } from 'bun:test';

import {
  formatDashboardSidebarJoinError,
  formatDashboardSidebarJoinResult,
  formatDashboardSidebarSelectedSession,
  resolveDashboardSidebarPromoteToVw,
} from '../src/dashboard/sidebar-session-selection.js';

describe('dashboard sidebar session selection', () => {
  test('formats promoted and joined ACP background results', () => {
    expect(formatDashboardSidebarJoinResult('acp-bg:1', {
      promoted: true,
      windowId: 4,
      paneId: 'p2',
      fullOutput: '',
      state: 'running',
    })).toEqual({
      tone: 'info',
      message: '[sidebar · promoted] acp-bg:1 → W4 / p2',
    });

    expect(formatDashboardSidebarJoinResult('acp-bg:2', {
      fullOutput: 'x'.repeat(2048),
      state: 'done',
      stopReason: 'stop',
      error: 'oops',
    })).toEqual({
      tone: 'info',
      message: '[sidebar · joined] acp-bg:2 — done (stop) · 2.0KB · err: oops',
    });
  });

  test('formats join failures and non-ACP selection', () => {
    expect(formatDashboardSidebarJoinError('acp-bg:3', new Error('boom')))
      .toBe('[sidebar · join failed] acp-bg:3: boom');

    expect(formatDashboardSidebarSelectedSession('agent-1')).toEqual({
      tone: 'muted',
      message: '[sidebar] selected agent-1 (focus hop TBD).',
    });
  });

  test('decides when ACP background selection should promote to a virtual window', () => {
    expect(resolveDashboardSidebarPromoteToVw(undefined, ['completed', 'failed'])).toBe(false);
    expect(resolveDashboardSidebarPromoteToVw(null, ['completed', 'failed'])).toBe(false);
    expect(resolveDashboardSidebarPromoteToVw('running', ['completed', 'failed'])).toBe(true);
    expect(resolveDashboardSidebarPromoteToVw('completed', ['completed', 'failed'])).toBe(false);
  });
});
