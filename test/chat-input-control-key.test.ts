import { describe, expect, test } from 'bun:test';

import { resolveTextInputControlAction } from '../src/chat/input-control-key.js';

describe('chat input control-key resolver', () => {
  test('treats shift+enter, ctrl+j, and trailing-backslash enter as newline', () => {
    expect(resolveTextInputControlAction({
      name: 'enter',
      shift: true,
      ctrl: false,
    }, {
      currentLine: 'draft',
      cursor: 5,
    })).toEqual({
      kind: 'newline',
      stripTrailingBackslash: false,
    });

    expect(resolveTextInputControlAction({
      name: 'j',
      shift: false,
      ctrl: true,
    }, {
      currentLine: 'draft',
      cursor: 5,
    })).toEqual({
      kind: 'newline',
      stripTrailingBackslash: false,
    });

    expect(resolveTextInputControlAction({
      name: 'enter',
      shift: false,
      ctrl: false,
    }, {
      currentLine: 'draft\\',
      cursor: 6,
    })).toEqual({
      kind: 'newline',
      stripTrailingBackslash: true,
    });
  });

  test('resolves submit and cancel', () => {
    expect(resolveTextInputControlAction({
      name: 'enter',
      shift: false,
      ctrl: false,
    }, {
      currentLine: 'draft',
      cursor: 5,
    })).toEqual({ kind: 'submit' });

    expect(resolveTextInputControlAction({
      name: 'escape',
      shift: false,
      ctrl: false,
    }, {
      currentLine: 'draft',
      cursor: 5,
    })).toEqual({ kind: 'cancel' });
  });

  test('accepts goto-pane and save aliases under Korean IME', () => {
    expect(resolveTextInputControlAction({
      name: 't',
      shift: false,
      ctrl: true,
    }, {
      currentLine: '',
      cursor: 0,
    })).toEqual({ kind: 'goto-pane' });

    expect(resolveTextInputControlAction({
      name: 'ㅡ',
      shift: false,
      ctrl: true,
    }, {
      currentLine: '',
      cursor: 0,
    })).toEqual({ kind: 'goto-pane' });

    expect(resolveTextInputControlAction({
      name: 'ㄴ',
      shift: false,
      ctrl: true,
    }, {
      currentLine: '',
      cursor: 0,
    })).toEqual({ kind: 'save' });
  });

  test('resolves view-switch and chord-prefix actions', () => {
    expect(resolveTextInputControlAction({
      name: '4',
      shift: false,
      ctrl: true,
    }, {
      currentLine: '',
      cursor: 0,
    })).toEqual({ kind: 'view-switch', view: '4' });

    expect(resolveTextInputControlAction({
      name: 'ㅌ',
      shift: false,
      ctrl: true,
    }, {
      currentLine: '',
      cursor: 0,
    })).toEqual({ kind: 'arm-chord' });
  });

  test('returns none for regular typing keys', () => {
    expect(resolveTextInputControlAction({
      name: 'a',
      shift: false,
      ctrl: false,
    }, {
      currentLine: 'draft',
      cursor: 5,
    })).toEqual({ kind: 'none' });
  });
});
