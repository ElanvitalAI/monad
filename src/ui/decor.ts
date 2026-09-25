// LC5 — decor helpers.
//
// Convenience wrappers around BoxView + shadow. These are view
// transformers: they take a View and return a new View that adds
// some visual treatment (border, shadow, fill) without touching
// the underlying focus/event plumbing.

import { BoxView, type View } from './view.js';
import { type Printer } from './printer.js';
import type { KeyEvent } from '../plugins/core/types.js';
import type { Size, FocusSource, EventResult } from './view.js';

export interface BorderOpts {
  title?: string;
  style?: string;
}

export function withBorder(inner: View, opts: BorderOpts = {}): View {
  return new BoxView(inner, { border: true, title: opts.title, style: opts.style });
}

export function withFill(inner: View, ch: string, style = ''): View {
  return new BoxView(inner, { border: false, fill: ch, style });
}

export function withTitle(inner: View, title: string, style = ''): View {
  return new BoxView(inner, { border: true, title, style });
}

/** ShadowView adds a 1-cell shadow on the right and bottom. The
 *  shadow is drawn into the region outside the inner view's
 *  effective size — callers should ensure the allocated region is
 *  at least `innerSize + (1, 1)`. */
export class ShadowView implements View {
  constructor(private inner: View, private style = '\x1b[2m') {}

  draw(p: Printer): void {
    const iw = Math.max(0, p.width - 1);
    const ih = Math.max(0, p.height - 1);
    if (iw > 0 && ih > 0) {
      this.inner.draw(p.sub(0, 0, iw, ih));
    }
    // Shadow right edge (skip top cell — hangs off).
    for (let y = 1; y < p.height; y++) {
      p.char(p.width - 1, y, '▒', this.style);
    }
    // Shadow bottom edge (skip leftmost cell — hangs off).
    for (let x = 1; x < p.width; x++) {
      p.char(x, p.height - 1, '▒', this.style);
    }
  }

  onEvent(ev: KeyEvent): EventResult { return this.inner.onEvent(ev); }
  layout(size: Size): void {
    this.inner.layout({
      width: Math.max(0, size.width - 1),
      height: Math.max(0, size.height - 1),
    });
  }
  requiredSize(c: Size): Size {
    const inner = this.inner.requiredSize({
      width: Math.max(0, c.width - 1),
      height: Math.max(0, c.height - 1),
    });
    return {
      width: Math.min(c.width, inner.width + 1),
      height: Math.min(c.height, inner.height + 1),
    };
  }
  takeFocus(s?: FocusSource): boolean { return this.inner.takeFocus(s); }
}

export function withShadow(inner: View, style?: string): View {
  return new ShadowView(inner, style);
}
