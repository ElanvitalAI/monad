// PR-2 — placeholder consumer behavior + capability gate (G6).

import { describe, expect, test } from 'bun:test';

import {
  createCaretFocusConsumer,
  createContextMenuConsumer,
  createDefaultConsumers,
  createViewportScrollConsumer,
  createWordSelectConsumer,
} from '../../../src/dashboard/terminal-intent-consumers/index.js';
import type { SerializableSurfaceIntent } from '../../../src/dashboard/terminal-surface-intent.js';
import type {
  TerminalSurfaceCapability,
} from '../../../src/terminal/posture.js';

const FULL_CAP: TerminalSurfaceCapability = {
  canRead: true,
  canInterrupt: true,
  canWrite: true,
  canInspect: true,
};

function intent(
  kind: SerializableSurfaceIntent['kind'],
  capability: Partial<TerminalSurfaceCapability> = {},
): SerializableSurfaceIntent {
  return {
    kind,
    surfaceId: 'pane:1',
    paneKind: 'terminal',
    row: 1,
    col: 2,
    exposure: { userExposure: 'user-interactive', agentInteractive: true },
    capability: { ...FULL_CAP, ...capability },
  };
}

describe('caret-focus consumer (PR-2)', () => {
  test('handles caret-focus intent when canRead', () => {
    const calls: SerializableSurfaceIntent[] = [];
    const c = createCaretFocusConsumer({ onCaretFocus: (i) => calls.push(i) });
    expect(c.handle(intent('caret-focus'))).toEqual({ handled: true });
    expect(calls.length).toBe(1);
  });

  test('passes (handled=false) on unrelated kind', () => {
    const c = createCaretFocusConsumer();
    expect(c.handle(intent('word-select'))).toEqual({ handled: false });
  });

  test('rejects with no-canRead reason when capability gate fails (G6)', () => {
    const c = createCaretFocusConsumer();
    const r = c.handle(intent('caret-focus', { canRead: false }));
    expect(r.handled).toBe(false);
    expect(r.reason).toBe('no-canRead');
  });
});

describe('word-select consumer (PR-2 / G4)', () => {
  test('handles word-select when canInspect', () => {
    const calls: SerializableSurfaceIntent[] = [];
    const c = createWordSelectConsumer({ onWordSelect: (i) => calls.push(i) });
    expect(c.handle(intent('word-select'))).toEqual({ handled: true });
    expect(calls.length).toBe(1);
  });

  test('rejects with no-canInspect when gate fails', () => {
    const c = createWordSelectConsumer();
    const r = c.handle(intent('word-select', { canInspect: false }));
    expect(r.handled).toBe(false);
    expect(r.reason).toBe('no-canInspect');
  });

  test('does not subsume caret-focus intent (G6 — capability is gate, not intent)', () => {
    // word-select consumer must NOT claim caret-focus even though both
    // would be allowed by the same capability vector.
    const c = createWordSelectConsumer();
    expect(c.handle(intent('caret-focus'))).toEqual({ handled: false });
  });
});

describe('viewport-scroll consumer (PR-2)', () => {
  test('handles viewport-scroll when canRead', () => {
    const c = createViewportScrollConsumer({ onViewportScroll: () => {} });
    expect(c.handle(intent('viewport-scroll'))).toEqual({ handled: true });
  });

  test('rejects when canRead is false', () => {
    const c = createViewportScrollConsumer();
    const r = c.handle(intent('viewport-scroll', { canRead: false }));
    expect(r.handled).toBe(false);
    expect(r.reason).toBe('no-canRead');
  });
});

describe('context-menu consumer (PR-2)', () => {
  test('handles context-menu when canRead and canInspect', () => {
    const calls: SerializableSurfaceIntent[] = [];
    const c = createContextMenuConsumer({ onContextMenu: (i) => calls.push(i) });
    expect(c.handle(intent('context-menu'))).toEqual({ handled: true });
    expect(calls.length).toBe(1);
  });

  test('rejects when canRead is false (G6 — both required)', () => {
    const c = createContextMenuConsumer();
    expect(c.handle(intent('context-menu', { canRead: false })).handled).toBe(false);
  });

  test('rejects when canInspect is false (G6 — both required)', () => {
    const c = createContextMenuConsumer();
    expect(c.handle(intent('context-menu', { canInspect: false })).handled).toBe(false);
  });
});

describe('createDefaultConsumers (PR-2 + X1)', () => {
  test('returns canonical consumers in priority order', () => {
    const consumers = createDefaultConsumers();
    // X1 (Phase 1) added range-select between context-menu (40) and
    // word-select (50). The chain order is priority-sorted ascending.
    expect(consumers.map(c => c.id)).toEqual([
      'context-menu',
      'range-select',
      'caret-focus',
      'word-select',
      'viewport-scroll',
    ]);
    // priority sanity — context-menu fires first.
    expect(consumers[0].priority).toBeLessThan(consumers[consumers.length - 1].priority ?? 100);
  });

  test('each consumer claims its own intent kind only', () => {
    const consumers = createDefaultConsumers();
    const claimed = (kind: SerializableSurfaceIntent['kind']) =>
      consumers
        .filter(c => c.handle(intent(kind)).handled)
        .map(c => c.id);

    expect(claimed('caret-focus')).toEqual(['caret-focus']);
    expect(claimed('word-select')).toEqual(['word-select']);
    expect(claimed('context-menu')).toEqual(['context-menu']);
    expect(claimed('viewport-scroll')).toEqual(['viewport-scroll']);
    // X1 — range-select-update / range-select-end now consumed by
    // the new range-select consumer.
    expect(claimed('range-select-update')).toEqual(['range-select']);
    expect(claimed('range-select-end')).toEqual(['range-select']);
  });
});
