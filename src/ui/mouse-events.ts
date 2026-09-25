// MX1 — Widget-level MouseEvent types.
//
// Host-side `DisplayMouseEvent` (src/display/types.ts) carries raw
// terminal-absolute row/col. When the Coordinator routes a mouse
// event to a widget (MX2), it translates that into this
// widget-level MouseEvent with coords relative to the widget's
// drawing region — so the widget can reason in its own coordinate
// space like it does for draw().
//
// The shape is intentionally close to DisplayMouseEvent so a
// straight field copy works in the router. Extra fields:
//   - `x`, `y`  : local, 0-indexed, relative to the target's region
//   - `absX`, `absY` : still 0-indexed but in the root Printer's
//                    coordinate space. Useful for drag machines
//                    (MX3) that need to track cursor paths across
//                    multiple widgets.
//
// `mouse-down` is synthesized by the router at the start of a drag
// so capture primitives can opt into drag mode before any `drag`
// events arrive.
//
// Refactoring policy note:
//   - general chooser/menu/list/tree widgets should usually consume
//     intent-level events (`click`, `double-click`, `right-click`)
//   - `mouse-down` / `release` are low-level capture signals meant
//     for drag / resize / title-bar / modal-adapter style primitives
//     and should not be a default product-widget contract

export type MouseEventType =
  | 'click'
  /** MD2 — synthesized by tui.ts SGR parser when a 2nd same-cell primary
   *  press arrives within MONAD_DOUBLE_CLICK_MS (default 300ms).
   *  Widgets in browseMode use it to distinguish select-cursor (click)
   *  from activate (double-click), matching AppCUI-rs's
   *  `MouseEvent::DoubleClick` variant. */
  | 'double-click'
  | 'right-click'
  | 'mouse-down'
  | 'drag'
  | 'release'
  | 'scroll-up'
  | 'scroll-down'
  // IDX-5 Phase 1 — Mac/Windows-like hover states. Hover events
  // never reach the binding resolver; they are consumed by the
  // widget-level onHover? hook and the hover-tracker (src/ui/
  // hover-tracker.ts) which maintains stable-hover context keys
  // and auto-triggers tooltips. Port of AppCUI-rs
  // `MouseEvent::Enter` / `MouseEvent::Leave` / `MouseEvent::Over`
  // plus a synthesized "stable" variant that fires once the
  // pointer has sat on a target for MONAD_HOVER_DELAY_MS
  // (default 500ms) — the trigger for hint-text tooltips.
  | 'hover-enter'
  | 'hover-leave'
  | 'hover-over'
  | 'hover-stable';

export type CaptureMouseEventType = Extract<MouseEventType, 'mouse-down' | 'drag' | 'release'>;
export type IntentMouseEventType = Exclude<
  MouseEventType,
  'mouse-down' | 'release' | 'hover-enter' | 'hover-leave' | 'hover-over' | 'hover-stable'
>;
export type PrimaryClickMouseEventType = Extract<IntentMouseEventType, 'click'>;
export type ClickIntentMouseEventType = Extract<IntentMouseEventType, 'click' | 'double-click'>;

export interface MouseEvent {
  type: MouseEventType;
  /** Local x (column) — 0-indexed, relative to the target view. */
  x: number;
  /** Local y (row) — 0-indexed, relative to the target view. */
  y: number;
  /** Absolute x in the root frame (0-indexed). */
  absX: number;
  /** Absolute y in the root frame (0-indexed). */
  absY: number;
  /** Shift held. */
  shift?: boolean;
  /** Ctrl held. */
  ctrl?: boolean;
  /** Alt held. */
  alt?: boolean;
  /** Opaque payload the widget attached when it registered the hit
   *  region. Widgets that register multiple regions (a list with
   *  one region per row, a column header with one region per
   *  column) use this to distinguish which region was actually
   *  clicked — simpler than reverse-computing from local coords. */
  payload?: unknown;
}

export function toWidgetMouseEventType(
  type: MouseEventType | 'motion',
): MouseEventType {
  return type === 'motion' ? 'hover-over' : type;
}

export function isCaptureMouseEventType(type: MouseEventType): type is CaptureMouseEventType {
  return type === 'mouse-down' || type === 'drag' || type === 'release';
}

export function isCaptureMoveMouseEventType(type: MouseEventType): type is Extract<CaptureMouseEventType, 'drag'> {
  return type === 'drag';
}

export function isCaptureEndMouseEventType(type: MouseEventType): type is Extract<CaptureMouseEventType, 'release'> {
  return type === 'release';
}

export function isPrimaryClickMouseEventType(type: MouseEventType): type is PrimaryClickMouseEventType {
  return type === 'click';
}

export function isClickIntentMouseEventType(
  // Accepts the raw display-level `'motion'` alias (widget-layer
  // `'hover-over'`) so callers holding a `WidgetDef.onMouse` event —
  // whose union carries `'motion'` — can classify without a prior
  // `toWidgetMouseEventType` hop. A motion event is not a click intent,
  // so the predicate simply returns false for it.
  type: MouseEventType | 'motion',
): type is ClickIntentMouseEventType {
  return type === 'click' || type === 'double-click';
}

export function isRawCaptureBoundaryMouseEventType(type: MouseEventType): type is Extract<MouseEventType, 'mouse-down' | 'release'> {
  return type === 'mouse-down' || type === 'release';
}

export function isIntentMouseEventType(type: MouseEventType): type is IntentMouseEventType {
  return !isRawCaptureBoundaryMouseEventType(type)
    && type !== 'hover-enter'
    && type !== 'hover-leave'
    && type !== 'hover-over'
    && type !== 'hover-stable';
}
