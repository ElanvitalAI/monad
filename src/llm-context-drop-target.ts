// ─────────────────────────────────────────────────────────────────
// LLM context DropTarget — DS-4c (PLAN-drag-session-ds4c-llm-context.md
// §5.1). Third cross-surface DropTarget consumer after chat-input
// (DS-3a) and scratch pane (DS-4a).
//
// Role
// ────
//   Accepts drops on the drag-reactive banner row above the chat
//   composer. The banner appears only during an active drag session
//   (wire subscribes to DragManager begin/end) · DS-4c's core UX is
//   "dropzone that materializes on drag start, vanishes on release".
//
//   Payload priority: `'llm-context-slice'` primary (structured
//   {kind:'files', paths} from working-dir-mouse.ts:183) · falls back
//   to `'file-path[]'` · then RFC 2483 `'text/uri-list'`. The primary
//   path lets future sources emit richer context-specific payloads
//   (text slices, symbol refs, …) via the same DropTarget without a
//   second rewrite.
//
//   Ingest handler is caller-injected via `onIngestContext`; dashboard
//   typically wires this to `attachFilePathToken` (same as DS-3a) for
//   MVP — the UX differentiator is the drag-reactive banner position,
//   not a separate ingest path. Future phase may dispatch into a
//   dedicated context-block queue with a header prefix.
//
// Why strict match on input::llm-context-drop
// ────────────────────────────────────────────
//   The banner hit is synthesized by `drag-session-dashboard-wire`'s
//   getInputHitTarget as `{kind:'input', inputId:'llm-context-drop'}`
//   only when drag is active (§5.3). surfaceId follows the
//   'input::${inputId}' convention (surface/address.ts) so DS-1's
//   hitMatchesSurface input-case (Phase A · 2026-04-21) routes the
//   hit exactly to this target without chat-input (input::chat-main)
//   picking it up first.
//
// Design mirror of chat-input-drop-target.ts / scratch-drop-target.ts
// ──────────────────────────────────────────────────────────────────
//   Same 5-method DropTarget shape, same optimistic onEnter, same
//   strict onOver/onDrop pattern. Ingest path is async fire-and-forget
//   (void return) for symmetry with DS-3a. Third-consumer pattern
//   established by DS-4a is preserved.

import type {
  DragSession,
  DropFeedback,
  DropOutcome,
  DropTarget,
} from './primitives/drag-session/index.js';
import type { SurfaceId } from './display/types.js';
import type { HitTarget } from './input-core/event.js';

export interface LlmContextDropTargetOpts {
  /** SurfaceId registered with DragManager. Convention:
   *  `surfaceKey({kind:'input', inputId:'llm-context-drop'})` which
   *  resolves to `'input::llm-context-drop'`. Required by DS-1's
   *  hitMatchesSurface input-case strict match. */
  readonly surfaceId: SurfaceId;
  /** The inputId the synthesized banner hit carries. Usually
   *  `'llm-context-drop'`. onEnter/onOver/onDrop strict-check on
   *  `hit.inputId === inputId`. */
  readonly inputId: string;
  /** Live banner rectangle (cell coords, absolute). Called on every
   *  hover/over so the popover highlight tracks terminal resizes.
   *  Typically `{row: inputPromptRow - 1, col: 1, width: cols - 2,
   *  height: 1}`. */
  readonly getBounds: () => {
    row: number;
    col: number;
    width: number;
    height: number;
  };
  /** Handler invoked on release with the resolved absolute paths.
   *  Fire-and-forget — caller owns async completion + error
   *  surfacing (chat log line etc.). */
  readonly onIngestContext: (paths: readonly string[]) => void | Promise<void>;
  /** Hint text rendered centered on the banner highlight. Default
   *  'Add to LLM context'. */
  readonly hint?: string;
}

/** Typed shape of the `'llm-context-slice'` payload produced by
 *  working-dir-mouse.ts:183. Exported for future sources that want
 *  to populate the same kind. */
export interface LlmContextFilesSlice {
  readonly kind: 'files';
  readonly paths: readonly string[];
}

function isFilesSlice(v: unknown): v is LlmContextFilesSlice {
  if (v === null || typeof v !== 'object') return false;
  const o = v as { readonly kind?: unknown; readonly paths?: unknown };
  if (o.kind !== 'files') return false;
  if (!Array.isArray(o.paths)) return false;
  return o.paths.every((p): p is string => typeof p === 'string');
}

/** Build a DropTarget for the LLM context banner. Pure over opts. */
export function createLlmContextDropTarget(
  opts: LlmContextDropTargetOpts,
): DropTarget {
  const strictMatch = (hit: HitTarget): boolean =>
    hit.kind === 'input' && hit.inputId === opts.inputId;

  const acceptFeedback = (_session: DragSession): DropFeedback => ({
    accept: true,
    action: 'copy',
    highlight: opts.getBounds(),
    hint: opts.hint ?? 'Add to LLM context',
  });

  const refuseFeedback: DropFeedback = { accept: false };

  return {
    surfaceId: opts.surfaceId,
    acceptKinds: ['llm-context-slice', 'file-path[]', 'text/uri-list'],

    onEnter(session) {
      // Optimistic accept; onOver refines per concrete hit.
      return acceptFeedback(session);
    },

    onOver(session, hit) {
      if (!strictMatch(hit)) return refuseFeedback;
      return acceptFeedback(session);
    },

    onLeave(_session) {
      // popover clears via its own 'leave' subscription
    },

    onDrop(session, hit) {
      if (!strictMatch(hit)) {
        return {
          type: 'rejected',
          target: opts.surfaceId,
          reason: `wrong-hit:${hit.kind}${hit.kind === 'input' ? `:${hit.inputId}` : ''}`,
        };
      }
      const paths = extractPaths(session);
      if (paths === null || paths.length === 0) {
        return { type: 'rejected', target: opts.surfaceId, reason: 'no-paths' };
      }
      void opts.onIngestContext(paths);
      return { type: 'dropped', target: opts.surfaceId, action: 'copy' };
    },
  };
}

/** Extract absolute file paths from a drag payload. Priority differs
 *  from DS-3a/4a: `'llm-context-slice'` primary (structured variant),
 *  then `'file-path[]'`, then RFC 2483 `'text/uri-list'`. Returns
 *  null when no source yields a non-empty string array. */
export function extractPaths(session: DragSession): readonly string[] | null {
  // 1. llm-context-slice (DS-4c primary)
  const slice = session.payload.get('llm-context-slice');
  if (isFilesSlice(slice) && slice.paths.length > 0) return slice.paths;

  // 2. file-path[] (DS-3a/4a parity)
  const primary = session.payload.get('file-path[]');
  if (
    Array.isArray(primary) &&
    primary.length > 0 &&
    primary.every((p): p is string => typeof p === 'string')
  ) {
    return primary;
  }

  // 3. text/uri-list (RFC 2483 fallback · cross-process DnD path)
  const uriList = session.payload.get('text/uri-list');
  if (typeof uriList === 'string' && uriList.length > 0) {
    const paths: string[] = [];
    for (const rawLine of uriList.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith('#')) continue;
      if (!line.startsWith('file://')) continue;
      try {
        paths.push(decodeURIComponent(line.slice('file://'.length)));
      } catch {
        /* skip malformed percent-encoding */
      }
    }
    return paths.length > 0 ? paths : null;
  }
  return null;
}
