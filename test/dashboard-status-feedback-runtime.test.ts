import { describe, expect, test } from 'bun:test';

import { createDashboardStatusFeedbackRuntime } from '../src/dashboard/status-feedback-runtime.js';

describe('createDashboardStatusFeedbackRuntime', () => {
  test('formats clipboard and widget-host status lines', () => {
    const lines: string[] = [];
    const runtime = createDashboardStatusFeedbackRuntime({
      muted: (text) => `muted:${text}`,
      success: (text) => `success:${text}`,
      error: (text) => `error:${text}`,
      pushChatLine: (line) => { lines.push(line); },
      setChatScrollBottom: () => { lines.push('scroll'); },
    });

    runtime.onClipboardHistoryCleared();
    runtime.onClipboardCompanionPopupToggled(true);
    runtime.onWidgetHostReloadStarted();
    runtime.onWidgetHostReloadCompleted();
    runtime.onWidgetHostReloadFailed('boom');

    expect(lines).toEqual([
      'muted:  clipboard history cleared',
      'scroll',
      'muted:  clipboard companion popup opened',
      'scroll',
      'muted:  widget-host: rescanning…',
      'scroll',
      'success:  widget-host: reload complete',
      'scroll',
      'error:  widget-host reload failed: boom',
      'scroll',
    ]);
  });
});
