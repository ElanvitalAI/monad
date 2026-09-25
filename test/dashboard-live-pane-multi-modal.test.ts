import { afterEach, describe, expect, test } from 'bun:test';
import {
  MIN_WIDE_WIDTH,
  _resetPaneMultiModalsForTesting,
  showLivePaneMultiModal,
  type WidgetHostLike,
} from '../src/dashboard/modals/pane-multi.js';
import type { DisplayCoordinator } from '../src/display/coordinator.js';
import type { ModalSurface } from '../src/display/modal-stack.js';
import type { DisplayMouseEvent, KeyEvent } from '../src/display/types.js';
import type { WidgetDef, WidgetInstance } from '../src/widgets/types.js';
import { createLayerTree } from '../src/primitives/layer-tree/index.js';
import { createRenderCoordinator } from '../src/primitives/render-coordinator/index.js';
import { MONAD_PASTEL_DEFAULT } from '../src/themes/monad-pastel-default.js';

// ── Stubs ───────────────────────────────────────────────────────────

function makeStubCoordinator() {
  const modals: ModalSurface[] = [];
  let nextId = 1;
  // H2.3 — chrome-layer primitive mounts into the coordinator's
  // LayerTree + RenderCoordinator on showLivePaneMultiModal. Stub
  // them with real primitive instances (same factories the coord
  // uses internally) so the fake DisplayCoordinator surfaces the
  // same API the production code expects.
  const layerTree = createLayerTree();
  const renderCoordinator = createRenderCoordinator();
  const coord = {
    pushModal(surface: ModalSurface) {
      modals.push(surface);
      const idStr = `surface-${nextId++}`;
      return {
        id: idStr as any,
        dispose: () => {
          const idx = modals.indexOf(surface);
          if (idx >= 0) modals.splice(idx, 1);
        },
      };
    },
    layerTreeAPI: () => layerTree,
    renderCoordinatorAPI: () => renderCoordinator,
  } as unknown as DisplayCoordinator;
  return { coord, modals, layerTree, renderCoordinator };
}

interface StubState {
  rows: string[];
  cursor: number;
}

function makeStubWidget(renderLines: (state: StubState) => string[]): WidgetDef<StubState> {
  return {
    type: 'stub',
    description: 'stub widget',
    initialState: () => ({ rows: [], cursor: 0 }),
    render: (state: StubState, _ctx, _char) => ['stub-title', ...renderLines(state)],
    onKey: (ev: KeyEvent, state: StubState, _ctx) => {
      if (ev.name === 'j') return { type: 'refresh' };
      if (ev.name === 'enter') return { type: 'submit', text: state.rows[state.cursor] ?? '' };
      return { type: 'none' };
    },
    onMouse: (ev, _state, _ctx) => {
      if (ev.type === 'click') return { type: 'refresh' };
      if (ev.type === 'scroll-up') return { type: 'focus', pane: 'preview' as any };
      return { type: 'none' };
    },
  };
}

function makeWidgetHost(entries: Array<{ id: string; inst: WidgetInstance<StubState>; def: WidgetDef<StubState> }>): WidgetHostLike {
  const byId = new Map(entries.map(e => [e.id, e]));
  return {
    get: (id: string) => byId.get(id)?.inst ?? null,
    defFor: (id: string) => byId.get(id)?.def ?? null,
  } as WidgetHostLike;
}

// ── Tests ───────────────────────────────────────────────────────────

describe('showLivePaneMultiModal (Track A · live-widget modal)', () => {
  afterEach(() => _resetPaneMultiModalsForTesting());

  test('paint() calls widget.render per frame — state changes reflect immediately', () => {
    const { coord, modals } = makeStubCoordinator();
    const state1: StubState = { rows: ['a.ts', 'b.ts'], cursor: 0 };
    const def = makeStubWidget((s) => s.rows);
    const inst: WidgetInstance<StubState> = { id: 'w1', type: 'stub', character: 'X', state: state1 };
    const host = makeWidgetHost([
      { id: 'w1', inst, def },
      { id: 'w2', inst: { ...inst, id: 'w2', state: { rows: ['p1', 'p2'], cursor: 0 } }, def },
    ]);

    const handle = showLivePaneMultiModal({
      title: 'Live 2x1',
      columns: [
        { widgetInstanceId: 'w1', title: 'Column A' },
        { widgetInstanceId: 'w2', title: 'Column B' },
      ],
      widgetHost: host,
      coordinator: coord,
      termCols: 140,
      termRows: 36,
    });

    expect(handle.columnCount).toBe(2);
    expect(modals.length).toBe(1);

    const frame1 = modals[0]!.paint!();
    expect(frame1).toContain('a.ts');
    expect(frame1).toContain('b.ts');
    expect(frame1).toContain('p1');
    expect(frame1).toContain('p2');

    // Mutate state — next paint should show new content (live!).
    state1.rows = ['c.ts', 'd.ts'];
    const frame2 = modals[0]!.paint!();
    expect(frame2).toContain('c.ts');
    expect(frame2).not.toContain('a.ts');
  });

  test('onKey forwards to focused column widget', () => {
    const { coord, modals } = makeStubCoordinator();
    let keyReceivedBy: string | null = null;
    const defW1: WidgetDef<StubState> = {
      ...makeStubWidget(s => s.rows),
      onKey: (ev) => {
        if (ev.name === 'j') { keyReceivedBy = 'w1'; return { type: 'refresh' }; }
        return { type: 'none' };
      },
    };
    const defW2: WidgetDef<StubState> = {
      ...makeStubWidget(s => s.rows),
      onKey: (ev) => {
        if (ev.name === 'j') { keyReceivedBy = 'w2'; return { type: 'refresh' }; }
        return { type: 'none' };
      },
    };
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: ['1'], cursor: 0 } }, def: defW1 },
      { id: 'w2', inst: { id: 'w2', type: 'stub', character: 'B', state: { rows: ['2'], cursor: 0 } }, def: defW2 },
    ]);
    const handle = showLivePaneMultiModal({
      title: 't',
      columns: [
        { widgetInstanceId: 'w1', title: 'A' },
        { widgetInstanceId: 'w2', title: 'B' },
      ],
      widgetHost: host,
      coordinator: coord,
      termCols: 140, termRows: 36,
    });
    // First paint to establish column bounds.
    modals[0]!.paint!();

    // Initial focus = 0 → 'j' should go to w1.
    const res1 = (modals[0] as any).onKey({ name: 'j' });
    expect(keyReceivedBy).toBe('w1');
    expect(res1).toBe('consumed');

    // Tab → focus = 1 → 'j' should go to w2.
    keyReceivedBy = null;
    const tabRes = (modals[0] as any).onKey({ name: 'tab' });
    expect(tabRes).toBe('consumed');
    expect(handle.focusedColumn()).toBe(1);

    (modals[0] as any).onKey({ name: 'j' });
    expect(keyReceivedBy).toBe('w2');
  });

  test('Shift+Tab cycles backward', () => {
    const { coord, modals } = makeStubCoordinator();
    const def = makeStubWidget(s => s.rows);
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: [], cursor: 0 } }, def },
      { id: 'w2', inst: { id: 'w2', type: 'stub', character: 'B', state: { rows: [], cursor: 0 } }, def },
      { id: 'w3', inst: { id: 'w3', type: 'stub', character: 'C', state: { rows: [], cursor: 0 } }, def },
    ]);
    const handle = showLivePaneMultiModal({
      title: 't',
      columns: [
        { widgetInstanceId: 'w1', title: 'A' },
        { widgetInstanceId: 'w2', title: 'B' },
        { widgetInstanceId: 'w3', title: 'C' },
      ],
      widgetHost: host,
      coordinator: coord,
      termCols: 160, termRows: 36,
    });
    expect(handle.focusedColumn()).toBe(0);
    (modals[0] as any).onKey({ name: 'tab', shift: true });
    expect(handle.focusedColumn()).toBe(2); // wraps 0 → 2
    (modals[0] as any).onKey({ name: 'tab', shift: true });
    expect(handle.focusedColumn()).toBe(1);
  });

  test('Esc calls onCancel and consumes the key', () => {
    const { coord, modals } = makeStubCoordinator();
    const def = makeStubWidget(s => s.rows);
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: [], cursor: 0 } }, def },
    ]);
    let cancelled = 0;
    showLivePaneMultiModal({
      title: 't',
      columns: [{ widgetInstanceId: 'w1', title: 'A' }],
      widgetHost: host,
      coordinator: coord,
      termCols: 120,
      termRows: 30,
      onCancel: () => { cancelled++; },
    });
    const res = (modals[0] as any).onKey({ name: 'escape' });
    expect(res).toBe('consumed');
    expect(cancelled).toBe(1);
  });

  test('onMouse click switches focus to the clicked column + forwards widget-local coords', () => {
    const { coord, modals } = makeStubCoordinator();
    let mouseReceived: { id: string; row: number; col: number } | null = null;
    const mkDef = (id: string): WidgetDef<StubState> => ({
      ...makeStubWidget(s => s.rows),
      onMouse: (ev) => {
        if (ev.type === 'click') {
          mouseReceived = { id, row: ev.row, col: ev.col };
          return { type: 'refresh' };
        }
        return { type: 'none' };
      },
    });
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: [], cursor: 0 } }, def: mkDef('w1') },
      { id: 'w2', inst: { id: 'w2', type: 'stub', character: 'B', state: { rows: [], cursor: 0 } }, def: mkDef('w2') },
    ]);
    const handle = showLivePaneMultiModal({
      title: 't',
      columns: [
        { widgetInstanceId: 'w1', title: 'A' },
        { widgetInstanceId: 'w2', title: 'B' },
      ],
      widgetHost: host,
      coordinator: coord,
      termCols: 140, termRows: 36,
    });
    // paint to register bounds.
    modals[0]!.paint!();
    const b = handle.bounds;
    // Absolute col that falls inside column B (the right half). Use
    // a row inside content rows (row + 4 = first content row).
    const absCol = b.col + Math.floor((b.width / 2)) + 5;
    const absRow = b.row + 5;
    (modals[0] as any).onMouse({ type: 'click', row: absRow, col: absCol, shift: false });
    expect(mouseReceived).not.toBeNull();
    expect(mouseReceived!.id).toBe('w2');
    // Widget-local col must be ≥ 0.
    expect(mouseReceived!.col).toBeGreaterThanOrEqual(0);
    expect(handle.focusedColumn()).toBe(1);
  });

  test('motion over a different cell switches focused column without click', () => {
    const { coord, modals } = makeStubCoordinator();
    const def = makeStubWidget(s => s.rows);
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: ['a'], cursor: 0 } }, def },
      { id: 'w2', inst: { id: 'w2', type: 'stub', character: 'B', state: { rows: ['b'], cursor: 0 } }, def },
    ]);
    const handle = showLivePaneMultiModal({
      title: 't',
      columns: [
        { widgetInstanceId: 'w1', title: 'A' },
        { widgetInstanceId: 'w2', title: 'B' },
      ],
      widgetHost: host,
      coordinator: coord,
      termCols: 140,
      termRows: 36,
    });
    modals[0]!.paint!();
    const b = handle.bounds;
    const absCol = b.col + Math.floor((b.width / 2)) + 5;
    const absRow = b.row + 5;
    expect((modals[0] as any).onMouse({ type: 'motion', row: absRow, col: absCol, shift: false })).toEqual({ type: 'refresh' });
    expect(handle.focusedColumn()).toBe(1);
  });

  test('title rail click is classified as modal-title before widget dispatch', () => {
    const { coord, modals } = makeStubCoordinator();
    const def = makeStubWidget(s => s.rows);
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: ['1'], cursor: 0 } }, def },
      { id: 'w2', inst: { id: 'w2', type: 'stub', character: 'B', state: { rows: ['2'], cursor: 0 } }, def },
    ]);
    const handle = showLivePaneMultiModal({
      title: 't',
      columns: [
        { widgetInstanceId: 'w1', title: 'A' },
        { widgetInstanceId: 'w2', title: 'B' },
      ],
      widgetHost: host,
      coordinator: coord,
      termCols: 140,
      termRows: 36,
      chrome: {
        theme: MONAD_PASTEL_DEFAULT,
        titleControls: [{ id: 'close', label: '✕' }],
      },
    });
    modals[0]!.paint!();
    const ev: any = { type: 'click', row: handle.bounds.row, col: handle.bounds.col + 4 };
    expect((modals[0] as any).onMouse(ev)).toEqual({ type: 'refresh' });
    expect(ev.hitTarget).toEqual({ kind: 'modal-title', modalId: handle.id });
  });

  test('title rail hit follows moved visual bounds after modal reposition', () => {
    const { coord, modals } = makeStubCoordinator();
    const def = makeStubWidget(s => s.rows);
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: ['1'], cursor: 0 } }, def },
    ]);
    const handle = showLivePaneMultiModal({
      title: 'Debug Events',
      columns: [{ widgetInstanceId: 'w1', title: 'events' }],
      widgetHost: host,
      coordinator: coord,
      termCols: 140,
      termRows: 36,
      chrome: {
        theme: MONAD_PASTEL_DEFAULT,
        titleControls: [{ id: 'close', label: '✕' }],
      },
    });
    modals[0]!.paint!();
    (modals[0] as any).interactiveBounds = {
      ...(modals[0] as any).interactiveBounds,
      row: handle.bounds.row + 9,
    };
    (modals[0] as any).visualBounds = {
      ...(modals[0] as any).visualBounds,
      row: handle.bounds.row + 9,
    };
    const ev: any = { type: 'click', row: handle.bounds.row + 9, col: handle.bounds.col + 4 };
    expect((modals[0] as any).onMouse(ev)).toEqual({ type: 'refresh' });
    expect(ev.hitTarget).toEqual({ kind: 'modal-title', modalId: handle.id });
    const frame = modals[0]!.paint!();
    expect(frame).toContain(`\u001b[${handle.bounds.row + 9};${handle.bounds.col}H`);
  });

  test('onMouse right-click delegates to column onRightClick hook', () => {
    const { coord, modals } = makeStubCoordinator();
    const def = makeStubWidget(s => s.rows);
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: ['a'], cursor: 0 } }, def },
    ]);
    let rightClicks = 0;
    const handle = showLivePaneMultiModal({
      title: 't',
      columns: [{
        widgetInstanceId: 'w1',
        title: 'A',
        onRightClick: () => {
          rightClicks++;
          return { type: 'refresh' };
        },
      }],
      widgetHost: host,
      coordinator: coord,
      termCols: 120,
      termRows: 30,
    });
    modals[0]!.paint!();
    const res = (modals[0] as any).onMouse({
      type: 'right-click',
      row: handle.bounds.row + 5,
      col: handle.bounds.col + 5,
      shift: false,
    });
    expect(res).toEqual({ type: 'refresh' });
    expect(rightClicks).toBe(1);
  });

  test('narrow-fallback (<80 cols) collapses to first column only', () => {
    const { coord, modals } = makeStubCoordinator();
    const def = makeStubWidget(s => s.rows);
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: ['only'], cursor: 0 } }, def },
      { id: 'w2', inst: { id: 'w2', type: 'stub', character: 'B', state: { rows: ['skipped'], cursor: 0 } }, def },
    ]);
    const handle = showLivePaneMultiModal({
      title: 't',
      columns: [
        { widgetInstanceId: 'w1', title: 'A' },
        { widgetInstanceId: 'w2', title: 'B' },
      ],
      widgetHost: host,
      coordinator: coord,
      termCols: 50, termRows: 20,
    });
    expect(handle.columnCount).toBe(1);
    const frame = modals[0]!.paint!();
    expect(frame).toContain('only');
    expect(frame).not.toContain('skipped');
  });

  test('W5 — 2x2 layout paints four live cells and keeps matrix focus order', () => {
    const { coord, modals } = makeStubCoordinator();
    const def = makeStubWidget(s => s.rows);
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: ['a1'], cursor: 0 } }, def },
      { id: 'w2', inst: { id: 'w2', type: 'stub', character: 'B', state: { rows: ['b1'], cursor: 0 } }, def },
      { id: 'w3', inst: { id: 'w3', type: 'stub', character: 'C', state: { rows: ['c1'], cursor: 0 } }, def },
      { id: 'w4', inst: { id: 'w4', type: 'stub', character: 'D', state: { rows: ['d1'], cursor: 0 } }, def },
    ]);
    const handle = showLivePaneMultiModal({
      title: 'Quad',
      layoutMode: '2x2',
      columns: [
        { widgetInstanceId: 'w1', title: 'A' },
        { widgetInstanceId: 'w2', title: 'B' },
        { widgetInstanceId: 'w3', title: 'C' },
        { widgetInstanceId: 'w4', title: 'D' },
      ],
      widgetHost: host,
      coordinator: coord,
      termCols: 160,
      termRows: 40,
    });

    const frame = modals[0]!.paint!();
    const plain = frame.replace(/\x1b\[[0-9;]*m/g, '');
    expect(plain).toContain('a1');
    expect(plain).toContain('b1');
    expect(plain).toContain('c1');
    expect(plain).toContain('d1');
    expect(plain).toContain('┼');

    expect(handle.focusedColumn()).toBe(0);
    (modals[0] as any).onKey({ name: 'tab' });
    expect(handle.focusedColumn()).toBe(1);
    (modals[0] as any).onKey({ name: 'tab' });
    expect(handle.focusedColumn()).toBe(2);
  });

  test('missing widget instance paints placeholder without crashing', () => {
    const { coord, modals } = makeStubCoordinator();
    const host = makeWidgetHost([]); // no entries — all lookups null
    showLivePaneMultiModal({
      title: 't',
      columns: [
        { widgetInstanceId: 'ghost-1', title: 'A' },
        { widgetInstanceId: 'ghost-2', title: 'B' },
      ],
      widgetHost: host,
      coordinator: coord,
      termCols: 140, termRows: 36,
    });
    const frame = modals[0]!.paint!();
    expect(frame).toContain("widget 'ghost-1' not mounted");
    expect(frame).toContain("widget 'ghost-2' not mounted");
  });

  test('widget render exception is caught — paint emits error placeholder', () => {
    const { coord, modals } = makeStubCoordinator();
    const def: WidgetDef<StubState> = {
      ...makeStubWidget(() => []),
      render: () => { throw new Error('boom'); },
    };
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: [], cursor: 0 } }, def },
    ]);
    showLivePaneMultiModal({
      title: 't',
      columns: [{ widgetInstanceId: 'w1', title: 'A' }],
      widgetHost: host,
      coordinator: coord,
      termCols: 120, termRows: 30,
    });
    const frame = modals[0]!.paint!();
    expect(frame).toContain('render error: boom');
  });

  test('onDispose fires once + group singleton replacement', () => {
    const { coord, modals } = makeStubCoordinator();
    const def = makeStubWidget(s => s.rows);
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: [], cursor: 0 } }, def },
    ]);
    let disposeCalls = 0;
    const h1 = showLivePaneMultiModal({
      title: 'first',
      columns: [{ widgetInstanceId: 'w1', title: 'A' }],
      widgetHost: host,
      coordinator: coord,
      termCols: 120, termRows: 30,
      onDispose: () => { disposeCalls++; },
    });
    // Same group — second call should dispose first.
    showLivePaneMultiModal({
      title: 'second',
      columns: [{ widgetInstanceId: 'w1', title: 'A' }],
      widgetHost: host,
      coordinator: coord,
      termCols: 120, termRows: 30,
    });
    expect(disposeCalls).toBe(1);
    expect(modals.length).toBe(1);
    h1.dispose(); // already disposed — idempotent
    expect(disposeCalls).toBe(1);
  });

  test('backdrop — paint() fills every terminal row with a moveTo so underlying chrome cannot bleed through', () => {
    const { coord, modals } = makeStubCoordinator();
    const def = makeStubWidget(s => s.rows);
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: [], cursor: 0 } }, def },
    ]);
    const termCols = 120, termRows = 30;
    showLivePaneMultiModal({
      title: 't',
      columns: [{ widgetInstanceId: 'w1', title: 'A' }],
      widgetHost: host,
      coordinator: coord,
      termCols, termRows,
    });
    const frame = modals[0]!.paint!();
    for (let r = 1; r <= termRows; r++) {
      // ANSI CSI row;1 H cursor move — one per row at the backdrop
      // start. The modal's own rows add further moveTos later in the
      // string, but each backdrop row's leading moveTo must appear
      // before any content for that row.
      expect(frame).toContain(`\x1b[${r};1H`);
    }
  });

  test('surface.bounds — covers the full terminal so V4 dispose invalidation repaints every backdrop row', () => {
    const { coord, modals } = makeStubCoordinator();
    const def = makeStubWidget(() => []);
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: [], cursor: 0 } }, def },
    ]);
    showLivePaneMultiModal({
      title: 't',
      columns: [{ widgetInstanceId: 'w1', title: 'A' }],
      widgetHost: host,
      coordinator: coord,
      termCols: 140, termRows: 36,
    });
    const sb = modals[0]!.bounds;
    expect(sb.row).toBe(1);
    expect(sb.col).toBe(1);
    expect(sb.width).toBe(140);
    expect(sb.height).toBe(36);
  });

  test('W2 — live modal keeps full-screen backdrop bounds but exposes centered interactiveBounds', () => {
    const { coord, modals } = makeStubCoordinator();
    const def = makeStubWidget(() => []);
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: [], cursor: 0 } }, def },
    ]);
    const handle = showLivePaneMultiModal({
      title: 't',
      columns: [{ widgetInstanceId: 'w1', title: 'A' }],
      widgetHost: host,
      coordinator: coord,
      termCols: 140, termRows: 36,
    });
    const surface = modals[0]!;
    expect(surface.bounds).toEqual({ row: 1, col: 1, width: 140, height: 36 });
    expect(surface.interactiveBounds).toEqual(handle.bounds);
    expect(surface.visualBounds).toEqual(handle.bounds);
    expect(surface.backdropBounds).toEqual(surface.bounds);
    expect(surface.backgroundInteractionPolicy).toBe('block');
  });

  test('W4 — live modal companion role stays passive without full-screen backdrop ownership', () => {
    const { coord, modals } = makeStubCoordinator();
    const def = makeStubWidget(() => []);
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: [], cursor: 0 } }, def },
    ]);
    const handle = showLivePaneMultiModal({
      title: 'watcher',
      columns: [{ widgetInstanceId: 'w1', title: 'watch' }],
      widgetHost: host,
      coordinator: coord,
      termCols: 140,
      termRows: 36,
      windowRole: 'companion',
    });
    const surface = modals[0]!;
    expect(surface.windowRole).toBe('companion');
    expect(surface.bounds).toEqual(handle.bounds);
    expect(surface.interactiveBounds).toEqual(handle.bounds);
    expect(surface.visualBounds).toEqual(handle.bounds);
    expect(surface.backdropBounds).toEqual(handle.bounds);
    expect(surface.backgroundInteractionPolicy).toBe('allow');
    expect(surface.focus).toBe('none');
    expect(surface.interactionClass).toBe('embedded-overlay');
  });

  test('weight — 2:3 split gives the second column ~60 % of the inner content row', () => {
    const { coord, modals } = makeStubCoordinator();
    const captured: number[] = [];
    const def: WidgetDef<StubState> = {
      ...makeStubWidget(() => []),
      render: (_s, ctx) => { captured.push(ctx.width); return []; },
    };
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: [], cursor: 0 } }, def },
      { id: 'w2', inst: { id: 'w2', type: 'stub', character: 'B', state: { rows: [], cursor: 0 } }, def },
    ]);
    // width=105 → inner=103 → content=102 (minus 1 divider).
    // floor(102 * 2/5) = 40.  Last column absorbs remainder: 62.
    showLivePaneMultiModal({
      title: 't',
      columns: [
        { widgetInstanceId: 'w1', title: 'A', weight: 2 },
        { widgetInstanceId: 'w2', title: 'B', weight: 3 },
      ],
      widgetHost: host,
      coordinator: coord,
      termCols: 200, termRows: 40,
      width: 105,
    });
    modals[0]!.paint!();
    expect(captured.length).toBeGreaterThanOrEqual(2);
    expect(captured[0]).toBe(40);
    expect(captured[1]).toBe(62);
  });

  test('onAfterKey — fires after the widget.onKey mutates state so the hook observes the new cursor', () => {
    const { coord, modals } = makeStubCoordinator();
    const def: WidgetDef<StubState> = {
      ...makeStubWidget(s => s.rows),
      onKey: (ev, state) => {
        if (ev.name === 'j') { state.cursor += 1; return { type: 'refresh' }; }
        return { type: 'none' };
      },
    };
    const inst: WidgetInstance<StubState> = {
      id: 'w1', type: 'stub', character: 'A',
      state: { rows: ['a', 'b', 'c'], cursor: 0 },
    };
    const host = makeWidgetHost([{ id: 'w1', inst, def }]);
    const seen: Array<{ cursor: number; action: string; key: string }> = [];
    showLivePaneMultiModal({
      title: 't',
      columns: [{
        widgetInstanceId: 'w1', title: 'A',
        onAfterKey: (action, ev) => {
          seen.push({ cursor: inst.state.cursor, action: action.type, key: ev.name ?? '' });
        },
      }],
      widgetHost: host,
      coordinator: coord,
      termCols: 120, termRows: 30,
    });
    modals[0]!.paint!();
    (modals[0] as any).onKey({ name: 'j' });
    (modals[0] as any).onKey({ name: 'j' });
    expect(seen).toEqual([
      { cursor: 1, action: 'refresh', key: 'j' },
      { cursor: 2, action: 'refresh', key: 'j' },
    ]);
  });

  test('content-only adapter gives widgets an extra title row budget and strips it in paint', () => {
    const { coord, modals } = makeStubCoordinator();
    const captured: Array<{ height: number }> = [];
    const def: WidgetDef<StubState> = {
      ...makeStubWidget(() => []),
      render: (_state, ctx) => {
        captured.push({ height: ctx.height });
        return Array.from({ length: ctx.height }, (_, i) => `row-${i}`);
      },
    };
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: [], cursor: 0 } }, def },
      { id: 'w2', inst: { id: 'w2', type: 'stub', character: 'B', state: { rows: [], cursor: 0 } }, def },
    ]);
    showLivePaneMultiModal({
      title: 't',
      columns: [
        { widgetInstanceId: 'w1', title: 'A' },
        { widgetInstanceId: 'w2', title: 'B' },
      ],
      widgetHost: host,
      coordinator: coord,
      termCols: 140, termRows: 36,
    });
    modals[0]!.paint!();
    expect(captured).toEqual([{ height: 29 }, { height: 29 }]);
  });

  test('simplified chrome — content rows start at row+1 (no inner subtitle/divider)', () => {
    const { coord, modals } = makeStubCoordinator();
    const captured: Array<{ height: number }> = [];
    const def: WidgetDef<StubState> = {
      ...makeStubWidget(() => []),
      render: (_state, ctx) => { captured.push({ height: ctx.height }); return []; },
    };
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: [], cursor: 0 } }, def },
    ]);
    // height=10 (from explicit bounds) → inner=8. v1 reserved 2 rows
    // (subtitle + divider) leaving content=6. v2 reserves 0 inner
    // rows → content=8.
    showLivePaneMultiModal({
      title: 't',
      columns: [{ widgetInstanceId: 'w1', title: 'A' }],
      widgetHost: host,
      coordinator: coord,
      termCols: 120, termRows: 36,
      bounds: { row: 5, col: 10, width: 60, height: 10 },
    });
    modals[0]!.paint!();
    expect(captured[0]!.height).toBe(9);
  });

  test('onAfterKey — exceptions are swallowed (modal stays live)', () => {
    const { coord, modals } = makeStubCoordinator();
    const def = makeStubWidget(s => s.rows);
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: ['a'], cursor: 0 } }, def },
    ]);
    showLivePaneMultiModal({
      title: 't',
      columns: [{
        widgetInstanceId: 'w1', title: 'A',
        onAfterKey: () => { throw new Error('hook boom'); },
      }],
      widgetHost: host,
      coordinator: coord,
      termCols: 120, termRows: 30,
    });
    modals[0]!.paint!();
    // Should not throw.
    const r = (modals[0] as any).onKey({ name: 'j' });
    expect(r).toBe('consumed');
  });

  test('MIN_WIDE_WIDTH boundary via explicit bounds — 80 = multi, 79 = single', () => {
    const { coord } = makeStubCoordinator();
    const def = makeStubWidget(() => []);
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: [], cursor: 0 } }, def },
      { id: 'w2', inst: { id: 'w2', type: 'stub', character: 'B', state: { rows: [], cursor: 0 } }, def },
    ]);
    const wideCols = MIN_WIDE_WIDTH;
    const atBoundary = showLivePaneMultiModal({
      title: 't',
      columns: [
        { widgetInstanceId: 'w1', title: 'A' },
        { widgetInstanceId: 'w2', title: 'B' },
      ],
      widgetHost: host,
      coordinator: coord,
      termCols: 100, termRows: 24,
      width: wideCols,
    });
    expect(atBoundary.columnCount).toBe(2);
    atBoundary.dispose();
    _resetPaneMultiModalsForTesting();

    const belowBoundary = showLivePaneMultiModal({
      title: 't',
      columns: [
        { widgetInstanceId: 'w1', title: 'A' },
        { widgetInstanceId: 'w2', title: 'B' },
      ],
      widgetHost: host,
      coordinator: coord,
      termCols: 100, termRows: 24,
      width: wideCols - 1,
    });
    expect(belowBoundary.columnCount).toBe(1);
  });

  // ── α.2 (2026-04-21 · compositor primitive track) ────────────────
  // Codex comment #4286180153 point 2 resolution: Browser→Preview
  // coupling must fire on mouse path the same way onAfterKey fires on
  // key path. Mirror tests of the onAfterKey suite above.

  test('onAfterMouse — fires after the widget.onMouse mutates state so the hook observes the new cursor', () => {
    const { coord, modals } = makeStubCoordinator();
    const def: WidgetDef<StubState> = {
      ...makeStubWidget(s => s.rows),
      onMouse: (ev, state) => {
        if (ev.type === 'click') {
          state.cursor = state.cursor + 1;
          return { type: 'refresh' };
        }
        if (ev.type === 'scroll-down') {
          state.cursor = state.cursor + 3;
          return { type: 'refresh' };
        }
        return { type: 'none' };
      },
    };
    const inst: WidgetInstance<StubState> = {
      id: 'w1', type: 'stub', character: 'A',
      state: { rows: ['a', 'b', 'c', 'd', 'e'], cursor: 0 },
    };
    const host = makeWidgetHost([{ id: 'w1', inst, def }]);
    const seen: Array<{ cursor: number; action: string; mouse: string }> = [];
    const handle = showLivePaneMultiModal({
      title: 't',
      columns: [{
        widgetInstanceId: 'w1', title: 'A',
        onAfterMouse: (action, ev) => {
          seen.push({ cursor: inst.state.cursor, action: action.type, mouse: ev.type });
        },
      }],
      widgetHost: host,
      coordinator: coord,
      termCols: 120, termRows: 30,
    });
    modals[0]!.paint!();
    const b = handle.bounds;
    // Click inside the column at a body row so the handler fires.
    (modals[0] as any).onMouse({ type: 'click', row: b.row + 5, col: b.col + 5, shift: false });
    (modals[0] as any).onMouse({ type: 'scroll-down', row: b.row + 5, col: b.col + 5, shift: false });
    expect(seen).toEqual([
      { cursor: 1, action: 'refresh', mouse: 'click' },
      { cursor: 4, action: 'refresh', mouse: 'scroll-down' },
    ]);
  });

  test('onAfterMouse — exceptions are swallowed (modal stays live)', () => {
    const { coord, modals } = makeStubCoordinator();
    const def = makeStubWidget(s => s.rows);
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: ['a'], cursor: 0 } }, def },
    ]);
    const handle = showLivePaneMultiModal({
      title: 't',
      columns: [{
        widgetInstanceId: 'w1', title: 'A',
        onAfterMouse: () => { throw new Error('hook boom'); },
      }],
      widgetHost: host,
      coordinator: coord,
      termCols: 120, termRows: 30,
    });
    modals[0]!.paint!();
    const b = handle.bounds;
    // Should not throw.
    const r = (modals[0] as any).onMouse({ type: 'click', row: b.row + 5, col: b.col + 5, shift: false });
    // onMouse returns the widget's action on click hits (not 'consumed'/'passthrough' marker).
    expect(r).toBeDefined();
  });

  test('onAfterMouse — not fired when there is no widget onMouse (graceful)', () => {
    const { coord, modals } = makeStubCoordinator();
    const def: WidgetDef<StubState> = {
      ...makeStubWidget(s => s.rows),
      onMouse: undefined,
    };
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: ['a'], cursor: 0 } }, def },
    ]);
    let hookFired = 0;
    const handle = showLivePaneMultiModal({
      title: 't',
      columns: [{
        widgetInstanceId: 'w1', title: 'A',
        onAfterMouse: () => { hookFired += 1; },
      }],
      widgetHost: host,
      coordinator: coord,
      termCols: 120, termRows: 30,
    });
    modals[0]!.paint!();
    const b = handle.bounds;
    (modals[0] as any).onMouse({ type: 'click', row: b.row + 5, col: b.col + 5, shift: false });
    // Widget has no onMouse, so the hit returns early — hook doesn't
    // fire. This is intentional: the hook observes the widget's mutation
    // and there's nothing to observe. Mirrors onAfterKey behaviour when
    // widget.onKey is absent.
    expect(hookFired).toBe(0);
  });

  test('onAfterMouse — fires on scroll-up + scroll-down + drag as well as click', () => {
    const { coord, modals } = makeStubCoordinator();
    const def: WidgetDef<StubState> = {
      ...makeStubWidget(s => s.rows),
      onMouse: () => ({ type: 'refresh' }),
    };
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: ['a'], cursor: 0 } }, def },
    ]);
    const types: string[] = [];
    const handle = showLivePaneMultiModal({
      title: 't',
      columns: [{
        widgetInstanceId: 'w1', title: 'A',
        onAfterMouse: (_action, ev) => { types.push(ev.type); },
      }],
      widgetHost: host,
      coordinator: coord,
      termCols: 120, termRows: 30,
    });
    modals[0]!.paint!();
    const b = handle.bounds;
    const pt = { row: b.row + 5, col: b.col + 5, shift: false };
    (modals[0] as any).onMouse({ type: 'click', ...pt });
    (modals[0] as any).onMouse({ type: 'scroll-up', ...pt });
    (modals[0] as any).onMouse({ type: 'scroll-down', ...pt });
    expect(types).toEqual(['click', 'scroll-up', 'scroll-down']);
  });

  test('live modal fluent chrome renders controls and bottom status', () => {
    const { coord, modals } = makeStubCoordinator();
    const def = makeStubWidget(s => s.rows);
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: ['only'], cursor: 0 } }, def },
      { id: 'w2', inst: { id: 'w2', type: 'stub', character: 'B', state: { rows: ['other'], cursor: 0 } }, def },
    ]);
    showLivePaneMultiModal({
      title: 'Browser + Preview',
      columns: [
        { widgetInstanceId: 'w1', title: 'browser' },
        { widgetInstanceId: 'w2', title: 'preview' },
      ],
      widgetHost: host,
      coordinator: coord,
      termCols: 140,
      termRows: 36,
      chrome: {
        theme: MONAD_PASTEL_DEFAULT,
        variant: 'rounded',
        titleAlign: 'left',
        titlePrefix: '⠿',
        titleRight: '— ✕',
        bottomStatus: 'browser · preview · live',
      },
    });
    const plain = modals[0]!.paint!().replace(/\x1b\[[0-9;]*m/g, '');
    expect(plain).toContain('╭');
    expect(plain).toContain('⠿ Browser + Preview');
    expect(plain).toContain('— ✕');
    expect(plain).toContain('browser · preview · live');
  });

  test('W3 — live modal title control click dispatches chrome action', () => {
    const { coord, modals } = makeStubCoordinator();
    const def = makeStubWidget(s => s.rows);
    const host = makeWidgetHost([
      { id: 'w1', inst: { id: 'w1', type: 'stub', character: 'A', state: { rows: ['only'], cursor: 0 } }, def },
    ]);
    const calls: string[] = [];
    const handle = showLivePaneMultiModal({
      title: 'Browser + Preview',
      columns: [{ widgetInstanceId: 'w1', title: 'browser' }],
      widgetHost: host,
      coordinator: coord,
      termCols: 140,
      termRows: 36,
      chrome: {
        theme: MONAD_PASTEL_DEFAULT,
        titleControls: [
          { id: 'model', label: '⌥' },
          { id: 'close', label: '✕' },
        ],
      },
      onChromeAction: (action) => { calls.push(action.controlId); },
    });
    const row = handle.bounds.row;
    const modelCol = handle.bounds.col + handle.bounds.width - 5;
    (modals[0] as any).onMouse({ type: 'click', row, col: modelCol });
    expect(calls).toEqual(['model']);
  });
});
