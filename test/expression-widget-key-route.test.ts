import { describe, expect, test } from 'bun:test';
import {
  routeInteractiveModalKey,
  type ModalKey,
} from '../src/expression/widget/index.js';

const k = (name: string, mods: Partial<ModalKey> = {}): ModalKey => ({
  name,
  ...mods,
});

describe('expression/widget/key-route · routing decisions', () => {
  test('Esc cancels regardless of state', () => {
    expect(routeInteractiveModalKey('show', k('escape')).kind).toBe('cancel');
    expect(routeInteractiveModalKey('awaiting', k('escape')).kind).toBe('cancel');
    expect(routeInteractiveModalKey('chained', k('escape')).kind).toBe('cancel');
  });

  test('Ctrl-C cancels', () => {
    expect(
      routeInteractiveModalKey('awaiting', k('c', { ctrl: true })).kind,
    ).toBe('cancel');
  });

  test('Enter submits in awaiting / show / answered / chained', () => {
    for (const state of ['show', 'awaiting', 'answered', 'chained'] as const) {
      expect(routeInteractiveModalKey(state, k('enter')).kind).toBe('submit');
    }
  });

  test('Tab navigates next; Shift-Tab navigates prev', () => {
    const fwd = routeInteractiveModalKey('awaiting', k('tab'));
    expect(fwd).toEqual({ kind: 'navigate', direction: 'next' });
    const back = routeInteractiveModalKey('awaiting', k('tab', { shift: true }));
    expect(back).toEqual({ kind: 'navigate', direction: 'prev' });
  });

  test('Up / Down arrows navigate', () => {
    expect(routeInteractiveModalKey('awaiting', k('up'))).toEqual({
      kind: 'navigate',
      direction: 'prev',
    });
    expect(routeInteractiveModalKey('awaiting', k('down'))).toEqual({
      kind: 'navigate',
      direction: 'next',
    });
  });

  test('printable chars become edit actions', () => {
    expect(routeInteractiveModalKey('awaiting', k('a'))).toEqual({
      kind: 'edit',
      char: 'a',
    });
    expect(routeInteractiveModalKey('awaiting', k('Z'))).toEqual({
      kind: 'edit',
      char: 'Z',
    });
  });

  test('backspace produces erase action', () => {
    expect(routeInteractiveModalKey('awaiting', k('backspace')).kind).toBe('erase');
  });

  test('Ctrl + printable does not become edit', () => {
    const action = routeInteractiveModalKey('awaiting', k('a', { ctrl: true }));
    expect(action.kind).toBe('passthrough');
  });

  test('terminal states passthrough non-cancel keys', () => {
    expect(routeInteractiveModalKey('done', k('enter')).kind).toBe('passthrough');
    expect(routeInteractiveModalKey('cancel', k('a')).kind).toBe('passthrough');
  });
});
