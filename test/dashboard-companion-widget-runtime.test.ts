import { describe, expect, test } from 'bun:test';

import { createDashboardCompanionWidgetRuntime } from '../src/dashboard/companion-widget-runtime.js';

describe('createDashboardCompanionWidgetRuntime', () => {
  test('projects clipboard, memo, and detail widgets', () => {
    const runtime = createDashboardCompanionWidgetRuntime();

    const clipboardWidget = { state: {} as Record<string, unknown>, character: '' };
    runtime.projectClipboardWidget(clipboardWidget, [{ id: 'c1', text: 'hello', ts: 1 }], 2);
    expect(clipboardWidget.state.mode).toBe('clipboard');
    expect(clipboardWidget.state.clipHistory).toEqual([{ id: 'c1', text: 'hello', ts: 1 }]);
    expect(clipboardWidget.state.clipCursor).toBe(2);
    expect(clipboardWidget.character).toBe('Clipboard · 1');

    const memoWidget = { state: {} as Record<string, unknown>, character: '' };
    runtime.projectMemoWidget(memoWidget);
    expect(memoWidget.state.mode).toBe('memo');
    expect(memoWidget.state.memoShowHelp).toBe(true);
    expect(memoWidget.character).toBe('Memo · Ctrl+S save / Esc cancel');

    const detailWidget = { state: {} as Record<string, unknown>, character: '' };
    runtime.projectDetailWidget(detailWidget, { title: 'Trace', lines: ['a'] });
    expect(detailWidget.state.mode).toBe('preview');
    expect(detailWidget.state.previewLines).toEqual(['a']);
    expect(detailWidget.character).toBe('Detail · Trace');
  });
});
