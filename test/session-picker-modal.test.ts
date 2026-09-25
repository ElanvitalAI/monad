import { describe, expect, test } from 'bun:test';

import { createSessionPickerModal } from '../src/session/picker-modal.js';
import { TerminalSessionRegistry } from '../src/terminal/session-registry.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import type { PreviewTerminalOpts, PreviewTerminal } from '../src/preview/terminal.js';
import type { TerminalSession } from '../src/terminal/session-registry.js';

function fakePreview(opts: PreviewTerminalOpts): PreviewTerminal {
  return {
    start: () => {},
    stop: () => {},
    write: () => {},
    resize: () => {},
    render: () => '',
    cursorPosition: () => null,
    isAlive: true,
    cols: opts.cols,
    rows: opts.rows,
    pid: 1,
    isScrolledBack: false,
    scrollbackOffset: 0,
    wantsMouse: false,
    scrollUp: () => 0,
    scrollDown: () => 0,
    scrollToTop: () => {},
    scrollToTail: () => {},
    forwardMouse: () => {},
  } as unknown as PreviewTerminal;
}

function makeRegistry(): TerminalSessionRegistry {
  return new TerminalSessionRegistry({
    coordinator: new DisplayCoordinator({ frameMs: 0 }),
    terminalFactory: fakePreview,
  });
}

describe('session picker modal', () => {
  test('lists sessions in the registry', () => {
    const registry = makeRegistry();
    registry.spawn({ title: 'alpha', cwd: '/tmp/a' }, { termCols: 100, termRows: 30 });
    registry.spawn({ title: 'beta',  cwd: '/tmp/b' }, { termCols: 100, termRows: 30 });
    const m = createSessionPickerModal({
      registry,
      bounds: { row: 3, col: 2, width: 80, height: 12 },
      width: 80,
      onAccept: () => {},
    });
    const state = m.state();
    expect(state.items).toHaveLength(2);
    expect(state.items.map(i => (i.label as string).toLowerCase()).some(l => l.includes('alpha'))).toBe(true);
  });

  test('excludes exited sessions', () => {
    const registry = makeRegistry();
    const a = registry.spawn({ title: 'alpha', cwd: '/tmp/a' }, { termCols: 100, termRows: 30 });
    registry.spawn({ title: 'beta',  cwd: '/tmp/b' }, { termCols: 100, termRows: 30 });
    registry.kill(a.id);
    const m = createSessionPickerModal({
      registry,
      bounds: { row: 3, col: 2, width: 80, height: 12 },
      width: 80,
      onAccept: () => {},
    });
    expect(m.state().items).toHaveLength(1);
  });

  test('query filter narrows matches', () => {
    const registry = makeRegistry();
    registry.spawn({ title: 'alpha', cwd: '/tmp/a' }, { termCols: 100, termRows: 30 });
    registry.spawn({ title: 'beta',  cwd: '/tmp/b' }, { termCols: 100, termRows: 30 });
    const m = createSessionPickerModal({
      registry,
      bounds: { row: 3, col: 2, width: 80, height: 12 },
      width: 80,
      onAccept: () => {},
    });
    m.type('a');
    m.type('l');
    m.type('p');
    expect(m.state().query).toBe('alp');
    expect(m.state().items).toHaveLength(1);
  });

  test('larger lists keep the top-filter picker contract', () => {
    const registry = makeRegistry();
    registry.spawn({ title: 'alpha', cwd: '/tmp/a' }, { termCols: 100, termRows: 30 });
    registry.spawn({ title: 'beta',  cwd: '/tmp/b' }, { termCols: 100, termRows: 30 });
    registry.spawn({ title: 'gamma', cwd: '/tmp/c' }, { termCols: 100, termRows: 30 });
    registry.spawn({ title: 'delta', cwd: '/tmp/d' }, { termCols: 100, termRows: 30 });
    const m = createSessionPickerModal({
      registry,
      bounds: { row: 3, col: 2, width: 80, height: 12 },
      width: 80,
      onAccept: () => {},
    });
    m.type('g');
    m.type('a');
    expect(m.state().query).toBe('ga');
    expect(m.state().items).toHaveLength(1);
    expect(String(m.state().items[0]?.label).toLowerCase()).toContain('gamma');
    const ansi = m.surface.paint();
    expect(ansi).toContain('Attach');
    expect(ansi).toContain('Cancel');
  });

  test('onAccept delivers the selected session', () => {
    const registry = makeRegistry();
    const a = registry.spawn({ title: 'alpha', cwd: '/tmp/a' }, { termCols: 100, termRows: 30 });
    let accepted: TerminalSession | null = null;
    const m = createSessionPickerModal({
      registry,
      bounds: { row: 3, col: 2, width: 80, height: 12 },
      width: 80,
      onAccept: (s) => { accepted = s; },
    });
    m.accept();
    // No detach tests here — picker only selects, caller does the
    // attach.
    expect(accepted?.id).toBe(a.id);
  });

  test('empty registry shows no items', () => {
    const registry = makeRegistry();
    const m = createSessionPickerModal({
      registry,
      bounds: { row: 3, col: 2, width: 80, height: 12 },
      width: 80,
      onAccept: () => {},
    });
    expect(m.state().items).toHaveLength(0);
  });
});
