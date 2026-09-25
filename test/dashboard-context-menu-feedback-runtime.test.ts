import { describe, expect, test } from 'bun:test';

import { createDashboardContextMenuFeedbackRuntime } from '../src/dashboard/context-menu-feedback-runtime.js';

describe('createDashboardContextMenuFeedbackRuntime', () => {
  test('formats companion and restore messages with scroll+draw', () => {
    const calls: string[] = [];
    const runtime = createDashboardContextMenuFeedbackRuntime({
      pushMutedLine: (line) => { calls.push(`muted:${line}`); },
      setChatScrollBottom: () => { calls.push('scroll'); },
      draw: () => { calls.push('draw'); },
    });

    runtime.onVwCompanionToggled(3, 'clipboard', true);
    runtime.onDashboardCompanionToggled('memo', false);
    runtime.onStarterPanesRestored();

    expect(calls).toEqual([
      'muted:  VW clipboard companion opened · win:3',
      'scroll',
      'draw',
      'muted:  closed memo companion',
      'scroll',
      'draw',
      'muted:  restored closed starter panes for the current view',
      'scroll',
      'draw',
    ]);
  });
});
