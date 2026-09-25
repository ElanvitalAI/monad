import { describe, expect, test } from 'bun:test';

import {
  WindowRegistry,
  MAX_WINDOWS,
  type RegistryEvent,
} from '../src/virtual-windows/window-registry.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import { registerPaneContentKind } from '../src/virtual-windows/pane-content.js';

function make() {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  const book = createAddressBook();
  const events: RegistryEvent[] = [];
  const reg = new WindowRegistry({
    addressBook: book,
    coordinator: coord,
    defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }),
  });
  const unsub = reg.subscribe((ev) => events.push(ev));
  return { reg, book, coord, events, unsub };
}

describe('WindowRegistry', () => {
  test('spawn creates + foregrounds the window by default', () => {
    const { reg, book, coord, events } = make();
    const win = reg.spawn({
      title: 'first',
      initialContent: { kind: 'markdown', text: 'hi' },
    });
    expect(reg.list()).toHaveLength(1);
    expect(reg.current()).toBe(win);
    expect(coord.modalStack()).toContain(`virtual-window:${win.id}`);
    expect(book.resolveWindow(win.id)?.title).toBe('first');
    expect(events.map(e => e.type)).toContain('window:create');
    expect(events.map(e => e.type)).toContain('pane:create');
    expect(events.map(e => e.type)).toContain('window:switch');
  });

  test('spawn with foreground:false leaves existing foreground alone', () => {
    const { reg } = make();
    const a = reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    const b = reg.spawn({
      title: 'b', foreground: false,
      initialContent: { kind: 'markdown', text: 'b' },
    });
    expect(reg.current()).toBe(a);
    expect(reg.list()).toHaveLength(2);
    expect(b).not.toBe(a);
  });

  test('switchTo pops current modal + pushes target', () => {
    const { reg, coord } = make();
    const a = reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    const b = reg.spawn({ title: 'b', initialContent: { kind: 'markdown', text: 'b' } });
    expect(reg.current()).toBe(b);
    reg.switchTo(a.id);
    expect(reg.current()).toBe(a);
    const stack = coord.modalStack();
    expect(stack).toContain(`virtual-window:${a.id}`);
    // B's modal has been popped; it's not in the focus stack.
    expect(stack).not.toContain(`virtual-window:${b.id}`);
  });

  test('close foreground auto-switches to survivor', () => {
    const { reg } = make();
    const a = reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    const b = reg.spawn({ title: 'b', initialContent: { kind: 'markdown', text: 'b' } });
    // b is fg; close it.
    expect(reg.close(b.id)).toBe(true);
    expect(reg.current()).toBe(a);
  });

  test('close last window leaves no foreground', () => {
    const { reg } = make();
    const a = reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    reg.close(a.id);
    expect(reg.current()).toBeNull();
    expect(reg.list()).toEqual([]);
  });

  test('backgroundCurrent demotes the foreground VW back to dashboard main without closing it', () => {
    const { reg, coord, events } = make();
    const a = reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    const b = reg.spawn({ title: 'b', initialContent: { kind: 'markdown', text: 'b' } });
    events.length = 0;
    expect(reg.current()).toBe(b);
    expect(reg.backgroundCurrent()).toBe(true);
    expect(reg.current()).toBeNull();
    expect(reg.list().map((window) => window.id)).toEqual([a.id, b.id]);
    expect(coord.modalStack()).not.toContain(`virtual-window:${b.id}`);
    expect(events.some((ev) => ev.type === 'window:switch' && ev.from === b.id && ev.to === undefined)).toBe(true);
  });

  test('SRF-1: window:close event carries spawnTitle', () => {
    const { reg, events } = make();
    const w = reg.spawn({ title: 'runner', initialContent: { kind: 'markdown', text: 'hi' } });
    events.length = 0;
    reg.close(w.id);
    const ev = events.find(e => e.type === 'window:close');
    expect(ev).toBeDefined();
    expect(ev && ev.type === 'window:close' ? ev.spawnTitle : null).toBe('runner');
  });

  test('SRF-1: spawnTitle is preserved across rename for close event', () => {
    const { reg, events } = make();
    const w = reg.spawn({ title: 'runner', initialContent: { kind: 'markdown', text: 'hi' } });
    reg.renameWindow(w.id, 'my shell');
    events.length = 0;
    reg.close(w.id);
    const ev = events.find(e => e.type === 'window:close');
    // spawnTitle still points at the original label so host-factory
    // eviction uses the cache key, not the (post-rename) display title.
    expect(ev && ev.type === 'window:close' ? ev.spawnTitle : null).toBe('runner');
  });

  test('MAX_WINDOWS cap rejects spawn beyond limit', () => {
    const { reg } = make();
    for (let i = 0; i < MAX_WINDOWS; i++) {
      reg.spawn({
        title: `w${i}`,
        initialContent: { kind: 'markdown', text: String(i) },
        foreground: i === 0,
      });
    }
    expect(() => reg.spawn({
      title: 'over', initialContent: { kind: 'markdown', text: 'x' },
    })).toThrow(/max/);
  });

  test('spawn passes pane host chrome profile into defaultBounds resolution', () => {
    registerPaneContentKind('test-host-chrome' as any, ((spec: any) => ({
      id: 'pane:test-host-chrome',
      kind: spec.kind,
      title: 'host chrome pane',
      focusPolicy: 'interactive',
      hostChromeProfile: 'hud-status-input-dock',
      start() {},
      stop() {},
      render: () => '',
      onKey: () => ({ type: 'none' }),
      write() {},
      capture: () => '',
      isAlive: true,
      on: () => () => {},
      dispose() {},
    })) as any);
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const book = createAddressBook();
    const requestedProfiles: string[] = [];
    const reg = new WindowRegistry({
      addressBook: book,
      coordinator: coord,
      defaultBounds: (profile) => {
        requestedProfiles.push(profile ?? 'none');
        return { row: 2, col: 3, width: 70, height: 19 };
      },
    });
    const win = reg.spawn({
      title: 'profiled',
      initialContent: { kind: 'test-host-chrome' } as any,
    });
    expect(requestedProfiles).toEqual(['hud-status-input-dock']);
    expect(win.getBounds()).toEqual({ row: 2, col: 3, width: 70, height: 19 });
  });

  test('next / previous cycle foreground', () => {
    const { reg } = make();
    const a = reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    const b = reg.spawn({ title: 'b', initialContent: { kind: 'markdown', text: 'b' } });
    const c = reg.spawn({ title: 'c', initialContent: { kind: 'markdown', text: 'c' } });
    // c is fg; next wraps to a.
    reg.next();
    expect(reg.current()).toBe(a);
    reg.next();
    expect(reg.current()).toBe(b);
    reg.previous();
    expect(reg.current()).toBe(a);
    expect(c).not.toBe(a);
  });

  test('address book keeps pane registrations through split/close', () => {
    const { reg, book } = make();
    const win = reg.spawn({ title: 'x', initialContent: { kind: 'markdown', text: 'a' } });
    const rootPaneId = win.focused;
    expect(book.resolvePane(rootPaneId)).not.toBeNull();
    const { createPaneContent } = require('../src/virtual-windows/pane-content.js');
    const b = createPaneContent({ kind: 'markdown', text: 'b' });
    win.splitFocused('h', b);
    expect(book.listPanes(win.id)).toHaveLength(2);
    win.closeFocused();   // closes b (fg)
    expect(book.listPanes(win.id)).toHaveLength(1);
  });

  test('closing a backgrounded window does NOT affect foreground', () => {
    const { reg } = make();
    const a = reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    const b = reg.spawn({ title: 'b', initialContent: { kind: 'markdown', text: 'b' } });
    reg.switchTo(a.id);
    reg.close(b.id);
    expect(reg.current()).toBe(a);
  });

  test('VW-U4 — onShowSelector deps forwards from pane right-click to host', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const book = createAddressBook();
    const calls: Array<{ w: number; p: string | null; col: number; row: number }> = [];
    const reg = new WindowRegistry({
      addressBook: book,
      coordinator: coord,
      defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }),
      onShowSelector: (w, p, col, row) => {
        calls.push({ w, p, col, row });
      },
    });
    const w = reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    const surface = w.asModalSurface();
    surface.onMouse!({ type: 'right-click', row: 10, col: 25 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.w).toBe(w.id);
    expect(calls[0]!.col).toBe(25);
    expect(calls[0]!.row).toBe(10);
  });

  test('R6 — onShowContextMenu deps forwards from pane-title right-click to host', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const book = createAddressBook();
    const calls: Array<{ w: number; p: string; col: number; row: number }> = [];
    const reg = new WindowRegistry({
      addressBook: book,
      coordinator: coord,
      defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }),
      onShowContextMenu: (w, p, col, row) => {
        calls.push({ w, p, col, row });
      },
    });
    const w = reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    const surface = w.asModalSurface();
    surface.onMouse!({ type: 'right-click', row: 2, col: 25 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.w).toBe(w.id);
    expect(calls[0]!.p).toBe(w.focused);
  });

  test('VW-U1 — switchTo flips borderAccent from prev to new foreground', () => {
    const { reg } = make();
    const a = reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    expect(a.isBorderAccent()).toBe(true);            // spawn → foreground → accent ON
    const b = reg.spawn({ title: 'b', initialContent: { kind: 'markdown', text: 'b' } });
    // Spawning b auto-switched it to foreground, so a should be muted now.
    expect(a.isBorderAccent()).toBe(false);
    expect(b.isBorderAccent()).toBe(true);
    reg.switchTo(a.id);
    expect(a.isBorderAccent()).toBe(true);
    expect(b.isBorderAccent()).toBe(false);
  });

  test('pane update requests a redraw for the owning virtual window', () => {
    const { reg, coord } = make();
    const requests: Array<{ region?: string; force?: boolean }> = [];
    const original = coord.requestRender.bind(coord);
    coord.requestRender = ((opts?: { region?: string; force?: boolean }) => {
      requests.push({ region: opts?.region, force: opts?.force });
      original(opts);
    }) as typeof coord.requestRender;

    const win = reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    const pane = win.getFocusedPane();
    expect(pane).not.toBeNull();
    pane!.write('changed');

    expect(requests.some((req) => req.region === `virtual-window:${win.id}`)).toBe(true);
  });
});
