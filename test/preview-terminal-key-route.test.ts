import { describe, expect, test } from 'bun:test';

import {
  handlePreviewTerminalKey,
  matchPreviewTerminalKeyAction,
} from '../src/dashboard/input/preview-terminal-key-route.js';
import type { Key } from '../src/tui.js';

function key(name: string, mods: Partial<Key> = {}): Key {
  return { name, ctrl: false, shift: false, ...mods };
}

describe('matchPreviewTerminalKeyAction', () => {
  test('matches preview terminal control keys', () => {
    expect(matchPreviewTerminalKeyAction(key('q', { ctrl: true }))).toEqual({ kind: 'quit-app' });
    expect(matchPreviewTerminalKeyAction(key('g', { ctrl: true }))).toEqual({ kind: 'close-and-focus-log' });
    expect(matchPreviewTerminalKeyAction(key('e', { ctrl: true, shift: true }))).toEqual({ kind: 'toggle-expand' });
    expect(matchPreviewTerminalKeyAction(key('pageup', { shift: true }))).toEqual({ kind: 'scroll-page-up' });
  });

  // Ctrl+Shift+T is intentionally NOT bound — the inline preview
  // terminal forwards it to the child PTY so shell-level Ctrl+T
  // helpers (fzf-style file finders) keep working when shift is
  // accidentally held. close + focus is reachable via Ctrl+G.
  test('Ctrl+Shift+T does NOT match (forwarded to child)', () => {
    expect(matchPreviewTerminalKeyAction(key('t', { ctrl: true, shift: true }))).toBeNull();
    expect(matchPreviewTerminalKeyAction(key('T', { ctrl: true, shift: true }))).toBeNull();
    expect(matchPreviewTerminalKeyAction(key('ㅅ', { ctrl: true, shift: true }))).toBeNull();
    expect(matchPreviewTerminalKeyAction(key('ㅆ', { ctrl: true }))).toBeNull();
  });

  // Regression: Korean shifted ㄸ for Ctrl+Shift+E (toggle-expand)
  // still works — the codepoint encodes shift on the 2-bul layout.
  test('matches Korean shifted ㄸ for toggle-expand (regression)', () => {
    expect(matchPreviewTerminalKeyAction(key('ㄸ', { ctrl: true, shift: true }))).toEqual({ kind: 'toggle-expand' });
    expect(matchPreviewTerminalKeyAction(key('ㄸ', { ctrl: true }))).toEqual({ kind: 'toggle-expand' });
  });
});

describe('handlePreviewTerminalKey', () => {
  test('closes and quits on ctrl+q', () => {
    const calls: string[] = [];
    const term = {
      rows: 30,
      isScrolledBack: false,
      scrollUp: () => { calls.push('scroll-up'); },
      scrollDown: () => { calls.push('scroll-down'); },
      scrollToTop: () => { calls.push('scroll-top'); },
      scrollToTail: () => { calls.push('scroll-tail'); },
      write: (raw: string) => { calls.push(`write:${raw}`); },
    } as never;

    const result = handlePreviewTerminalKey(key('q', { ctrl: true }), {
      term,
      closeTerminalForQuit: () => { calls.push('close-quit'); },
      closeTerminalAndFocusLog: () => { calls.push('close-log'); },
      toggleExpand: () => { calls.push('expand'); },
      redraw: () => { calls.push('draw'); },
      quitApp: () => { calls.push('quit'); },
    });

    expect(result).toEqual({ type: 'quit' });
    expect(calls).toEqual(['close-quit', 'quit']);
  });

  test('scrolls with redraw and snaps to tail before writing', () => {
    const calls: string[] = [];
    const term = {
      rows: 30,
      isScrolledBack: true,
      scrollUp: (n: number) => { calls.push(`scroll-up:${n}`); },
      scrollDown: (n: number) => { calls.push(`scroll-down:${n}`); },
      scrollToTop: () => { calls.push('scroll-top'); },
      scrollToTail: () => { calls.push('scroll-tail'); },
      write: (raw: string) => { calls.push(`write:${raw}`); },
    } as never;

    handlePreviewTerminalKey(key('pageup', { shift: true }), {
      term,
      closeTerminalForQuit: () => { calls.push('close-quit'); },
      closeTerminalAndFocusLog: () => { calls.push('close-log'); },
      toggleExpand: () => { calls.push('expand'); },
      redraw: () => { calls.push('draw'); },
      quitApp: () => { calls.push('quit'); },
    });
    handlePreviewTerminalKey(key('x', { raw: 'x' }), {
      term,
      closeTerminalForQuit: () => { calls.push('close-quit'); },
      closeTerminalAndFocusLog: () => { calls.push('close-log'); },
      toggleExpand: () => { calls.push('expand'); },
      redraw: () => { calls.push('draw'); },
      quitApp: () => { calls.push('quit'); },
    });

    expect(calls).toEqual(['scroll-up:29', 'draw', 'scroll-tail', 'write:x']);
  });
});
