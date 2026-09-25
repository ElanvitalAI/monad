import { describe, expect, test } from 'bun:test';

import {
  buildTerminalModalListTool,
  buildTerminalModalObserveTool,
  buildTerminalModalFocusTool,
  buildTerminalModalDetachTool,
  buildTerminalModalKillTool,
  dispatchTerminalModalList,
  dispatchTerminalModalObserve,
  dispatchTerminalModalFocus,
  dispatchTerminalModalDetach,
  dispatchTerminalModalKill,
} from '../src/skills/tools/terminal-modal.js';
import { TerminalSessionRegistry } from '../src/terminal/session-registry.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import type { PreviewTerminalOpts, PreviewTerminal } from '../src/preview/terminal.js';

function fakePreview(opts: PreviewTerminalOpts): PreviewTerminal {
  let alive = false;
  return {
    start: () => { alive = true; },
    stop: () => { alive = false; },
    write: () => {},
    resize: () => {},
    render: () => 'fake-grid-contents',
    cursorPosition: () => alive ? ({ row: 0, col: 0 }) : null,
    get isAlive(): boolean { return alive; },
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

describe('terminal_modal_list', () => {
  test('schema shape', () => {
    expect(buildTerminalModalListTool().name).toBe('TerminalModalList');
  });

  test('empty registry → 0 sessions', async () => {
    const registry = makeRegistry();
    const r = await dispatchTerminalModalList({}, { registry });
    expect(r.output).toMatch(/0 sessions/);
  });

  test('lists live sessions with id and state', async () => {
    const registry = makeRegistry();
    registry.spawn({ title: 'alpha', cwd: '/tmp/a' }, { termCols: 100, termRows: 30 });
    registry.spawn({ title: 'beta',  cwd: '/tmp/b' }, { termCols: 100, termRows: 30 });
    const r = await dispatchTerminalModalList({}, { registry });
    expect(r.output).toMatch(/2 sessions/);
    expect(r.output).toContain('alpha');
    expect(r.output).toContain('beta');
  });

  test('include_exited=false filters exited', async () => {
    const registry = makeRegistry();
    const a = registry.spawn({ title: 'alpha', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    registry.spawn({ title: 'beta', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    registry.kill(a.id);
    const r = await dispatchTerminalModalList({}, { registry });
    expect(r.output).toMatch(/1 sessions/);
    expect(r.output).not.toContain('alpha');
  });
});

describe('terminal_modal_observe', () => {
  test('returns snapshot header + grid body', async () => {
    const registry = makeRegistry();
    const s = registry.spawn({ title: 'X', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    const r = await dispatchTerminalModalObserve({ id: s.id }, { registry });
    expect(r.output).toContain(s.id);
    expect(r.output).toContain('fake-grid-contents');
  });

  test('unknown id throws', async () => {
    const registry = makeRegistry();
    await expect(dispatchTerminalModalObserve({ id: 'nope' }, { registry }))
      .rejects.toThrow(/unknown session id/);
  });

  test('tail mode truncates to max_bytes', async () => {
    const registry = makeRegistry();
    const s = registry.spawn({ title: 'X', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    // Stub out render to return something large.
    (s.preview as unknown as { render: () => string }).render = () =>
      'a'.repeat(100_000);
    const r = await dispatchTerminalModalObserve({ id: s.id, mode: 'tail', max_bytes: 100 }, { registry });
    // Output had been truncated (either via tail trimmer or output-
    // truncation spillover). Inline portion is bounded.
    expect(r.output.length).toBeLessThan(100_000);
  });
});

// NT-C3 (session nt): terminal_modal_spawn tool removed.
// Its tests are deleted — RunShell (mode='vw') replaces the surface.

describe('terminal_modal_focus', () => {
  test('attaches a background session', async () => {
    const registry = makeRegistry();
    const a = registry.spawn({ title: 'a', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    const b = registry.spawn({ title: 'b', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    // b is now foreground.
    const r = await dispatchTerminalModalFocus({ id: a.id }, { registry, termCols: 100, termRows: 30 });
    expect(r.output).toContain(a.id);
    expect(registry.foreground()?.id).toBe(a.id);
    expect(b.state).toBe('background');
  });

  test('unknown id throws', async () => {
    const registry = makeRegistry();
    await expect(
      dispatchTerminalModalFocus({ id: 'nope' }, { registry, termCols: 100, termRows: 30 }),
    ).rejects.toThrow(/unknown/);
  });
});

describe('terminal_modal_detach', () => {
  test('detaches foreground session', async () => {
    const registry = makeRegistry();
    const s = registry.spawn({ title: 's', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    const r = await dispatchTerminalModalDetach({}, { registry });
    expect(r.output).toContain(s.id);
    expect(s.state).toBe('background');
  });

  test('returns no-op when no foreground', async () => {
    const registry = makeRegistry();
    const r = await dispatchTerminalModalDetach({}, { registry });
    expect(r.output).toMatch(/nothing to do/);
  });
});

describe('terminal_modal_kill', () => {
  test('kills specified session', async () => {
    const registry = makeRegistry();
    const s = registry.spawn({ title: 's', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    const r = await dispatchTerminalModalKill({ id: s.id }, { registry });
    expect(r.output).toContain(s.id);
    expect(s.state).toBe('exited');
  });

  test('unknown id throws', async () => {
    const registry = makeRegistry();
    await expect(
      dispatchTerminalModalKill({ id: 'nope' }, { registry }),
    ).rejects.toThrow(/unknown/);
  });
});

describe('catalog registration', () => {
  test('all 5 surviving terminal_modal tools registered with node-pty probe', async () => {
    const { nativeToolCatalog } = await import('../src/native-tool-catalog.js');
    for (const id of ['terminal_modal_list', 'terminal_modal_observe', 'terminal_modal_focus', 'terminal_modal_detach', 'terminal_modal_kill']) {
      const e = nativeToolCatalog.find(t => t.id === id);
      expect(e).toBeDefined();
      expect(e!.probe?.kind).toBe('custom');
      expect(e!.probe?.onFail).toBe('hide');
    }
  });

  test('terminal_modal_spawn is NO LONGER registered (NT-C3)', async () => {
    const { nativeToolCatalog } = await import('../src/native-tool-catalog.js');
    expect(nativeToolCatalog.find(t => t.id === 'terminal_modal_spawn')).toBeUndefined();
  });

  test('focus + kill are minTier T2', async () => {
    const { nativeToolCatalog } = await import('../src/native-tool-catalog.js');
    expect(nativeToolCatalog.find(t => t.id === 'terminal_modal_focus')?.minTier).toBe('T2');
    expect(nativeToolCatalog.find(t => t.id === 'terminal_modal_kill')?.minTier).toBe('T2');
  });
});

// Just assert schemas are well-formed so the JSON catalog doesn't
// drift.
describe('tool schemas', () => {
  test('all 5 surviving build* return objects with parameters', () => {
    const tools = [
      buildTerminalModalListTool(),
      buildTerminalModalObserveTool(),
      buildTerminalModalFocusTool(),
      buildTerminalModalDetachTool(),
      buildTerminalModalKillTool(),
    ];
    for (const t of tools) {
      expect(typeof t.name).toBe('string');
      expect(t.parameters.type).toBe('object');
    }
  });
});
