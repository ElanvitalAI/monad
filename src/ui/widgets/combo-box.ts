// LC9 — ComboBox: EditView + dropdown SelectView.
//
// One-line field that shows matching options as the user types.
// Enter picks the highlighted option; if the input exactly matches
// no option and `allowFreeform: true`, the typed text is returned
// as the value. ↑↓ moves the dropdown selection.
//
// Meant for short picker lists (git branch, session, worktree name)
// where search + optional new-value entry is the shape of the UI.

import type { KeyEvent } from '../../plugins/core/types.js';
import { C } from '../../tui.js';
import { filterInputMatches } from '../../input/query-match.js';
import type { WidgetChromeSpec } from '../declarative/spec.js';
import { resolveWidgetChromeBoxViewOptions } from '../declarative/index.js';
import { resolvePickerChromeSpec } from '../chrome/picker-chrome.js';
import type { Printer } from '../printer.js';
import { BoxView, Consumed, Ignored, type EventResult, type FocusSource, type Size, type View } from '../view.js';
import {
  isClickIntentMouseEventType,
  isPrimaryClickMouseEventType,
  type MouseEvent,
} from '../mouse-events.js';
import { EditView } from './edit-view.js';

export interface ComboBoxOption<T> {
  value: T;
  label: string;
  description?: string;
}

export interface ComboBoxSpec<T> {
  options: ComboBoxOption<T>[];
  title?: string;
  placeholder?: string;
  initialValue?: string;
  /** If the typed string doesn't match any option, Enter returns it as-is. */
  allowFreeform?: boolean;
  visibleRows?: number;
  onSubmit: (value: T | string) => void;
  onCancel?: () => void;
  /** MD4 — when true, clicking a dropdown row highlights it only;
   *  double-click (or Enter) submits. Default false keeps the MX-era
   *  "click == submit" dropdown behaviour. */
  browseMode?: boolean;
  chromeSpec?: WidgetChromeSpec;
}

export class ComboBox<T> implements View {
  private dropdownIdx = 0;
  private readonly root: View | null;
  private readonly input: EditView;

  constructor(private spec: ComboBoxSpec<T>) {
    this.input = new EditView({
      initialValue: spec.initialValue,
      placeholder: spec.placeholder,
      onChange: () => { this.dropdownIdx = 0; },
      onCancel: spec.onCancel,
      // ComboBox owns Enter semantics so the shared input primitive
      // handles editing while the wrapper decides what selection means.
      onSubmit: () => {},
    });
    this.root = spec.title || spec.chromeSpec
      ? new BoxView(this.contentView(), resolveWidgetChromeBoxViewOptions(
          undefined,
          resolvePickerChromeSpec({
            title: spec.title ?? 'Choices',
            primaryAction: 'submit',
            filterable: true,
            browseMode: spec.browseMode,
            defaultVariant: 'panel',
            defaultShowClose: false,
            chromeSpec: {
              titleAlign: 'center',
              ...spec.chromeSpec,
            },
          }),
          spec.title ?? 'Choices',
        ))
      : null;
  }

  get value(): string { return this.input.value; }

  private filtered(): ComboBoxOption<T>[] {
    if (!this.input.value) return this.spec.options;
    return filterInputMatches(
      this.spec.options,
      this.input.value,
      (option) => `${option.label}\n${option.description ?? ''}`,
      'substring',
    );
  }

  draw(p: Printer): void {
    if (this.root) {
      this.root.draw(p);
      return;
    }
    this.drawInner(p);
  }

  private drawInner(p: Printer): void {
    this.input.draw(p.sub(0, 0, p.width, 1, { focused: p.focused }));

    // Dropdown
    const matches = this.filtered();
    const rows = Math.min(matches.length, this.spec.visibleRows ?? 6, Math.max(0, p.height - 1));
    if (this.dropdownIdx >= matches.length) this.dropdownIdx = Math.max(0, matches.length - 1);
    for (let i = 0; i < rows; i++) {
      const opt = matches[i]!;
      const isCursor = i === this.dropdownIdx;
      const mark = isCursor ? C.accent('❯') : ' ';
      const desc = opt.description ? '  ' + C.subtext(opt.description) : '';
      const line = `${mark} ${opt.label}${desc}`;
      p.text(0, 1 + i, isCursor && p.focused ? C.bold(line) : line);
      // MX7 — each visible dropdown row is clickable. Payload carries
      // the match index (not the raw option index) since filtering
      // may have shrunk the list.
      p.clickable({ x: 0, y: 1 + i, width: p.width, height: 1 }, this, { kind: 'row', matchIdx: i });
    }
    // Input line is clickable too — lets a mouse user focus the
    // editor just by clicking into it.
    p.clickable({ x: 0, y: 0, width: p.width, height: 1 }, this, { kind: 'input' });
  }

  onEvent(ev: KeyEvent): EventResult {
    if (this.root) return this.root.onEvent(ev);
    return this.onEventInner(ev);
  }

  private onEventInner(ev: KeyEvent): EventResult {
    const n = ev.name;
    const matches = this.filtered();

    if (n === 'escape') { this.spec.onCancel?.(); return Consumed(); }
    if (n === 'up')   { if (matches.length > 0) { this.dropdownIdx = (this.dropdownIdx - 1 + matches.length) % matches.length; } return Consumed(); }
    if (n === 'down') { if (matches.length > 0) { this.dropdownIdx = (this.dropdownIdx + 1) % matches.length; } return Consumed(); }
    if (n === 'enter') {
      if (matches[this.dropdownIdx]) this.spec.onSubmit(matches[this.dropdownIdx]!.value);
      else if (this.spec.allowFreeform) this.spec.onSubmit(this.input.value);
      else this.spec.onCancel?.();
      return Consumed();
    }
    return this.input.onEvent(ev);
  }

  // MX7 + MD4 — mouse support.
  //   - click dropdown row → set dropdownIdx
  //   - double-click row   → submit
  //   - click input row    → focus
  //   - scroll-up/down     → move dropdownIdx
  onMouse(ev: MouseEvent): EventResult {
    return this.onMouseInner(ev);
  }

  private onMouseInner(ev: MouseEvent): EventResult {
    const matches = this.filtered();
    if (ev.type === 'scroll-up' && matches.length > 0) {
      this.dropdownIdx = (this.dropdownIdx - 1 + matches.length) % matches.length;
      return Consumed();
    }
    if (ev.type === 'scroll-down' && matches.length > 0) {
      this.dropdownIdx = (this.dropdownIdx + 1) % matches.length;
      return Consumed();
    }
    if (isClickIntentMouseEventType(ev.type)) {
      const p = ev.payload as { kind?: string; matchIdx?: number } | undefined;
      if (p?.kind === 'input') {
        this.input.takeFocus('front');
        return Consumed();
      }
      if (p?.kind === 'row' && typeof p.matchIdx === 'number') {
        const idx = p.matchIdx;
        if (idx >= 0 && idx < matches.length) {
          this.dropdownIdx = idx;
          if (isPrimaryClickMouseEventType(ev.type)) return Consumed();
          this.spec.onSubmit(matches[idx]!.value);
          return Consumed();
        }
      }
    }
    return Ignored;
  }

  layout(s: Size): void {
    if (this.root) {
      this.root.layout(s);
      return;
    }
    this.input.layout({ width: s.width, height: 1 });
  }

  requiredSize(c: Size): Size {
    if (this.root) return this.root.requiredSize(c);
    return this.requiredSizeInner(c);
  }

  private requiredSizeInner(c: Size): Size {
    const rows = Math.min(this.spec.options.length, this.spec.visibleRows ?? 6) + 1;
    return { width: c.width, height: Math.min(c.height, rows) };
  }

  takeFocus(s?: FocusSource): boolean {
    if (this.root) return this.root.takeFocus(s);
    return this.input.takeFocus(s);
  }
  blur(): void { this.input.blur(); }

  private contentView(): View {
    return {
      draw: (p) => this.drawInner(p),
      onEvent: (ev) => this.onEventInner(ev),
      onMouse: (ev) => this.onMouseInner(ev),
      layout: (size) => { this.input.layout({ width: size.width, height: 1 }); },
      requiredSize: (c) => this.requiredSizeInner(c),
      takeFocus: (source) => this.input.takeFocus(source),
    };
  }
}
