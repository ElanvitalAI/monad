import { describe, expect, test } from 'bun:test';

import { createDashboardPreviewWidgetRuntime } from '../src/dashboard/preview-widget-runtime.js';

describe('createDashboardPreviewWidgetRuntime', () => {
  test('projects terminal preview widget state', () => {
    const runtime = createDashboardPreviewWidgetRuntime();
    const widget = { state: {} as Record<string, unknown>, character: '' };

    runtime.projectTerminal(widget, {
      text: 'hello',
      focused: true,
      title: 'Terminal · pid 1 · 80×24',
    });

    expect(widget.state.text).toBe('hello');
    expect(widget.state.scroll).toBe(0);
    expect(widget.state.focused).toBe(true);
    expect(widget.state.preformatted).toBe(true);
    expect(widget.character).toBe('Terminal · pid 1 · 80×24');
  });

  test('projects vi preview widget state', () => {
    const runtime = createDashboardPreviewWidgetRuntime();
    const widget = { state: {} as Record<string, unknown>, character: '' };

    runtime.projectVi(widget, {
      text: 'vi rows',
      focused: false,
      title: 'vi NOR · note.txt',
    });

    expect(widget.state.text).toBe('vi rows');
    expect(widget.state.scroll).toBe(0);
    expect(widget.state.focused).toBe(false);
    expect(widget.state.preformatted).toBe(true);
    expect(widget.character).toBe('vi NOR · note.txt');
  });

  test('projects plain preview widget state', () => {
    const runtime = createDashboardPreviewWidgetRuntime();
    const widget = { state: {} as Record<string, unknown>, character: '' };

    runtime.projectPlain(widget, {
      text: 'plain',
      scroll: 3,
      focused: true,
      title: 'Preview · Smart',
    });

    expect(widget.state.text).toBe('plain');
    expect(widget.state.scroll).toBe(3);
    expect(widget.state.focused).toBe(true);
    expect(widget.state.preformatted).toBe(true);
    expect(widget.character).toBe('Preview · Smart');
  });
});
