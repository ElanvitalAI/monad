import type { KeyEvent } from '../../plugins/core/types.js';
import type { MouseEvent } from '../mouse-events.js';
import { isIntentMouseEventType } from '../mouse-events.js';
import type { Printer } from '../printer.js';
import { Consumed, Ignored, type EventResult, type Size } from '../view.js';
import {
  createActionPickerRecipe,
  type ActionItem,
} from '../../mouse-action-recipes.js';
import type { ViewSurfaceHandle } from '../modal-adapter.js';
import {
  ansiForPair,
  DEFAULT_WIDGET_TOKENS,
  type ThemeTokens,
} from '../../theme/tokens.js';

export interface IulRailSelectOption {
  value: string;
  label: string;
}

export interface IulRailStaticControlModel {
  kind: 'static';
  id: string;
  label: string;
  valueLabel: string;
}

export interface IulRailSelectControlModel {
  kind: 'select';
  id: string;
  label: string;
  value: string;
  valueLabel: string;
  options: IulRailSelectOption[];
  title?: string;
  width?: number;
}

export type IulRailControlModel =
  | IulRailStaticControlModel
  | IulRailSelectControlModel;

interface RailRange {
  id: string;
  x0: number;
  x1: number;
  y: number;
}

export class IulTopControlRail {
  private size: Size = { width: 0, height: 0 };
  private ranges: RailRange[] = [];
  private openControlId: string | null = null;
  private openHandle: ViewSurfaceHandle | null = null;

  constructor(
    private readonly deps: {
      row?: number;
      resolveTheme: () => ThemeTokens;
      controls: () => readonly IulRailControlModel[];
      onPickSelect: (id: string, value: string) => void;
    },
  ) {}

  layout(size: Size): void {
    this.size = size;
    this.openHandle = null;
  }

  draw(p: Printer): void {
    this.ranges = this.computeRanges(p.width);
    const row = this.row();
    const theme = this.deps.resolveTheme();
    const chrome = theme.widgetTokens?.modalChrome ?? DEFAULT_WIDGET_TOKENS.modalChrome!;
    const bg = ansiForPair(chrome.titleBarInactive ?? chrome.titleBar);
    const fg = ansiForPair(chrome.titleTextInactive ?? chrome.titleText);
    for (const range of this.ranges) {
      const control = this.deps.controls().find((entry) => entry.id === range.id);
      if (!control) continue;
      const text = this.controlText(control);
      const width = range.x1 - range.x0 + 1;
      const x0 = range.x0;
      p.text(x0, row, `${bg}${' '.repeat(width)}\x1b[0m`);
      p.text(x0 + 1, row, `${fg}${text}\x1b[0m`);
    }
    if (this.openControlId) this.drawHandle(p, this.ensureOpenHandle());
  }

  onEvent(ev: KeyEvent): EventResult {
    if (!this.openControlId) return Ignored;
    const control = this.selectControl(this.openControlId);
    if (!control) {
      this.close();
      return Ignored;
    }
    if (ev.name === 'escape') {
      this.close();
      return Consumed();
    }
    const digit = Number(ev.name);
    if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
      const opt = control.options[digit - 1];
      if (opt) {
        this.deps.onPickSelect(control.id, opt.value);
        this.close();
        return Consumed();
      }
    }
    const result = this.ensureOpenHandle().handleKey(ev);
    return result === 'consumed' ? Consumed() : Ignored;
  }

  onMouse(ev: MouseEvent): EventResult {
    if (this.ranges.length === 0) this.ranges = this.computeRanges(this.size.width);
    const handleHit = this.hitHandle(ev);
    if (handleHit) {
      if (!isIntentMouseEventType(ev.type)) return Consumed();
      const result = handleHit.handleMouse({
        type: ev.type,
        row: handleHit.surface.bounds.row + (ev.y - (handleHit.surface.bounds.row - 1)),
        col: handleHit.surface.bounds.col + (ev.x - (handleHit.surface.bounds.col - 1)),
        shift: ev.shift,
        ctrl: ev.ctrl,
        alt: ev.alt,
      });
      return result === 'consumed' ? Consumed() : Ignored;
    }
    const hit = this.ranges.find((range) =>
      range.y === ev.y
      && ev.x >= Math.max(0, range.x0 - 4)
      && ev.x <= range.x1 + 1,
    );
    if (!hit) return Ignored;
    const control = this.deps.controls().find((entry) => entry.id === hit.id);
    if (!control) return Ignored;
    if (control.kind !== 'select') return Consumed();
    if (ev.type === 'click') {
      const next = this.stepOption(control, +1);
      if (next) this.deps.onPickSelect(control.id, next.value);
      this.close();
      return Consumed();
    }
    if (ev.type === 'right-click') {
      const prev = this.stepOption(control, -1);
      if (prev) this.deps.onPickSelect(control.id, prev.value);
      this.close();
      return Consumed();
    }
    if (ev.type === 'double-click') {
      this.openControlId = this.openControlId === control.id ? null : control.id;
      this.openHandle = null;
      return Consumed();
    }
    return Ignored;
  }

  private row(): number {
    return this.deps.row ?? 1;
  }

  private controlText(control: IulRailControlModel): string {
    if (control.kind === 'static') return `${control.label}: ${control.valueLabel}`;
    return `${control.label}: ${control.valueLabel} ▾`;
  }

  private computeRanges(width: number): RailRange[] {
    const row = this.row();
    let cursor = Math.max(1, width - 2);
    const ranges: RailRange[] = [];
    const controls = [...this.deps.controls()].reverse();
    for (const control of controls) {
      const text = this.controlText(control);
      const controlWidth = text.length + 2;
      const x0 = Math.max(1, cursor - controlWidth);
      ranges.push({ id: control.id, x0, x1: x0 + controlWidth - 1, y: row });
      cursor = x0 - 2;
    }
    return ranges;
  }

  private selectControl(id: string): IulRailSelectControlModel | null {
    const control = this.deps.controls().find((entry) => entry.id === id);
    return control?.kind === 'select' ? control : null;
  }

  private stepOption(
    control: IulRailSelectControlModel,
    delta: -1 | 1,
  ): IulRailSelectOption | null {
    if (control.options.length === 0) return null;
    const currentIndex = Math.max(
      0,
      control.options.findIndex((option) => option.value === control.value),
    );
    const nextIndex = (currentIndex + delta + control.options.length) % control.options.length;
    return control.options[nextIndex] ?? null;
  }

  private ensureOpenHandle(): ViewSurfaceHandle {
    if (this.openHandle) return this.openHandle;
    const id = this.openControlId;
    const control = id ? this.selectControl(id) : null;
    if (!control) {
      this.openControlId = null;
      throw new Error('open rail control missing');
    }
    const range = this.ranges.find((entry) => entry.id === id);
    const anchorStartCol = Math.max(1, (range?.x0 ?? 2) + 1);
    const width = control.width ?? Math.max(18, control.label.length + control.valueLabel.length + 8);
    const items: ActionItem<string>[] = control.options.map((option) => ({
      value: option.value,
      label: option.value === control.value ? `● ${option.label}` : `○ ${option.label}`,
    }));
    this.openHandle = createActionPickerRecipe({
      id: `iul:rail:${control.id}`,
      title: control.title ?? control.label,
      items,
      placement: {
        anchorStartCol,
        anchorEndCol: Math.min(this.size.width, anchorStartCol + width),
        statusRow: this.row() + 1,
        termCols: Math.max(1, this.size.width),
        termRows: Math.max(1, this.size.height),
      },
      onPick: (value) => {
        this.deps.onPickSelect(control.id, value);
        this.close();
      },
      onCancel: () => this.close(),
      actionButtons: false,
      filterable: false,
      initialIndex: Math.max(
        0,
        control.options.findIndex((option) => option.value === control.value),
      ),
      theme: this.deps.resolveTheme(),
      shadow: { theme: this.deps.resolveTheme() },
    });
    return this.openHandle;
  }

  private drawHandle(p: Printer, handle: ViewSurfaceHandle): void {
    const lines = renderMountedSurfaceLines(handle.surface.paint());
    const x = Math.max(0, handle.surface.bounds.col - 1);
    const y = Math.max(0, handle.surface.bounds.row - 1);
    for (let row = 0; row < lines.length && y + row < p.height; row += 1) {
      p.text(x, y + row, lines[row] ?? '');
    }
  }

  private hitHandle(ev: MouseEvent): ViewSurfaceHandle | null {
    const handle = this.openHandle;
    if (!handle) return null;
    const { bounds } = handle.surface;
    return ev.x >= bounds.col - 1
      && ev.x < bounds.col - 1 + bounds.width
      && ev.y >= bounds.row - 1
      && ev.y < bounds.row - 1 + bounds.height
      ? handle
      : null;
  }

  private close(): void {
    this.openControlId = null;
    this.openHandle = null;
  }
}

function renderMountedSurfaceLines(output: string): string[] {
  const moveRe = /\x1b\[(\d+);(\d+)H/g;
  const segments: Array<{ row: number; col: number; text: string }> = [];
  let match: RegExpExecArray | null;
  let prevRow = 1;
  let prevCol = 1;
  let prevEnd = 0;
  while ((match = moveRe.exec(output)) !== null) {
    if (prevEnd !== 0) {
      segments.push({ row: prevRow, col: prevCol, text: output.slice(prevEnd, match.index) });
    }
    prevRow = Number(match[1]);
    prevCol = Number(match[2]);
    prevEnd = moveRe.lastIndex;
  }
  if (prevEnd !== 0) segments.push({ row: prevRow, col: prevCol, text: output.slice(prevEnd) });
  if (segments.length === 0) return output.length > 0 ? [output] : [];
  const baseRow = Math.min(...segments.map((segment) => segment.row));
  const baseCol = Math.min(...segments.map((segment) => segment.col));
  const lines: string[] = [];
  for (const segment of segments) {
    const row = segment.row - baseRow;
    while (lines.length <= row) lines.push('');
    const prefix = ' '.repeat(Math.max(0, segment.col - baseCol - lines[row]!.length));
    lines[row] = lines[row]! + prefix + segment.text;
  }
  return lines;
}
