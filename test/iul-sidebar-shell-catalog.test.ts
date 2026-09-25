import { describe, expect, test } from 'bun:test';
import {
  buildIulSidebarItems,
  IUL_SIDEBAR_LANES,
  IUL_SIDEBAR_TAB_IDS,
} from '../src/iul/sidebar-shell-catalog.js';
import type { KeyEvent } from '../src/plugins/core/types.js';

function key(name: string): KeyEvent {
  return { name, ctrl: false, shift: false, alt: false };
}

describe('IUL sidebar shell catalog', () => {
  test('exports stable lane ids and materialized items', () => {
    expect(IUL_SIDEBAR_TAB_IDS).toEqual([
      'test-lab',
      'yaml-editor',
    ]);
    expect(IUL_SIDEBAR_LANES.map((lane) => lane.id)).toEqual(IUL_SIDEBAR_TAB_IDS);
    const items = buildIulSidebarItems();
    expect(items.map((item) => item.id)).toEqual([...IUL_SIDEBAR_TAB_IDS]);
    expect(items[0]?.label).toBe('Test Lab');
    expect(items[0]?.badgeTone).toBe('active');
    expect(items[1]?.label).toBe('YAML Editor');
  });

  test('test lab item materializes with optional theme preview control', () => {
    const items = buildIulSidebarItems({
      themePreviewControl: {
        getActiveThemeName: () => 'catppuccin-mocha',
        previewTheme: () => {},
        revertPreview: () => {},
        commitTheme: () => {},
      },
    });
    const testLab = items.find((item) => item.id === 'test-lab');
    expect(testLab?.presentation).toBeUndefined();
    const view = testLab?.content;
    if (!view || typeof view === 'function') throw new Error('expected materialized theme-lab view');
    expect(view.onEvent(key('enter')).kind).toBe('consumed');
  });
});
