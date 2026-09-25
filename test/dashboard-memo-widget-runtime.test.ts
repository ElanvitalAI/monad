import { describe, expect, test } from 'bun:test';

import { createDashboardMemoWidgetRuntime } from '../src/dashboard/memo-widget-runtime.js';

describe('createDashboardMemoWidgetRuntime', () => {
  test('seeds and reads memo widget state', () => {
    const runtime = createDashboardMemoWidgetRuntime();
    const widget = { state: {} as Record<string, unknown> };

    runtime.seed(widget, ['alpha', 'beta']);
    expect(widget.state.mode).toBe('memo');
    expect(widget.state.memoLines).toEqual(['alpha', 'beta']);
    expect(widget.state.memoLineIdx).toBe(0);
    expect(widget.state.memoColIdx).toBe(0);
    expect(widget.state.memoDirty).toBe(false);
    expect(widget.state.memoShowHelp).toBe(true);
    expect(widget.state.memoCursorStyle).toBe('inverse');

    expect(runtime.readLines(widget)).toEqual(['alpha', 'beta']);
    expect(runtime.readLines({ state: { memoLines: [1, 2] } as unknown as Record<string, unknown> })).toEqual(['']);
  });
});
