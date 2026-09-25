// ── X1 (Phase 1) — range-select consumer ──
//
// Handles the substrate `range-select-update` + `range-select-end`
// intent pair fired by the drag-session DS-4d arc. `update` events
// arrive while the user is dragging; we capture the most recent
// (row, col) per surface. `end` finalises the range and dispatches
// to the injected `onRangeSelect` callback (typically wired to a
// buffer extractor + clipboard write + chat context attach).
//
// Per HANDOFF §5 X1 detail: this consumer is "the multi-line variant
// of word-select". Single-line drags produce a `SurfaceRangeSpec`
// where startRow === endRow; consumers/tests do not need a separate
// path for that case.

import type {
  TerminalSurfaceIntentConsumer,
  TerminalSurfaceIntentResult,
} from '../terminal-mouse-intent-runtime.js';
import type { SerializableSurfaceIntent } from '../terminal-surface-intent.js';

export interface RangeSelectSpec {
  readonly surfaceId: string;
  readonly paneKind: 'terminal' | 'external-terminal' | 'preview-terminal';
  readonly startRow: number;
  readonly startCol: number;
  readonly endRow: number;
  readonly endCol: number;
}

export interface RangeSelectConsumerDeps {
  /** Called on `range-select-end` with the full start→end spec. The
   *  start position is the FIRST `range-select-update` we observed
   *  for this surface; the end position is the `range-select-end`
   *  intent's coordinates. */
  onRangeSelect?: (spec: RangeSelectSpec) => void;
  logDebug?: (category: string, event: string, data?: unknown) => void;
}

interface RangeAnchor {
  startRow: number;
  startCol: number;
}

export function createRangeSelectConsumer(
  deps: RangeSelectConsumerDeps = {},
): TerminalSurfaceIntentConsumer {
  const anchors = new Map<string, RangeAnchor>();

  return {
    id: 'range-select',
    // Higher priority than word-select (50) so a drag finalisation
    // wins over a stray double-click event during long drag motions.
    // Lower than context-menu (40) so right-click-to-cancel still
    // takes precedence.
    priority: 45,
    handle(intent: SerializableSurfaceIntent): TerminalSurfaceIntentResult {
      if (intent.kind !== 'range-select-update' && intent.kind !== 'range-select-end') {
        return { handled: false };
      }
      // G6 — capability gate. canInspect maps to "user can read the
      // surface buffer" which is a prerequisite for any text capture.
      if (!intent.capability.canInspect) {
        return { handled: false, reason: 'no-canInspect' };
      }

      if (intent.kind === 'range-select-update') {
        // Only set anchor on FIRST update; subsequent updates are
        // motion within the same drag. (DS-4d emits motion-style
        // updates throughout the drag; the anchor is the original
        // press location.)
        if (!anchors.has(intent.surfaceId)) {
          anchors.set(intent.surfaceId, { startRow: intent.row, startCol: intent.col });
        }
        if (deps.logDebug) {
          deps.logDebug('terminal.intent.range-select.update', intent.surfaceId, {
            row: intent.row,
            col: intent.col,
            anchor: anchors.get(intent.surfaceId),
          });
        }
        return { handled: true };
      }

      // range-select-end
      const anchor = anchors.get(intent.surfaceId);
      anchors.delete(intent.surfaceId);
      // No anchor means the end fired without a prior update —
      // synthesize a single-cell range so the consumer still fires
      // (matches the user's expectation of a click-with-tiny-drag).
      const spec: RangeSelectSpec = {
        surfaceId: intent.surfaceId,
        paneKind: intent.paneKind,
        startRow: anchor?.startRow ?? intent.row,
        startCol: anchor?.startCol ?? intent.col,
        endRow: intent.row,
        endCol: intent.col,
      };
      try { deps.onRangeSelect?.(spec); } catch { /* isolate */ }
      if (deps.logDebug) {
        deps.logDebug('terminal.intent.range-select.applied', intent.surfaceId, {
          startRow: spec.startRow,
          startCol: spec.startCol,
          endRow: spec.endRow,
          endCol: spec.endCol,
          hadAnchor: anchor !== undefined,
        });
      }
      return { handled: true };
    },
  };
}
