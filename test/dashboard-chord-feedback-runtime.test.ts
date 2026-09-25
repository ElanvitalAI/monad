import { describe, expect, test } from 'bun:test';

import { createDashboardChordFeedbackRuntime } from '../src/dashboard/chord-feedback-runtime.js';

describe('createDashboardChordFeedbackRuntime', () => {
  test('formats muted feedback lines and scrolls to bottom', () => {
    const lines: string[] = [];
    const runtime = createDashboardChordFeedbackRuntime({
      pushMutedLine: (line) => { lines.push(`muted:${line}`); },
      setChatScrollBottom: () => { lines.push('scroll'); },
    });

    runtime.onPaneClosed('Browser');
    runtime.onPanesReopened();
    runtime.onPreviewTerminalExpandChanged(true);
    runtime.onMissingPreviewTerminal();

    expect(lines).toEqual([
      'muted:Browser pane closed. ^B o restores panes; ^B m opens focused pane as a modal.',
      'scroll',
      'muted:All dashboard panes reopened.',
      'scroll',
      'muted:Terminal expanded. ^B e to restore.',
      'scroll',
      'muted:No terminal running — ^B t to start one first.',
      'scroll',
    ]);
  });
});
