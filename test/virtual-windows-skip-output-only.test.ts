// SP-A — WindowRegistry.next()/previous() skip predicate.
//
// Covers two layers:
//   1. WindowRegistry cycle logic with a generic skipWhen predicate.
//   2. VirtualWindow.hasInteractableFocus() — duck-types the focused
//      pane's focusPolicy and returns false when it's 'output-only'.
//   3. End-to-end composition: skipWhen = !w.hasInteractableFocus().

import { describe, expect, test } from 'bun:test';

import { WindowRegistry } from '../src/virtual-windows/window-registry.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import type { VirtualWindow } from '../src/virtual-windows/virtual-window.js';
import type { PaneContent, PaneContentKind, PaneRenderCtx } from '../src/virtual-windows/pane-content.js';
import type { KeyEvent, Action } from '../src/display/types.js';

function make(opts?: { skipWhen?: (w: VirtualWindow) => boolean }) {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  const book = createAddressBook();
  const reg = new WindowRegistry({
    addressBook: book,
    coordinator: coord,
    defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }),
    skipWindowWhen: opts?.skipWhen,
  });
  return { reg, coord };
}

describe('SP-A — WindowRegistry cycle skip predicate', () => {
  test('next() skips windows flagged by deps.skipWindowWhen', () => {
    const { reg } = make({ skipWhen: (w) => w.title === 'runner' });
    const chat    = reg.spawn({ title: 'chat',    initialContent: { kind: 'markdown', text: '' } });
    const runner  = reg.spawn({ title: 'runner',  initialContent: { kind: 'markdown', text: '' } });
    const scratch = reg.spawn({ title: 'scratch', initialContent: { kind: 'markdown', text: '' } });
    // After spawn, scratch is foreground. next() must go chat (wrap past runner).
    expect(reg.current()?.id).toBe(scratch.id);
    reg.next();
    expect(reg.current()?.id).toBe(chat.id);
    reg.next();    // chat → scratch (runner skipped)
    expect(reg.current()?.id).toBe(scratch.id);
  });

  test('previous() skips the same way in reverse', () => {
    const { reg } = make({ skipWhen: (w) => w.title === 'runner' });
    const chat    = reg.spawn({ title: 'chat',    initialContent: { kind: 'markdown', text: '' } });
    const runner  = reg.spawn({ title: 'runner',  initialContent: { kind: 'markdown', text: '' } });
    const scratch = reg.spawn({ title: 'scratch', initialContent: { kind: 'markdown', text: '' } });
    // scratch.prev → chat (wrap past runner)
    reg.previous();
    expect(reg.current()?.id).toBe(chat.id);
    reg.previous();
    expect(reg.current()?.id).toBe(scratch.id);
  });

  test('switchTo(id) ignores the predicate (explicit selection wins)', () => {
    const { reg } = make({ skipWhen: (w) => w.title === 'runner' });
    const chat    = reg.spawn({ title: 'chat',    initialContent: { kind: 'markdown', text: '' } });
    const runner  = reg.spawn({ title: 'runner',  initialContent: { kind: 'markdown', text: '' } });
    expect(reg.switchTo(runner.id)).toBe(true);
    expect(reg.current()?.id).toBe(runner.id);
  });

  test('all windows skipped → falls back to naive next-id (no deadlock)', () => {
    const { reg } = make({ skipWhen: () => true });
    const a = reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: '' } });
    const b = reg.spawn({ title: 'b', initialContent: { kind: 'markdown', text: '' } });
    // b is foreground (last spawned). next() should fall back to a
    // because every window is flagged skip.
    reg.next();
    expect(reg.current()?.id).toBe(a.id);
  });

  test('per-call skipWhen overrides default', () => {
    const { reg } = make({ skipWhen: (w) => w.title === 'runner' });
    const chat   = reg.spawn({ title: 'chat',   initialContent: { kind: 'markdown', text: '' } });
    const runner = reg.spawn({ title: 'runner', initialContent: { kind: 'markdown', text: '' } });
    // Override with a no-op predicate — runner should now be reachable.
    reg.next({ skipWhen: () => false });
    expect(reg.current()?.id).toBe(chat.id);
    reg.next({ skipWhen: () => false });
    expect(reg.current()?.id).toBe(runner.id);
  });
});

describe('SP-A — VirtualWindow.hasInteractableFocus', () => {
  test('returns true for a markdown pane with interactive focus policy', () => {
    const { reg } = make();
    const w = reg.spawn({ title: 'md', initialContent: { kind: 'markdown', text: 'hi' } });
    expect(w.hasInteractableFocus()).toBe(true);
  });

  test('returns false when focused pane focusPolicy flips to output-only', () => {
    const { reg } = make();
    const w = reg.spawn({
      title: 'runner',
      initialContent: { kind: 'markdown', text: '' },
    });
    const pane = w.getFocusedPane()!;
    Object.defineProperty(pane, 'focusPolicy', { value: 'output-only', configurable: true });
    expect(w.hasInteractableFocus()).toBe(false);
    Object.defineProperty(pane, 'focusPolicy', { value: 'interactive', configurable: true });
    expect(w.hasInteractableFocus()).toBe(true);
  });
});

describe('SP-A — end-to-end composition', () => {
  test('skipWindowWhen = (w) => !w.hasInteractableFocus() skips runner', () => {
    const { reg } = make({ skipWhen: (w) => !w.hasInteractableFocus() });
    const chat    = reg.spawn({ title: 'chat',    initialContent: { kind: 'markdown', text: '' } });
    const runner  = reg.spawn({ title: 'runner',  initialContent: { kind: 'markdown', text: '' } });
    const scratch = reg.spawn({ title: 'scratch', initialContent: { kind: 'markdown', text: '' } });
    // Flag runner's pane as output-only.
    const runnerPane = runner.getFocusedPane()!;
    Object.defineProperty(runnerPane, 'focusPolicy', { value: 'output-only', configurable: true });
    // Foreground: scratch. next() → chat, next() → scratch.
    reg.next();
    expect(reg.current()?.id).toBe(chat.id);
    reg.next();
    expect(reg.current()?.id).toBe(scratch.id);
  });
});
