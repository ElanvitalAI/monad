// ─────────────────────────────────────────────────────────────────
// Scratch pane DropTarget — DS-4a (PLAN-drag-session-ds4a-browser-
// to-scratch.md §5). Second cross-surface DropTarget consumer after
// chat-input (DS-3a).
//
// Role
// ────
//   Accepts file-path drops over the `wd-scratch` pane and appends
//   a `→ /abs/path` reference line per file to the caller-injected
//   append handler. Default action is `'link'` — no file content
//   reading. Modifier-gated `'copy'` (content inlining) is deferred
//   to DS-4b with the copy/move picker modal.
//
// Why separate from chat-input?
// ─────────────────────────────
//   • Different paneId (`wd-scratch` vs `chat-main` input)
//   • Different visual feedback semantics (scratch accept is always
//     OK · chat input may reject if outside inputRow)
//   • Different append path (scratchLines.push vs attachFilePathToken)
//   Sharing code via a helper would require the handler to carry
//   more context than either consumer needs.

import type {
  DragSession,
  DropFeedback,
  DropOutcome,
  DropTarget,
} from './primitives/drag-session/index.js';
import type { SurfaceId } from './display/types.js';
import type { HitTarget } from './input-core/event.js';

export interface ScratchDropTargetOpts {
  /** SurfaceId registered with DragManager. Convention: pane widget
   *  id string cast — `'wd-scratch' as SurfaceId`. DS-1
   *  `hitMatchesSurface` matches `pane-body` kind by `hit.paneId ===
   *  surfaceId`, so keeping surfaceId identical to the pane id lets
   *  the default-filter path engage. */
  readonly surfaceId: SurfaceId;
  /** PaneId to strict-match against (usually `'wd-scratch'`). Used
   *  inside onEnter/onOver to refuse hits on other panes should the
   *  same target ever be registered more broadly. */
  readonly paneId: string;
  /** Live scratch pane rectangle (cell coords, absolute). Called on
   *  every hover/over so the popover highlight tracks scratch pane
   *  resizes. */
  readonly getBounds: () => {
    row: number;
    col: number;
    width: number;
    height: number;
  };
  /** Handler invoked on release with the resolved absolute paths.
   *  Fire-and-forget — caller mutates scratchLines + calls draw().
   *  Errors are the caller's responsibility (log surface etc.). */
  readonly onAppendPaths: (paths: readonly string[]) => void;
}

/** Build a DropTarget for the scratch pane. Pure over opts. */
export function createScratchDropTarget(opts: ScratchDropTargetOpts): DropTarget {
  const strictMatch = (hit: HitTarget): boolean =>
    hit.kind === 'pane-body' && hit.paneId === opts.paneId;

  const acceptFeedback = (_session: DragSession): DropFeedback => ({
    accept: true,
    action: 'link',
    highlight: opts.getBounds(),
    hint: 'Append to scratch',
  });

  const refuseFeedback: DropFeedback = { accept: false };

  return {
    surfaceId: opts.surfaceId,
    acceptKinds: ['file-path[]', 'text/uri-list'],

    onEnter(session) {
      // Same optimistic-accept pattern as chat-input-drop-target.
      // onOver refines with the concrete hit on subsequent moves.
      return acceptFeedback(session);
    },

    onOver(session, hit) {
      if (!strictMatch(hit)) return refuseFeedback;
      return acceptFeedback(session);
    },

    onLeave(_session) {
      // popover cleans itself via 'leave' event
    },

    onDrop(session, hit) {
      if (!strictMatch(hit)) {
        return {
          type: 'rejected',
          target: opts.surfaceId,
          reason: `wrong-hit:${hit.kind}${hit.kind === 'pane-body' ? `:${hit.paneId}` : ''}`,
        };
      }
      const paths = extractFilePaths(session);
      if (paths === null || paths.length === 0) {
        return { type: 'rejected', target: opts.surfaceId, reason: 'no-file-paths' };
      }
      try {
        opts.onAppendPaths(paths);
      } catch {
        // Append handler owns its error logging; we return optimistic
        // 'dropped' so the source UI clears the ghost. Failures
        // surface via scratch content not updating.
      }
      return { type: 'dropped', target: opts.surfaceId, action: 'link' };
    },
  };
}

/** Extract absolute paths from a drag payload. Same priority order
 *  as chat-input-drop-target: `'file-path[]'` primary, RFC 2483
 *  `'text/uri-list'` fallback. */
function extractFilePaths(session: DragSession): readonly string[] | null {
  const primary = session.payload.get('file-path[]');
  if (Array.isArray(primary) && primary.every((p): p is string => typeof p === 'string')) {
    return primary;
  }
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
        /* skip malformed */
      }
    }
    return paths.length > 0 ? paths : null;
  }
  return null;
}
