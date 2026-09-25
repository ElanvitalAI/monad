// ── Capture Phase 0 — Types ──
//
// Pure type surface for the capture arc's Phase 0 skeleton. Kept
// deliberately narrow — enough to let callers request a text / ansi /
// asciicast artifact and record an asciicast stream, but without the
// SVG/PNG pipeline or pane substrate integration that Phase 0.5+
// adds.
//
// Design intent:
//   - Capture is substrate-unaware at this layer. The engine consumes
//     a caller-supplied `source` function that yields one ANSI frame
//     (or stream of chunks for the recorder). Pane substrate wiring
//     arrives in Phase 2b where the same API accepts a PaneRef and
//     talks to `pane-source.ts`.
//   - Every format is decided at request time; the engine picks the
//     encoder. No reflection on output — caller checks `result.format`.
//
// See: 내부 문서 `PLAN-session-capture-phase-0` · 내부 문서 `ROADMAP-capture-recording`

export type CaptureFormat = 'text' | 'ansi' | 'asciicast' | 'svg' | 'png';

/** Capture target — Bundle 6T Phase C·a+b expanded this from pane-only
 *  to full SurfaceAddress coverage. Existing callers using the legacy
 *  `{kind:'pane', paneId}` shape keep working because the surface-source
 *  dispatcher (src/capture/sources/surface-source.ts) recognizes it and
 *  auto-wraps into a `PaneRef`. New callers pass the full SurfaceAddress
 *  via `{kind:'pane', ref}` or `{kind:'modal', modalId}` etc.
 *
 *  The `{kind:'stream'}` variant signals that the caller owns whatever
 *  ANSI arrives — engine doesn't consult any substrate source. */
import type { PaneRef } from '../panes/types.js';

export type CaptureTarget =
  | { readonly kind: 'stream' }                 // caller-owned source
  // Pane — accepts either the legacy paneId-only shape OR a full PaneRef
  | { readonly kind: 'pane'; readonly paneId: string; readonly ref?: PaneRef }
  | { readonly kind: 'pane'; readonly ref: PaneRef; readonly paneId?: string }
  // Bundle 6T — remaining SurfaceAddress kinds
  | { readonly kind: 'modal';   readonly modalId: string }
  | { readonly kind: 'widget';  readonly widgetId: string }
  | { readonly kind: 'popover'; readonly popoverId: string }
  | { readonly kind: 'inline';  readonly inlineId: string }
  | { readonly kind: 'bg';      readonly bgId: string }
  | { readonly kind: 'screen' };

export interface CaptureDimensions {
  readonly cols: number;
  readonly rows: number;
}

export interface CaptureRequest {
  readonly target: CaptureTarget;
  readonly format: CaptureFormat;
  readonly dims: CaptureDimensions;
  /** Human-readable label embedded in asciicast header / file meta. */
  readonly title?: string;
  /** The ANSI/plain payload the engine should encode. Phase 0 requires
   *  the caller to supply this directly — Phase 2b swaps in substrate
   *  lookup via PaneRef. */
  readonly source: () => string;
  /** When set, engine also returns the raw input string unchanged for
   *  callers that want parallel side-channels (debug, hash). */
  readonly echoInput?: boolean;
  /** Caller-provided clock for deterministic tests. Defaults to Date.now. */
  readonly now?: () => number;
  /** Optional theme override for SVG/PNG formats. See SvgThemeTokens. */
  readonly theme?: Record<string, string | number>;
}

export interface CaptureResult {
  readonly format: CaptureFormat;
  readonly body: string;
  readonly bytes: number;
  readonly dims: CaptureDimensions;
  readonly capturedAt: number;
  readonly title?: string;
  /** Present only when `echoInput === true`. */
  readonly input?: string;
}

// ── Recorder types ─────────────────────────────────────────────

/** Chunk type an asciicast frame can carry. 'o' = output, 'i' = input. */
export type RecorderStream = 'o' | 'i';

export interface RecorderOpts {
  readonly dims: CaptureDimensions;
  readonly title?: string;
  /** Epoch seconds at recording start. Defaults to current time. */
  readonly startedAtSec?: number;
  /** Clock override for deterministic tests. Returns ms. */
  readonly now?: () => number;
  /** Environment embed in asciicast header (SHELL, TERM …). */
  readonly env?: Record<string, string>;
}

export type RecorderStatus = 'idle' | 'recording' | 'paused' | 'stopped';

export interface RecorderHandle {
  readonly status: RecorderStatus;
  readonly frameCount: number;
  /** Current duration (seconds) excluding paused spans. */
  readonly elapsedSec: number;
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  write(bytes: string, stream?: RecorderStream): void;
  /** Export current state as an asciicast v2 string. Stop() first
   *  for the canonical end-of-record artifact; calling while
   *  recording produces a valid prefix. */
  serialize(): string;
}

/** Raised when a recorder method is invoked in the wrong state (e.g.
 *  resume while idle). */
export class RecorderStateError extends Error {
  constructor(message: string, public readonly state: RecorderStatus) {
    super(`${message} (state: ${state})`);
    this.name = 'RecorderStateError';
  }
}
