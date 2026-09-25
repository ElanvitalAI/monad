// Log-pane search modal — SelectView that lists matches as the user
// types, jumps to the picked line on Enter. Mirrors the vw-selector
// popup recipe (SelectView + BoxView + mountViewAsModalSurface) so
// the layering / context-key wiring comes free.
//
// Flow:
//   1. User presses `s` on log focus OR runs `/log search [query]`.
//   2. Dashboard builds `findLogMatches(lines, '')` initial set (empty
//      query → empty list until they type).
//   3. Modal paints an SelectView with a live query input (searchable
//      mode). The options getter re-runs findLogMatches(lines, query)
//      on every keystroke via the externalFilter + onQueryChange path.
//   4. Enter → onJump(result). Caller decides what to do (scroll + set
//      persistent highlight state).
//   5. Esc → onCancel (caller may or may not clear persistent state —
//      typical policy is "keep query so n/N still works").

import { type ViewSurfaceHandle } from '../ui/modal-adapter.js';
import { computePopupBounds } from '../ui/chrome/picker-popup-placement.js';
import { findLogMatches, type LogSearchResult } from './search.js';
import type { ThemeTokens } from '../theme/tokens.js';
import { createVwSearchModal } from '../ui/vw-search-modal.js';

export interface LogSearchModalOpts {
  /** Live source — modal reads it every keystroke via the options
   *  getter so newly pushed lines appear in matches. */
  linesGetter: () => readonly string[];
  initialQuery?: string;
  termCols: number;
  termRows: number;
  /** Screen coords the popup anchors near. Usually dashboard passes
   *  the log pane's top-left-ish. */
  anchorRow: number;
  anchorCol: number;
  onJump: (result: LogSearchResult, query: string) => void;
  onCancel?: (lastQuery: string) => void;
  theme?: ThemeTokens;
}

export function createLogSearchModal(opts: LogSearchModalOpts): ViewSurfaceHandle {
  let query = opts.initialQuery ?? '';
  let disposed = false;

  const buildItems = () => {
    if (!query.trim()) {
      return [
        {
          label: '(type to search — results appear here)',
          payload: {
            lineIdx: -1, preview: '(type to search — results appear here)',
            matchStart: 0, matchEnd: 0,
          } as LogSearchResult,
        },
      ];
    }
    const results = findLogMatches(opts.linesGetter(), query);
    if (results.length === 0) {
      return [
        {
          label: `(no matches for "${query}")`,
          payload: {
            lineIdx: -1, preview: `(no matches for "${query}")`,
            matchStart: 0, matchEnd: 0,
          } as LogSearchResult,
        },
      ];
    }
    return results.map((r) => {
      return {
        label: r.preview,
        payload: r,
      };
    });
  };
  const width = Math.min(80, Math.max(48, Math.floor(opts.termCols * 0.7)));
  const maxVisible = 10;
  const height = maxVisible + 4;
  const bounds = computePopupBounds(
    {
      anchorStartCol: Math.max(0, opts.anchorCol - 1),
      anchorEndCol: Math.max(1, opts.anchorCol),
      statusRow: opts.anchorRow,
      termCols: opts.termCols,
      termRows: opts.termRows,
    },
    { width, height },
  );
  const modal = createVwSearchModal({
    id: `log-search:${Date.now().toString(36)}`,
    bounds,
    title: 'Log search',
    width,
    maxVisible,
    initialQuery: opts.initialQuery ?? '',
    primaryActionLabel: 'jump',
    cancelActionLabel: 'cancel',
    actionButtons: false,
    filterable: true,
    browseMode: true,
    footerHint: '',
    theme: opts.theme,
    onQuery: (next) => {
      query = next;
      return buildItems();
    },
    onAccept: (item) => {
      const result = item.payload as LogSearchResult;
      if (result.lineIdx < 0) {
        opts.onCancel?.(query);
        disposed = true;
        return;
      }
      opts.onJump(result, query);
      disposed = true;
    },
    onCancel: () => {
      opts.onCancel?.(query);
      disposed = true;
    },
  });
  return {
    surface: modal.surface,
    handleKey(ev) {
      // ModalSurface.onKey is typed wider than this surface actually
      // returns (Action | Promise are legal for other surfaces). The
      // narrow ViewSurfaceHandle.handleKey contract is sync
      // 'consumed' | 'passthrough', so collapse anything that isn't a
      // definite 'consumed' to 'passthrough' — matching the sync
      // routeKey semantics (Action/Promise fall through to the next
      // priority) and this file's handleMouse normalization below.
      return modal.surface.onKey?.(ev) === 'consumed' ? 'consumed' : 'passthrough';
    },
    handleMouse(ev) {
      const result = modal.surface.onMouse?.(ev);
      return result && result.type !== 'none' ? 'consumed' : 'passthrough';
    },
    dispose() {
      disposed = true;
    },
    isDisposed() {
      return disposed;
    },
  };
}
