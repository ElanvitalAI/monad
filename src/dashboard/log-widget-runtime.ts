import type { LogClickDispatchDeps } from '../log-pane/click-dispatch.js';
import type { FoldMode } from '../log-entry.js';
import { buildDashboardLogProjection } from './render/renderer.js';
import {
  applyLogSurfaceState,
  type LogSurfaceStateContract,
} from '../widgets/contracts/log-surface.js';

export interface DashboardLogWidgetRuntime {
  syncMain(
    state: LogSurfaceStateContract | null,
    opts: {
      lines: readonly string[];
      scrollOffset: number;
      focused: boolean;
      footerLine: string | null;
      /** ⭐ `B1` — 스트리밍 중 대기 큐 한 줄(없으면 null). */
      queueRow?: string | null;
      logFrozenTailIndex: number | null;
      logSearchCursor: number;
      logSearchResultsLength: number;
      logFilterQuery: string;
      logSearchQuery: string;
      foldMode: FoldMode;
      clickDeps: LogClickDispatchDeps | null;
    },
  ): void;
  syncDebug(
    state: LogSurfaceStateContract | null,
    opts: {
      lines: readonly string[];
      scrollOffset: number;
      filterQuery: string;
    },
  ): void;
}

export function createDashboardLogWidgetRuntime(): DashboardLogWidgetRuntime {
  return {
    syncMain(state, opts) {
      if (!state) return;
      const projection = buildDashboardLogProjection({
        chatScrollOffset: opts.scrollOffset,
        logFrozenTailIndex: opts.logFrozenTailIndex,
        logSearchCursor: opts.logSearchCursor,
        logSearchResultsLength: opts.logSearchResultsLength,
      });
      applyLogSurfaceState(state, {
        lines: opts.lines,
        scrollOffset: opts.scrollOffset,
        focused: opts.focused,
        footerLine: opts.footerLine,
        queueRow: opts.queueRow ?? null,
        frozenTailIndex: projection.effectiveFreeze,
        filterQuery: opts.logFilterQuery || null,
        filterHint: '/log filter',
        foldMode: opts.foldMode,
        searchQuery: opts.logSearchQuery || null,
        searchCursor: projection.searchCursorState,
        clickDeps: opts.clickDeps,
      });
    },
    syncDebug(state, opts) {
      if (!state) return;
      applyLogSurfaceState(state, {
        lines: opts.lines,
        scrollOffset: opts.scrollOffset,
        focused: false,
        footerLine: null,
        queueRow: null,
        frozenTailIndex: null,
        filterQuery: opts.filterQuery || null,
        filterHint: '/debug filter',
        searchQuery: null,
        searchCursor: null,
        clickDeps: null,
      });
    },
  };
}
