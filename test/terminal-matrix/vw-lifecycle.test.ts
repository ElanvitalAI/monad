import { describe, expect, test } from 'bun:test';

import {
  findBindingsForPaneClose,
  findLiveVwTerminalIdsForBindings,
  findLiveVwTerminalIdsForWindow,
} from '../../src/terminal-matrix/vw-lifecycle.js';

describe('vw lifecycle helpers', () => {
  test('findBindingsForPaneClose resolves binding metadata for a pane close', () => {
    const bindings = new Map<string, string>([
      ['7/custom-slot', 'pane-1'],
      ['7/pane-2', 'pane-2'],
      ['8/other', 'pane-3'],
    ]);
    expect(findBindingsForPaneClose(bindings, 'pane-1')).toEqual([
      { bindingKey: '7/custom-slot', windowId: '7', slotId: 'custom-slot' },
    ]);
    expect(findBindingsForPaneClose(bindings, 'pane-2')).toEqual([
      { bindingKey: '7/pane-2', windowId: '7', slotId: 'pane-2' },
    ]);
  });

  test('findLiveVwTerminalIdsForBindings returns only matching live vw terminals', () => {
    const terminals = [
      { id: 'term:1', exitCode: null, placement: { kind: 'vw', windowId: '7', slotId: 'custom-slot' } },
      { id: 'term:2', exitCode: null, placement: { kind: 'vw', windowId: '7', slotId: 'other-slot' } },
      { id: 'term:3', exitCode: 0, placement: { kind: 'vw', windowId: '7', slotId: 'custom-slot' } },
      { id: 'term:4', exitCode: null, placement: { kind: 'background' } },
    ] as const;
    const bindings = [
      { bindingKey: '7/custom-slot', windowId: '7', slotId: 'custom-slot' },
    ];
    expect(findLiveVwTerminalIdsForBindings(terminals, bindings)).toEqual(['term:1']);
  });

  test('findLiveVwTerminalIdsForWindow returns every live terminal in a closing window', () => {
    const terminals = [
      { id: 'term:1', exitCode: null, placement: { kind: 'vw', windowId: '9', slotId: 'a' } },
      { id: 'term:2', exitCode: null, placement: { kind: 'vw', windowId: '9', slotId: 'b' } },
      { id: 'term:3', exitCode: 0, placement: { kind: 'vw', windowId: '9', slotId: 'c' } },
      { id: 'term:4', exitCode: null, placement: { kind: 'vw', windowId: '10', slotId: 'a' } },
      { id: 'term:5', exitCode: null, placement: { kind: 'modal', modalId: 'term:5' } },
    ] as const;
    expect(findLiveVwTerminalIdsForWindow(terminals, '9')).toEqual(['term:1', 'term:2']);
  });
});
