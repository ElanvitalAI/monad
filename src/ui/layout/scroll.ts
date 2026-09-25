// LC5 — ScrollView: viewport over a taller inner content.
//
// The inner view is measured with an unbounded height and rendered
// into a full-height offscreen Printer; the visible slice (offset..
// offset+viewport) is copied into the visible region. Scrollbar
// painted on the right edge.

import type { Printer } from '../printer.js';
import { Printer as PrinterCls } from '../printer.js';
import { Consumed, Ignored, type EventResult, type FocusSource, type Size, type View } from '../view.js';
import type { KeyEvent } from '../../plugins/core/types.js';

export interface ScrollViewOptions {
  /** Show a right-edge scrollbar. Defaults to true. */
  scrollbar?: boolean;
}

export class ScrollView implements View {
  private offset = 0;
  private lastViewportH = 0;
  private lastContentH = 0;
  private lastInnerW = 0;

  constructor(private inner: View, private opts: ScrollViewOptions = {}) {}

  get scrollOffset(): number { return this.offset; }
  get contentHeight(): number { return this.lastContentH; }

  setScroll(off: number): void {
    const max = Math.max(0, this.lastContentH - this.lastViewportH);
    this.offset = Math.max(0, Math.min(off, max));
  }

  scrollBy(delta: number): void { this.setScroll(this.offset + delta); }

  draw(p: Printer): void {
    const hasBar = this.opts.scrollbar !== false;
    const innerW = Math.max(0, p.width - (hasBar ? 1 : 0));
    this.lastInnerW = innerW;
    this.lastViewportH = p.height;

    // Measure content at innerW × unbounded height to decide buffer size.
    const req = this.inner.requiredSize({ width: innerW, height: Number.MAX_SAFE_INTEGER });
    const contentH = Math.max(p.height, req.height);
    this.lastContentH = contentH;

    // Clamp offset after measurement in case content shrank.
    this.setScroll(this.offset);

    if (innerW === 0 || p.height === 0) return;

    // Paint inner into an offscreen buffer sized to full content.
    const buf = PrinterCls.create({ width: innerW, height: contentH, focused: p.focused });
    this.inner.layout({ width: innerW, height: contentH });
    this.inner.draw(buf);
    const lines = buf.lines();

    // Copy visible slice into the outer printer.
    for (let y = 0; y < p.height; y++) {
      const src = lines[this.offset + y];
      if (src !== undefined) p.text(0, y, src);
    }

    if (hasBar && p.height > 0 && contentH > p.height) {
      this.drawScrollbar(p, contentH);
    }
  }

  private drawScrollbar(p: Printer, contentH: number): void {
    const col = p.width - 1;
    const h = p.height;
    const thumbH = Math.max(1, Math.floor((h * h) / contentH));
    const maxOff = Math.max(1, contentH - h);
    const thumbTop = Math.min(h - thumbH, Math.floor((this.offset / maxOff) * (h - thumbH)));
    for (let y = 0; y < h; y++) {
      if (y >= thumbTop && y < thumbTop + thumbH) p.char(col, y, '█');
      else p.char(col, y, '│', '\x1b[2m');
    }
  }

  onEvent(ev: KeyEvent): EventResult {
    // Let the focused inner view handle first.
    const r = this.inner.onEvent(ev);
    if (r.kind === 'consumed') return r;
    if (ev.name === 'up')   { this.scrollBy(-1); return Consumed(); }
    if (ev.name === 'down') { this.scrollBy(+1); return Consumed(); }
    if (ev.name === 'pageup')   { this.scrollBy(-this.lastViewportH); return Consumed(); }
    if (ev.name === 'pagedown') { this.scrollBy(+this.lastViewportH); return Consumed(); }
    if (ev.name === 'home') { this.setScroll(0); return Consumed(); }
    if (ev.name === 'end')  { this.setScroll(Number.MAX_SAFE_INTEGER); return Consumed(); }
    return Ignored;
  }

  layout(size: Size): void { this.inner.layout(size); }

  requiredSize(constraint: Size): Size {
    // ScrollView wants whatever it's offered — content is virtual.
    return { width: constraint.width, height: constraint.height };
  }

  takeFocus(source?: FocusSource): boolean {
    return this.inner.takeFocus(source);
  }
}
