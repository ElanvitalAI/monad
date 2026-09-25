import { describe, expect, test } from 'bun:test';
import { Printer } from '../src/ui/printer.js';
import { Button } from '../src/ui/widgets/button.js';
import { Dialog } from '../src/ui/widgets/dialog.js';
import { SelectView } from '../src/ui/widgets/select-view.js';
import { mountViewAsModalSurface } from '../src/ui/modal-adapter.js';
import type { DisplayMouseEvent } from '../src/display/types.js';
import { DEFAULT_THEME_TOKENS } from '../src/theme/tokens.js';

function mouse(type: DisplayMouseEvent['type'], row: number, col: number): DisplayMouseEvent {
  return { type, row, col };
}

describe('MX4 Button mouse', () => {
  test('click triggers onClick', () => {
    let clicks = 0;
    const b = new Button({ label: 'Go', onClick: () => clicks++ });
    const p = Printer.create({ width: 20, height: 1 });
    b.draw(p);
    // Registered region should span "[ Go ]" = 6 cells at (0,0).
    expect(p.registry.size()).toBe(1);
    const reg = p.registry.snapshot()[0]!;
    expect(reg.width).toBe(6);
    expect(reg.absX).toBe(0);
    expect(reg.absY).toBe(0);
    // Simulate a click directly via the registry hit and onMouse.
    const hit = p.registry.hit(2, 0);
    hit?.view.onMouse?.({ type: 'click', x: 2, y: 0, absX: 2, absY: 0 });
    expect(clicks).toBe(1);
  });

  test('click focuses the button', () => {
    const b = new Button({ label: 'X', onClick: () => {} });
    const p = Printer.create({ width: 10, height: 1 });
    b.draw(p);
    expect(b.isFocused()).toBe(false);
    const hit = p.registry.hit(1, 0);
    hit?.view.onMouse?.({ type: 'click', x: 1, y: 0, absX: 1, absY: 0 });
    expect(b.isFocused()).toBe(true);
  });

  test('right-click and scroll on a Button → Ignored', () => {
    const b = new Button({ label: 'X', onClick: () => {} });
    const res1 = b.onMouse!({ type: 'right-click', x: 0, y: 0, absX: 0, absY: 0 });
    const res2 = b.onMouse!({ type: 'scroll-up', x: 0, y: 0, absX: 0, absY: 0 });
    expect(res1.kind).toBe('ignored');
    expect(res2.kind).toBe('ignored');
  });
});

describe('MX4 SelectView mouse', () => {
  test('draw registers one clickable per visible row with filtIdx payload', () => {
    const results: { picked?: string } = {};
    const view = new SelectView<string>({
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
        { value: 'c', label: 'Gamma' },
      ],
      onSubmit: v => { results.picked = v as string; },
    });
    view.takeFocus();
    const p = Printer.create({ width: 20, height: 6, focused: true });
    view.draw(p);
    const regs = p.registry.snapshot();
    // 3 rows → 3 clickable regions.
    expect(regs.length).toBe(3);
    expect(regs[0]?.payload).toEqual({ kind: 'row', filtIdx: 0 });
    expect(regs[1]?.payload).toEqual({ kind: 'row', filtIdx: 1 });
    expect(regs[2]?.payload).toEqual({ kind: 'row', filtIdx: 2 });
  });

  test('click a row routes through adapter → cursor moves without submit', () => {
    let picked: string | null = null;
    const view = new SelectView<string>({
      title: 'Pick',
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
        { value: 'c', label: 'Gamma' },
      ],
      onSubmit: v => { picked = v as string; },
    });
    const h = mountViewAsModalSurface({
      id: 'sel',
      bounds: { row: 2, col: 4, width: 30, height: 8 },
      view,
    });
    h.surface.paint();
    // Title on row 0, rows start at y=1 → terminal row = 2 + 1 + filtIdx.
    // Click row "Beta" (filtIdx=1) at terminal row=4, col=6 (inside).
    const res = h.handleMouse(mouse('click', 4, 6));
    expect(res).toBe('consumed');
    expect(picked).toBeNull();
    expect(view._snapshot().cursor).toBe(1);
  });

  test('double-click a row routes through adapter → cursor moves + onSubmit fires', () => {
    let picked: string | null = null;
    const view = new SelectView<string>({
      title: 'Pick',
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
        { value: 'c', label: 'Gamma' },
      ],
      onSubmit: v => { picked = v as string; },
    });
    const h = mountViewAsModalSurface({
      id: 'sel-double',
      bounds: { row: 2, col: 4, width: 30, height: 8 },
      view,
    });
    h.surface.paint();
    const res = h.handleMouse(mouse('double-click', 4, 6));
    expect(res).toBe('consumed');
    expect(picked).toBe('b');
  });

  test('themed cursor row paints a real background ANSI fill', () => {
    const view = new SelectView<string>({
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
      onSubmit: () => {},
      theme: DEFAULT_THEME_TOKENS,
    });
    const p = Printer.create({ width: 24, height: 5, focused: true });
    view.draw(p);
    expect(p.lines()[0]).toContain('48;2;49;50;68');
  });

  test('scroll-up / scroll-down move the cursor by 3', () => {
    const view = new SelectView<number>({
      options: Array.from({ length: 20 }, (_, i) => ({ value: i, label: `L${i}` })),
      onSubmit: () => {},
    });
    view.takeFocus();
    const p = Printer.create({ width: 20, height: 6, focused: true });
    view.draw(p);
    const hit = p.registry.hit(5, 1);
    expect(hit).not.toBeNull();
    hit!.view.onMouse?.({ type: 'scroll-down', x: 0, y: 0, absX: 5, absY: 1 });
    expect(view._snapshot().cursor).toBe(3);
    hit!.view.onMouse?.({ type: 'scroll-up', x: 0, y: 0, absX: 5, absY: 1 });
    expect(view._snapshot().cursor).toBe(0);
  });

  test('click on a multi-select row toggles membership (no submit)', () => {
    let picked: unknown = 'NOT-CALLED';
    const view = new SelectView<string>({
      multi: true,
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
      onSubmit: v => { picked = v; },
    });
    const h = mountViewAsModalSurface({
      id: 'mul',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view,
    });
    h.surface.paint();
    // Click on row 0.
    h.handleMouse(mouse('click', 1, 2));
    expect(view._snapshot().multi).toEqual(['a']);
    expect(picked).toBe('NOT-CALLED');
    // Click on row 1.
    h.handleMouse(mouse('click', 2, 2));
    expect(view._snapshot().multi.sort()).toEqual(['a', 'b']);
    // Click row 0 again → toggle off.
    h.handleMouse(mouse('click', 1, 2));
    expect(view._snapshot().multi).toEqual(['b']);
  });

  test('scrolling beyond end does not crash', () => {
    const view = new SelectView<number>({
      options: [{ value: 0, label: 'only' }],
      onSubmit: () => {},
    });
    view.takeFocus();
    view.onMouse?.({ type: 'scroll-down', x: 0, y: 0, absX: 0, absY: 0 });
    view.onMouse?.({ type: 'scroll-down', x: 0, y: 0, absX: 0, absY: 0 });
    expect(view._snapshot().cursor).toBe(0);
  });
});

describe('MX4 Dialog mouse — routes through child buttons', () => {
  test('clicking Yes button calls onSubmit with its value', () => {
    let picked: string | null = null;
    const d = new Dialog<'yes' | 'no'>({
      title: 'Confirm',
      body: 'Proceed?',
      buttons: [
        { label: 'Yes', value: 'yes' },
        { label: 'No',  value: 'no' },
      ],
      onSubmit: v => { picked = v; },
    });
    const h = mountViewAsModalSurface({
      id: 'dlg',
      bounds: { row: 2, col: 3, width: 30, height: 5 },
      view: d,
    });
    h.surface.paint();
    // Dialog body is 'Proceed?' on row 1, buttons on row 2. Dialog
    // is bordered → inner starts at +1,+1. Button bar right-aligned:
    // "[ Yes ] [ No ]" → [ No ] is at the far right.
    // Find button registrations to locate them dynamically.
    // We hit the Yes button by finding the first clickable labelled
    // within the bar row.
    const regs = h.surface.paint();
    // Rather than parse ANSI, we rely on the registry via re-paint
    // and the internal snapshot — use a direct hit approach:
    // Click at the bottom row, near the right.
    // Build-time bounds: bordered dialog → button bar at row height-2.
    // height=5 so button row is absolute row 2 + 3 = 5.
    // button bar right-aligned: "[ Yes ] [ No ]" ends at inner right
    // (col 3+28=31). [ No ] = 6 cells → cols 26..31. [ Yes ] = 7
    // cells (includes a space separator before 'No'): 18..24.
    // Click one cell into [ Yes ].
    void regs;
    const res = h.handleMouse(mouse('click', 5, 20));
    expect(res).toBe('consumed');
    expect(picked).toBe('yes');
  });
});
