import { describe, expect, test } from 'bun:test';

import { TerminalSessionRegistry } from '../../src/terminal/session-registry.js';
import { DisplayCoordinator } from '../../src/display/coordinator.js';
import type { PreviewTerminal, PreviewTerminalOpts } from '../../src/preview/terminal.js';
import { TerminalRegistry } from '../../src/terminal-matrix/registry.js';
import { VwPlacementAdapter } from '../../src/terminal-matrix/vw-placement-adapter.js';
import { BroadcastBus } from '../../src/terminal-matrix/broadcast-bus.js';

function fakePreviewFactory(opts: PreviewTerminalOpts): PreviewTerminal {
  let alive = false;
  const writes: string[] = [];
  return {
    start: () => { alive = true; },
    stop: () => { alive = false; },
    write: (b: string) => writes.push(b),
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
    _writes: writes,
  } as unknown as PreviewTerminal;
}

function fixture() {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  const sessions = new TerminalSessionRegistry({
    coordinator: coord,
    terminalFactory: fakePreviewFactory,
  });
  const matrix = new TerminalRegistry({
    sessionRegistry: sessions,
    termSize: () => ({ cols: 80, rows: 24 }),
  });
  new VwPlacementAdapter({
    matrix, sessionRegistry: sessions,
    termSize: () => ({ cols: 80, rows: 24 }),
    installSlot: () => {},
    removeSlot: () => {},
  }).install();
  // Mirror dashboard.ts auto-group wiring.
  matrix.subscribe((ev) => {
    if (ev.type !== 'placement') return;
    if (ev.prev.kind === 'vw') matrix.leaveGroup(ev.instance.id, `_vw:${ev.prev.windowId}`);
    if (ev.instance.placement.kind === 'vw') {
      matrix.joinGroup(ev.instance.id, `_vw:${ev.instance.placement.windowId}`);
    }
  });
  return { matrix, bus: new BroadcastBus(matrix) };
}

describe('VW auto-group (per-VW broadcast membership)', () => {
  test('moving a terminal into vw:W auto-joins _vw:W', () => {
    const { matrix } = fixture();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    matrix.move(inst.id, { kind: 'vw', windowId: '42', slotId: 'slot-a' });
    expect(inst.broadcastGroups.has('_vw:42')).toBe(true);
  });

  test('leaving vw:W removes _vw:W membership', () => {
    const { matrix } = fixture();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    matrix.move(inst.id, { kind: 'vw', windowId: '42', slotId: 'slot-a' });
    matrix.move(inst.id, { kind: 'background' });
    expect(inst.broadcastGroups.has('_vw:42')).toBe(false);
  });

  test('vw → different vw swaps membership', () => {
    const { matrix } = fixture();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    matrix.move(inst.id, { kind: 'vw', windowId: '1', slotId: 'a' });
    matrix.move(inst.id, { kind: 'vw', windowId: '2', slotId: 'b' });
    expect(inst.broadcastGroups.has('_vw:1')).toBe(false);
    expect(inst.broadcastGroups.has('_vw:2')).toBe(true);
  });

  test('broadcasting to _vw:W fans out to every slot in that window', () => {
    const { matrix, bus } = fixture();
    const a = matrix.spawn({ title: 'a', cwd: '/tmp' });
    const b = matrix.spawn({ title: 'b', cwd: '/tmp' });
    const c = matrix.spawn({ title: 'c', cwd: '/tmp' });
    matrix.move(a.id, { kind: 'vw', windowId: '7', slotId: 's1' });
    matrix.move(b.id, { kind: 'vw', windowId: '7', slotId: 's2' });
    matrix.move(c.id, { kind: 'vw', windowId: '9', slotId: 's1' }); // different window
    const r = bus.broadcastBytes('_vw:7', 'git pull\r');
    expect(r.delivered.sort()).toEqual([a.id, b.id].sort());
    expect(r.delivered).not.toContain(c.id);
  });

  test('vw → vw same window is idempotent membership-wise', () => {
    const { matrix } = fixture();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    matrix.move(inst.id, { kind: 'vw', windowId: '1', slotId: 'a' });
    matrix.move(inst.id, { kind: 'vw', windowId: '1', slotId: 'b' });
    expect([...inst.broadcastGroups]).toEqual(['_vw:1']);
  });
});
