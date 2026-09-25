import { describe, expect, test } from 'bun:test';

import { resolveTextInputEditAction } from '../src/chat/input-edit-key.js';

describe('chat input edit-key resolver', () => {
  test('maps backspace and horizontal movement keys', () => {
    const state = {
      linesLength: 2,
      lineIdx: 1,
      historyLength: 3,
      historyIdx: -1,
    } as const;

    expect(resolveTextInputEditAction({ name: 'backspace', ctrl: false }, state)).toEqual({ kind: 'backspace' });
    expect(resolveTextInputEditAction({ name: 'left', ctrl: false }, state)).toEqual({ kind: 'move-left' });
    expect(resolveTextInputEditAction({ name: 'right', ctrl: false }, state)).toEqual({ kind: 'move-right' });
  });

  test('routes vertical arrows between history and multiline movement', () => {
    expect(resolveTextInputEditAction({
      name: 'up',
      ctrl: false,
    }, {
      linesLength: 1,
      lineIdx: 0,
      historyLength: 3,
      historyIdx: 0,
    })).toEqual({ kind: 'history-older' });

    expect(resolveTextInputEditAction({
      name: 'up',
      ctrl: false,
    }, {
      linesLength: 3,
      lineIdx: 1,
      historyLength: 0,
      historyIdx: -1,
    })).toEqual({ kind: 'move-vertical', delta: -1 });

    expect(resolveTextInputEditAction({
      name: 'down',
      ctrl: false,
    }, {
      linesLength: 1,
      lineIdx: 0,
      historyLength: 3,
      historyIdx: 1,
    })).toEqual({ kind: 'history-newer' });

    expect(resolveTextInputEditAction({
      name: 'down',
      ctrl: false,
    }, {
      linesLength: 3,
      lineIdx: 1,
      historyLength: 0,
      historyIdx: -1,
    })).toEqual({ kind: 'move-vertical', delta: 1 });
  });

  test('maps home/end and kill-line control shortcuts', () => {
    const state = {
      linesLength: 1,
      lineIdx: 0,
      historyLength: 0,
      historyIdx: -1,
    } as const;

    expect(resolveTextInputEditAction({ name: 'home', ctrl: false }, state)).toEqual({ kind: 'move-home' });
    expect(resolveTextInputEditAction({ name: 'a', ctrl: true }, state)).toEqual({ kind: 'move-home' });
    expect(resolveTextInputEditAction({ name: 'end', ctrl: false }, state)).toEqual({ kind: 'move-end' });
    expect(resolveTextInputEditAction({ name: 'e', ctrl: true }, state)).toEqual({ kind: 'move-end' });
    expect(resolveTextInputEditAction({ name: 'u', ctrl: true }, state)).toEqual({ kind: 'kill-before-cursor' });
    expect(resolveTextInputEditAction({ name: 'k', ctrl: true }, state)).toEqual({ kind: 'kill-after-cursor' });
  });

  test('returns none when movement cannot progress or key is unrelated', () => {
    expect(resolveTextInputEditAction({
      name: 'up',
      ctrl: false,
    }, {
      linesLength: 1,
      lineIdx: 0,
      historyLength: 0,
      historyIdx: -1,
    })).toEqual({ kind: 'none' });

    expect(resolveTextInputEditAction({
      name: 'z',
      ctrl: false,
    }, {
      linesLength: 2,
      lineIdx: 0,
      historyLength: 1,
      historyIdx: -1,
    })).toEqual({ kind: 'none' });
  });
});
