import { describe, expect, test } from 'bun:test';

import { createPaneModalChord } from '../src/dashboard/modals/pane.js';
import { routePaneModalChordKey } from '../src/dashboard/modals/pane-key-router.js';
import type { Key } from '../src/tui.js';
import type { PaneVisibility } from '../src/views/pane-policy.js';

function key(overrides: Partial<Key>): Key {
  return { name: '', ctrl: false, shift: false, ...overrides };
}

function visibility(modalDeferred: PaneVisibility['modalDeferred']): PaneVisibility {
  return {
    view: 1,
    compactLevel: 'tabletMini',
    primary: 'browser',
    visible: ['browser'],
    omitted: [],
    modalDeferred,
  };
}

describe('routePaneModalChordKey', () => {
  test('passes through when no panes are deferred and chord is idle', () => {
    const chord = createPaneModalChord();
    const result = routePaneModalChordKey(key({ name: 'a' }), {
      chord,
      visibility: () => visibility([]),
      openPane: () => {},
    });
    expect(result).toBe('passthrough');
  });

  test('arms and dispatches pane modal chord', () => {
    const chord = createPaneModalChord();
    const opened: string[] = [];
    const deps = {
      chord,
      visibility: () => visibility(['preview', 'log']),
      openPane: (pane: 'preview' | 'log') => { opened.push(pane); },
    };

    expect(routePaneModalChordKey(key({ name: 'm', ctrl: true }), deps)).toBe('consumed');
    expect(chord.state.armed).toBe(true);
    expect(routePaneModalChordKey(key({ name: 'p' }), deps)).toBe('consumed');
    expect(opened).toEqual(['preview']);
    expect(chord.state.armed).toBe(false);
  });

  test('continues routing while armed even if deferred list becomes empty', () => {
    const chord = createPaneModalChord();
    routePaneModalChordKey(key({ name: 'm', ctrl: true }), {
      chord,
      visibility: () => visibility(['preview']),
      openPane: () => {},
    });

    expect(routePaneModalChordKey(key({ name: 'p' }), {
      chord,
      visibility: () => visibility([]),
      openPane: () => {},
    })).toBe('consumed');
  });
});
