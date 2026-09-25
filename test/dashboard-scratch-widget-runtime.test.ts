// Surface-unification v2.2 V2.2-5 Part 2 (2026-05-11) — `projectScheduler`
// method retired together with the dashboard scheduler view. Only the
// preview branch remains.

import { describe, expect, test } from 'bun:test';

import { createDashboardScratchWidgetRuntime } from '../src/dashboard/scratch-widget-runtime.js';

describe('createDashboardScratchWidgetRuntime', () => {
  test('projects preview scratch widget', () => {
    const runtime = createDashboardScratchWidgetRuntime();

    const previewWidget = { state: {} as Record<string, unknown>, character: '' };
    runtime.projectPreview(
      previewWidget,
      false,
      3,
      'Note',
      ['x'],
      { source: 'dashboard', mode: 'preview', title: 'Pinned', lines: ['y'], updatedAt: 1 },
    );
    expect(previewWidget.state.mode).toBe('preview');
    expect(previewWidget.state.previewLines).toEqual(['y']);
    expect(previewWidget.state.scroll).toBe(3);
    expect(previewWidget.state.focused).toBe(false);
    expect(previewWidget.character).toBe('Scratch · Pinned');
  });
});
