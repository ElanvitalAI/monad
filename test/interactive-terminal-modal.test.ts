import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  createInteractiveTerminalModal,
  computeDefaultBounds,
  INTERACTIVE_MIN_COLS,
  INTERACTIVE_MIN_ROWS,
} from '../src/interactive-terminal-modal.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import type { PreviewTerminal } from '../src/preview/terminal.js';

/** Minimal PreviewTerminal stand-in. Exposes exactly what the
 *  interactive modal needs: start/stop/write/resize/render +
 *  cursorPosition. No real PTY; records writes for assertions. */
function fakePreview(opts: { cols: number; rows: number; cwd: string; onUpdate?: () => void; onExit?: (code: number) => void }): PreviewTerminal {
  let alive = false;
  let cursorRow = 0;
  let cursorCol = 0;
  const writes: string[] = [];
  const pt = {
    _writes: writes,
    start: () => { alive = true; },
    stop: () => { alive = false; },
    write: (bytes: string) => { writes.push(bytes); cursorCol += bytes.length; },
    resize: (_c: number, _r: number) => {},
    render: (_focused?: boolean) =>
      Array.from({ length: opts.rows }, (_v, i) => `row${i} `).join('\n'),
    cursorPosition: () => alive ? ({ row: cursorRow, col: cursorCol }) : null,
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
    _moveCursor: (r: number, c: number) => { cursorRow = r; cursorCol = c; },
  };
  return pt as unknown as PreviewTerminal;
}

beforeEach(() => {
  // no-op; each test builds its own coordinator
});

afterEach(() => {
  // no-op
});

describe('computeDefaultBounds', () => {
  test('85% of termCols × termRows, centered', () => {
    const b = computeDefaultBounds(100, 30);
    expect(b.width).toBe(85);
    expect(b.height).toBe(25);
    expect(b.col).toBe(Math.floor((100 - 85) / 2) + 1);
    expect(b.row).toBe(Math.floor((30 - 25) / 2) + 1);
  });

  test('falls back to fullscreen on terminals smaller than min', () => {
    // Pre-fix this test expected `width >= INTERACTIVE_MIN_COLS` on a
    // 30-col screen, which was precisely the bug — the modal painted
    // off the right edge and wrapped, so users reported "the modal
    // doesn't open". The correct behavior is to never exceed the
    // terminal; fall back to fullscreen when the min wouldn't fit.
    const b = computeDefaultBounds(30, 6);
    expect(b.col + b.width - 1).toBeLessThanOrEqual(30);
    expect(b.row + b.height - 1).toBeLessThanOrEqual(6);
    // Still paintable — paintModal bails below 4x3.
    expect(b.width).toBeGreaterThanOrEqual(4);
    expect(b.height).toBeGreaterThanOrEqual(3);
  });
});

describe('createInteractiveTerminalModal', () => {
  test('registers modal in coordinator + starts preview', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    let started = false;
    const handle = createInteractiveTerminalModal(
      { title: 'Test', cwd: '/tmp' },
      {
        coordinator: coord,
        termCols: 100,
        termRows: 30,
        terminalFactory: (o) => {
          const pt = fakePreview({ cols: o.cols, rows: o.rows, cwd: o.cwd });
          const origStart = pt.start.bind(pt);
          pt.start = () => { started = true; origStart(); };
          return pt;
        },
      },
    );
    expect(started).toBe(true);
    expect(coord.modalStack()).toContain(handle.id);
    expect(handle.isAlive()).toBe(true);
  });

  test('dispose stops preview + removes modal', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    let stopped = false;
    const handle = createInteractiveTerminalModal(
      { title: 'T', cwd: '/tmp' },
      {
        coordinator: coord,
        termCols: 100,
        termRows: 30,
        terminalFactory: (o) => {
          const pt = fakePreview({ cols: o.cols, rows: o.rows, cwd: o.cwd });
          const orig = pt.stop.bind(pt);
          pt.stop = () => { stopped = true; orig(); };
          return pt;
        },
      },
    );
    handle.dispose();
    expect(stopped).toBe(true);
    expect(coord.modalStack()).not.toContain(handle.id);
    expect(handle.isAlive()).toBe(false);
  });

  test('write() forwards bytes to preview', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    let capturedWrites: string[] = [];
    const handle = createInteractiveTerminalModal(
      { title: 'T', cwd: '/tmp' },
      {
        coordinator: coord,
        termCols: 100,
        termRows: 30,
        terminalFactory: (o) => {
          const pt = fakePreview({ cols: o.cols, rows: o.rows, cwd: o.cwd }) as PreviewTerminal & { _writes: string[] };
          capturedWrites = pt._writes;
          return pt;
        },
      },
    );
    handle.write('hello\r');
    expect(capturedWrites).toContain('hello\r');
  });

  test('command spec types into PTY on start (with trailing CR)', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    let capturedWrites: string[] = [];
    createInteractiveTerminalModal(
      { title: 'T', cwd: '/tmp', command: 'ls' },
      {
        coordinator: coord,
        termCols: 100,
        termRows: 30,
        terminalFactory: (o) => {
          const pt = fakePreview({ cols: o.cols, rows: o.rows, cwd: o.cwd }) as PreviewTerminal & { _writes: string[] };
          capturedWrites = pt._writes;
          return pt;
        },
      },
    );
    expect(capturedWrites).toContain('ls\r');
  });

  test('cursor() returns bounds-offset absolute coords', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    let fakePT: any = null;
    const handle = createInteractiveTerminalModal(
      { title: 'T', cwd: '/tmp' },
      {
        coordinator: coord,
        termCols: 100,
        termRows: 30,
        terminalFactory: (o) => {
          const pt = fakePreview({ cols: o.cols, rows: o.rows, cwd: o.cwd }) as any;
          fakePT = pt;
          return pt;
        },
      },
    );
    fakePT._moveCursor(3, 5);
    const c = handle.surface.cursor!();
    // bounds interior starts at bounds.row+1, bounds.col+1
    expect(c).not.toBeNull();
    expect(c!.row).toBe(handle.bounds.row + 1 + 3);
    expect(c!.col).toBe(handle.bounds.col + 1 + 5);
    expect(c!.visible).toBe(true);
  });

  test('onKey forwards converted bytes', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    let capturedWrites: string[] = [];
    const handle = createInteractiveTerminalModal(
      { title: 'T', cwd: '/tmp' },
      {
        coordinator: coord,
        termCols: 100,
        termRows: 30,
        terminalFactory: (o) => {
          const pt = fakePreview({ cols: o.cols, rows: o.rows, cwd: o.cwd }) as PreviewTerminal & { _writes: string[] };
          capturedWrites = pt._writes;
          return pt;
        },
      },
    );
    const action = handle.surface.onKey!({ name: 'enter' });
    expect(action.type).toBe('refresh');
    expect(capturedWrites).toContain('\r');
  });

  test('paint output contains title + border glyphs', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const handle = createInteractiveTerminalModal(
      { title: 'Live Shell', cwd: '/tmp' },
      {
        coordinator: coord,
        termCols: 120,
        termRows: 40,
        terminalFactory: (o) => fakePreview({ cols: o.cols, rows: o.rows, cwd: o.cwd }),
      },
    );
    const paint = (handle.surface.paint as () => string)();
    expect(paint).toContain('Live Shell');
    expect(paint).toContain('╭');
    expect(paint).toContain('╯');
  });

  test('title rail mouse hit is classified as modal-title', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const handle = createInteractiveTerminalModal(
      { title: 'Live Shell', cwd: '/tmp', bounds: { row: 4, col: 8, width: 30, height: 10 } },
      {
        coordinator: coord,
        termCols: 120,
        termRows: 40,
        terminalFactory: (o) => fakePreview({ cols: o.cols, rows: o.rows, cwd: o.cwd }),
      },
    );
    const ev = { type: 'click', row: 4, col: 12 } as any;
    expect(handle.surface.onMouse?.(ev)).toEqual({ type: 'refresh' });
    expect(ev.hitTarget).toEqual({ kind: 'modal-title', modalId: handle.id });
  });

  test('enterFullscreen + exitFullscreen toggles bounds', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const handle = createInteractiveTerminalModal(
      { title: 'T', cwd: '/tmp' },
      {
        coordinator: coord,
        termCols: 100,
        termRows: 30,
        terminalFactory: (o) => fakePreview({ cols: o.cols, rows: o.rows, cwd: o.cwd }),
      },
    );
    expect(handle.isFullscreen(100, 30)).toBe(false);
    handle.enterFullscreen(100, 30);
    expect(handle.bounds.row).toBe(1);
    expect(handle.bounds.col).toBe(1);
    expect(handle.bounds.width).toBe(100);
    expect(handle.bounds.height).toBe(30);
    expect(handle.isFullscreen(100, 30)).toBe(true);
    handle.exitFullscreen(100, 30);
    expect(handle.isFullscreen(100, 30)).toBe(false);
    // Back to 85% default.
    expect(handle.bounds.width).toBe(85);
  });

  test('setBounds mirrors new bounds on surface.bounds getter', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const handle = createInteractiveTerminalModal(
      { title: 'T', cwd: '/tmp' },
      {
        coordinator: coord,
        termCols: 100,
        termRows: 30,
        terminalFactory: (o) => fakePreview({ cols: o.cols, rows: o.rows, cwd: o.cwd }),
      },
    );
    handle.setBounds({ row: 5, col: 5, width: 50, height: 20 }, 100, 30);
    expect(handle.surface.bounds.row).toBe(5);
    expect(handle.surface.bounds.width).toBe(50);
  });

  // Regression: cold-launch modal shows a "Starting <title>…"
  // placeholder until the PreviewTerminal emits its first onUpdate.
  // This eliminates the 1-2s blank-modal window during shell startup
  // (zsh+p10k for plain shell, +keychain unlock+claude bootstrap
  // for /claude). Per user feedback: "popup 터미널 모드, claude,
  // codex 등 1초 이상 delay 가 걸리는데 빠르게 ‘Start Terminal’ 안내
  // 팝업을 띄우고 바로 실제 런치 되자마자 dispose 하고 전환."
  test('cold-launch paint shows Starting placeholder until first onUpdate', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    let updateHook: (() => void) | undefined;
    const handle = createInteractiveTerminalModal(
      { title: 'claude-code', cwd: '/tmp' },
      {
        coordinator: coord,
        termCols: 100,
        termRows: 30,
        terminalFactory: (o) => {
          updateHook = o.onUpdate;
          return fakePreview({
            cols: o.cols, rows: o.rows, cwd: o.cwd, onUpdate: o.onUpdate,
          });
        },
      },
    );

    // Pre-output: paint shows the placeholder banner.
    const before = (handle.surface.paint as () => string)();
    expect(before).toContain('Information');           // banner
    expect(before).toContain('STARTING');              // headline
    expect(before).toContain('claude-code');           // subject (also in border title)
    expect(before).toContain('cold start may take');   // hint
    // The fakePreview's row pattern (e.g. "row0") must NOT be in the
    // grid yet — the placeholder replaces the cold grid until first
    // onUpdate.
    expect(before).not.toContain('row0 ');

    // Fire the first onUpdate as if the PTY just emitted bytes.
    expect(updateHook).toBeDefined();
    updateHook!();

    // Post-output: paint switches to the real PreviewTerminal grid.
    const after = (handle.surface.paint as () => string)();
    expect(after).not.toContain('STARTING');
    expect(after).not.toContain('Information');
    expect(after).toContain('row0 ');

    handle.dispose();
  });

  // Re-attach path (session resume) skips the placeholder — the
  // PreviewTerminal already has output from the prior session, so a
  // "Starting…" overlay would be misleading.
  test('attachedToExisting skips Starting placeholder', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const existing = fakePreview({ cols: 60, rows: 20, cwd: '/tmp' });
    const handle = createInteractiveTerminalModal(
      { title: 'reattached', cwd: '/tmp' },
      {
        coordinator: coord,
        termCols: 100,
        termRows: 30,
        existingPreview: existing,
      },
    );

    const paint = (handle.surface.paint as () => string)();
    expect(paint).not.toContain('STARTING');
    expect(paint).not.toContain('Information');
    expect(paint).toContain('row0 ');

    handle.dispose({ keepPreview: true });
  });

  // Regression: BrowserPreview-style title-bar controls. When
  // `onTitleAction` is provided, the running-state paint includes
  // [─] (minimize) and [✕] (close) in the right edge of the title
  // rail. Clicks dispatch through onTitleAction to the host so it
  // can map to detach / kill operations.
  test('title controls render + clicks dispatch onTitleAction', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const actions: string[] = [];
    let updateHook: (() => void) | undefined;
    const handle = createInteractiveTerminalModal(
      {
        title: 'Live Shell',
        cwd: '/tmp',
        bounds: { row: 4, col: 8, width: 60, height: 20 },
        onTitleAction: (action) => { actions.push(action); },
      },
      {
        coordinator: coord,
        termCols: 100,
        termRows: 30,
        terminalFactory: (o) => {
          updateHook = o.onUpdate;
          return fakePreview({ cols: o.cols, rows: o.rows, cwd: o.cwd });
        },
      },
    );

    // Trigger first onUpdate so paint switches to running state
    // (controls are NOT shown during the placeholder). The pre-output
    // paint uses the centered fallback layout per spec.
    expect(updateHook).toBeDefined();
    updateHook!();

    const paint = (handle.surface.paint as () => string)();
    // Heavy block bars + control glyphs in the top row.
    expect(paint).toContain('█');
    expect(paint).toContain('⎘');   // copy
    expect(paint).toContain('─');   // minimize
    expect(paint).toContain('✕');   // close
    // Title prefix glyph is present.
    expect(paint).toContain('⏵');

    // Heavy-bar layout: `…██ [ ⎘ ] [ ─ ] [ ✕ ]` — `]` of close at
    // col+width-1; mids: ✕ at col+width-3, ─ at col+width-9, ⎘ at
    // col+width-15.
    const closeCol = handle.bounds.col + handle.bounds.width - 3;
    const minCol = handle.bounds.col + handle.bounds.width - 9;
    const copyCol = handle.bounds.col + handle.bounds.width - 15;

    // Click on the [⎘] — copy action fires.
    handle.surface.onMouse?.({ type: 'click', row: handle.bounds.row, col: copyCol } as never);
    expect(actions).toEqual(['copy']);
    actions.length = 0;

    // Click on the [─] — minimize action fires.
    handle.surface.onMouse?.({ type: 'click', row: handle.bounds.row, col: minCol } as never);
    expect(actions).toEqual(['minimize']);

    // Click on the [✕] — close action fires.
    handle.surface.onMouse?.({ type: 'click', row: handle.bounds.row, col: closeCol } as never);
    expect(actions).toEqual(['minimize', 'close']);

    // Regression: click on the absolute last column (the `]` cell of
    // the close button) must also fire close. The previous
    // isInteractiveTerminalTitleRailHit excluded col + width - 1
    // assuming a `╮` corner there — but the new heavy-bar layout
    // anchors the close button's `]` at exactly that column.
    const lastCol = handle.bounds.col + handle.bounds.width - 1;
    handle.surface.onMouse?.({ type: 'click', row: handle.bounds.row, col: lastCol } as never);
    expect(actions).toEqual(['minimize', 'close', 'close']);

    handle.dispose();
  });

  test('title close action can opt into shared dispose behavior', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    let updateHook: (() => void) | undefined;
    const actions: string[] = [];
    const handle = createInteractiveTerminalModal(
      {
        title: 'Live Shell',
        cwd: '/tmp',
        bounds: { row: 4, col: 8, width: 60, height: 20 },
        onTitleAction: (action) => {
          actions.push(action);
          return action === 'close' ? 'dispose' : 'keep-open';
        },
      },
      {
        coordinator: coord,
        termCols: 100,
        termRows: 30,
        terminalFactory: (o) => {
          updateHook = o.onUpdate;
          return fakePreview({ cols: o.cols, rows: o.rows, cwd: o.cwd });
        },
      },
    );

    updateHook!();
    const closeCol = handle.bounds.col + handle.bounds.width - 3;
    handle.surface.onMouse?.({ type: 'click', row: handle.bounds.row, col: closeCol } as never);

    expect(actions).toEqual(['close']);
    expect(handle.isAlive()).toBe(false);
    expect(coord.modalStack()).not.toContain(handle.id);
  });

  // Defensive: dispose during placeholder state must clear the
  // spinner timer (otherwise it keeps requesting renders for a
  // disposed modal).
  test('dispose during placeholder stops the spinner cleanly', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const handle = createInteractiveTerminalModal(
      { title: 'cold-disposed', cwd: '/tmp' },
      {
        coordinator: coord,
        termCols: 100,
        termRows: 30,
        terminalFactory: (o) => fakePreview({ cols: o.cols, rows: o.rows, cwd: o.cwd }),
      },
    );

    // Verify the placeholder is active first.
    expect((handle.surface.paint as () => string)()).toContain('STARTING');
    handle.dispose();
    expect(handle.isAlive()).toBe(false);
    // Subsequent paint returns empty (alive guard).
    expect((handle.surface.paint as () => string)()).toBe('');
  });

  test('snapshot returns render output', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const handle = createInteractiveTerminalModal(
      { title: 'T', cwd: '/tmp' },
      {
        coordinator: coord,
        termCols: 100,
        termRows: 30,
        terminalFactory: (o) => fakePreview({ cols: o.cols, rows: o.rows, cwd: o.cwd }),
      },
    );
    const snap = handle.snapshot();
    expect(snap).toContain('row0');
  });
});
