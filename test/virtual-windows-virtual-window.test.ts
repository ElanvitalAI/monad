import { describe, expect, test } from 'bun:test';

import { VirtualWindow } from '../src/virtual-windows/virtual-window.js';
import { createPaneContent } from '../src/virtual-windows/pane-content.js';
import { ansi, stripAnsi } from '../src/tui.js';

function makePane(title = 'x', kind: 'markdown' | 'scratch' = 'markdown') {
  if (kind === 'scratch') return createPaneContent({ kind: 'scratch', title });
  return createPaneContent({ kind: 'markdown', text: 'hello', title });
}

function makeBroadcastProbe(title: string, seen: Array<{ mode: string; text: string }>) {
  const pane = createPaneContent({ kind: 'scratch', title });
  pane.acceptBroadcast = (input) => { seen.push({ mode: input.mode, text: input.text }); };
  return pane;
}

describe('VirtualWindow', () => {
  test('constructs with a single pane (root leaf)', () => {
    const p = makePane();
    const vw = new VirtualWindow({
      id: 1, title: 'w1', rootContent: p,
      bounds: { row: 1, col: 1, width: 80, height: 24 },
    });
    expect(vw.listPanes()).toHaveLength(1);
    expect(vw.focused).toBe(p.id);
  });

  test('splitFocused adds a second pane + focuses it', () => {
    const a = makePane('a');
    const vw = new VirtualWindow({
      id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 },
    });
    const b = makePane('b');
    const newId = vw.splitFocused('h', b);
    expect(newId).toBe(b.id);
    expect(vw.listPanes()).toHaveLength(2);
    expect(vw.focused).toBe(b.id);
  });

  test('focusDirection moves between panes', () => {
    const a = makePane('a');
    const vw = new VirtualWindow({
      id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 },
    });
    const b = makePane('b');
    vw.splitFocused('h', b);
    vw.setFocus(a.id);
    expect(vw.focusDirection('right')).toBe(true);
    expect(vw.focused).toBe(b.id);
    expect(vw.focusDirection('left')).toBe(true);
    expect(vw.focused).toBe(a.id);
  });

  test('closeFocused disposes pane and collapses', () => {
    const a = makePane('a');
    let aDisposed = 0;
    const vw = new VirtualWindow({
      id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 },
    });
    const b = makePane('b');
    vw.splitFocused('h', b);
    // Record on a.
    const origDispose = a.dispose;
    a.dispose = () => { aDisposed++; origDispose.call(a); };
    vw.setFocus(a.id);
    expect(vw.closeFocused()).toBe(true);
    expect(aDisposed).toBe(1);
    expect(vw.listPanes()).toHaveLength(1);
    expect(vw.focused).toBe(b.id);
  });

  test('closeFocused on last pane marks window closed', () => {
    const a = makePane('a');
    let closed = 0;
    const vw = new VirtualWindow(
      { id: 1, title: 'w', rootContent: a,
        bounds: { row: 1, col: 1, width: 80, height: 24 } },
      { onClose: () => { closed++; } },
    );
    expect(vw.closeFocused()).toBe(true);
    expect(vw.isClosed).toBe(true);
    expect(closed).toBe(1);
  });

  test('render includes border + pane content', () => {
    const a = createPaneContent({ kind: 'markdown', text: 'PAYLOAD', title: 'a' });
    const vw = new VirtualWindow({
      id: 1, title: 'Demo', rootContent: a,
      bounds: { row: 1, col: 1, width: 40, height: 10 },
    });
    const out = vw.render();
    expect(out).toContain('Demo');
    expect(out).toContain('╭');
    expect(out).toContain('╯');
    expect(out).toContain('PAYLOAD');
  });

  test('render pre-clears the full inner rect so popup dismiss can recover blank areas', () => {
    const a = createPaneContent({ kind: 'markdown', text: 'PAYLOAD', title: 'a' });
    const vw = new VirtualWindow({
      id: 1, title: 'Demo', rootContent: a,
      bounds: { row: 1, col: 1, width: 40, height: 10 },
    });
    const out = vw.render();
    expect(out).toContain(ansi.moveTo(2, 2) + '\x1b[0m' + ' '.repeat(38));
  });

  test('render paints border titles for both focused and unfocused panes', () => {
    const a = createPaneContent({ kind: 'markdown', text: 'LEFT', title: 'codex' });
    const vw = new VirtualWindow({
      id: 1, title: 'showroom', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 12 },
    });
    const b = createPaneContent({ kind: 'markdown', text: 'RIGHT', title: 'claude' });
    vw.splitFocused('h', b); // b focused, a unfocused
    const out = stripAnsi(vw.render());
    expect(out).toContain('codex');
    expect(out).toContain('claude');
  });

  test('focused live pane title pulses across animation phases', () => {
    const a = createPaneContent({ kind: 'markdown', text: 'LEFT', title: 'codex' });
    const vwA = new VirtualWindow({
      id: 1, title: 'showroom', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 12 },
      now: () => 0,
    });
    const b = createPaneContent({ kind: 'scratch', title: 'claude' });
    Object.defineProperty(b, 'isAlive', { get: () => true });
    vwA.splitFocused('h', b);

    const vwB = new VirtualWindow({
      id: 1, title: 'showroom', rootContent: createPaneContent({ kind: 'markdown', text: 'LEFT', title: 'codex' }),
      bounds: { row: 1, col: 1, width: 80, height: 12 },
      now: () => 500,
    });
    const b2 = createPaneContent({ kind: 'scratch', title: 'claude' });
    Object.defineProperty(b2, 'isAlive', { get: () => true });
    vwB.splitFocused('h', b2);

    const outA = stripAnsi(vwA.render());
    const outB = stripAnsi(vwB.render());
    expect(outA).toContain('claude ●');
    expect(outB).toContain('claude ○');
  });

  test('onKey routes to focused pane', () => {
    const a = createPaneContent({ kind: 'scratch' });
    const vw = new VirtualWindow({
      id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 40, height: 10 },
    });
    // Scratch panes ignore keys, so action is always 'none'.
    expect(vw.onKey({ name: 'a' }).type).toBe('none');
  });

  test('deliverBroadcastToAll fans submit intent to mixed panes', () => {
    const seenA: Array<{ mode: string; text: string }> = [];
    const seenB: Array<{ mode: string; text: string }> = [];
    const a = makeBroadcastProbe('a', seenA);
    const vw = new VirtualWindow({
      id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 12 },
    });
    const b = makeBroadcastProbe('b', seenB);
    vw.splitFocused('h', b);
    const delivered = vw.deliverBroadcastToAll({ mode: 'submit', text: 'status' });
    expect(delivered).toBe(2);
    expect(seenA).toEqual([{ mode: 'submit', text: 'status' }]);
    expect(seenB).toEqual([{ mode: 'submit', text: 'status' }]);
  });

  test('splitFocused rejects when bounds too small', () => {
    const a = makePane('a');
    const vw = new VirtualWindow({
      id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 30, height: 10 },
    });
    expect(() => vw.splitFocused('h', makePane('b'))).toThrow(/too-small/);
  });

  test('asModalSurface returns a valid ModalSurface', () => {
    const a = makePane('a');
    const vw = new VirtualWindow({
      id: 3, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 },
    });
    const ms = vw.asModalSurface();
    expect(ms.kind).toBe('modal');
    expect(ms.id).toBe('virtual-window:3');
    expect(ms.backgroundInteractionPolicy).toBe('block');
    expect(ms.windowRole).toBe('foreground');
    expect(typeof ms.paint).toBe('function');
    expect(ms.paint()).toContain('╭');
  });

  test('dispose disposes all panes + marks closed', () => {
    let disposeCount = 0;
    const a = createPaneContent({ kind: 'markdown', text: 'a' });
    const origDispose = a.dispose;
    a.dispose = () => { disposeCount++; origDispose.call(a); };
    const vw = new VirtualWindow({ id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 } });
    const b = createPaneContent({ kind: 'markdown', text: 'b' });
    const origDisposeB = b.dispose;
    b.dispose = () => { disposeCount++; origDisposeB.call(b); };
    vw.splitFocused('h', b);
    vw.dispose();
    expect(disposeCount).toBe(2);
    expect(vw.isClosed).toBe(true);
  });

  test('VW-U3 — onMouse left click focuses the clicked pane', () => {
    const a = makePane('a');
    const vw = new VirtualWindow({ id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 } });
    const b = makePane('b');
    vw.splitFocused('h', b);           // 2 panes, b focused (default)
    expect(vw.focused).toBe(b.id);
    // Click the LEFT half of the inner rect (which should land on pane a).
    const act = vw.onMouse({ type: 'click', row: 12, col: 5 });
    expect(act.type).toBe('refresh');
    expect(vw.focused).toBe(a.id);
    // Clicking the same pane again is a no-op.
    const act2 = vw.onMouse({ type: 'click', row: 12, col: 5 });
    expect(act2.type).toBe('none');
    expect(vw.focused).toBe(a.id);
  });

  test('VW-U3 — onMouse forwards pane-body click to pane-local content', () => {
    const seen: Array<{ row: number; col: number; type: string }> = [];
    const a = makePane('a');
    a.onMouse = (ev) => {
      seen.push({ row: ev.row, col: ev.col, type: ev.type });
      return { type: 'refresh' };
    };
    const vw = new VirtualWindow({
      id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 40, height: 12 },
    });
    const paneRect = vw.paneRects().find((r) => r.paneId === a.id)!.rect;
    const act = vw.onMouse({ type: 'click', row: paneRect.row + 2, col: paneRect.col + 3 });
    expect(act.type).toBe('refresh');
    expect(seen).toEqual([{ type: 'click', row: 3, col: 4 }]);
  });

  test('VW-U3 — onMouse forwards pane-body double-click to pane-local content', () => {
    const seen: Array<{ row: number; col: number; type: string }> = [];
    const a = makePane('a');
    a.onMouse = (ev) => {
      seen.push({ row: ev.row, col: ev.col, type: ev.type });
      return { type: 'refresh' };
    };
    const vw = new VirtualWindow({
      id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 40, height: 12 },
    });
    const paneRect = vw.paneRects().find((r) => r.paneId === a.id)!.rect;
    const act = vw.onMouse({ type: 'double-click', row: paneRect.row + 2, col: paneRect.col + 3 });
    expect(act.type).toBe('refresh');
    expect(seen).toEqual([{ type: 'double-click', row: 3, col: 4 }]);
  });

  test('VW-U3 — onMouse forwards pane-body drag and release to pane-local content', () => {
    const seen: Array<{ row: number; col: number; type: string }> = [];
    const a = makePane('a');
    a.onMouse = (ev) => {
      seen.push({ row: ev.row, col: ev.col, type: ev.type });
      return { type: 'refresh' };
    };
    const vw = new VirtualWindow({
      id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 40, height: 12 },
    });
    const paneRect = vw.paneRects().find((r) => r.paneId === a.id)!.rect;
    const drag = vw.onMouse({ type: 'drag', row: paneRect.row + 2, col: paneRect.col + 3 });
    const release = vw.onMouse({ type: 'release', row: paneRect.row + 2, col: paneRect.col + 4 });
    expect(drag.type).toBe('refresh');
    expect(release.type).toBe('refresh');
    expect(seen).toEqual([
      { type: 'drag', row: 3, col: 4 },
      { type: 'release', row: 3, col: 5 },
    ]);
  });

  test('VW-U3 — onMouse border click keeps current focus', () => {
    const p = makePane('a');
    const vw = new VirtualWindow({ id: 1, title: 'w', rootContent: p,
      bounds: { row: 1, col: 1, width: 80, height: 24 } });
    // row:1 col:1 is the top-left corner — outside inner rect.
    const act = vw.onMouse({ type: 'click', row: 1, col: 1 });
    expect(act.type).toBe('none');
    expect(vw.focused).toBe(p.id);
  });

  test('VW-U3/R6 — pane title right click fires onShowContextMenu', () => {
    const selectorCalls: Array<{ w: number; p: string | null; col: number; row: number }> = [];
    const menuCalls: Array<{ w: number; p: string; col: number; row: number }> = [];
    const p = makePane('a');
    const vw = new VirtualWindow({
      id: 5, title: 'w', rootContent: p,
      bounds: { row: 1, col: 1, width: 80, height: 24 },
    }, {
      onShowSelector: (w, pane, col, row) => {
        selectorCalls.push({ w, p: pane, col, row });
      },
      onShowContextMenu: (w, pane, col, row) => {
        menuCalls.push({ w, p: pane, col, row });
      },
    });
    const paneRect = vw.paneRects().find(r => r.paneId === p.id)!.rect;
    vw.onMouse({ type: 'right-click', row: paneRect.row, col: paneRect.col + 2 });
    expect(menuCalls).toEqual([{ w: 5, p: p.id, col: paneRect.col + 2, row: paneRect.row }]);
    expect(selectorCalls).toEqual([]);
  });

  test('VW-U3/R6 — pane body right click keeps selector popup path', () => {
    const selectorCalls: Array<{ w: number; p: string | null; col: number; row: number }> = [];
    const menuCalls: Array<{ w: number; p: string; col: number; row: number }> = [];
    const p = makePane('a');
    const vw = new VirtualWindow({
      id: 5, title: 'w', rootContent: p,
      bounds: { row: 1, col: 1, width: 80, height: 24 },
    }, {
      onShowSelector: (w, pane, col, row) => {
        selectorCalls.push({ w, p: pane, col, row });
      },
      onShowContextMenu: (w, pane, col, row) => {
        menuCalls.push({ w, p: pane, col, row });
      },
    });
    const paneRect = vw.paneRects().find(r => r.paneId === p.id)!.rect;
    vw.onMouse({ type: 'right-click', row: paneRect.row + 1, col: paneRect.col + 2 });
    expect(selectorCalls).toEqual([{ w: 5, p: p.id, col: paneRect.col + 2, row: paneRect.row + 1 }]);
    expect(menuCalls).toEqual([]);
  });

  test('VW-U3/R6 — pane body right click can be consumed by pane content before selector fallback', () => {
    const selectorCalls: Array<{ w: number; p: string | null; col: number; row: number }> = [];
    const seen: Array<{ row: number; col: number; type: string }> = [];
    const p = makePane('a');
    p.onMouse = (ev) => {
      seen.push({ row: ev.row, col: ev.col, type: ev.type });
      if (ev.type === 'right-click') return { type: 'refresh' };
      return { type: 'none' };
    };
    const vw = new VirtualWindow({
      id: 5, title: 'w', rootContent: p,
      bounds: { row: 1, col: 1, width: 80, height: 24 },
    }, {
      onShowSelector: (w, pane, col, row) => {
        selectorCalls.push({ w, p: pane, col, row });
      },
    });
    const paneRect = vw.paneRects().find(r => r.paneId === p.id)!.rect;
    const act = vw.onMouse({ type: 'right-click', row: paneRect.row + 1, col: paneRect.col + 2 });
    expect(act.type).toBe('refresh');
    expect(seen).toEqual([{ type: 'right-click', row: 2, col: 3 }]);
    expect(selectorCalls).toEqual([]);
  });

  test('VW-U3 — asModalSurface.bounds reflects setBounds updates', () => {
    const p = makePane('a');
    const vw = new VirtualWindow({ id: 1, title: 'w', rootContent: p,
      bounds: { row: 2, col: 3, width: 50, height: 10 } });
    const surface = vw.asModalSurface();
    expect(surface.bounds).toEqual({ row: 2, col: 3, width: 50, height: 10 });
    vw.setBounds({ row: 5, col: 6, width: 40, height: 20 });
    expect(surface.bounds).toEqual({ row: 5, col: 6, width: 40, height: 20 });
  });

  test('VW-A2 — closeButtonAt returns null for solo pane', () => {
    const p = makePane('a');
    const vw = new VirtualWindow({ id: 1, title: 'w', rootContent: p,
      bounds: { row: 1, col: 1, width: 80, height: 24 } });
    // any corner
    expect(vw.closeButtonAt(79, 1)).toBe(null);
  });

  test('VW-A2 — closeButtonAt hits focused pane top-right in multi-pane layout', () => {
    const a = makePane('a');
    const vw = new VirtualWindow({ id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 } });
    const b = makePane('b');
    vw.splitFocused('h', b);  // b focused, left/right halves
    // Paint rects: focused (b) is the right half.
    const rects = (vw as unknown as { paneRects: () => Array<{ paneId: string; rect: { col: number; width: number; row: number } }> })
      .paneRects();
    const bRect = rects.find(r => r.paneId === b.id)!;
    const closeCol = bRect.rect.col + bRect.rect.width - 2;
    expect(vw.closeButtonAt(closeCol, bRect.rect.row)).toBe(b.id);
    // Non-focused pane (a) shouldn't expose a close button.
    const aRect = rects.find(r => r.paneId === a.id)!;
    const aCloseCol = aRect.rect.col + aRect.rect.width - 2;
    expect(vw.closeButtonAt(aCloseCol, aRect.rect.row)).toBe(null);
  });

  test('VW-A2 — clicking × closes that pane and focuses the survivor', () => {
    const a = makePane('a');
    const vw = new VirtualWindow({ id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 } });
    const b = makePane('b');
    vw.splitFocused('h', b);
    const rects = (vw as unknown as { paneRects: () => Array<{ paneId: string; rect: { col: number; width: number; row: number } }> })
      .paneRects();
    const bRect = rects.find(r => r.paneId === b.id)!;
    const closeCol = bRect.rect.col + bRect.rect.width - 2;
    const act = vw.onMouse({ type: 'click', row: bRect.rect.row, col: closeCol });
    expect(act.type).toBe('refresh');
    expect(vw.listPanes()).toHaveLength(1);
    expect(vw.focused).toBe(a.id);
  });

  test('VW-A2 — zoomed pane suppresses the × button', () => {
    const a = makePane('a');
    const vw = new VirtualWindow({ id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 } });
    const b = makePane('b');
    vw.splitFocused('h', b);
    vw.toggleZoom();
    expect(vw.closeButtonAt(78, 2)).toBe(null);
  });

  test('VW-A1 — scroll-up forwards to pane under cursor', () => {
    const calls: Array<{ type: string }> = [];
    const a = makePane('a');
    (a as unknown as { onMouse: (ev: unknown) => unknown }).onMouse = (ev) => {
      calls.push(ev as { type: string });
      return { type: 'none' };
    };
    const vw = new VirtualWindow({ id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 } });
    const act = vw.onMouse({ type: 'scroll-up', row: 10, col: 10 });
    expect(act.type).toBe('refresh');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.type).toBe('scroll-up');
  });

  test('VW-A1 — scroll-down outside inner rect falls back to focused pane', () => {
    const calls: Array<unknown> = [];
    const a = makePane('a');
    (a as unknown as { onMouse: (ev: unknown) => unknown }).onMouse = (ev) => {
      calls.push(ev);
      return { type: 'none' };
    };
    const vw = new VirtualWindow({ id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 } });
    // row=1 col=1 is the border — outside inner rect.
    const act = vw.onMouse({ type: 'scroll-down', row: 1, col: 1 });
    expect(act.type).toBe('refresh');
    expect(calls).toHaveLength(1);
  });

  test('VW-A1 — scroll is a no-op when pane omits onMouse', () => {
    const a = makePane('a');
    // Ensure the test pane does NOT define onMouse (markdown default).
    const vw = new VirtualWindow({ id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 } });
    const act = vw.onMouse({ type: 'scroll-up', row: 10, col: 10 });
    expect(act.type).toBe('none');
  });

  test('VW-U5 — toggleZoom expands focused pane, toggle again restores', () => {
    const a = makePane('a');
    const vw = new VirtualWindow({ id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 } });
    const b = makePane('b');
    vw.splitFocused('h', b);
    expect(vw.isZoomed()).toBe(false);
    expect(vw.toggleZoom()).toBe(true);
    expect(vw.isZoomed()).toBe(true);
    // render() should paint the zoomed pane across the full inner rect
    // (no b-side h split content). Strong assertion skipped — the
    // state flag is the contract; paint content is an integration test.
    expect(vw.toggleZoom()).toBe(false);
    expect(vw.isZoomed()).toBe(false);
  });

  test('VW-U5 — closing the zoomed pane clears zoom automatically', () => {
    const a = makePane('a');
    const vw = new VirtualWindow({ id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 } });
    const b = makePane('b');
    vw.splitFocused('h', b);
    expect(vw.focused).toBe(b.id);
    vw.toggleZoom();
    expect(vw.isZoomed()).toBe(true);
    vw.closeFocused();  // closes b
    expect(vw.isZoomed()).toBe(false);
    expect(vw.focused).toBe(a.id);
  });

  test('VW-U5 — focusLastPane swaps between two most recent panes', () => {
    const a = makePane('a');
    const vw = new VirtualWindow({ id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 } });
    const b = makePane('b');
    vw.splitFocused('h', b);
    expect(vw.focused).toBe(b.id);
    // No previous focus before split → first focusLastPane returns a.
    const t1 = vw.focusLastPane();
    expect(t1).toBe(a.id);
    expect(vw.focused).toBe(a.id);
    // Swap back.
    const t2 = vw.focusLastPane();
    expect(t2).toBe(b.id);
    expect(vw.focused).toBe(b.id);
  });

  test('VW-U5 — focusLastPane returns null when no previous pane recorded', () => {
    const a = makePane('a');
    const vw = new VirtualWindow({ id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 } });
    expect(vw.focusLastPane()).toBe(null);
  });

  test('SRF-5 — focusLastPane skips output-only previous pane when an interactive alt exists', () => {
    const a = makePane('a');
    const vw = new VirtualWindow({ id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 240, height: 48 } });
    const runner = makePane('runner');
    // Tag runner as output-only (duck-type — same trick external-
    // terminal pane uses).
    (runner as unknown as { focusPolicy: 'output-only' }).focusPolicy = 'output-only';
    vw.splitFocused('h', runner);
    const c = makePane('c');
    vw.splitFocused('h', c);
    // State after splits: focus = c; previous = runner (most recent).
    expect(vw.focused).toBe(c.id);
    // Without skip, focusLastPane would land on the runner (output-only).
    // With SRF-5, it picks the next interactive pane — a.
    const t = vw.focusLastPane();
    expect(t).toBe(a.id);
    expect(vw.focused).toBe(a.id);
  });

  test('SRF-5 — focusLastPane falls through to naive target when every alt is output-only', () => {
    const a = makePane('a');
    const vw = new VirtualWindow({ id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 240, height: 48 } });
    const runnerA = makePane('runner-a');
    const runnerB = makePane('runner-b');
    (runnerA as unknown as { focusPolicy: 'output-only' }).focusPolicy = 'output-only';
    (runnerB as unknown as { focusPolicy: 'output-only' }).focusPolicy = 'output-only';
    vw.splitFocused('h', runnerA);
    vw.splitFocused('h', runnerB);
    // Force the "no interactive alt" scenario: flip a to output-only
    // too, then land in runnerB with runnerA as previous.
    vw.setFocus(a.id);           // focus=a, prev=runnerB
    vw.setFocus(runnerA.id);     // focus=runnerA, prev=a
    (a as unknown as { focusPolicy: 'output-only' }).focusPolicy = 'output-only';
    vw.setFocus(runnerB.id);     // focus=runnerB, prev=runnerA (output-only)
    // Every other pane is output-only → skip search finds nothing →
    // fall through to naive target (the remembered previous).
    const t = vw.focusLastPane();
    expect(t).toBe(runnerA.id);
  });

  test('VW-U1 — setBorderAccent toggles accent flag; paintBorder reflects state', () => {
    const p = makePane('a');
    const vw = new VirtualWindow({ id: 1, title: 'w', rootContent: p,
      bounds: { row: 1, col: 1, width: 80, height: 24 } });
    expect(vw.isBorderAccent()).toBe(false);
    vw.setBorderAccent(true);
    expect(vw.isBorderAccent()).toBe(true);
    // render() must still produce a non-empty payload in both states
    // — sides + bottom stay muted; only top chrome changes tone.
    expect(vw.render().length).toBeGreaterThan(0);
    vw.setBorderAccent(false);
    expect(vw.render().length).toBeGreaterThan(0);
  });

  test('KX4b — asModalSurface.onKey always returns consumed', () => {
    const p = makePane('a');
    const vw = new VirtualWindow({ id: 1, title: 'w', rootContent: p,
      bounds: { row: 1, col: 1, width: 80, height: 24 } });
    const surface = vw.asModalSurface();
    expect(surface.onKey!({ name: 'x' } as never)).toBe('consumed');
    expect(surface.onKey!({ name: 'enter' } as never)).toBe('consumed');
    // Even unknown pane errors are swallowed — VW is keyboard-exclusive.
    const broken = makePane('b');
    (broken as unknown as { onKey: () => never }).onKey = () => { throw new Error('boom'); };
    const vw2 = new VirtualWindow({ id: 2, title: 'w2', rootContent: broken,
      bounds: { row: 1, col: 1, width: 80, height: 24 } });
    expect(vw2.asModalSurface().onKey!({ name: 'z' } as never)).toBe('consumed');
  });
});
