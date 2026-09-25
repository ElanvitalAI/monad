import { describe, expect, test } from 'bun:test';
import {
  buildDashboardDockWindowTargets,
  buildDashboardVirtualWindowEntries,
} from '../src/dashboard/dock-picker-inventory.js';

describe('buildDashboardDockWindowTargets', () => {
  test('formats popup descriptions for pane targets', () => {
    expect(buildDashboardDockWindowTargets([
      { pane: 'browser', label: 'Browser' },
      { pane: 'preview', label: 'Preview' },
    ])).toEqual([
      {
        id: 'browser',
        label: 'Browser',
        description: 'Open Browser in a popup window',
      },
      {
        id: 'preview',
        label: 'Preview',
        description: 'Open Preview in a popup window',
      },
    ]);
  });
});

describe('buildDashboardVirtualWindowEntries', () => {
  test('sorts windows by id and marks the current entry active', () => {
    expect(buildDashboardVirtualWindowEntries([
      { id: 9, title: 'Nine' },
      { id: 2, title: 'Two' },
      { id: 5, title: 'Five' },
    ], 5)).toEqual([
      { id: 2, label: 'Two', active: false },
      { id: 5, label: 'Five', active: true },
      { id: 9, label: 'Nine', active: false },
    ]);
  });
});
