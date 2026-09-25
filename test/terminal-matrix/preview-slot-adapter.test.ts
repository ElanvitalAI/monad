import { describe, expect, test } from 'bun:test';

import { TerminalSessionRegistry } from '../../src/terminal/session-registry.js';
import { DisplayCoordinator } from '../../src/display/coordinator.js';
import type { PreviewTerminal, PreviewTerminalOpts } from '../../src/preview/terminal.js';
import { TerminalRegistry } from '../../src/terminal-matrix/registry.js';
import { PreviewSlotAdapter } from '../../src/terminal-matrix/preview-slot-adapter.js';

function fakePreviewFactory(opts: PreviewTerminalOpts): PreviewTerminal {
  let alive = false;
  return {
    start: () => { alive = true; },
    stop: () => { alive = false; },
    write: () => {},
    resize: () => {},
    render: () => '',
    cursorPosition: () => null,
    get isAlive(): boolean { return alive; },
    get cols(): number { return opts.cols; },
    get rows(): number { return opts.rows; },
    get pid(): number { return 1; },
    get isScrolledBack(): boolean { return false; },
    get scrollbackOffset(): number { return 0; },
    get wantsMouse(): boolean { return false; },
    scrollUp: () => 0,
    scrollDown: () => 0,
    scrollToTop: () => {},
    scrollToTail: () => {},
    forwardMouse: () => {},
  } as unknown as PreviewTerminal;
}

function makeFixture() {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  const sessions = new TerminalSessionRegistry({
    coordinator: coord,
    terminalFactory: fakePreviewFactory,
  });
  const matrix = new TerminalRegistry({
    sessionRegistry: sessions,
    termSize: () => ({ cols: 80, rows: 24 }),
  });

  // Dashboard's previewTerminal variable — stand-in.
  let slot: PreviewTerminal | null = null;
  const changes: Array<PreviewTerminal | null> = [];
  const adapter = new PreviewSlotAdapter({
    matrix,
    sessionRegistry: sessions,
    termSize: () => ({ cols: 80, rows: 24 }),
    binding: {
      get: () => slot,
      set: (v) => { slot = v; changes.push(v); },
      onChange: () => {},
    },
  });
  adapter.install();

  return { matrix, sessions, adapter, getSlot: () => slot, changes };
}

describe('PreviewSlotAdapter', () => {
  test('move modal → preview detaches modal and installs PTY in slot', () => {
    const { matrix, adapter, getSlot } = makeFixture();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    expect(inst.placement.kind).toBe('modal');
    matrix.move(inst.id, { kind: 'preview' });
    expect(inst.placement.kind).toBe('preview');
    expect(getSlot()).toBe(inst.pty);
    expect(adapter.current()?.id).toBe(inst.id);
  });

  test('move preview → modal releases slot and re-attaches modal', () => {
    const { matrix, adapter, getSlot } = makeFixture();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    matrix.move(inst.id, { kind: 'preview' });
    matrix.move(inst.id, { kind: 'modal', modalId: inst.id });
    expect(inst.placement.kind).toBe('modal');
    expect(getSlot()).toBeNull();
    expect(adapter.current()).toBeNull();
  });

  test('move preview → background releases slot without attaching modal', () => {
    const { matrix, adapter, getSlot } = makeFixture();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    matrix.move(inst.id, { kind: 'preview' });
    matrix.move(inst.id, { kind: 'background' });
    expect(inst.placement.kind).toBe('background');
    expect(getSlot()).toBeNull();
    expect(adapter.current()).toBeNull();
  });

  test('claiming preview evicts prior occupant to background', () => {
    const { matrix, getSlot } = makeFixture();
    const a = matrix.spawn({ title: 'a', cwd: '/tmp' });
    const b = matrix.spawn({ title: 'b', cwd: '/tmp' });
    // a spawns → modal; moving b → preview should auto-evict a (a
    // wasn't in preview, but we ensure the slot can only hold one).
    // First put a in preview to make the eviction meaningful.
    matrix.move(a.id, { kind: 'preview' });
    expect(getSlot()).toBe(a.pty);
    expect(a.placement.kind).toBe('preview');
    matrix.move(b.id, { kind: 'preview' });
    expect(getSlot()).toBe(b.pty);
    expect(b.placement.kind).toBe('preview');
    // a gets kicked to background automatically.
    expect(a.placement.kind).toBe('background');
  });

  test('PTY identity survives placement transitions (scrollback preservation proxy)', () => {
    const { matrix } = makeFixture();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    const ptyBefore = inst.pty;
    matrix.move(inst.id, { kind: 'preview' });
    matrix.move(inst.id, { kind: 'background' });
    matrix.move(inst.id, { kind: 'modal', modalId: inst.id });
    matrix.move(inst.id, { kind: 'preview' });
    expect(inst.pty).toBe(ptyBefore);
  });

  test('forgetBinding drops adapter state when preview PTY dies externally', () => {
    const { matrix, adapter, getSlot } = makeFixture();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    matrix.move(inst.id, { kind: 'preview' });
    // Simulate the dashboard's onExit handler setting slot=null.
    adapter.forgetBinding();
    expect(adapter.current()).toBeNull();
    // Next move should not try to evict a stale prior.
    const b = matrix.spawn({ title: 'b', cwd: '/tmp' });
    matrix.move(b.id, { kind: 'preview' });
    expect(getSlot()).toBe(b.pty);
  });

  test('install() returns idempotent unregister', () => {
    const { matrix, adapter } = makeFixture();
    const u1 = adapter.install();
    const u2 = adapter.install();
    expect(u1).toBe(u2);
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    matrix.move(inst.id, { kind: 'preview' });
    u1();
    // After unregister, preview transitions should throw again.
    const inst2 = matrix.spawn({ title: 't2', cwd: '/tmp' });
    expect(() => matrix.move(inst2.id, { kind: 'preview' }))
      .toThrow(/preview lands in T2b/);
  });
});
