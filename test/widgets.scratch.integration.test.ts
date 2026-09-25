// Scratch widget integration tests — Phase 7 Batch S3.
//
// Verifies the full flow: WidgetHost spawns `type: 'scratch'`, the
// dashboard bridge helper pushes state each frame, and the rendered
// output reflects each mode. This is the forward-facing proof that
// alternative workspace layouts can embed the new scratch widget.

import { describe, expect, test, beforeEach } from 'bun:test';
import { WidgetHost } from '../src/widgets/host.js';
import scratchWidget, {
  syncScratchFromDashboard,
  setScratchMode,
  type ScratchState,
} from '../widgets/scratch/widget.js';
import { stripAnsi } from '../src/tui.js';
import { dispatchKeyToWidget } from '../src/widget-routing/widget-dispatcher.js';

describe('scratch widget via WidgetHost', () => {
  let host: WidgetHost;

  beforeEach(() => {
    host = new WidgetHost({
      log: () => {},
      requestRender: () => {},
    });
    host.register(scratchWidget, 'builtin', '');
  });

  test('spawn returns a live instance', () => {
    const inst = host.spawn({ type: 'scratch', id: 'wd-scratch-panel' });
    expect(inst.id).toBe('wd-scratch-panel');
    expect(inst.type).toBe('scratch');
    const state = inst.state as ScratchState;
    expect(state.mode).toBe('preview');
  });

  test('buildContext wires animation + canvas + telemetry handles', () => {
    host.spawn({ type: 'scratch', id: 'wd-x' });
    const ctx = host.buildContext('wd-x');
    expect(ctx).not.toBeNull();
    expect(ctx!.widgetType).toBe('scratch');
    expect(ctx!.animate).toBeDefined();
    expect(ctx!.canvas).toBeDefined();
  });

  test('render via host context produces lines matching ctx height', () => {
    const inst = host.spawn({
      type: 'scratch',
      id: 'wd-y',
      config: { previewLines: ['a', 'b', 'c'] },
    });
    const ctx = host.buildContext('wd-y')!;
    const def = host.defFor('wd-y')!;
    // Host ctx doesn't supply width/height — widget expects RenderCtx
    // (different type than WidgetContext). Invoke render directly with
    // a synthetic RenderCtx.
    const out = def.render(inst.state, { width: 40, height: 5, focused: true } as any, 'Scratch');
    expect(out).toHaveLength(5);
    const plain = out.map(stripAnsi).join('\n');
    expect(plain).toContain('a');
    expect(plain).toContain('c');
  });

  test('dispatchKeyToWidget routes memo keys through onKey', () => {
    const inst = host.spawn({
      type: 'scratch',
      id: 'wd-mm',
      config: { mode: 'memo', memoLines: ['hello'] },
    });
    const state = inst.state as ScratchState;
    // After initialState, memoColIdx is 0.
    dispatchKeyToWidget(host, 'wd-mm', { name: 'end', ctrl: false, shift: false } as any);
    expect(state.memoColIdx).toBe(5); // end of 'hello'
    dispatchKeyToWidget(host, 'wd-mm', { name: '!', ctrl: false, shift: false } as any);
    expect(state.memoLines[0]).toBe('hello!');
    expect(state.memoDirty).toBe(true);
  });
});

describe('syncScratchFromDashboard', () => {
  test('pushes preview state including scroll', () => {
    const state: ScratchState = scratchWidget.initialState();
    syncScratchFromDashboard(state, {
      mode: 'preview',
      previewLines: ['x', 'y'],
      previewPath: '/a/b.md',
      scrollOffset: 7,
      focused: true,
    });
    expect(state.mode).toBe('preview');
    expect(state.previewLines).toEqual(['x', 'y']);
    expect(state.previewPath).toBe('/a/b.md');
    expect(state.scroll).toBe(7);
    expect(state.focused).toBe(true);
  });

  test('pushes memo state', () => {
    const state: ScratchState = scratchWidget.initialState();
    syncScratchFromDashboard(state, {
      mode: 'memo',
      memoLines: ['first', 'second'],
      memoLineIdx: 1,
      memoColIdx: 3,
      memoDirty: true,
    });
    expect(state.mode).toBe('memo');
    expect(state.memoLines).toEqual(['first', 'second']);
    expect(state.memoLineIdx).toBe(1);
    expect(state.memoColIdx).toBe(3);
    expect(state.memoDirty).toBe(true);
  });

  test('pushes clipboard state', () => {
    const state: ScratchState = scratchWidget.initialState();
    syncScratchFromDashboard(state, {
      mode: 'clipboard',
      clipHistory: [
        { id: 'c1', text: 'first' },
        { id: 'c2', text: 'second' },
      ],
      clipCursor: 1,
    });
    expect(state.mode).toBe('clipboard');
    expect(state.clipHistory).toHaveLength(2);
    expect(state.clipCursor).toBe(1);
  });

  test('memoLines default to [""] when dashboard sends empty array', () => {
    const state: ScratchState = scratchWidget.initialState();
    syncScratchFromDashboard(state, {
      mode: 'memo',
      memoLines: [],
    });
    expect(state.memoLines).toEqual(['']);
  });

  test('clamps negative indices to 0', () => {
    const state: ScratchState = scratchWidget.initialState({ mode: 'memo' });
    syncScratchFromDashboard(state, {
      mode: 'memo',
      memoLines: ['abc'],
      memoLineIdx: -5,
      memoColIdx: -10,
    });
    expect(state.memoLineIdx).toBe(0);
    expect(state.memoColIdx).toBe(0);
  });

  test('omitted fields leave state untouched', () => {
    const state: ScratchState = scratchWidget.initialState({
      mode: 'preview',
      previewLines: ['keep'],
    });
    state.scroll = 42;
    syncScratchFromDashboard(state, { mode: 'preview' });
    // scrollOffset omitted → scroll stays
    expect(state.scroll).toBe(42);
    expect(state.previewLines).toEqual(['keep']);
  });
});

describe('setScratchMode', () => {
  test('transition to memo clamps cursor within lines', () => {
    const state: ScratchState = scratchWidget.initialState({
      mode: 'preview',
      memoLines: ['short'],
    });
    state.memoLineIdx = 99;
    state.memoColIdx = 99;
    setScratchMode(state, 'memo');
    expect(state.mode).toBe('memo');
    expect(state.memoLineIdx).toBe(0);
    expect(state.memoColIdx).toBe(5);
  });

  test('transition to clipboard clamps cursor', () => {
    const state: ScratchState = scratchWidget.initialState({
      mode: 'preview',
      clipHistory: [{ id: 'x', text: 'y' }],
    });
    state.clipCursor = 50;
    setScratchMode(state, 'clipboard');
    expect(state.mode).toBe('clipboard');
    expect(state.clipCursor).toBe(0);
  });

  test('transition to preview normalises scroll non-negative', () => {
    const state: ScratchState = scratchWidget.initialState();
    state.scroll = -5;
    setScratchMode(state, 'preview');
    expect(state.scroll).toBe(0);
  });
});
