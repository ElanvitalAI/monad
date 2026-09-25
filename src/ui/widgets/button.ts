// LC7 — Button widget.
//
// A minimal clickable view. Fires its onClick on Enter or Space
// when focused. Rendered as a bracketed label; focused state uses
// the accent color so the Dialog button bar (LC7) can show which
// button is currently selected.
//
// IDX-6 Phase 4 (2026-04-19): the button now reads its colors from
// a ThemeTokens hierarchy when one is passed. Callers without a
// theme keep the legacy C.* painters — the refactor is strictly
// additive.

import type { KeyEvent } from '../../plugins/core/types.js';
import {
  paintPair,
  resolveButtonState,
  resolveWidgetTokens,
  resolveSemantic,
  type ThemeTokens,
  type TokenPair,
} from '../../theme/tokens.js';
import { C } from '../../tui.js';
import type { Printer } from '../printer.js';
import { cellWidth } from '../printer.js';
import { Consumed, Ignored, type EventResult, type FocusSource, type Size, type View } from '../view.js';
import { isPrimaryClickMouseEventType, type MouseEvent } from '../mouse-events.js';

export type ButtonStyle = 'default' | 'primary' | 'secondary' | 'danger';

export interface ButtonSpec {
  label: string;
  onClick: () => void;
  style?: ButtonStyle;
  frameStyle?: 'bracket' | 'pill';
  /** Single-letter shortcut (case-insensitive). Still needs focus + key to trigger. */
  shortcut?: string;
  /** IDX-6 Phase 4 — optional theme tokens. When supplied, the
   *  button resolves colors via resolveButtonState / resolveSemantic
   *  instead of the legacy C.* painters. Absent = backward-compat
   *  behavior unchanged. */
  theme?: ThemeTokens;
  /** IDX-F5c — stable identifier for the modal-button HitTarget
   *  refinement. When supplied, Button registers its clickable
   *  region with `{kind:'button', buttonId}` payload so
   *  modal-adapter's payload reader can refine ev.hitTarget to
   *  `{kind:'modal-button', modalId, buttonId}`. Omit to preserve
   *  legacy un-tagged registration. */
  buttonId?: string;
}

export class Button implements View {
  private focused = false;

  constructor(private spec: ButtonSpec) {}

  get label(): string { return this.spec.label; }
  get shortcut(): string | undefined { return this.spec.shortcut; }

  draw(p: Printer): void {
    const active = this.focused && p.focused;
    const labelPaint = this.stylePaint(active);
    const text = this.spec.frameStyle === 'pill'
      ? labelPaint(` ${this.spec.label} `)
      : `${this.bracketPaint(active)('[ ')}${labelPaint(this.spec.label)}${this.bracketPaint(active)(' ]')}`;
    p.text(0, 0, text);
    // Register the button's full extent as clickable. The bracket
    // pad (2 cells each side) is included so clicking anywhere on
    // the visual button triggers it.
    const w = this.spec.frameStyle === 'pill'
      ? cellWidth(this.spec.label) + 2
      : cellWidth(this.spec.label) + 4;
    const payload = this.spec.buttonId !== undefined
      ? { kind: 'button', buttonId: this.spec.buttonId }
      : undefined;
    p.clickable({ x: 0, y: 0, width: w, height: 1 }, this, payload);
  }

  private bracketPaint(active: boolean): (s: string) => string {
    if (!active) return (s: string) => s;
    if (this.spec.theme) {
      return paintPair(resolveButtonState(this.spec.theme, 'focused'));
    }
    return C.accent;
  }

  private stylePaint(active: boolean): (s: string) => string {
    const style = this.spec.style ?? 'default';
    if (this.spec.theme) {
      return this.themePaint(active, style, this.spec.theme);
    }
    // Legacy painter path — callers without a theme keep the
    // original Mocha-bound C.* painters.
    if (!active) {
      if (style === 'danger')  return C.error;
      if (style === 'primary') return C.accent;
      if (style === 'secondary') return C.subtext;
      return C.text;
    }
    if (style === 'danger')  return (s: string) => C.bold(C.error(s));
    if (style === 'primary') return (s: string) => C.bold(C.accent(s));
    if (style === 'secondary') return C.subtext;
    return C.bold;
  }

  private themePaint(
    active: boolean,
    style: ButtonStyle,
    theme: ThemeTokens,
  ): (s: string) => string {
    // Semantic override: danger uses the theme's critical color
    // regardless of style preset's own fg — matches the invariant
    // "red stays red" from DD-IDX-15. Primary uses accent from
    // button.focused when active, or text when idle, letting the
    // preset decide saturation. Default uses button.normal/focused
    // per the hierarchy.
    if (style === 'danger') {
      const crit = resolveSemantic(theme, 'critical');
      const withBold: TokenPair = active ? { ...crit, bold: true } : crit;
      return paintPair(withBold);
    }
    if (style === 'secondary') {
      const t = theme.widgetTokens ?? undefined;
      const statusBar = resolveWidgetTokens(theme, 'statusBar');
      const pair = active
        ? {
            fg: theme.colors.text,
            bg: statusBar.pillHovered?.bg ?? statusBar.pill.bg ?? theme.widget.selected,
            bold: true,
          }
        : (t?.button.normal
          ? { ...t.button.normal, fg: theme.colors.muted }
          : { fg: theme.colors.muted });
      return paintPair(pair);
    }
    const state = active ? 'focused' : 'normal';
    const base = resolveButtonState(theme, state);
    if (style === 'primary' && !active) {
      // Primary + idle uses the accent color to stand out slightly.
      // The focused state already pops; no extra accent needed.
      return paintPair({ fg: theme.colors.accent });
    }
    return paintPair(base);
  }

  onEvent(ev: KeyEvent): EventResult {
    if (!this.focused) return Ignored;
    if (ev.name === 'enter' || ev.name === 'space') {
      this.spec.onClick();
      return Consumed();
    }
    return Ignored;
  }

  onMouse(ev: MouseEvent): EventResult {
    if (isPrimaryClickMouseEventType(ev.type)) {
      // Clicking a button also focuses it (matches keyboard cycle
      // through Tab), then triggers the click action.
      this.focused = true;
      this.spec.onClick();
      return Consumed();
    }
    return Ignored;
  }

  layout(_size: Size): void { /* no-op */ }

  requiredSize(constraint: Size): Size {
    const width = this.spec.frameStyle === 'pill'
      ? cellWidth(this.spec.label) + 2
      : cellWidth(this.spec.label) + 4;
    return {
      width: Math.min(constraint.width, width),
      height: Math.min(constraint.height, 1),
    };
  }

  takeFocus(_src?: FocusSource): boolean {
    this.focused = true;
    return true;
  }

  /** Parent (e.g. ButtonBar) flips focus off when moving away. */
  blur(): void { this.focused = false; }

  /** For tests and button-bar composition. */
  isFocused(): boolean { return this.focused; }
  click(): void { this.spec.onClick(); }
}
