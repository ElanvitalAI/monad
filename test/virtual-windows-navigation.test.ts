import { describe, expect, test } from 'bun:test';

import { createNavigationRouter, PREFIX_KEY } from '../src/virtual-windows/navigation.js';
import { WindowRegistry } from '../src/virtual-windows/window-registry.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';

function make() {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  const book = createAddressBook();
  const registry = new WindowRegistry({
    addressBook: book,
    coordinator: coord,
    defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }),
  });
  let time = 1_000_000;
  const router = createNavigationRouter({
    registry,
    now: () => time,
    chordTimeoutMs: 1000,
    callbacks: {},
  });
  return { registry, router, coord, advance: (dt: number) => { time += dt; } };
}

describe('NavigationRouter', () => {
  test('bare key → passthrough', () => {
    const { router } = make();
    expect(router.handleKey({ name: 'a' })).toBe('passthrough');
    expect(router.isArmed()).toBe(false);
  });

  test('Ctrl+B arms chord', () => {
    const { router } = make();
    expect(router.handleKey({ name: PREFIX_KEY, ctrl: true })).toBe('armed');
    expect(router.isArmed()).toBe(true);
  });

  test('Ctrl+B then digit switches window', () => {
    const { router, registry } = make();
    const a = registry.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    const b = registry.spawn({ title: 'b', initialContent: { kind: 'markdown', text: 'b' } });
    registry.switchTo(b.id);
    router.handleKey({ name: 'b', ctrl: true });
    const r = router.handleKey({ name: '1' });
    expect(r).toBe('consumed');
    expect(registry.current()?.id).toBe(a.id);
  });

  test('Ctrl+B 0 triggers onPicker callback', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const book = createAddressBook();
    const reg = new WindowRegistry({ addressBook: book, coordinator: coord, defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }) });
    let called = 0;
    const router = createNavigationRouter({
      registry: reg,
      callbacks: { onPicker: () => { called++; } },
    });
    router.handleKey({ name: 'b', ctrl: true });
    router.handleKey({ name: '0' });
    expect(called).toBe(1);
  });

  test('Ctrl+B n / p cycle windows', () => {
    const { router, registry } = make();
    const a = registry.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    const b = registry.spawn({ title: 'b', initialContent: { kind: 'markdown', text: 'b' } });
    registry.switchTo(a.id);
    router.handleKey({ name: 'b', ctrl: true });
    router.handleKey({ name: 'n' });
    expect(registry.current()?.id).toBe(b.id);
    router.handleKey({ name: 'b', ctrl: true });
    router.handleKey({ name: 'p' });
    expect(registry.current()?.id).toBe(a.id);
  });

  test('Ctrl+B c → onNewWindow callback', () => {
    let called = 0;
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const book = createAddressBook();
    const reg = new WindowRegistry({ addressBook: book, coordinator: coord, defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }) });
    const router = createNavigationRouter({
      registry: reg,
      callbacks: { onNewWindow: () => { called++; } },
    });
    router.handleKey({ name: 'b', ctrl: true });
    router.handleKey({ name: 'c' });
    expect(called).toBe(1);
  });

  test('Ctrl+B % and " trigger onSplit', () => {
    const axes: Array<'h' | 'v'> = [];
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const book = createAddressBook();
    const reg = new WindowRegistry({ addressBook: book, coordinator: coord, defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }) });
    const router = createNavigationRouter({
      registry: reg,
      callbacks: { onSplit: (a) => { axes.push(a); } },
    });
    router.handleKey({ name: 'b', ctrl: true });
    router.handleKey({ name: '%' });
    router.handleKey({ name: 'b', ctrl: true });
    router.handleKey({ name: '"' });
    expect(axes).toEqual(['h', 'v']);
  });

  test('Ctrl+B arrows shift pane focus', () => {
    const { router, registry } = make();
    const w = registry.spawn({ title: 'w', initialContent: { kind: 'markdown', text: 'a' } });
    const { createPaneContent } = require('../src/virtual-windows/pane-content.js');
    const b = createPaneContent({ kind: 'markdown', text: 'b' });
    w.splitFocused('h', b);
    expect(w.focused).toBe(b.id);
    router.handleKey({ name: 'b', ctrl: true });
    router.handleKey({ name: 'left' });
    expect(w.focused).not.toBe(b.id);
  });

  test('Ctrl+B x closes focused pane', () => {
    const { router, registry } = make();
    const w = registry.spawn({ title: 'w', initialContent: { kind: 'markdown', text: 'a' } });
    const { createPaneContent } = require('../src/virtual-windows/pane-content.js');
    const b = createPaneContent({ kind: 'markdown', text: 'b' });
    w.splitFocused('h', b);
    router.handleKey({ name: 'b', ctrl: true });
    router.handleKey({ name: 'x' });
    expect(w.listPanes()).toHaveLength(1);
  });

  test('VW-U5 — Ctrl+B z fires onZoomToggle; Ctrl+B Tab fires onLastFocusedPane', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const book = createAddressBook();
    const reg = new WindowRegistry({
      addressBook: book, coordinator: coord,
      defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }),
    });
    let zoomCalls = 0;
    let lastCalls = 0;
    const router = createNavigationRouter({
      registry: reg,
      callbacks: {
        onZoomToggle: () => { zoomCalls++; },
        onLastFocusedPane: () => { lastCalls++; },
      },
    });
    router.handleKey({ name: 'b', ctrl: true });
    expect(router.handleKey({ name: 'z' })).toBe('consumed');
    router.handleKey({ name: 'b', ctrl: true });
    expect(router.handleKey({ name: 'tab' })).toBe('consumed');
    expect(zoomCalls).toBe(1);
    expect(lastCalls).toBe(1);
  });

  test('unknown sequence key → cancelled + disarmed', () => {
    const { router } = make();
    router.handleKey({ name: 'b', ctrl: true });
    // VW-U5 took `z` + `tab` as valid body keys — use `q` as a truly
    // unknown body.
    expect(router.handleKey({ name: 'q' })).toBe('cancelled');
    expect(router.isArmed()).toBe(false);
  });

  test('chord timeout disarms', () => {
    const { router, advance } = make();
    router.handleKey({ name: 'b', ctrl: true });
    advance(1500);
    expect(router.handleKey({ name: '1' })).toBe('passthrough');
    expect(router.isArmed()).toBe(false);
  });

  test('reset force-disarms', () => {
    const { router } = make();
    router.handleKey({ name: 'b', ctrl: true });
    router.reset();
    expect(router.isArmed()).toBe(false);
  });

  test('Ctrl+B < / > alias previous / next (Phase α2)', () => {
    const { router, registry } = make();
    const a = registry.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    const b = registry.spawn({ title: 'b', initialContent: { kind: 'markdown', text: 'b' } });
    registry.switchTo(a.id);
    router.handleKey({ name: 'b', ctrl: true });
    router.handleKey({ name: '>' });
    expect(registry.current()?.id).toBe(b.id);
    router.handleKey({ name: 'b', ctrl: true });
    router.handleKey({ name: '<' });
    expect(registry.current()?.id).toBe(a.id);
    // Comma / period work identically for shift-less keyboards.
    router.handleKey({ name: 'b', ctrl: true });
    router.handleKey({ name: '.' });
    expect(registry.current()?.id).toBe(b.id);
    router.handleKey({ name: 'b', ctrl: true });
    router.handleKey({ name: ',' });
    expect(registry.current()?.id).toBe(a.id);
  });

  test('Ctrl+B t → onModalWindowToggle callback (Phase α2)', () => {
    let called = 0;
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const book = createAddressBook();
    const reg = new WindowRegistry({ addressBook: book, coordinator: coord, defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }) });
    const router = createNavigationRouter({
      registry: reg,
      callbacks: { onModalWindowToggle: () => { called++; } },
    });
    router.handleKey({ name: 'b', ctrl: true });
    const r = router.handleKey({ name: 't' });
    expect(r).toBe('consumed');
    expect(called).toBe(1);
  });

  test('vim-like hjkl focus movement', () => {
    const { router, registry } = make();
    const w = registry.spawn({ title: 'w', initialContent: { kind: 'markdown', text: 'a' } });
    const { createPaneContent } = require('../src/virtual-windows/pane-content.js');
    const b = createPaneContent({ kind: 'markdown', text: 'b' });
    w.splitFocused('h', b);
    // Back to a.
    router.handleKey({ name: 'b', ctrl: true });
    router.handleKey({ name: 'h' });
    expect(w.focused).not.toBe(b.id);
    router.handleKey({ name: 'b', ctrl: true });
    router.handleKey({ name: 'l' });
    expect(w.focused).toBe(b.id);
  });
});
