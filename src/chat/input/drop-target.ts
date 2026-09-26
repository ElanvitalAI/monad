// ─────────────────────────────────────────────────────────────────
// Chat input DropTarget — DS-3a (PLAN-drag-session-ds3-browser-to-chat
// §3.3). First real cross-surface consumer of the DragManager
// primitive (PR #315).
//
// Role
// ────
//   Accepts file-path drops from any source (browser pane today,
//   scratch / remote-browser / LLM context dump tomorrow) and routes
//   them through a caller-injected `onAttachPaths` handler. The
//   handler typically calls dashboard's `attachFilePathToken`
//   (dashboard.ts:5341) which owns the tokenize → register →
//   render-summary pipeline.
//
// Why caller-injected?
// ─────────────────────
//   `attachFilePathToken` is a dashboard closure that captures
//   contextRegistry, chatLines, draw(), and chatScrollOffset. Exposing
//   it module-top-level would leak dashboard state across modules.
//   Instead, dashboard wires the closure in at mount time, and this
//   module stays pure over its opts.
//
// Design decisions
// ────────────────
//   • DS-1 `hitMatchesSurface` returns true by default for hit kinds
//     it doesn't know about (including the new `'input'` kind from
//     PR #330). Strict matching — "this target only accepts drops
//     over MY specific inputId" — is enforced here via
//     `onEnter` / `onOver` returning `accept: false` when the kind
//     or inputId doesn't match.
//   • `onDrop` stays synchronous (matching DropTarget.onDrop's
//     signature); actual attachment work is fire-and-forget since
//     errors surface as chat log warnings via
//     `attachFilePathToken`'s own error path.
//   • `acceptKinds = ['file-path[]', 'text/uri-list']` — primary is
//     the elanous-native array shape; URI list fallback lets us accept
//     payloads originating from future cross-process DnD (XDND /
//     Wayland `text/uri-list` MIME) without a second rewrite.

import type {
  DragSession,
  DropFeedback,
  DropOutcome,
  DropTarget,
} from '../../primitives/drag-session/index.js';
import type { SurfaceId } from '../../display/types.js';
// DS-1 DropTarget.onOver / onDrop receive input-core HitTarget (the
// primitive module imports from input-core/event.js). Display HitTarget
// is not the right type here — both unions were extended in PR #330 to
// include `{kind:'input', inputId}`, so the strict match works either
// way at runtime, but the type must match the primitive's signature.
import type { HitTarget } from '../../input-core/event.js';

export interface ChatInputDropTargetOpts {
  /** Surface id to register with DragManager. Convention:
   *  `'input:chat-main' as SurfaceId` (stringified `SurfaceRegistry`
   *  address). DropTarget resolution in DS-1 doesn't require the id
   *  to match the hit's inputId; strict matching happens inside
   *  onEnter/onOver. */
  readonly surfaceId: SurfaceId;
  /** The `inputId` this target accepts drops for (e.g. `'chat-main'`).
   *  Hits with a different inputId get `accept: false`. */
  readonly inputId: string;
  /** Live rectangle of the chat input in terminal cells. Called on
   *  every hover/over to populate `DropFeedback.highlight` — so the
   *  drop-zone popover renders in sync with terminal resizes. */
  readonly getBounds: () => { row: number; col: number; width: number; height: number };
  /** Handler invoked on release with the resolved absolute paths.
   *  Dashboard wires this to `attachFilePathToken` loop. Failures
   *  surface as chat log warnings; this target returns 'dropped'
   *  optimistically on valid payload.
   *
   *  Returns void — fire-and-forget. Async handlers are OK; we
   *  discard the promise. */
  readonly onAttachPaths: (paths: readonly string[]) => void | Promise<void>;
}

/** Build a DropTarget for the chat input. Pure over opts. */
export function createChatInputDropTarget(opts: ChatInputDropTargetOpts): DropTarget {
  const strictMatch = (hit: HitTarget): boolean =>
    hit.kind === 'input' && hit.inputId === opts.inputId;

  const acceptFeedback = (session: DragSession): DropFeedback => {
    const label = session.payload.preview?.label ?? 'item';
    return {
      accept: true,
      action: 'copy',
      highlight: opts.getBounds(),
      hint: `Attach ${label}`,
    };
  };

  const refuseFeedback: DropFeedback = { accept: false };

  return {
    surfaceId: opts.surfaceId,
    acceptKinds: ['file-path[]', 'text/uri-list'],

    onEnter(session) {
      // onEnter fires when the pointer first lands on this target.
      // DS-1 only selects us when payload.kinds ∩ acceptKinds is
      // non-empty, so we just re-confirm the hit shape here. Default-
      // true surface matching from DS-1 means a pointer over *any*
      // input kind (not just chat-main) would reach us — refuse
      // when inputId mismatches so source sees the correct cursor.
      //
      // Hit is implicit at onEnter (first over this target) — the
      // primitive doesn't pass it. We accept optimistically; onOver
      // refines with the concrete hit on subsequent moves.
      return acceptFeedback(session);
    },

    onOver(session, hit) {
      if (!strictMatch(hit)) return refuseFeedback;
      return acceptFeedback(session);
    },

    onLeave(_session) {
      // No internal state to clear — drop-zone-popover module handles
      // its own cleanup by subscribing to the manager's 'leave' event.
    },

    onDrop(session, hit) {
      if (!strictMatch(hit)) {
        return {
          type: 'rejected',
          target: opts.surfaceId,
          reason: `wrong-hit:${hit.kind}${hit.kind === 'input' ? `:${hit.inputId}` : ''}`,
        };
      }
      const paths = extractFilePaths(session);
      if (paths === null || paths.length === 0) {
        return { type: 'rejected', target: opts.surfaceId, reason: 'no-file-paths' };
      }
      // Fire-and-forget. The handler reports per-path failures via
      // chat log lines (attachFilePathToken path). The DropOutcome
      // is optimistic `dropped` so the source UI closes its drag
      // visualization promptly; a fully-correct async outcome would
      // require Promise<DropOutcome> in the DS-1 contract (out of
      // DS-3a scope).
      void opts.onAttachPaths(paths);
      return { type: 'dropped', target: opts.surfaceId, action: 'copy' };
    },
  };
}

/** Extract absolute file paths from a drag payload. Prefers the
 *  native `'file-path[]'` kind; falls back to parsing
 *  `'text/uri-list'` (one URI per line, `file://` prefix stripped +
 *  percent-decoded). Returns null when neither is present or valid. */
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
      if (line.length === 0 || line.startsWith('#')) continue; // RFC 2483 comment
      if (!line.startsWith('file://')) continue;
      try {
        paths.push(decodeURIComponent(line.slice('file://'.length)));
      } catch {
        /* malformed percent-encoding — skip */
      }
    }
    return paths.length > 0 ? paths : null;
  }
  return null;
}
