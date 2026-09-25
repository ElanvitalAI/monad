// ── VW-term-infra Phase 2a — PaneTap contract ──
//
// The three-axis tap model for any pane: raw PTY-style byte stream,
// rendered frame snapshots, and structured lifecycle events. Every
// PaneKind exposes addTap() returning an Unsubscribe — the axis it
// serves is advertised in `PaneDescription.supportedTaps`.
//
// Phase 2a status — CONTRACT ONLY:
// This file defines types. Concrete per-kind implementations land in
// each pane class body (terminal / external-terminal / widget / placeholder).
// Phase 1 pane classes may throw NotImplementedError for unsupported
// taps — callers should check supportedTaps first.
//
// See: 내부 문서 `PLAN-session-vw-term-infra` §4 Layer B · 내부 문서 `PLAN-session-vw-term-infra-p0-p2` §4

import type { Rect } from '../display/rect.js';

/** Three axes a pane can be observed on. See §4.3 for per-kind
 *  support matrix (some panes no-op on axes they don't fit). */
export type TapKind = 'raw' | 'frame' | 'event';

/** Raw output chunk — the PTY-style stream. For terminal / external-
 *  terminal panes these are the UTF-8 decoded bytes right before the
 *  emulator processes them. Widget panes may emit tool-call / render
 *  log strings on this axis (opt-in); placeholder panes never emit. */
export interface RawChunk {
  readonly bytes: string;
  readonly ts: number;
}

/** A frame-level snapshot. Minimal shape — the host consumer (capture
 *  engine · CaptureController · Widget-in-widget renderer) picks
 *  what to do with it. `cells` is deferred to Phase 2b where snapshot
 *  and frame tap share the same grid shape. For Phase 2a the frame
 *  tap carries opaque bytes (serialized ANSI or widget-specific). */
export interface FrameChunk {
  readonly mime: 'text/ansi' | 'text/plain' | 'application/x-widget-frame';
  readonly bytes: string;
  readonly dims: Rect;
  readonly ts: number;
}

/** Structured event the pane wants observers to know about. */
export type PaneEvent =
  | { readonly kind: 'cursor'; readonly row: number; readonly col: number }
  | { readonly kind: 'resize'; readonly dims: Rect }
  | { readonly kind: 'title'; readonly title: string }
  | { readonly kind: 'widget-state'; readonly fingerprint: string }
  | { readonly kind: 'mount' }
  | { readonly kind: 'unmount' }
  | { readonly kind: 'exit'; readonly code: number | null };

/** Discriminated callback. TapKind → expected callback signature. */
export type TapCallback =
  | ((chunk: RawChunk) => void)
  | ((frame: FrameChunk) => void)
  | ((evt: PaneEvent) => void);

/** Unsubscribe handle. Idempotent — calling twice is safe. */
export type Unsubscribe = () => void;

/** Thrown when a pane kind does not support the requested tap axis.
 *  Callers should check `describe().supportedTaps` before addTap. */
export class PaneTapNotSupportedError extends Error {
  constructor(public readonly kind: TapKind, public readonly paneLabel: string) {
    super(`Pane "${paneLabel}" does not support tap kind "${kind}".`);
    this.name = 'PaneTapNotSupportedError';
  }
}
