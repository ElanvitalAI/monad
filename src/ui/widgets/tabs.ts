// LC8 — Tabs: horizontal tab bar + content area.
//
// A tab bar across the top row, with the active tab's view filling
// the remaining area. Tab / Shift+Tab (or Ctrl+Right/Left) cycles
// the active tab. All other keys route to the active content view.
//
// IDX-6 round-2 (2026-04-19) — optional theme. Active tab uses
// `selectView.cursor`, inactive tabs use `semantic.muted` so the
// color relationship matches SelectView cursor-vs-other rows.

import type { KeyEvent } from '../../plugins/core/types.js';
import {
  paintPair,
  resolveSemantic,
  resolveWidgetTokens,
  type ThemeTokens,
} from '../../theme/tokens.js';
import { C } from '../../tui.js';
import type { MouseEvent } from '../mouse-events.js';
import type { Printer } from '../printer.js';
import { cellWidth } from '../printer.js';
import { Consumed, Ignored, type EventResult, type FocusSource, type Size, type View } from '../view.js';
import { cycleCursor } from './selection-cursor.js';

export interface TabSpec {
  title: string;
  content: View;
}

export interface TabsSpec {
  tabs: TabSpec[];
  initialActive?: number;
  onChange?: (active: number) => void;
  /** IDX-6 round-2 — optional theme. Absent = legacy C.* painters. */
  theme?: ThemeTokens;
}

export class Tabs implements View {
  private active: number;
  private focusInBar = true;

  constructor(private spec: TabsSpec) {
    this.active = Math.max(0, Math.min((spec.initialActive ?? 0), spec.tabs.length - 1));
  }

  get activeIndex(): number { return this.active; }

  draw(p: Printer): void {
    const activePaint = this.activePainter();
    const mutedPaint = this.mutedPainter();
    if (this.spec.tabs.length === 0) {
      p.text(0, 0, mutedPaint('(no tabs)'));
      return;
    }
    let x = 0;
    for (let i = 0; i < this.spec.tabs.length; i++) {
      const t = this.spec.tabs[i]!;
      const isActive = i === this.active;
      const label = ` ${t.title} `;
      const styled = isActive ? activePaint(label) : mutedPaint(label);
      p.text(x, 0, styled);
      x += cellWidth(label) + 1;
    }

    const body = p.sub(0, 1, p.width, Math.max(0, p.height - 1), { focused: p.focused && !this.focusInBar });
    const content = this.spec.tabs[this.active]?.content;
    if (content && body.height > 0) content.draw(body);
  }

  onEvent(ev: KeyEvent): EventResult {
    const n = this.spec.tabs.length;
    if (n === 0) return Ignored;

    // Active tab cycling always available
    if (ev.name === 'tab') {
      const dir = ev.shift ? -1 : +1;
      this.active = cycleCursor(this.active, n, dir);
      this.spec.onChange?.(this.active);
      return Consumed();
    }
    if (ev.ctrl && (ev.name === 'right' || ev.name === 'n')) {
      this.active = cycleCursor(this.active, n, 1);
      this.spec.onChange?.(this.active);
      return Consumed();
    }
    if (ev.ctrl && (ev.name === 'left' || ev.name === 'p')) {
      this.active = cycleCursor(this.active, n, -1);
      this.spec.onChange?.(this.active);
      return Consumed();
    }

    // Route other keys to active content
    const content = this.spec.tabs[this.active]?.content;
    if (content) {
      this.focusInBar = false;
      const r = content.onEvent(ev);
      if (r.kind === 'consumed') return r;
    }
    return Ignored;
  }

  onMouse(ev: MouseEvent): EventResult {
    const n = this.spec.tabs.length;
    if (n === 0) return Ignored;
    if (ev.y === 0) {
      const idx = this.hitTabIndex(ev.x);
      if (idx < 0) return Ignored;
      this.active = idx;
      this.focusInBar = true;
      this.spec.onChange?.(idx);
      return Consumed();
    }
    if (ev.y <= 0) return Ignored;
    const content = this.spec.tabs[this.active]?.content;
    if (!content?.onMouse) return Ignored;
    this.focusInBar = false;
    return content.onMouse({
      ...ev,
      y: ev.y - 1,
      absY: ev.absY - 1,
    });
  }

  layout(s: Size): void {
    const inner: Size = { width: s.width, height: Math.max(0, s.height - 1) };
    for (const t of this.spec.tabs) t.content.layout(inner);
  }

  requiredSize(c: Size): Size {
    const active = this.spec.tabs[this.active];
    if (!active) return { width: c.width, height: Math.min(c.height, 1) };
    const inner = active.content.requiredSize({ width: c.width, height: Math.max(0, c.height - 1) });
    return { width: c.width, height: Math.min(c.height, inner.height + 1) };
  }

  takeFocus(_s?: FocusSource): boolean {
    this.focusInBar = true;
    const content = this.spec.tabs[this.active]?.content;
    if (content) content.takeFocus('front');
    return true;
  }

  setActive(i: number): void {
    if (i < 0 || i >= this.spec.tabs.length) return;
    this.active = i;
    this.spec.onChange?.(i);
  }

  private hitTabIndex(x: number): number {
    let cursor = 0;
    for (let i = 0; i < this.spec.tabs.length; i++) {
      const label = ` ${this.spec.tabs[i]!.title} `;
      const width = cellWidth(label);
      if (x >= cursor && x < cursor + width) return i;
      cursor += width + 1;
    }
    return -1;
  }

  private activePainter(): (s: string) => string {
    const { theme } = this.spec;
    if (!theme) {
      const accent = C.accent;
      return (s: string) => (this.focusInBar ? C.bold(accent(s)) : accent(s));
    }
    return paintPair(resolveWidgetTokens(theme, 'selectView').cursor);
  }

  private mutedPainter(): (s: string) => string {
    const { theme } = this.spec;
    if (!theme) return C.muted;
    return paintPair(resolveSemantic(theme, 'muted'));
  }
}
