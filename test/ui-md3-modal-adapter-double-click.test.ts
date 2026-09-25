// MD3 — modal-adapter.handleMouse forwards `double-click` events
// verbatim to the hit view's onMouse. No special drag / context-menu
// behavior — it is a normal click with a distinct type tag.

import { describe, expect, test } from 'bun:test';
import { Printer } from '../src/ui/printer.js';
import { mountViewAsModalSurface } from '../src/ui/modal-adapter.js';
import { Consumed, Ignored, type EventResult, type View } from '../src/ui/view.js';
import type { MouseEvent } from '../src/ui/mouse-events.js';

class RecordingView implements View {
  received: MouseEvent[] = [];
  draw(p: Printer): void {
    p.text(0, 0, 'X');
    p.clickable({ x: 0, y: 0, width: p.width, height: p.height }, this, { id: 'root' });
  }
  onEvent(): EventResult { return Ignored; }
  onMouse(ev: MouseEvent): EventResult { this.received.push(ev); return Consumed(); }
  layout(): void {}
  requiredSize() { return { width: 10, height: 3 }; }
  takeFocus() { return true; }
}

describe('MD3 — modal-adapter double-click forwarding', () => {
  test('double-click arrives at view with matching type', () => {
    const view = new RecordingView();
    const h = mountViewAsModalSurface({
      id: 'test',
      bounds: { row: 2, col: 3, width: 10, height: 3 },
      view,
    });
    h.surface.paint!();     // paint to populate registry
    const res = h.handleMouse({ type: 'double-click', row: 3, col: 5 });
    expect(res).toBe('consumed');
    expect(view.received.length).toBe(1);
    expect(view.received[0]!.type).toBe('double-click');
  });

  test('click and double-click are separate events', () => {
    const view = new RecordingView();
    const h = mountViewAsModalSurface({
      id: 'test',
      bounds: { row: 2, col: 3, width: 10, height: 3 },
      view,
    });
    h.surface.paint!();
    h.handleMouse({ type: 'click', row: 3, col: 5 });
    h.handleMouse({ type: 'double-click', row: 3, col: 5 });
    expect(view.received.length).toBe(2);
    expect(view.received[0]!.type).toBe('click');
    expect(view.received[1]!.type).toBe('double-click');
  });

  test('double-click outside bounds → passthrough', () => {
    const view = new RecordingView();
    const h = mountViewAsModalSurface({
      id: 'test',
      bounds: { row: 2, col: 3, width: 5, height: 3 },
      view,
    });
    h.surface.paint!();
    const res = h.handleMouse({ type: 'double-click', row: 10, col: 100 });
    expect(res).toBe('passthrough');
    expect(view.received.length).toBe(0);
  });
});
