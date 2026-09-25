// LC8 — Accordion: vertically stacked foldable sections.
//
// Each section has a title row plus an optional body view. Enter /
// Space on the title toggles open/closed. Up/Down navigates between
// titles; when inside an open section, Tab cycles into the body.
//
// IDX-6 round-2 (2026-04-19) — optional theme. Cursor glyph + bolded
// focused row resolve from `selectView.cursor`; consistent with
// SelectView / ListView cursor styling so themed apps look unified.

import type { KeyEvent } from '../../plugins/core/types.js';
import {
  paintPair,
  resolveWidgetTokens,
  type ThemeTokens,
} from '../../theme/tokens.js';
import { C } from '../../tui.js';
import type { Printer } from '../printer.js';
import { cellWidth } from '../printer.js';
import { Consumed, Ignored, type EventResult, type FocusSource, type Size, type View } from '../view.js';
import { moveCursorBy, moveCursorToEdge } from './selection-cursor.js';

export interface AccordionSection {
  title: string;
  content: View;
  /** Fixed rows the body wants when open. If omitted, asks content. */
  openHeight?: number;
  openByDefault?: boolean;
}

export interface AccordionSpec {
  sections: AccordionSection[];
  /** At most one section open at a time. */
  exclusive?: boolean;
  /** IDX-6 round-2 — optional theme. Absent = legacy C.* painters. */
  theme?: ThemeTokens;
}

export class Accordion implements View {
  private open: boolean[];
  private cursor = 0;
  private focused = false;

  constructor(private spec: AccordionSpec) {
    this.open = spec.sections.map(s => !!s.openByDefault);
  }

  draw(p: Printer): void {
    const cursorPaint = this.cursorPainter();
    let y = 0;
    for (let i = 0; i < this.spec.sections.length; i++) {
      if (y >= p.height) break;
      const sec = this.spec.sections[i]!;
      const isOpen = this.open[i]!;
      const isCursor = i === this.cursor;
      const caret = isOpen ? '▾' : '▸';
      const title = `${isCursor ? cursorPaint('❯') : ' '} ${caret} ${sec.title}`;
      p.text(0, y, isCursor && p.focused && this.focused ? cursorPaint(title) : title);
      y++;

      if (isOpen) {
        const maxH = Math.min(
          sec.openHeight ?? sec.content.requiredSize({ width: p.width - 2, height: p.height - y }).height,
          p.height - y,
        );
        if (maxH > 0) {
          const body = p.sub(2, y, Math.max(0, p.width - 2), maxH);
          sec.content.draw(body);
          y += maxH;
        }
      }
    }
  }

  onEvent(ev: KeyEvent): EventResult {
    if (!this.focused) return Ignored;
    const n = this.spec.sections.length;
    if (n === 0) return Ignored;

    if (ev.name === 'up'   || ev.name === 'k') { this.cursor = moveCursorBy(this.cursor, n, -1); return Consumed(); }
    if (ev.name === 'down' || ev.name === 'j') { this.cursor = moveCursorBy(this.cursor, n, 1); return Consumed(); }
    if (ev.name === 'home') { this.cursor = moveCursorToEdge(n, 'start'); return Consumed(); }
    if (ev.name === 'end')  { this.cursor = moveCursorToEdge(n, 'end'); return Consumed(); }
    if (ev.name === 'enter' || ev.name === 'space') {
      if (this.spec.exclusive) {
        const wasOpen = this.open[this.cursor];
        this.open = this.open.map(() => false);
        this.open[this.cursor] = !wasOpen;
      } else {
        this.open[this.cursor] = !this.open[this.cursor];
      }
      return Consumed();
    }
    return Ignored;
  }

  layout(_s: Size): void { /* no cached layout */ }

  requiredSize(c: Size): Size {
    let h = 0;
    for (let i = 0; i < this.spec.sections.length; i++) {
      h++;
      if (this.open[i]) {
        const sec = this.spec.sections[i]!;
        const innerH = sec.openHeight ?? sec.content.requiredSize({ width: c.width - 2, height: c.height }).height;
        h += innerH;
      }
    }
    return { width: c.width, height: Math.min(c.height, Math.max(1, h)) };
  }

  takeFocus(_s?: FocusSource): boolean { this.focused = true; return true; }

  private cursorPainter(): (s: string) => string {
    const { theme } = this.spec;
    if (!theme) return (s: string) => C.bold(C.accent(s));
    return paintPair(resolveWidgetTokens(theme, 'selectView').cursor);
  }

  /** @internal — tests. */
  _state() { return { cursor: this.cursor, open: [...this.open] }; }
}
