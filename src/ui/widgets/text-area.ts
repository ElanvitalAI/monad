// LC8 — TextArea: multi-line text view.
//
// MVP focuses on the most common monad use case: a read-only
// multiline viewer for diffs, logs, and stdout/stderr — with
// vertical + horizontal scrolling and optional soft-wrap. Editable
// mode is included as a thin extension (insertion, backspace,
// Enter → new line) but the single-line EditView (LC7) should
// still be preferred for short answers.
//
// Navigation (readOnly and editable):
//   ↑↓/j/k       — line scroll
//   ←→           — column scroll (no-wrap mode)
//   PgUp/PgDn    — page scroll
//   Home/End     — line start/end (cursor in editable mode)
//   Ctrl-Home/End— document top/bottom
//
// Editable mode adds insertion at cursor plus Enter = newline,
// Backspace = delete prev char, Delete = delete at cursor.

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
import { keyEventToTextInsertion } from '../../input-core/text-entry.js';

export interface TextAreaSpec {
  text?: string;
  readOnly?: boolean;
  wrap?: boolean;
  maxLength?: number;
  onChange?: (text: string) => void;
  /** IDX-6 round-2 — optional theme. Cursor bar resolves from
   *  `selectView.cursor` when set. Absent = legacy C.accent. */
  theme?: ThemeTokens;
}

export class TextArea implements View {
  private lines: string[];
  private scrollY = 0;
  private scrollX = 0;
  private row = 0;
  private col = 0;
  private focused = false;
  private size: Size = { width: 40, height: 8 };

  constructor(private spec: TextAreaSpec = {}) {
    this.lines = (spec.text ?? '').split('\n');
  }

  get text(): string { return this.lines.join('\n'); }

  setText(t: string): void {
    this.lines = t.split('\n');
    this.clampCursor();
    this.ensureCursorVisible();
  }

  draw(p: Printer): void {
    this.size = { width: p.width, height: p.height };
    const wrap = this.spec.wrap ?? false;

    const rendered = wrap ? this.wrapLines(p.width) : this.lines;
    const maxRow = Math.max(0, rendered.length - 1);
    // Keep the cursor visible given the printer's current viewport
    if (this.row < this.scrollY) this.scrollY = this.row;
    if (this.row >= this.scrollY + p.height) this.scrollY = this.row - p.height + 1;
    this.scrollY = Math.max(0, Math.min(this.scrollY, maxRow));

    for (let row = 0; row < p.height; row++) {
      const abs = this.scrollY + row;
      if (abs > maxRow) break;
      const line = rendered[abs]!;
      const slice = wrap ? line : line.slice(this.scrollX, this.scrollX + p.width);
      p.text(0, row, slice);
    }

    if (this.focused && p.focused && !this.spec.readOnly) {
      const visibleRow = this.row - this.scrollY;
      const visibleCol = wrap ? 0 : this.col - this.scrollX;
      if (visibleRow >= 0 && visibleRow < p.height && visibleCol >= 0 && visibleCol < p.width) {
        p.text(visibleCol, visibleRow, this.cursorPainter()('▎'));
      }
    }
  }

  private cursorPainter(): (s: string) => string {
    const { theme } = this.spec;
    if (!theme) return C.accent;
    return paintPair(resolveWidgetTokens(theme, 'selectView').cursor);
  }

  private wrapLines(width: number): string[] {
    if (width <= 0) return [];
    const out: string[] = [];
    for (const line of this.lines) {
      if (cellWidth(line) <= width) { out.push(line); continue; }
      let buf = '';
      let w = 0;
      for (const ch of line) {
        const cw = cellWidth(ch);
        if (w + cw > width) { out.push(buf); buf = ch; w = cw; }
        else { buf += ch; w += cw; }
      }
      if (buf) out.push(buf);
    }
    return out;
  }

  onEvent(ev: KeyEvent): EventResult {
    if (!this.focused) return Ignored;
    const n = ev.name;

    if (n === 'up'   || (ev.ctrl && n === 'p') || n === 'k') { this.move(-1, 0); return Consumed(); }
    if (n === 'down' || (ev.ctrl && n === 'n') || n === 'j') { this.move(+1, 0); return Consumed(); }
    if (n === 'pageup')   { this.move(-this.size.height, 0); return Consumed(); }
    if (n === 'pagedown') { this.move(+this.size.height, 0); return Consumed(); }
    if (n === 'left')  { this.move(0, -1); return Consumed(); }
    if (n === 'right') { this.move(0, +1); return Consumed(); }
    if (n === 'home') {
      if (ev.ctrl) { this.row = 0; this.col = 0; }
      else this.col = 0;
      this.ensureCursorVisible();
      return Consumed();
    }
    if (n === 'end') {
      if (ev.ctrl) { this.row = this.lines.length - 1; }
      this.col = this.currentLine().length;
      this.ensureCursorVisible();
      return Consumed();
    }

    if (!this.spec.readOnly) {
      if (n === 'enter') { this.insertNewline(); return Consumed(); }
      if (n === 'backspace') { this.backspace(); return Consumed(); }
      if (n === 'delete')    { this.deleteChar(); return Consumed(); }
      const inserted = keyEventToTextInsertion(ev);
      if (inserted !== null) { this.insertChar(inserted); return Consumed(); }
    }
    return Ignored;
  }

  private currentLine(): string { return this.lines[this.row] ?? ''; }

  private move(dRow: number, dCol: number): void {
    this.row = Math.max(0, Math.min(this.lines.length - 1, this.row + dRow));
    this.col = Math.max(0, Math.min(this.currentLine().length, this.col + dCol));
    this.ensureCursorVisible();
  }

  private clampCursor(): void {
    this.row = Math.max(0, Math.min(this.lines.length - 1, this.row));
    this.col = Math.max(0, Math.min(this.currentLine().length, this.col));
  }

  private ensureCursorVisible(): void {
    if (this.row < this.scrollY) this.scrollY = this.row;
    if (this.row >= this.scrollY + this.size.height) this.scrollY = this.row - this.size.height + 1;
    if (!(this.spec.wrap ?? false)) {
      if (this.col < this.scrollX) this.scrollX = this.col;
      if (this.col >= this.scrollX + this.size.width) this.scrollX = this.col - this.size.width + 1;
    }
  }

  private insertChar(ch: string): void {
    if (this.atCap()) return;
    const line = this.currentLine();
    this.lines[this.row] = line.slice(0, this.col) + ch + line.slice(this.col);
    this.col += ch.length;
    this.spec.onChange?.(this.text);
    this.ensureCursorVisible();
  }

  private insertNewline(): void {
    if (this.atCap()) return;
    const line = this.currentLine();
    this.lines[this.row] = line.slice(0, this.col);
    this.lines.splice(this.row + 1, 0, line.slice(this.col));
    this.row++;
    this.col = 0;
    this.spec.onChange?.(this.text);
    this.ensureCursorVisible();
  }

  private backspace(): void {
    if (this.col > 0) {
      const line = this.currentLine();
      this.lines[this.row] = line.slice(0, this.col - 1) + line.slice(this.col);
      this.col--;
    } else if (this.row > 0) {
      const prev = this.lines[this.row - 1]!;
      this.col = prev.length;
      this.lines[this.row - 1] = prev + this.currentLine();
      this.lines.splice(this.row, 1);
      this.row--;
    } else return;
    this.spec.onChange?.(this.text);
    this.ensureCursorVisible();
  }

  private deleteChar(): void {
    const line = this.currentLine();
    if (this.col < line.length) {
      this.lines[this.row] = line.slice(0, this.col) + line.slice(this.col + 1);
    } else if (this.row < this.lines.length - 1) {
      this.lines[this.row] = line + this.lines[this.row + 1]!;
      this.lines.splice(this.row + 1, 1);
    } else return;
    this.spec.onChange?.(this.text);
  }

  private atCap(): boolean {
    const max = this.spec.maxLength;
    if (!max) return false;
    return this.text.length >= max;
  }

  layout(size: Size): void { this.size = size; }

  requiredSize(c: Size): Size {
    return { width: c.width, height: Math.min(c.height, Math.max(1, this.lines.length)) };
  }

  takeFocus(_src?: FocusSource): boolean { this.focused = true; return true; }
  blur(): void { this.focused = false; }
}
