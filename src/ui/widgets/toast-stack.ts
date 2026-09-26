// MX10 — ToastStack + MousePointer.
//
// A transient "toast" is a short line of text shown at a corner of
// the screen for a bounded time, used to acknowledge mouse actions
// ("Model switched to Opus 4.7") without stealing focus. Toasts
// stack vertically; new ones arrive at the bottom (or top, per
// `order`), older ones expire and are pruned.
//
// MousePointer is an optional synthetic cursor glyph — a single
// character rendered at the last known pointer position. Off by
// default (most terminals show the real cursor fine), but ready to
// enable for demos / mouse-heavy screencasts where you want the
// pointer visible regardless of terminal settings.
//
// Both are non-focusable, non-consuming views: they observe but
// don't intercept. Hosts call `render()` near the end of their paint
// pipeline so toasts land on top of everything else.

import { C } from '../../tui.js';
import {
  paintPair,
  resolveSemantic,
  type ThemeTokens,
} from '../../theme/tokens.js';
import type { Printer } from '../printer.js';
import { cellWidth } from '../printer.js';
import { Ignored, type EventResult, type FocusSource, type Size, type View } from '../view.js';
import type { MouseEvent } from '../mouse-events.js';
import type { KeyEvent } from '../../plugins/core/types.js';
import { icon, type IconName } from '../../theme/icons.js';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export type ToastPlacement =
  | 'top-left' | 'top-center' | 'top-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface ToastSpec {
  text: string;
  kind?: ToastKind;
  /** Default 3000ms. 0 or negative = manual dismiss only. */
  ttlMs?: number;
}

export interface ToastStackOpts {
  /** Default 'top-right'. */
  placement?: ToastPlacement;
  /** Default 3. Older toasts past this get pruned regardless of ttl. */
  maxVisible?: number;
  /** Horizontal gap from viewport edge (cells). Default 2. */
  marginX?: number;
  /** Vertical gap from viewport edge (cells). Default 1. */
  marginY?: number;
  /** Inter-toast spacing (rows). Default 0. */
  gapY?: number;
  /** Max toast width. Default 40. */
  maxWidth?: number;
  /** Newest first (bottom) or oldest first. Default 'newest-bottom'. */
  order?: 'newest-bottom' | 'newest-top';
  /** Monotonic "now" source for tests. */
  nowMs?: () => number;
  /** Optional theme tokens for semantic toast coloring. */
  theme?: ThemeTokens;
  /** Live theme accessor for long-running hosts. When present, this
   *  wins over `theme` so toast rendering follows theme switches
   *  without rebuilding the stack. */
  getTheme?: () => ThemeTokens | null | undefined;
}

interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
  bornAt: number;
  expiresAt: number | null;   // null = manual dismiss only
}

export class ToastStack {
  private toasts: Toast[] = [];
  private nextId = 1;
  private readonly placement: ToastPlacement;
  private readonly maxVisible: number;
  private readonly marginX: number;
  private readonly marginY: number;
  private readonly gapY: number;
  private readonly maxWidth: number;
  private readonly order: 'newest-bottom' | 'newest-top';
  private readonly now: () => number;
  private readonly theme?: ThemeTokens;
  private readonly getTheme?: () => ThemeTokens | null | undefined;

  constructor(opts: ToastStackOpts = {}) {
    this.placement = opts.placement ?? 'top-right';
    this.maxVisible = opts.maxVisible ?? 3;
    this.marginX = opts.marginX ?? 2;
    this.marginY = opts.marginY ?? 1;
    this.gapY = opts.gapY ?? 0;
    this.maxWidth = opts.maxWidth ?? 40;
    this.order = opts.order ?? 'newest-bottom';
    this.now = opts.nowMs ?? Date.now;
    this.theme = opts.theme;
    this.getTheme = opts.getTheme;
  }

  push(spec: ToastSpec): number {
    const ttl = spec.ttlMs ?? 3000;
    const bornAt = this.now();
    const toast: Toast = {
      id: this.nextId++,
      text: spec.text,
      kind: spec.kind ?? 'info',
      bornAt,
      expiresAt: ttl > 0 ? bornAt + ttl : null,
    };
    this.toasts.push(toast);
    return toast.id;
  }

  /** Remove a specific toast by id (manual dismiss). */
  dismiss(id: number): boolean {
    const before = this.toasts.length;
    this.toasts = this.toasts.filter(t => t.id !== id);
    return this.toasts.length !== before;
  }

  /** Drop expired toasts. Hosts should call this before every paint
   *  (or right after — the renderer also calls it internally). */
  pruneExpired(): void {
    const now = this.now();
    this.toasts = this.toasts.filter(t => t.expiresAt === null || t.expiresAt > now);
    // Cap to maxVisible — oldest drop first.
    if (this.toasts.length > this.maxVisible) {
      this.toasts.splice(0, this.toasts.length - this.maxVisible);
    }
  }

  /** Current visible toasts — for tests & host introspection. */
  snapshot(): readonly { id: number; text: string; kind: ToastKind }[] {
    return this.toasts.map(t => ({ id: t.id, text: t.text, kind: t.kind }));
  }

  /** Render into a printer representing the FULL viewport. Layout
   *  positions each toast at the configured placement. Call this
   *  last in the host's paint pipeline so toasts overlay everything. */
  render(p: Printer): void {
    this.pruneExpired();
    if (this.toasts.length === 0) return;

    const list = this.order === 'newest-bottom' ? this.toasts : [...this.toasts].reverse();

    const { horizontal, vertical } = parsePlacement(this.placement);

    // Compute each toast's dimensions.
    const boxes = list.map(t => {
      const label = this.labelOf(t);
      const w = Math.min(this.maxWidth, cellWidth(label) + 4);
      return { toast: t, label, w };
    });

    const rowsEach = 1;
    const totalH = boxes.length * rowsEach + Math.max(0, boxes.length - 1) * this.gapY;

    let startY: number;
    if (vertical === 'top') {
      startY = this.marginY;
    } else if (vertical === 'bottom') {
      startY = Math.max(0, p.height - totalH - this.marginY);
    } else {
      startY = Math.max(0, Math.floor((p.height - totalH) / 2));
    }

    for (let i = 0; i < boxes.length; i++) {
      const { toast, label, w } = boxes[i]!;
      let x: number;
      if (horizontal === 'left') x = this.marginX;
      else if (horizontal === 'right') x = Math.max(0, p.width - w - this.marginX);
      else x = Math.max(0, Math.floor((p.width - w) / 2));

      const y = startY + i * (rowsEach + this.gapY);
      if (y >= p.height) break;
      const body = this.format(toast, label);
      p.text(x, y, body);
    }
  }

  private labelOf(t: Toast): string {
    // IDX-6 Phase 6 — route through theme-icons so ELANOUS_ASCII_ICONS
    // + future theme-specific overrides apply uniformly. The hard-
    // coded `•` for 'info' kept — it has no dedicated IconTokens slot
    // (notification is the closest match but semantically different).
    const iconName: IconName | null =
      t.kind === 'success' ? 'success'
      : t.kind === 'warning' ? 'warning'
      : t.kind === 'error'   ? 'error'
      : null;
    const glyph = iconName ? icon(iconName) : '•';
    return `${glyph} ${t.text}`;
  }

  private format(t: Toast, label: string): string {
    const theme = this.getTheme?.() ?? this.theme;
    if (theme) {
      const slot =
        t.kind === 'success' ? 'success'
        : t.kind === 'warning' ? 'warning'
        : t.kind === 'error' ? 'critical'
        : 'info';
      return paintPair(resolveSemantic(theme, slot))(label);
    }
    if (t.kind === 'success') return C.success(label);
    if (t.kind === 'warning') return C.warning(label);
    if (t.kind === 'error')   return C.error(label);
    return C.subtext(label);
  }
}

function parsePlacement(p: ToastPlacement): { vertical: 'top' | 'center' | 'bottom'; horizontal: 'left' | 'center' | 'right' } {
  const [vertical, horizontal] = p.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
  return { vertical, horizontal };
}

// ── MousePointer ─────────────────────────────────────────────────

export interface MousePointerSpec {
  /** Default '◆' (solid diamond). Pick something with no ambiguous
   *  width so placement is always stable. */
  glyph?: string;
  /** Defaults to C.accent. */
  paint?: (glyph: string) => string;
}

export class MousePointer implements View {
  private x = -1;
  private y = -1;
  constructor(private spec: MousePointerSpec = {}) {}

  /** Host calls this on each mouse event to keep the pointer in
   *  sync with the user's cursor. */
  update(absX: number, absY: number): void {
    this.x = absX;
    this.y = absY;
  }

  hide(): void { this.x = -1; this.y = -1; }

  isVisible(): boolean { return this.x >= 0 && this.y >= 0; }

  draw(p: Printer): void {
    if (!this.isVisible()) return;
    if (this.x < 0 || this.x >= p.width || this.y < 0 || this.y >= p.height) return;
    const glyph = this.spec.glyph ?? '◆';
    const paint = this.spec.paint ?? ((g: string) => C.accent(g));
    p.text(this.x, this.y, paint(glyph));
  }

  onEvent(_: KeyEvent): EventResult { return Ignored; }
  onMouse(_ev: MouseEvent): EventResult { return Ignored; }
  layout(_: Size): void {}
  requiredSize(c: Size): Size { return c; }
  takeFocus(_?: FocusSource): boolean { return false; }
}
