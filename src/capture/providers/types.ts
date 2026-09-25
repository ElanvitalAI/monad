// H6 P6 · Capture source provider interface.
//
// Providers turn domain-specific stores (VW pane factory · live
// embodied session map · CDP client) into a uniform list + snapshot
// surface the registry consumes. Every built-in provider in Bundle 1
// implements this interface; Bundle 2 external / plugin providers
// will too.
//
// Design rails (PLAN §D1, §D2, §D4, §D10):
//   - D1  Static type registry · provider enumerates live via its own
//         store at list-time; no per-instance registration churn.
//   - D2  Source id = `<type>:<native-id>` · native-id MUST NOT contain
//         `:` (providers enforce · registry splits on first colon).
//   - D4  Providers SHOULD return warnings for degraded paths
//         (e.g. observer-missing) rather than throwing — caller
//         decides whether to surface.
//   - D10 `list()` must not throw for environmental reasons (Chrome
//         not installed, no live session) · return empty instead.

import type { InputSourceRef } from '../../input/input-source-kind.js';
import type { CaptureDimensions, CaptureFormat } from '../types.js';

/** Built-in source types Bundle 1 recognizes. External providers may
 *  register additional types (plugin path · Bundle 2) but the built-in
 *  trio is guaranteed present. */
export type CaptureSourceType =
  | 'vw-pane'
  | 'agent-session'
  | 'browser-cdp';

export interface CaptureSourceDescriptor {
  /** Unique id · format `<type>:<native-id>`.
   *  Examples: 'vw-pane:1/p12' · 'agent-session:emb-codex-pty-1' ·
   *  'browser-cdp:page-0'. */
  readonly id: string;
  /** Provider type tag · matches `CaptureSourceProvider.type`. */
  readonly type: CaptureSourceType | string;
  /** Human-readable label · "codex-pty [emb-codex-pty-1]". */
  readonly label: string;
  /** One-line summary for LLM context · e.g.
   *  "running · channels: message, reasoning". */
  readonly summary?: string;
  /** Formats this source can produce at snapshot time. */
  readonly formats: readonly CaptureFormat[];
  /** Epoch ms of last known activity (provider discretion · may be
   *  session startedAt, page load time, or omitted). */
  readonly updatedAt?: number;
  /** Arbitrary metadata for Bundle 2 HUD / discovery UI. Registry
   *  passes through without interpretation. */
  readonly meta?: Readonly<Record<string, unknown>>;
  /** Canonical source provenance for cross-surface observation /
   *  policy work. Additive alpha — current callers may ignore it. */
  readonly sourceRef?: InputSourceRef;
}

export interface SnapshotOpts {
  /** Override format. Undefined = provider's primary default. */
  readonly format?: CaptureFormat;
  readonly dims?: CaptureDimensions;
  readonly title?: string;
  readonly theme?: Record<string, string | number>;
  /** Bundle 2 · historical snapshot at epoch ms. Bundle 1 returns
   *  current + `'historical-not-supported'` warning when set. */
  readonly at?: number;
}

export interface SnapshotResult {
  /** Echo of the requested source id — helps callers trace outputs
   *  through logs. */
  readonly sourceId: string;
  readonly format: CaptureFormat;
  /** Plain-text body for text/ansi/asciicast/svg. Empty string when
   *  format='png' (see `bodyBase64`). */
  readonly body: string;
  /** Set when format='png' · base64-encoded image bytes. */
  readonly bodyBase64?: string;
  readonly bytes: number;
  readonly dims: CaptureDimensions;
  readonly capturedAt: number;
  /** Short description echoed from the provider's descriptor (if
   *  available) · lets callers log without a second `list()` call. */
  readonly sourceSummary?: string;
  /** Canonical source provenance echoed from the provider so
   *  downstream inject / audit / policy code can reason about the
   *  observation surface without re-parsing source ids. */
  readonly sourceRef?: InputSourceRef;
  /** Non-fatal warnings · e.g. 'observer-missing' · 'historical-not-supported'
   *  · 'source-empty' · 'buffer-truncated'. */
  readonly warnings: readonly string[];
}

export interface CaptureSourceProvider {
  readonly type: CaptureSourceType | string;
  /** Enumerate currently-visible sources. Must NOT throw for
   *  environmental reasons (no Chrome, no sessions) — return []. */
  list(): readonly CaptureSourceDescriptor[];
  /** Resolve a source id (already type-routed by the registry) to a
   *  live snapshot. Throws for malformed ids or unrecoverable errors
   *  (source not found, source dead). */
  snapshot(id: string, opts: SnapshotOpts): Promise<SnapshotResult>;
  /** Optional · some providers (CDP) can clean up per-id state.
   *  Bundle 2 event-bus will replace this with subscribe/dispose. */
  dispose?(id: string): void;
}

/** Error thrown when `registry.snapshot(id)` can't route an id to
 *  any registered provider. Caller surfaces to LLM as isError. */
export class UnknownCaptureSourceError extends Error {
  constructor(
    readonly sourceId: string,
    readonly providerType: string,
  ) {
    super(
      `CaptureSourceRegistry · unknown source '${sourceId}' · no provider registered for type '${providerType}'`,
    );
    this.name = 'UnknownCaptureSourceError';
  }
}
