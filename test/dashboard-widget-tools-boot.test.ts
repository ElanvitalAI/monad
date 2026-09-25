import { describe, expect, test } from 'bun:test';

import { bootDashboardWidgetTools } from '../src/dashboard/widget-tools-boot.js';

describe('bootDashboardWidgetTools', () => {
  test('wires widget listing, toggleFocus, and pane focus delegation', () => {
    let installed:
      | {
        list: () => Array<{ id: string; type: string; focused: boolean }>;
        toggleFocus: (id: string) => boolean | null;
        focusPane: (name: string) => boolean;
        listPanes: () => string[];
      }
      | undefined;
    const widgets = new Map<string, { type: string; state: { focused?: boolean } }>([
      ['a', { type: 'editor', state: { focused: false } }],
      ['b', { type: 'viewer', state: { focused: true } }],
    ]);
    const events: string[] = [];

    bootDashboardWidgetTools({
      initDashboardWidgetTools: (deps) => { installed = deps; },
      listWidgetInstanceIds: () => ['a', 'b'],
      getWidget: (id) => widgets.get(id),
      validPanes: ['browser', 'preview'] as const,
      onFocusPane: (name) => {
        events.push(`focus:${name}`);
        return true;
      },
      afterToggleFocus: () => { events.push('draw'); },
    });

    expect(installed?.list()).toEqual([
      { id: 'a', type: 'editor', focused: false },
      { id: 'b', type: 'viewer', focused: true },
    ]);
    expect(installed?.toggleFocus('a')).toBe(true);
    expect(widgets.get('a')?.state.focused).toBe(true);
    expect(installed?.toggleFocus('missing')).toBeNull();
    expect(installed?.focusPane('browser')).toBe(true);
    expect(installed?.focusPane('log')).toBe(false);
    expect(installed?.listPanes()).toEqual(['browser', 'preview']);
    expect(events).toEqual(['draw', 'focus:browser']);
  });
});
