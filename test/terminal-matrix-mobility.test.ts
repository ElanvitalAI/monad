import { describe, expect, test } from 'bun:test';
import {
  resolveTerminalMoveDestination,
  resolveVwTerminalInstanceForPane,
} from '../src/terminal-matrix/mobility.js';
import type { TerminalInstance } from '../src/terminal-matrix/types.js';

function makeInstance(overrides: Partial<TerminalInstance>): TerminalInstance {
  return {
    id: 'term:1',
    title: 'terminal',
    character: { kind: 'shell' },
    transport: { kind: 'local' },
    pty: {} as any,
    placement: { kind: 'background' },
    readOnly: false,
    visibility: 'both',
    broadcastGroups: new Set<string>(),
    createdAt: 0,
    lastActivityAt: 0,
    exitCode: null,
    attentionLevel: 0,
    metadata: {},
    ...overrides,
  };
}

describe('resolveVwTerminalInstanceForPane', () => {
  test('resolves a pane through vw slot bindings', () => {
    const instance = makeInstance({
      id: 'term:7',
      placement: { kind: 'vw', windowId: '12', slotId: 'slot-a' },
    });
    const resolved = resolveVwTerminalInstanceForPane(
      [instance],
      new Map([['12/slot-a', 'pane-42']]),
      '12',
      'pane-42',
    );
    expect(resolved?.id).toBe('term:7');
  });

  test('falls back to slot id when no binding exists', () => {
    const instance = makeInstance({
      id: 'term:8',
      placement: { kind: 'vw', windowId: '5', slotId: 'pane-direct' },
    });
    const resolved = resolveVwTerminalInstanceForPane([instance], new Map(), '5', 'pane-direct');
    expect(resolved?.id).toBe('term:8');
  });
});

describe('resolveTerminalMoveDestination', () => {
  test('resolves current-window vw moves', () => {
    const dest = resolveTerminalMoveDestination('vw', {
      currentVwWindowId: '9',
      vwSlotId: 'term-slot:term:1',
      modalId: 'term:1',
    });
    expect(dest).toEqual({ kind: 'vw', windowId: '9', slotId: 'term-slot:term:1' });
  });

  test('returns null for vw moves without a foreground window', () => {
    const dest = resolveTerminalMoveDestination('vw', {
      currentVwWindowId: null,
      vwSlotId: null,
      modalId: 'term:1',
    });
    expect(dest).toBeNull();
  });
});
