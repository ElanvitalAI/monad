// LC5 — LinearLayout: vertical / horizontal box layout.
//
// Children are laid out in order along the primary axis. Each child
// can declare a fixed size or take remaining space (weight=1 style,
// uniform flex). Focus moves between focusable children via arrow
// keys along the primary axis. Events go to the focused child first;
// if Ignored, the LinearLayout tries arrow-key focus navigation.

import { Ignored, Consumed, type EventResult, type FocusSource, type Size, type View } from '../view.js';
import type { Printer } from '../printer.js';
import type { KeyEvent } from '../../plugins/core/types.js';

export type Orientation = 'vertical' | 'horizontal';

export interface LinearChild {
  view: View;
  /** Fixed size along the primary axis. When omitted, the child gets
   *  an equal share of whatever's left after the fixed-size siblings
   *  claim their space. */
  size?: number;
}

export class LinearLayout implements View {
  private children: LinearChild[] = [];
  private focusIndex = -1;            // -1 = no focus held
  private layoutSize: Size = { width: 0, height: 0 };

  constructor(private orientation: Orientation) {}

  static vertical(...children: (View | LinearChild)[]): LinearLayout {
    const l = new LinearLayout('vertical');
    for (const c of children) l.add(c);
    return l;
  }

  static horizontal(...children: (View | LinearChild)[]): LinearLayout {
    const l = new LinearLayout('horizontal');
    for (const c of children) l.add(c);
    return l;
  }

  add(child: View | LinearChild): this {
    if ('view' in child) this.children.push({ ...child });
    else this.children.push({ view: child });
    return this;
  }

  /** Which child currently holds focus, if any. */
  focusedChild(): View | null {
    if (this.focusIndex < 0 || this.focusIndex >= this.children.length) return null;
    return this.children[this.focusIndex]!.view;
  }

  draw(p: Printer): void {
    const slices = this.computeSlices(this.orientation === 'vertical' ? p.height : p.width);
    for (let i = 0; i < this.children.length; i++) {
      const s = slices[i]!;
      if (s.size <= 0) continue;
      const region = this.orientation === 'vertical'
        ? p.sub(0, s.offset, p.width, s.size, { focused: i === this.focusIndex && p.focused })
        : p.sub(s.offset, 0, s.size, p.height, { focused: i === this.focusIndex && p.focused });
      this.children[i]!.view.draw(region);
    }
  }

  onEvent(ev: KeyEvent): EventResult {
    // Route to focused child first.
    if (this.focusIndex >= 0 && this.focusIndex < this.children.length) {
      const r = this.children[this.focusIndex]!.view.onEvent(ev);
      if (r.kind === 'consumed') return r;
    }
    // Child ignored → try arrow-key focus navigation.
    const nextKey = this.orientation === 'vertical' ? 'down' : 'right';
    const prevKey = this.orientation === 'vertical' ? 'up' : 'left';
    if (ev.name === nextKey) {
      if (this.moveFocus(+1)) return Consumed();
    }
    if (ev.name === prevKey) {
      if (this.moveFocus(-1)) return Consumed();
    }
    if (ev.name === 'tab') {
      if (this.moveFocus(ev.shift ? -1 : +1)) return Consumed();
    }
    return Ignored;
  }

  layout(size: Size): void {
    this.layoutSize = size;
    const slices = this.computeSlices(this.orientation === 'vertical' ? size.height : size.width);
    for (let i = 0; i < this.children.length; i++) {
      const s = slices[i]!;
      const childSize: Size = this.orientation === 'vertical'
        ? { width: size.width, height: s.size }
        : { width: s.size, height: size.height };
      this.children[i]!.view.layout(childSize);
    }
  }

  requiredSize(constraint: Size): Size {
    // Primary axis: sum of child requests (constrained).
    // Cross axis: max of child requests (constrained).
    let primary = 0;
    let cross = 0;
    for (const c of this.children) {
      const req = c.view.requiredSize(constraint);
      if (this.orientation === 'vertical') {
        primary += c.size ?? req.height;
        cross = Math.max(cross, req.width);
      } else {
        primary += c.size ?? req.width;
        cross = Math.max(cross, req.height);
      }
    }
    return this.orientation === 'vertical'
      ? {
          width: Math.min(constraint.width, cross),
          height: Math.min(constraint.height, primary),
        }
      : {
          width: Math.min(constraint.width, primary),
          height: Math.min(constraint.height, cross),
        };
  }

  takeFocus(source?: FocusSource): boolean {
    const range = source === 'back'
      ? Array.from({ length: this.children.length }, (_, i) => this.children.length - 1 - i)
      : Array.from({ length: this.children.length }, (_, i) => i);
    for (const i of range) {
      if (this.children[i]!.view.takeFocus(source)) {
        this.focusIndex = i;
        return true;
      }
    }
    this.focusIndex = -1;
    return false;
  }

  /** Try to move focus by `delta`. Returns true if focus changed. */
  private moveFocus(delta: number): boolean {
    const n = this.children.length;
    if (n === 0) return false;
    let start = this.focusIndex;
    if (start < 0) start = delta > 0 ? -1 : n;
    for (let step = 1; step <= n; step++) {
      const i = (start + delta * step + n * step) % n;
      const idx = ((i % n) + n) % n;
      if (idx === this.focusIndex) continue;
      const child = this.children[idx]!;
      if (child.view.takeFocus(delta > 0 ? 'front' : 'back')) {
        this.focusIndex = idx;
        return true;
      }
    }
    return false;
  }

  /** Allocate primary-axis space to children. Fixed-size children
   *  take their declared size first; remaining is split equally
   *  among flex children. Sizes clip to non-negative. */
  private computeSlices(total: number): { offset: number; size: number }[] {
    const n = this.children.length;
    const sizes = new Array<number>(n).fill(0);
    let fixedSum = 0;
    let flexCount = 0;
    for (let i = 0; i < n; i++) {
      const c = this.children[i]!;
      if (c.size !== undefined) {
        sizes[i] = Math.max(0, c.size);
        fixedSum += sizes[i]!;
      } else {
        flexCount++;
      }
    }
    const remaining = Math.max(0, total - fixedSum);
    if (flexCount > 0) {
      const share = Math.floor(remaining / flexCount);
      let leftover = remaining - share * flexCount;
      for (let i = 0; i < n; i++) {
        if (this.children[i]!.size === undefined) {
          sizes[i] = share + (leftover > 0 ? 1 : 0);
          if (leftover > 0) leftover--;
        }
      }
    }
    const slices: { offset: number; size: number }[] = [];
    let off = 0;
    for (let i = 0; i < n; i++) {
      slices.push({ offset: off, size: sizes[i]! });
      off += sizes[i]!;
    }
    return slices;
  }
}
