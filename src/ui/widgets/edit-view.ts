// LC7 — EditView: single-line text input.
//
// A focused, editable line with cursor, insert/delete, left/right/
// home/end navigation, Ctrl-U (kill line), Ctrl-W (kill word).
// Submit on Enter, Cancel on Esc.
//
// This is the thin primitive shared by Dialog/ComboBox and the
// `inputType` fallback rendered in SelectView. Multi-line editing
// belongs in TextArea (LC8).

import { debug } from '../../debug/log.js';
import type { KeyEvent } from '../../plugins/core/types.js';
import { C } from '../../tui.js';
import type { Printer } from '../printer.js';
import { cellWidth } from '../printer.js';
import { Consumed, Ignored, type EventResult, type FocusSource, type Size, type View } from '../view.js';

export interface EditViewSpec {
  initialValue?: string;
  placeholder?: string;
  maxLength?: number;
  /** When set, draw this glyph instead of the real buffer contents.
   *  Input and submission still use the underlying value. */
  maskChar?: string;
  /** Fired on every content change (insertion, deletion). */
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  onCancel?: () => void;
  /** If true, empty Enter calls onCancel instead of onSubmit. */
  cancelOnEmptySubmit?: boolean;
}

export interface PromptEditViewSpec {
  initialValue?: string;
  placeholder?: string;
  maxLength?: number;
  maskChar?: string;
  onChange?: (value: string) => void;
  onCancel?: () => void;
  onSubmit?: (value: string) => void;
  submitMode?: 'raw' | 'trimmed';
  emptySubmit?: 'submit' | 'ignore' | 'cancel';
}

export class EditView implements View {
  private buffer: string;
  private cursor: number;
  private focused = false;

  constructor(private spec: EditViewSpec = {}) {
    this.buffer = spec.initialValue ?? '';
    this.cursor = this.buffer.length;
  }

  get value(): string { return this.buffer; }

  setValue(v: string): void {
    const from = this.cursor;
    this.buffer = v;
    this.cursor = Math.min(this.cursor, v.length);
    this.logCursorChange('set-value', from);
  }

  draw(p: Printer): void {
    const focused = this.focused && p.focused;
    if (!this.buffer && this.spec.placeholder) {
      const line = C.muted(this.spec.placeholder);
      if (focused) {
        p.text(0, 0, C.accent('▎'));
        p.text(1, 0, line);
      } else {
        p.text(0, 0, line);
      }
      return;
    }
    const mask = this.spec.maskChar;
    const rendered = mask ? mask.repeat(this.buffer.length) : this.buffer;
    const pre = rendered.slice(0, this.cursor);
    const post = rendered.slice(this.cursor);
    const caret = focused ? C.accent('▎') : '';
    p.text(0, 0, pre + caret + post);
  }

  onEvent(ev: KeyEvent): EventResult {
    if (!this.focused) return Ignored;
    const n = ev.name;

    if (n === 'escape') {
      this.spec.onCancel?.();
      return Consumed();
    }
    if (n === 'enter') {
      if (!this.buffer && this.spec.cancelOnEmptySubmit) {
        this.spec.onCancel?.();
        return Consumed();
      }
      this.spec.onSubmit?.(this.buffer);
      return Consumed();
    }
    if (n === 'left')  { this.moveCursor('left', Math.max(0, this.cursor - 1)); return Consumed(); }
    if (n === 'right') { this.moveCursor('right', Math.min(this.buffer.length, this.cursor + 1)); return Consumed(); }
    if (n === 'home')  { this.moveCursor('home', 0); return Consumed(); }
    if (n === 'end')   { this.moveCursor('end', this.buffer.length); return Consumed(); }
    if (n === 'backspace') {
      if (this.cursor > 0) {
        const from = this.cursor;
        this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
        this.cursor--;
        this.logCursorChange('backspace', from);
        this.spec.onChange?.(this.buffer);
      }
      return Consumed();
    }
    if (n === 'delete') {
      if (this.cursor < this.buffer.length) {
        const from = this.cursor;
        this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
        this.logCursorChange('delete', from);
        this.spec.onChange?.(this.buffer);
      }
      return Consumed();
    }
    if (ev.ctrl && n === 'u') {
      if (this.cursor > 0) {
        const from = this.cursor;
        this.buffer = this.buffer.slice(this.cursor);
        this.cursor = 0;
        this.logCursorChange('kill-line', from);
        this.spec.onChange?.(this.buffer);
      }
      return Consumed();
    }
    if (ev.ctrl && n === 'w') {
      if (this.cursor > 0) {
        const from = this.cursor;
        const before = this.buffer.slice(0, this.cursor);
        const after = this.buffer.slice(this.cursor);
        const m = before.match(/^(.*?)(\S*\s*)$/);
        const newBefore = m ? m[1]! : '';
        this.buffer = newBefore + after;
        this.cursor = newBefore.length;
        this.logCursorChange('kill-word', from);
        this.spec.onChange?.(this.buffer);
      }
      return Consumed();
    }
    if (n === 'space') { this.insert(' '); return Consumed(); }
    if (!ev.ctrl && !ev.alt && n.length === 1) {
      this.insert(n);
      return Consumed();
    }
    return Ignored;
  }

  private insert(ch: string): void {
    const max = this.spec.maxLength ?? Infinity;
    if (this.buffer.length >= max) return;
    const from = this.cursor;
    this.buffer = this.buffer.slice(0, this.cursor) + ch + this.buffer.slice(this.cursor);
    this.cursor += ch.length;
    this.logCursorChange('insert', from);
    this.spec.onChange?.(this.buffer);
  }

  private moveCursor(event: 'left' | 'right' | 'home' | 'end', cursor: number): void {
    const from = this.cursor;
    this.cursor = cursor;
    this.logCursorChange(event, from);
  }

  private logCursorChange(event: string, from: number): void {
    if (from === this.cursor) return;
    try {
      debug.log('ui.edit-view', event, { from, to: this.cursor });
    } catch { /* observability must not interrupt editing */ }
  }

  layout(_size: Size): void { /* no-op */ }

  requiredSize(constraint: Size): Size {
    const w = Math.max(cellWidth(this.buffer), cellWidth(this.spec.placeholder ?? ''), 1);
    return {
      width: Math.min(constraint.width, w + 1),   // + caret cell
      height: Math.min(constraint.height, 1),
    };
  }

  takeFocus(_src?: FocusSource): boolean { this.focused = true; return true; }
  blur(): void { this.focused = false; }
  isFocused(): boolean { return this.focused; }
}

export function createPromptEditView(spec: PromptEditViewSpec = {}): EditView {
  return new EditView({
    initialValue: spec.initialValue,
    placeholder: spec.placeholder,
    maxLength: spec.maxLength,
    maskChar: spec.maskChar,
    onChange: spec.onChange,
    onCancel: spec.onCancel,
    onSubmit: (value) => {
      const next = spec.submitMode === 'trimmed' ? value.trim() : value;
      const emptySubmit = spec.emptySubmit ?? 'submit';
      if (!next && emptySubmit === 'ignore') return;
      if (!next && emptySubmit === 'cancel') {
        spec.onCancel?.();
        return;
      }
      spec.onSubmit?.(next);
    },
  });
}
