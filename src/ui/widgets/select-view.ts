// LC6 — SelectView primitive.
//
// The single choice-UI primitive that all the downstream wrappers
// (Dialog, PermissionPrompt, FileDialog, SlashMenu, ComboBox, the
// legacy modals) sit on top of. Synthesizes the common intersection
// of claude-code-fork's `Select<T>` and codex's `ListSelectionView`
// plus the high-value differentiators each one has alone:
//   - codex: live search filter, side-by-side preview, item-level
//     action closures, disabled-with-reason
//   - claude-code-fork: item-level input option, feedback prompt
//     (accept/deny + reason), shortcut letters
//
// The schema comes from `내부 문서 `ANALYSIS-choice-ui`` §4. Wrapper
// widgets in LC7+ should stay ≤80 LOC by routing through this.
//
// Event model follows LC4 View interface — `onEvent` returns
// Consumed()/Ignored so the parent surface can propagate.

import type { KeyEvent } from '../../plugins/core/types.js';
import {
  ansiForPair,
  paintPair,
  resolveWidgetTokens,
  type ThemeTokens,
} from '../../theme/tokens.js';
import { C } from '../../tui.js';
import { filterInputMatches } from '../../input/query-match.js';
import { appendInputText, backspaceInputText } from '../../input/text-key.js';
import type { Printer } from '../printer.js';
import { cellWidth } from '../printer.js';
import { Consumed, Ignored, type EventResult, type FocusSource, type Size, type View } from '../view.js';
import { isClickIntentMouseEventType, type MouseEvent } from '../mouse-events.js';
import { dispatchPointerListMouse } from './pointer-list-controller.js';
import {
  cycleCursor,
  moveCursorBy,
  moveCursorByPage,
  moveCursorToEdge,
} from './selection-cursor.js';

export interface SelectOption<T> {
  value: T;
  label: string;
  /** Right-column detail shown inline (codex style). */
  description?: string;
  disabled?: boolean;
  /** If disabled, shown next to the row when focused. */
  disabledReason?: string;
  /** Single-letter shortcut. Selected via the letter key (non-searchable mode). */
  shortcut?: string;
  /** Fired right before `onSubmit` when this option wins. Supports
   *  async — the view doesn't wait, callers can do their own spinner. */
  action?: () => void | Promise<void>;
  /** Make the option itself a text-input prompt. Enter submits the
   *  typed value through `onSubmit` as the second `feedback` arg. */
  inputType?: {
    placeholder: string;
    initialValue?: string;
    allowEmptySubmitToCancel?: boolean;
  };
  /** KX5-0 — optional glyph rendered before the label. Counts toward
   *  cell width so the description column stays aligned. Used by
   *  file/at pickers ('📁'/'📄') but generic for any categorization. */
  icon?: string;
}

export interface FeedbackPromptSpec<T> {
  placeholder: string;
  /** Values that bypass the feedback prompt (submit immediately). */
  optionalFor?: T[];
  /** Cap for feedback length (default 1000 — avoid LLM prompt inflation). */
  maxLength?: number;
}

export interface SelectViewSpec<T> {
  title?: string;
  /** Option source. Array for the static case; function form is called
   *  at every draw / event tick so external owners can swap the list
   *  (search modal, dynamic pickers). Keep it cheap — no I/O in the
   *  getter; fetch async and cache externally. */
  options: SelectOption<T>[] | (() => SelectOption<T>[]);
  initialValue?: T;
  /** Enable live substring filter. Disables numeric 1–9 fast-pick. */
  searchable?: boolean;
  /** Visible list rows. Default 8. */
  visibleRows?: number;
  /** Space toggles membership; Enter submits T[]. */
  multi?: boolean;
  /** If set and the Printer is wide enough, show a right-column detail panel. */
  preview?: (focused: SelectOption<T>) => string;
  previewMinWidth?: number;
  footerHint?: string;
  /** After Enter, if present and the picked value is not in optionalFor,
   *  the view flips to feedback entry and submits on the next Enter. */
  feedbackPrompt?: FeedbackPromptSpec<T>;
  /** Wrap up/down at list boundaries. Default true. */
  wrap?: boolean;
  /** KX5-0 — layout direction. 'up' renders rows from the bottom of
   *  the printer region upward (title/footer reverse), so the list
   *  sits above the caret for prompt-adjacent pickers. Default
   *  'down'. */
  direction?: 'up' | 'down';
  /** KX5-0 — external cursor override. When provided, the view
   *  ignores its internal cursor and paints from this index. Getter
   *  form is re-read at every draw / event so the owner can tick its
   *  source of truth without re-creating the view. */
  cursor?: number | (() => number);
  /** KX5-0 — fires when the view would internally advance the cursor
   *  (keyboard nav, mouse click, scroll). Always called — uncontrolled
   *  callers can ignore it; controlled callers must update `cursor`. */
  onCursorChange?: (next: number) => void;
  /** KX5-0 — external query override. Number | getter semantics
   *  mirror `cursor`. Pass a static string to disable internal
   *  filtering entirely (useful when the options getter already
   *  filters externally). */
  query?: string | (() => string);
  /** KX5-0 — fires when the user types / backspaces inside the
   *  searchable query. Only delivered when `searchable: true`. */
  onQueryChange?: (next: string) => void;
  /** KX5-a — skip the built-in substring filter entirely. The owner
   *  is responsible for filtering the `options` getter output before
   *  handing it to the view. The query line still renders (so typing
   *  looks live) but filteredIndices returns the full list. */
  externalFilter?: boolean;
  /** KX5-a — rendered at the list position when the filtered index
   *  set is empty. Skipped when undefined — callers that want a
   *  literal "(no matches)" row opt in explicitly. */
  emptyPlaceholder?: string;
  /** MD4 — when true, single-click moves the cursor only (AppCUI-rs
   *  ListBox/TreeView convention: Pressed = select, DoubleClick =
   *  activate). Double-click then submits. Default false preserves
   *  the MX-era picker UX (single-click = submit) that existing
   *  status-bar popups depend on. Set true for pane-like browse
   *  surfaces where users want to survey the list before committing. */
  browseMode?: boolean;
  /** Optional leading cursor glyph. Default `▸`. Pass `''` to keep
   *  row selection styling but omit the extra marker for list types
   *  that already encode selection state in their own label. */
  cursorGlyph?: string;
  onChange?: (value: T) => void;
  onSubmit: (picked: T | T[], feedback?: string) => void;
  onCancel?: () => void;
  /** IDX-6 FU I — optional theme tokens. When present, the cursor-row
   *  accent resolves from `selectView.cursor` (hierarchical widget
   *  tokens) instead of the legacy C.accent painter. Absent =
   *  backward-compat rendering unchanged. Other SelectView paint
   *  paths (title / query / preview / footer) continue to use C.*
   *  and will migrate incrementally. */
  theme?: ThemeTokens;
}

type Mode = 'list' | 'feedback' | 'input';

/** Primitive choice widget. Implements View for the LC4 composition stack. */
export class SelectView<T> implements View {
  private cursor = 0;       // index into the filtered list
  private scroll = 0;       // first visible filtered row
  private query = '';
  private multiSelected = new Set<T>();
  private feedback = '';
  private inputBuffer = '';
  private mode: Mode = 'list';
  private pendingPicked: T | T[] | null = null;

  // IDX-6 FU I — theme-aware accent painters. Swap legacy C.* when
  // a theme is present, otherwise keep the exact pre-refactor output.
  private cursorAccentPainter(): (s: string) => string {
    const { theme } = this.spec;
    if (!theme) return C.accent;
    return paintPair(resolveWidgetTokens(theme, 'selectView').cursor);
  }

  private cursorBoldPainter(): (s: string) => string {
    const { theme } = this.spec;
    if (!theme) return C.bold;
    const cursor = resolveWidgetTokens(theme, 'selectView').cursor;
    return paintPair({ ...cursor, bold: true });
  }

  // IDX-6 round-2 — painters for the remaining paint paths. Each
  // falls back along a chain: specific round-2 slot → selectView
  // muted / cursor → legacy C.* (only when no theme at all). That
  // way presets that ship ONLY cursor/muted/selected/hovered still
  // themed correctly without needing to revise every preset file.

  /** Heading above the option list. Bold-focused in legacy; uses
   *  `selectView.title ?? { ...cursor.fg, bold: true }` when themed. */
  private titlePainter(focused: boolean): (s: string) => string {
    const { theme } = this.spec;
    if (!theme) return focused ? C.bold : (s) => s;
    const t = resolveWidgetTokens(theme, 'selectView');
    if (t.title) return paintPair(t.title);
    const cursor = t.cursor;
    return paintPair({ fg: cursor.fg, bold: focused });
  }

  /** `/` prefix + query body. Legacy: muted prefix + default body. */
  private queryPainter(): {
    prefix: (s: string) => string;
    body: (s: string) => string;
    caret: (s: string) => string;
  } {
    const { theme } = this.spec;
    if (!theme) {
      return { prefix: C.muted, body: (s) => s, caret: C.accent };
    }
    const t = resolveWidgetTokens(theme, 'selectView');
    const prefix = paintPair(t.query ?? t.muted);
    const body = paintPair(t.query ?? { fg: theme.colors.text });
    const caret = paintPair(t.caret ?? t.cursor);
    return { prefix, body, caret };
  }

  /** Preview pane text + side separator glyph. */
  private previewPainter(): { body: (s: string) => string; separator: (s: string) => string } {
    const { theme } = this.spec;
    if (!theme) return { body: C.subtext, separator: C.border };
    const t = resolveWidgetTokens(theme, 'selectView');
    return {
      body: paintPair(t.preview ?? t.muted),
      // Side separator never has a dedicated slot in round-2 —
      // share the preview slot so they stay visually linked.
      separator: paintPair(t.preview ?? t.muted),
    };
  }

  /** Single-line footer hint. */
  private footerPainter(): (s: string) => string {
    const { theme } = this.spec;
    if (!theme) return C.muted;
    const t = resolveWidgetTokens(theme, 'selectView');
    return paintPair(t.footer ?? t.muted);
  }

  /** Empty-list placeholder + feedback/input mode banner lines. */
  private placeholderPainter(): (s: string) => string {
    const { theme } = this.spec;
    if (!theme) return C.subtext;
    const t = resolveWidgetTokens(theme, 'selectView');
    return paintPair(t.placeholder ?? t.muted);
  }

  /** Input caret '▎' in input / feedback modes. */
  private inputCaretPainter(): (s: string) => string {
    const { theme } = this.spec;
    if (!theme) return C.accent;
    const t = resolveWidgetTokens(theme, 'selectView');
    return paintPair(t.caret ?? t.cursor);
  }

  /** Disabled row label. Legacy C.dim is faint+muted. */
  private disabledPainter(): (s: string) => string {
    const { theme } = this.spec;
    if (!theme) return C.dim;
    const t = resolveWidgetTokens(theme, 'selectView');
    return paintPair(t.disabled ?? { ...t.muted, faint: true });
  }

  /** Reason string after a disabled row. Uses semantic.critical-ish —
   *  legacy uses C.error. Round-2 can override via disabledReason slot. */
  private disabledReasonPainter(): (s: string) => string {
    const { theme } = this.spec;
    if (!theme) return C.error;
    const t = resolveWidgetTokens(theme, 'selectView');
    if (t.disabledReason) return paintPair(t.disabledReason);
    // No dedicated slot — keep the critical-semantic invariance so
    // disabled reasons still read as warnings across presets.
    return paintPair(resolveWidgetTokens(theme, 'semantic').critical);
  }

  /** Horizontal separator in upward-mode layouts (─). It should
   *  visually match the prompt-frame divider because upward pickers
   *  sit directly above the input zone. A fainter / indented line
   *  reads like the border width or theme changed mid-frame. */
  private separatorPainter(): (s: string) => string {
    const { theme } = this.spec;
    if (!theme) return C.border;
    const t = resolveWidgetTokens(theme, 'selectView');
    return paintPair(t.separator ?? t.muted);
  }

  /** Vertical overflow rail for long lists. */
  private scrollbarTrackPainter(): (s: string) => string {
    const { theme } = this.spec;
    if (!theme) return C.border;
    const t = resolveWidgetTokens(theme, 'selectView');
    return paintPair(t.separator ?? t.muted);
  }

  private scrollbarThumbPainter(): (s: string) => string {
    const { theme } = this.spec;
    if (!theme) return C.accent;
    const t = resolveWidgetTokens(theme, 'selectView');
    return paintPair(t.cursor);
  }

  /** Per-row description suffix. Legacy C.subtext. */
  private descriptionPainter(isCursor = false, focused = false): (s: string) => string {
    const { theme } = this.spec;
    if (!theme) return C.subtext;
    const t = resolveWidgetTokens(theme, 'selectView');
    if (isCursor && focused) return paintPair(t.selected);
    if (isCursor && t.hovered) return paintPair(t.hovered);
    return paintPair(t.description ?? t.muted);
  }

  private fullRowPainter(focused: boolean): ((s: string) => string) | null {
    const { theme } = this.spec;
    if (!theme) return null;
    const t = resolveWidgetTokens(theme, 'selectView');
    return paintPair(focused ? t.cursor : (t.hovered ?? t.selected));
  }

  private fullRowFillStyle(focused: boolean): string {
    const { theme } = this.spec;
    if (!theme) return '';
    const t = resolveWidgetTokens(theme, 'selectView');
    const pair = focused ? t.cursor : (t.hovered ?? t.selected);
    return pair.bg ? ansiForPair({ fg: pair.fg, bg: pair.bg }) : '';
  }

  constructor(private spec: SelectViewSpec<T>) {
    if (spec.initialValue !== undefined) {
      const all = this.optionsSnapshot();
      for (let i = 0; i < all.length; i++) {
        if (Object.is(all[i]!.value, spec.initialValue)) {
          // cursor lives in filtered list; with empty query, filtered==all
          this.cursor = i;
          break;
        }
      }
    }
  }

  // KX5-0 — resolve options on demand so controlled callers can flip
  // the list per draw. Array form is returned as-is (cheap).
  private optionsSnapshot(): SelectOption<T>[] {
    return typeof this.spec.options === 'function'
      ? this.spec.options()
      : this.spec.options;
  }

  // KX5-0 — external-controlled cursor/query override internal state
  // on every read. Getter form is re-invoked each call so callers
  // can tick their source of truth without re-creating the view.
  private effectiveCursor(): number {
    const c = this.spec.cursor;
    if (c === undefined) return this.cursor;
    return typeof c === 'function' ? c() : c;
  }
  private effectiveQuery(): string {
    const q = this.spec.query;
    if (q === undefined) return this.query;
    return typeof q === 'function' ? q() : q;
  }

  // ── filtering ──────────────────────────────────────────────────
  private filteredIndices(): number[] {
    const opts = this.optionsSnapshot();
    // KX5-a — when the owner handles filtering externally, short-circuit
    // the built-in substring match so the options list is used as-is.
    if (this.spec.externalFilter) return opts.map((_, i) => i);
    const q = this.effectiveQuery();
    if (!q) return opts.map((_, i) => i);
    return filterInputMatches(
      opts.map((option, index) => ({ option, index })),
      q,
      ({ option }) => `${option.label}\n${option.description ?? ''}`,
      'substring',
    ).map(({ index }) => index);
  }

  private currentOption(): SelectOption<T> | null {
    const filt = this.filteredIndices();
    if (filt.length === 0) return null;
    const opts = this.optionsSnapshot();
    // Clamping: only mutate internal when uncontrolled. Controlled
    // callers are responsible for their own clamping in onCursorChange.
    if (this.spec.cursor === undefined) {
      this.cursor = Math.max(0, Math.min(this.cursor, filt.length - 1));
    }
    const cur = this.effectiveCursor();
    const clampedCur = Math.max(0, Math.min(cur, filt.length - 1));
    return opts[filt[clampedCur]!] ?? null;
  }

  private visibleRows(): number {
    return Math.max(1, this.spec.visibleRows ?? 8);
  }

  private canSideBySidePreview(w: number): boolean {
    return !!this.spec.preview && w >= (this.spec.previewMinWidth ?? 60);
  }

  // ── draw ───────────────────────────────────────────────────────
  draw(p: Printer): void {
    if (this.spec.direction === 'up') {
      this.drawUpward(p);
      return;
    }
    this.drawDownward(p);
  }

  private drawDownward(p: Printer): void {
    const spec = this.spec;
    const focused = p.focused;
    const opts = this.optionsSnapshot();
    const query = this.effectiveQuery();
    const cursor = this.effectiveCursor();
    let y = 0;

    if (spec.title) {
      p.text(0, y, this.titlePainter(focused)(spec.title));
      y++;
    }
    if (spec.searchable) {
      const qp = this.queryPainter();
      const caret = focused && this.mode === 'list' ? qp.caret('▎') : '';
      p.text(0, y, qp.prefix('/ ') + qp.body(query) + caret);
      y++;
    }

    const sideBySide = this.canSideBySidePreview(p.width);
    const listWidth = sideBySide ? Math.floor(p.width / 2) : p.width;
    const previewCol = listWidth + 1;

    const filt = this.filteredIndices();
    const rows = Math.min(this.visibleRows(), Math.max(1, p.height - y - this.footerRows()));

    if (cursor < this.scroll) this.scroll = cursor;
    if (cursor >= this.scroll + rows) this.scroll = cursor - rows + 1;
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, filt.length - rows)));

    const listStart = y;
    // KX5-a — render emptyPlaceholder (one row) when the filtered set
    // is empty and the caller opted in. Otherwise leave the list area
    // blank so the rest of the layout (preview / footer) still aligns.
    if (filt.length === 0 && spec.emptyPlaceholder) {
      p.text(0, y, this.placeholderPainter()(spec.emptyPlaceholder));
      y += rows;
    } else {
      for (let row = 0; row < rows; row++) {
        const filtIdx = this.scroll + row;
        if (filtIdx >= filt.length) {
          p.text(0, y, '');
          y++;
          continue;
        }
        const opt = opts[filt[filtIdx]!]!;
        this.drawRow(p, y, listWidth, opt, filtIdx === cursor, focused);
        p.clickable({ x: 0, y, width: listWidth, height: 1 }, this, { kind: 'row', filtIdx });
        y++;
      }
    }

    this.drawOverflowScrollbar(p, listWidth, listStart, rows, filt.length);

    if (sideBySide) {
      const pv = this.previewPainter();
      const opt = this.currentOption();
      if (opt && spec.preview) {
        const text = spec.preview(opt);
        const lines = text.split('\n');
        for (let i = 0; i < Math.min(lines.length, rows); i++) {
          p.text(previewCol, listStart + i, pv.body(lines[i]!));
        }
      }
      for (let i = 0; i < rows; i++) {
        p.text(listWidth, listStart + i, pv.separator('│'));
      }
    }

    const footerY = p.height - 1;
    if (this.mode === 'feedback') {
      const fb = spec.feedbackPrompt;
      if (p.height >= 2) {
        p.text(0, footerY - 1, this.placeholderPainter()(fb?.placeholder ?? 'Feedback:'));
      }
      const caret = focused ? this.inputCaretPainter()('▎') : '';
      p.text(0, footerY, this.feedback + caret);
    } else if (this.mode === 'input') {
      const opt = this.currentOption();
      const ph = opt?.inputType?.placeholder ?? '';
      if (p.height >= 2) p.text(0, footerY - 1, this.placeholderPainter()(ph));
      const caret = focused ? this.inputCaretPainter()('▎') : '';
      p.text(0, footerY, this.inputBuffer + caret);
    } else {
      p.text(0, footerY, this.footerPainter()(spec.footerHint ?? this.defaultFooter()));
    }
  }

  // KX5-0 — upward layout. Matches the legacy paintUpwardList shape
  // used by chat pickers:
  //   y=0..visibleCount-1  → list rows (top-anchored inside printer)
  //   y=visibleCount       → separator (bottom of the painted region,
  //                          which is where the caller stitches it to
  //                          the top of the input zone)
  // The wrapper is expected to size the Printer at visibleCount+1
  // rows and shift each row to sit above the prompt; the separator
  // then lands at `bounds.row - inputZoneHeight` exactly like the
  // old hand-rolled path.
  //
  // Does NOT render feedback / input / multi / footer UI — upward
  // pickers are always list-only.
  private drawUpward(p: Printer): void {
    const focused = p.focused;
    const opts = this.optionsSnapshot();
    const filt = this.filteredIndices();
    const cursor = this.effectiveCursor();

    const visibleCount = Math.min(filt.length, this.visibleRows());
    if (visibleCount === 0) return;

    let startIdx = 0;
    if (filt.length > visibleCount) {
      startIdx = Math.max(
        0,
        Math.min(cursor - Math.floor(visibleCount / 2), filt.length - visibleCount),
      );
    }

    for (let vi = 0; vi < visibleCount; vi++) {
      const ci = startIdx + vi;
      const y = vi;
      if (y >= p.height) break;
      const opt = opts[filt[ci]!];
      if (!opt) {
        p.text(0, y, '');
        continue;
      }
      this.drawRow(p, y, p.width, opt, ci === cursor, focused);
      p.clickable({ x: 0, y, width: p.width, height: 1 }, this, { kind: 'row', filtIdx: ci });
    }

    const sepY = visibleCount;
    if (sepY < p.height) {
      // F-E3 — extend the separator to the full printer width (was
      // capped at 40 cells). With the F-E2 clear-wrapper overwriting
      // the row below the picker's list, a short separator left a
      // visible gap on the right side where the dashboard's own
      // full-width divider used to show through; the picker paint
      // emitted spaces there because paintUpwardSelect pads the line
      // to `width`. Filling the full width with `─` restores a clean
      // single horizontal divider at the picker's bottom. The 2-cell
      // Use the full width with no side indent so the picker's
      // separator doesn't appear narrower than the prompt-frame
      // divider beneath it.
      const sepLen = Math.max(0, p.width);
      const sepLine = this.separatorPainter()('\u2500'.repeat(sepLen));
      p.text(0, sepY, sepLine);
    }
  }

  private footerRows(): number {
    return this.mode === 'list' ? 1 : 2;
  }

  private drawOverflowScrollbar(
    p: Printer,
    listWidth: number,
    listStart: number,
    rows: number,
    total: number,
  ): void {
    if (rows <= 0 || total <= rows || listWidth <= 0) return;
    const x = Math.max(0, listWidth - 1);
    const trackPaint = this.scrollbarTrackPainter();
    const thumbPaint = this.scrollbarThumbPainter();
    const thumbSize = Math.max(1, Math.floor((rows * rows) / total));
    const scrollRange = Math.max(1, total - rows);
    const thumbTravel = Math.max(0, rows - thumbSize);
    const thumbOffset = thumbTravel === 0
      ? 0
      : Math.floor((this.scroll * thumbTravel) / scrollRange);
    for (let i = 0; i < rows; i += 1) {
      const paint = i >= thumbOffset && i < thumbOffset + thumbSize ? thumbPaint : trackPaint;
      p.text(x, listStart + i, paint(i >= thumbOffset && i < thumbOffset + thumbSize ? '█' : '│'));
    }
  }

  private drawRow(
    p: Printer,
    y: number,
    width: number,
    opt: SelectOption<T>,
    isCursor: boolean,
    focused: boolean,
  ): void {
    const spec = this.spec;
    const isChecked = spec.multi && this.multiSelected.has(opt.value);
    // IDX-F8 — `▸` (U+25B8 black right-pointing small triangle) is
    // visually distinct from input-prompt leaders `)` / `>` / `❯`,
    // so the focused picker row never gets confused with a prompt
    // glyph in the user's peripheral vision.
    const pointerGlyph = this.spec.cursorGlyph ?? '▸';
    const prefix = pointerGlyph === ''
      ? ''
      : `${isCursor ? pointerGlyph : ' '} `;
    const check = spec.multi ? (isChecked ? '[×] ' : '[ ] ') : '';
    const iconPart = opt.icon ? opt.icon + ' ' : '';
    const shortcut = opt.shortcut ? `(${opt.shortcut}) ` : '';
    const descPaint = this.descriptionPainter(isCursor, focused);
    const descPart = opt.description ? '  ' + descPaint(opt.description) : '';
    const base = `${prefix}${check}${iconPart}${shortcut}${opt.label}${descPart}`;
    // IDX-6 FU I — cursor accent uses theme's selectView.cursor token
    // when theme is set; otherwise legacy C.accent. Bold label likewise.
    const accentPaint = this.cursorAccentPainter();
    const boldPaint = this.cursorBoldPainter();
    const disabledPaint = this.disabledPainter();
    let styled = base;
    if (opt.disabled) styled = disabledPaint(base);
    else if (isCursor && focused) styled = prefix === ''
      ? `${check}${iconPart}${shortcut}${boldPaint(opt.label)}${descPart}`
      : accentPaint(prefix) + `${check}${iconPart}${shortcut}${boldPaint(opt.label)}${descPart}`;
    else if (isCursor) styled = prefix === ''
      ? base
      : accentPaint(prefix) + base.slice(prefix.length);
    if (isCursor) {
      const fullRowPaint = this.fullRowPainter(focused);
      if (fullRowPaint) {
        const fillStyle = this.fullRowFillStyle(focused);
        if (fillStyle) p.sub(0, y, width, 1).fill(' ', fillStyle);
        const plain = `${prefix}${check}${iconPart}${shortcut}${opt.label}${opt.description ? `  ${opt.description}` : ''}`;
        const padded = plain.padEnd(width, ' ');
        p.text(0, y, fullRowPaint(padded));
      } else {
        p.text(0, y, styled);
      }
    } else {
      p.text(0, y, styled);
    }

    if (isCursor && opt.disabled && opt.disabledReason) {
      const reason = ` (${opt.disabledReason})`;
      const used = cellWidth(base);
      if (used + cellWidth(reason) + 1 <= width) {
        p.text(used + 1, y, this.disabledReasonPainter()(reason));
      }
    }
  }

  private defaultFooter(): string {
    const parts: string[] = ['↑↓ select'];
    if (this.spec.searchable) parts.push('type filter');
    else if (this.spec.options.length <= 9) parts.push('1-9 jump');
    if (this.spec.multi) parts.push('Space toggle');
    parts.push('Enter ' + (this.spec.multi ? 'confirm' : 'pick'));
    parts.push('Esc cancel');
    return parts.join(' · ');
  }

  // ── events ─────────────────────────────────────────────────────
  onEvent(ev: KeyEvent): EventResult {
    if (this.mode === 'feedback') return this.onFeedbackEvent(ev);
    if (this.mode === 'input') return this.onInputEvent(ev);
    return this.onListEvent(ev);
  }

  private onListEvent(ev: KeyEvent): EventResult {
    const spec = this.spec;
    const n = ev.name;

    if (n === 'escape') { this.spec.onCancel?.(); return Consumed(); }
    if (n === 'up'       || (!spec.searchable && n === 'k') || (ev.ctrl && n === 'p')) { this.moveCursor(-1); return Consumed(); }
    if (n === 'down'     || (!spec.searchable && n === 'j') || (ev.ctrl && n === 'n')) { this.moveCursor(+1); return Consumed(); }
    if (n === 'pageup')   { this.moveCursorPage(-1); return Consumed(); }
    if (n === 'pagedown') { this.moveCursorPage(1); return Consumed(); }
    if (n === 'home')     { this.setCursor(moveCursorToEdge(this.filteredIndices().length, 'start')); return Consumed(); }
    if (n === 'end') {
      this.setCursor(moveCursorToEdge(this.filteredIndices().length, 'end'));
      return Consumed();
    }

    if (n === 'space' && spec.multi) {
      const opt = this.currentOption();
      if (opt && !opt.disabled) {
        if (this.multiSelected.has(opt.value)) this.multiSelected.delete(opt.value);
        else this.multiSelected.add(opt.value);
      }
      return Consumed();
    }

    if (n === 'enter') return this.accept();

    if (spec.searchable && n === 'backspace') {
      this.setQuery(backspaceInputText(this.effectiveQuery()));
      this.setCursor(0);
      return Consumed();
    }

    if (!ev.ctrl && !ev.alt && n.length === 1) {
      if (spec.searchable) {
        this.setQuery(appendInputText(this.effectiveQuery(), n));
        this.setCursor(0);
        return Consumed();
      }
      // numeric fast-pick (non-searchable)
      const digit = n.charCodeAt(0) - 48;
      if (digit >= 1 && digit <= 9) {
        const filt = this.filteredIndices();
        if (digit - 1 < filt.length) {
          this.setCursor(digit - 1);
          return this.accept();
        }
      }
      // item-level shortcut letter
      const opts = this.optionsSnapshot();
      for (let i = 0; i < opts.length; i++) {
        const o = opts[i]!;
        if (o.shortcut && o.shortcut.toLowerCase() === n.toLowerCase()) {
          const filt = this.filteredIndices();
          const pos = filt.indexOf(i);
          if (pos >= 0) {
            this.setCursor(pos);
            return this.accept();
          }
        }
      }
    }

    return Ignored;
  }

  // KX5-0 — centralised cursor / query writers. Always update the
  // internal field (so uncontrolled callers see a stable state) and
  // fire the observer callback (controlled callers use it to update
  // their own source of truth).
  private setCursor(next: number): void {
    this.cursor = next;
    this.spec.onCursorChange?.(next);
    this.notifyChange();
  }
  private setQuery(next: string): void {
    this.query = next;
    this.spec.onQueryChange?.(next);
  }

  // MX4 + MD4 — mouse support. Click a row to select it, scroll to
  // move the cursor, double-click to activate. Multi-select remains
  // special: click toggles membership and Enter confirms the set.
  onMouse(ev: MouseEvent): EventResult {
    if (this.mode !== 'list') return Ignored;   // feedback/input handled by keyboard
    if (isClickIntentMouseEventType(ev.type)) {
      const payload = ev.payload as { kind?: string; filtIdx?: number } | undefined;
      if (payload?.kind !== 'row' || typeof payload.filtIdx !== 'number') return Ignored;
      if (this.spec.multi) {
        const filt = this.filteredIndices();
        if (payload.filtIdx >= filt.length) return Ignored;
        this.setCursor(payload.filtIdx);
        // Multi-select: click toggles instead of submitting. User
        // still needs Enter or (MX7) a dedicated "Confirm" button.
        // Double-click in multi-mode also toggles (no separate
        // activation verb — Enter confirms the whole set).
        const opt = this.currentOption();
        if (opt && !opt.disabled) {
          if (this.multiSelected.has(opt.value)) this.multiSelected.delete(opt.value);
          else this.multiSelected.add(opt.value);
        }
        return Consumed();
      }
    }
    return dispatchPointerListMouse({
        event: ev,
        count: this.filteredIndices().length,
        currentIndex: this.effectiveCursor(),
        browseMode: this.spec.browseMode,
        getValueAt: (index) => {
          const filt = this.filteredIndices();
          return index >= 0 && index < filt.length ? index : null;
        },
        setCursor: (index) => {
          this.setCursor(index);
        },
        onCursor: (_value, index) => {
          this.setCursor(index);
        },
        onActivate: (_value, index) => {
          this.setCursor(index);
          this.accept();
        },
      });
  }

  private moveCursor(delta: number): void {
    const filt = this.filteredIndices();
    if (filt.length === 0) return;
    const current = this.effectiveCursor();
    const next =
      this.spec.wrap !== false && (delta === 1 || delta === -1)
        ? cycleCursor(current, filt.length, delta)
        : moveCursorBy(current, filt.length, delta);
    this.cursor = next;
    this.clampScroll(filt.length);
    this.spec.onCursorChange?.(next);
    this.notifyChange();
  }

  private moveCursorPage(direction: -1 | 1): void {
    const filt = this.filteredIndices();
    if (filt.length === 0) return;
    const next = moveCursorByPage(this.effectiveCursor(), filt.length, this.visibleRows(), direction);
    this.cursor = next;
    this.clampScroll(filt.length);
    this.spec.onCursorChange?.(next);
    this.notifyChange();
  }

  private clampScroll(count: number): void {
    const rows = this.visibleRows();
    const cur = this.effectiveCursor();
    if (cur < this.scroll) this.scroll = cur;
    if (cur >= this.scroll + rows) this.scroll = cur - rows + 1;
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, count - rows)));
  }

  private notifyChange(): void {
    const opt = this.currentOption();
    if (opt && this.spec.onChange) this.spec.onChange(opt.value);
  }

  private accept(): EventResult {
    const spec = this.spec;
    if (spec.multi) {
      const picked = Array.from(this.multiSelected);
      return this.maybeAskFeedback(picked);
    }
    const opt = this.currentOption();
    if (!opt) return Consumed();
    if (opt.disabled) return Consumed();
    if (opt.inputType) {
      this.mode = 'input';
      this.inputBuffer = opt.inputType.initialValue ?? '';
      return Consumed();
    }
    if (opt.action) { void opt.action(); }
    return this.maybeAskFeedback(opt.value);
  }

  private maybeAskFeedback(picked: T | T[]): EventResult {
    const fb = this.spec.feedbackPrompt;
    if (!fb) { this.spec.onSubmit(picked); return Consumed(); }
    const optional = fb.optionalFor ?? [];
    const skip = !Array.isArray(picked) && optional.some(v => Object.is(v, picked));
    if (skip) { this.spec.onSubmit(picked); return Consumed(); }
    this.pendingPicked = picked;
    this.mode = 'feedback';
    return Consumed();
  }

  private onFeedbackEvent(ev: KeyEvent): EventResult {
    if (ev.name === 'escape') {
      this.mode = 'list';
      this.feedback = '';
      this.pendingPicked = null;
      return Consumed();
    }
    if (ev.name === 'enter') {
      if (this.pendingPicked !== null) this.spec.onSubmit(this.pendingPicked, this.feedback);
      return Consumed();
    }
    if (ev.name === 'backspace') {
      this.feedback = backspaceInputText(this.feedback);
      return Consumed();
    }
    if (!ev.ctrl && !ev.alt && ev.name.length === 1) {
      const max = this.spec.feedbackPrompt?.maxLength ?? 1000;
      this.feedback = appendInputText(this.feedback, ev.name === 'space' ? ' ' : ev.name, max);
      return Consumed();
    }
    if (ev.name === 'space') {
      const max = this.spec.feedbackPrompt?.maxLength ?? 1000;
      this.feedback = appendInputText(this.feedback, ' ', max);
      return Consumed();
    }
    return Ignored;
  }

  private onInputEvent(ev: KeyEvent): EventResult {
    const opt = this.currentOption();
    const cfg = opt?.inputType;
    if (!cfg) { this.mode = 'list'; return Ignored; }
    if (ev.name === 'escape') {
      this.mode = 'list';
      this.inputBuffer = '';
      return Consumed();
    }
    if (ev.name === 'enter') {
      if (!this.inputBuffer && cfg.allowEmptySubmitToCancel) {
        this.spec.onCancel?.();
        return Consumed();
      }
      if (opt?.action) void opt.action();
      this.spec.onSubmit(opt!.value, this.inputBuffer);
      return Consumed();
    }
    if (ev.name === 'backspace') {
      this.inputBuffer = backspaceInputText(this.inputBuffer);
      return Consumed();
    }
    if (!ev.ctrl && !ev.alt && ev.name.length === 1) {
      this.inputBuffer = appendInputText(this.inputBuffer, ev.name === 'space' ? ' ' : ev.name);
      return Consumed();
    }
    if (ev.name === 'space') {
      this.inputBuffer = appendInputText(this.inputBuffer, ' ');
      return Consumed();
    }
    return Ignored;
  }

  // ── layout ─────────────────────────────────────────────────────
  layout(_size: Size): void { /* no cached state */ }

  requiredSize(constraint: Size): Size {
    const spec = this.spec;
    const opts = this.optionsSnapshot();
    let w = 0;
    for (const o of opts) {
      const line = (spec.multi ? '[×] ' : '') +
        (o.icon ? o.icon + ' ' : '') +
        (o.shortcut ? `(${o.shortcut}) ` : '') +
        o.label +
        (o.description ? '  ' + o.description : '');
      w = Math.max(w, cellWidth(line) + 2);
    }
    if (spec.title) w = Math.max(w, cellWidth(spec.title));
    const rowCount = Math.min(opts.length, spec.visibleRows ?? 8);
    // Upward mode renders list + separator only — no title/search/footer.
    const extras = spec.direction === 'up'
      ? 1 /* separator row */
      : (spec.title ? 1 : 0) + (spec.searchable ? 1 : 0) + 1 /* footer */;
    return {
      width: Math.min(constraint.width, w),
      height: Math.min(constraint.height, rowCount + extras),
    };
  }

  takeFocus(_src?: FocusSource): boolean { return true; }

  // ── test / adapter helpers ─────────────────────────────────────
  /** @internal — exposed for tests and wrapper widgets. */
  _snapshot() {
    return {
      cursor: this.effectiveCursor(),
      scroll: this.scroll,
      query: this.effectiveQuery(),
      mode: this.mode,
      feedback: this.feedback,
      inputBuffer: this.inputBuffer,
      multi: Array.from(this.multiSelected),
      filteredCount: this.filteredIndices().length,
    };
  }
}
