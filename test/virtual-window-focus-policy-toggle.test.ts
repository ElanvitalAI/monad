// SP-D — pane focusPolicy toggle composition.
//
// Doesn't spin up the full dashboard chord binding (that needs
// DisplayCoordinator wiring). Instead validates the pieces the
// binding handler composes:
//   1. VirtualWindow.getFocusedPane() returns the pane the chord
//      will mutate.
//   2. A pane that advertises focusPolicy+setFocusPolicy can round-
//      trip the two allowed values.
//   3. hasInteractableFocus() flips to match after setFocusPolicy.

import { describe, expect, test } from 'bun:test';

import { WindowRegistry } from '../src/virtual-windows/window-registry.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';

function setup() {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  const book = createAddressBook();
  const reg = new WindowRegistry({
    addressBook: book,
    coordinator: coord,
    defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }),
  });
  return { reg };
}

type Togglable = {
  focusPolicy?: 'output-only' | 'interactive';
  setFocusPolicy?: (p: 'output-only' | 'interactive') => unknown;
};

describe('SP-D — pane focusPolicy toggle building blocks', () => {
  test('getFocusedPane returns the initial root pane', () => {
    const { reg } = setup();
    const w = reg.spawn({ title: 'runner', initialContent: { kind: 'markdown', text: '' } });
    const pane = w.getFocusedPane();
    expect(pane).not.toBeNull();
    expect(pane!.id).toBe(w.focused);
  });

  test('attach focusPolicy + setter → toggle flips both the probe and hasInteractableFocus', () => {
    const { reg } = setup();
    const w = reg.spawn({ title: 'runner', initialContent: { kind: 'markdown', text: '' } });
    const pane = w.getFocusedPane()! as ReturnType<typeof w.getFocusedPane> & Togglable;
    // Simulate the external-terminal contract: focusPolicy getter
    // closes over a mutable local, setFocusPolicy mutates it.
    let policy: 'output-only' | 'interactive' = 'output-only';
    Object.defineProperty(pane, 'focusPolicy', { get: () => policy, configurable: true });
    pane.setFocusPolicy = (next) => { const prev = policy; policy = next; return prev; };

    expect(w.hasInteractableFocus()).toBe(false);
    // Toggle once: output-only → interactive
    const handler = () => {
      const t = pane as Togglable;
      if (!t.focusPolicy || !t.setFocusPolicy) return;
      const next = t.focusPolicy === 'output-only' ? 'interactive' : 'output-only';
      t.setFocusPolicy(next);
    };
    handler();
    expect((pane as Togglable).focusPolicy).toBe('interactive');
    expect(w.hasInteractableFocus()).toBe(true);
    handler();
    expect((pane as Togglable).focusPolicy).toBe('output-only');
    expect(w.hasInteractableFocus()).toBe(false);
  });

  test('plain pane (no focusPolicy) is a silent no-op under the toggle', () => {
    const { reg } = setup();
    const w = reg.spawn({ title: 'chat', initialContent: { kind: 'markdown', text: '' } });
    const pane = w.getFocusedPane()!;
    const before = w.hasInteractableFocus();
    const handler = () => {
      const t = pane as Togglable;
      if (!t.focusPolicy || !t.setFocusPolicy) return;
      const next = t.focusPolicy === 'output-only' ? 'interactive' : 'output-only';
      t.setFocusPolicy(next);
    };
    handler();
    // Built-in interactive pane has no setter, so the toggle is a no-op.
    expect(w.hasInteractableFocus()).toBe(before);
  });
});
