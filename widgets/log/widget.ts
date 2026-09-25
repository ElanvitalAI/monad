// ── Log widget ──
//
// Wraps the existing log-pane renderer as a WidgetDef so workspace
// layouts can embed the log inline (e.g. View 2's file-list + log
// side-by-side). State is lines + scroll offset — dashboard pushes
// chatLines / chatScrollOffset in via setState each draw.
//
// Phase 7 Batch A (2026-04-20) — log widget adopts the Scrollable
// behavior. The dashboard still owns `chatScrollOffset` (300+ call
// sites that do `chatScrollOffset = -1` for tail-follow) so this
// widget exposes a `scroll` field that mirrors the pane-handler's
// chatScrollOffset <-> Scrollable bridge. Pane handler syncs
// `scroll` + `maxScroll` before dispatch, reads back after, and
// snaps to -1 (tail) when scroll reaches maxScroll.

import type { Widget } from '../../src/widgets/types.js';
import { buildLogPaneViewport } from '../../src/panes/log-pane.js';
import { debug } from '../../src/debug/log.js';
import { Scrollable } from '../../src/widget-behaviors/index.js';
import type { LogClickDispatchDeps } from '../../src/log-pane/click-dispatch.js';
import {
  tryAttachmentHitAtBodyRow,
  tryAttachmentHitAtLineIndex,
} from '../../src/log-pane/click-dispatch.js';
import type { FoldMode } from '../../src/log-entry.js';
import type {
  LogSurfaceSearchCursor,
  LogSurfaceStateContract,
} from '../../src/widgets/contracts/log-surface.js';

export interface LogWidgetState extends LogSurfaceStateContract {
  lines: string[];
  /** -1 = follow tail; otherwise 0-based top index (matches LogPaneState). */
  scrollOffset: number;
  focused: boolean;
  /** Pinned footer line — rendered as the last body row when set. Used
   *  for the chat thinking/streaming indicator so it stays at the
   *  bottom of the log while streamed content scrolls above. */
  footerLine?: string | null;
  /** U-4.2 · streaming-freeze tail index. When set (non-null), the
   *  renderer shows the log content up to this index only, so content
   *  pushed during a partial-scroll doesn't flicker past the frozen
   *  view. Dashboard syncs `logFrozenTailIndex` here each frame. */
  frozenTailIndex?: number | null;
  /** U-4.2 · active search query string · non-empty when the user has
   *  a `/` search active. Drives the in-line match highlight inside
   *  the log body. */
  searchQuery?: string | null;
  /** U-4.2 · match counter state for the search badge ({current, total}
   *  rendered in the title bar). */
  searchCursor?: LogSurfaceSearchCursor | null;
  /** U-4.3 · click-dispatch deps bag · supplied by dashboard's
   *  syncLogWidgetState each frame so widget.onMouse can run the
   *  attachment hit-test without importing dashboard internals.
   *  Runtime-only field (never serialized via snapshotHash / recorder
   *  since it holds closures). */
  clickDeps?: LogClickDispatchDeps | null;
  filterQuery?: string | null;
  filterHint?: string | null;
  foldMode?: FoldMode;
  /** U-4.3 · last render's absolute origin · stashed by widget.render
   *  so widget.onMouse can compute absolute click coords for popup
   *  anchoring. Set once per render tick; reads are always post-
   *  render because mouse events require a visible widget. */
  lastRenderOriginRow?: number;
  lastRenderOriginCol?: number;
  /** Runtime-only viewport→source line map. `-1` marks non-content
   *  rows such as footer gap/footer. */
  lastVisibleLineIndices?: number[];
  /** Phase 7 Batch A — Scrollable state contract. Pane handler mirrors
   *  `scrollOffset` <-> `scroll` around dispatch; behavior mutates
   *  `scroll` and pane handler reconciles back to `scrollOffset`. */
  scroll: number;
  maxScroll?: number;
  pageSize?: number;
  halfPageSize?: number;
}

export interface LogWidgetConfig {
  lines?: string[];
}

/** How many visible-index table entries `mapped-index` may carry.
 *  Kept at the debug-log array compact limit so the prefix itself
 *  survives the store; the cap-reached bit is a separate value so a
 *  truncated prefix is never read as the whole table. */
export const MAPPED_INDEX_TABLE_PREFIX_CAP = 6;

const logWidget: Widget<LogWidgetState, LogWidgetConfig> = {
  type: 'log',
  description: 'Scrollback log pane (chat / tool output) — tail-follow aware',
  defaultCharacter: 'Log',

  // Phase 7 Batch A: declarative keymap. Scrollable handles j/k/↑↓,
  // g/G, Home/End, PgUp/PgDn, Ctrl+d/u against state.scroll — clamped
  // to [0, maxScroll] when the latter is present. The pane handler
  // bridges between chatScrollOffset (tail-sticky -1) and scroll
  // (0..maxScroll) pre/post dispatch.
  behaviors: [Scrollable],

  initialState(config) {
    return {
      lines: config?.lines ?? [],
      scrollOffset: -1,
      focused: false,
      foldMode: 'line',
      scroll: 0,
    };
  },

  render(state, ctx) {
    // U-4.3 · stash origin for onMouse · only set when the host
    // supplies them (pure renderers may not). Reads in onMouse fall
    // back to row 1 / col 1 when absent — safe approximation for
    // popup anchor; covered by tests.
    if (ctx.originRow !== undefined) state.lastRenderOriginRow = ctx.originRow;
    if (ctx.originCol !== undefined) state.lastRenderOriginCol = ctx.originCol;
    // Delegate to the existing pure log-pane renderer. It returns
    // title + body lines padded/truncated to ctx.width already.
    // U-4.2 · pass the freeze/search fields through so branches that
    // used to call renderLogPane directly (chat-only · default) keep
    // the same visual output after migrating to widget-based render.
    const viewport = buildLogPaneViewport(
      {
        lines: state.lines,
        scrollOffset: state.scrollOffset,
        footerLine: state.footerLine,
        // ⛔⭐⭐⭐ 이 매핑은 «필드를 골라» 새 객체를 만든다 — 새 필드를 여기 «안 넣으면»
        //   위쪽 층이 아무리 옳게 공급해도 «조용히» 떨어진다.
        //   📏 2026-08-19 실측: 정확히 그렇게 한 번 잃었고, 라이브로 «한 시간» 걸려 찾았다.
        //   📌 형태가 `user-config.ts` 의 `llm.*` 허용목록과 «같다» — 골라 담는 자리는 전부 이 병을 갖는다.
        queueRow: (state as { queueRow?: string | null }).queueRow ?? null,
        frozenTailIndex: state.frozenTailIndex ?? null,
        filterQuery: state.filterQuery ?? null,
        filterHint: state.filterHint ?? null,
        foldMode: state.foldMode ?? 'line',
        searchQuery: state.searchQuery ?? null,
        searchCursor: state.searchCursor ?? null,
      },
      { width: ctx.width, height: ctx.height, focused: state.focused || ctx.focused },
    );
    // Origin is the stored start row, not a computed fallback.
    // Absent stays absent so a missing origin cannot look like row 1.
    // Not gated on `debug.enabled` — a silent gate would look like
    // "did not happen". The other nine fields stay behind the gate.
    debug.log('dashboard.chat.stream', 'wd-log.render', {
      ...(debug.enabled
        ? {
            // Production-grade boundary observability — 구조 정보만 (chat
            // content 는 노출 안 함). ctxHeight 가 갑자기 줄거나
            // bodyLineCount=0 / visibleIndices range 가 비정상이면 layout/
            // viewport 단의 회귀로 즉시 진단 가능.
            ctxHeight: ctx.height,
            ctxWidth: ctx.width,
            stateLinesLen: state.lines.length,
            scrollOffset: state.scrollOffset,
            hasFooter: state.footerLine != null && state.footerLine !== '',
            bodyLineCount: viewport.bodyLines.length,
            visibleLineIndicesCount: viewport.visibleLineIndices.length,
            firstVisibleIdx: viewport.visibleLineIndices[0] ?? -1,
            lastVisibleIdx: viewport.visibleLineIndices[viewport.visibleLineIndices.length - 1] ?? -1,
          }
        : {}),
      originRow: state.lastRenderOriginRow ?? null,
    });
    state.lastVisibleLineIndices = viewport.visibleLineIndices;
    return [viewport.title, ...viewport.bodyLines];
  },

  // U-4.3 · attachment hit-test + popup mount. Runs the same
  // `tryAttachmentHitAtLineIndex` the dashboard called directly before
  // this phase; deps come from state.clickDeps (dashboard syncs each
  // frame). Returns `{type: 'none'}` unconditionally — the popup
  // mount is a side effect, and focus/dispatch policy is owned by
  // the caller (mx-mouse shifts focus; input-mode doesn't; streaming
  // does). `widget.onMouse` just answers "did this row hit an
  // attachment and if so open its popup".
  onMouse(ev, state, _ctx) {
    // Unconditional reach records. Same category as
    // `dispatchLogZoneClick` (`log.mouse`). Distinct events:
    // not-click · missing-click-deps · title-row · mapped-index ·
    // mapped-index-negative · row-fallback.
    // Not gated on `debug.enabled` — a silent gate would look like
    // "did not happen". Index/coordinate detail may sit behind the
    // gate; arrival itself must always remain.
    if (ev.type !== 'click' && ev.type !== 'double-click') {
      debug.log('log.mouse', 'not-click', { type: ev.type });
      return { type: 'none' };
    }
    const deps = state.clickDeps;
    if (!deps) {
      debug.log('log.mouse', 'missing-click-deps');
      return { type: 'none' };
    }
    // Local row 0 = title; body starts at local row 1.
    const rowInBody = ev.row - 1;
    if (rowInBody < 0) {
      debug.log('log.mouse', 'title-row', { row: ev.row, rowInBody });
      return { type: 'none' };
    }
    // Absolute coords for popup anchoring. Prefer stashed origin from
    // the most recent render; fall back to 1/1 if the host never
    // supplied it (shouldn't happen in production — belt-and-suspenders
    // default).
    const absRow = (state.lastRenderOriginRow ?? 1) + ev.row;
    const absCol = (state.lastRenderOriginCol ?? 1) + ev.col;
    const visibleIndices = state.lastVisibleLineIndices;
    const mappedLineIdx = visibleIndices?.[rowInBody];
    if (visibleIndices && mappedLineIdx !== undefined) {
      // Successful table lookup: keep the mapped result, and also leave
      // enough widget-side mapping context to reproduce the conversion
      // later (row math vs table contents). Bounded prefix so a long
      // viewport cannot drown the store; the cap-reached bit is itself
      // a value so a truncated prefix is never read as "that's all".
      const tableLength = visibleIndices.length;
      const prefixCap = MAPPED_INDEX_TABLE_PREFIX_CAP;
      const tablePrefix = visibleIndices.slice(0, prefixCap);
      // Origin is the stored render start row, not the popup fallback.
      // Absent stays absent so a missing origin cannot look like row 1.
      debug.log('log.mouse', 'mapped-index', {
        index: mappedLineIdx,
        row: ev.row,
        rowInBody,
        tableLength,
        scrollOffset: state.scrollOffset,
        tail: state.scrollOffset === -1,
        tablePrefix,
        prefixCap,
        prefixTruncated: tableLength > prefixCap,
        originRow: state.lastRenderOriginRow ?? null,
      });
      if (mappedLineIdx < 0) {
        debug.log('log.mouse', 'mapped-index-negative', { index: mappedLineIdx });
        return { type: 'none' };
      }
      tryAttachmentHitAtLineIndex(mappedLineIdx, { row: absRow, col: absCol }, deps, {
        rowInBody,
        scrollOffset: state.scrollOffset,
      });
      return { type: 'none' };
    }
    debug.log('log.mouse', 'row-fallback', {
      row: ev.row,
      col: ev.col,
      rowInBody,
    });
    tryAttachmentHitAtBodyRow(rowInBody, { row: absRow, col: absCol }, deps);
    return { type: 'none' };
  },

  // WR-1 (Bundle 7W · 2026-04-20) — scroll + entry-count transitions.
  // Log is a high-frequency append surface (chat / tool output), so
  // emitting on every `lines` push would drown the sink. We only fire
  // when tail-follow toggles (scrollOffset -1 ↔ non-tail) and when the
  // size class changes by a full 1024-line bucket — coarse enough for a
  // recorder to mark "big growth" moments without per-line chatter.
  onStateChange(prev, next, ctx) {
    const wasTail = prev.scrollOffset === -1;
    const isTail = next.scrollOffset === -1;
    if (wasTail !== isTail) {
      ctx.telemetry?.emit({
        kind: 'log.tail.change',
        data: { tail: isTail, scroll: next.scrollOffset },
      });
    } else if (!isTail && prev.scrollOffset !== next.scrollOffset) {
      ctx.telemetry?.emit({
        kind: 'log.scroll.change',
        data: { from: prev.scrollOffset, to: next.scrollOffset, total: next.lines.length },
      });
    }
    const prevBucket = Math.floor(prev.lines.length / 1024);
    const nextBucket = Math.floor(next.lines.length / 1024);
    if (prevBucket !== nextBucket) {
      ctx.telemetry?.emit({
        kind: 'log.size.bucket',
        data: { from: prev.lines.length, to: next.lines.length, bucket: nextBucket },
      });
    }
  },

  // WR-2 — tail-follow bit + scroll offset + line count + focus +
  // freeze/search state (U-4.4). Line count (and not content hash) is
  // enough: the log is append-only in practice, so length strictly
  // grows; recorder does a deep-compare on hash match per WR-2
  // contract so rare in-place edits still pass. Freeze + search bits
  // are small discriminators — inclusion makes an LLM observing via
  // StartRecording see these transitions without a deep-compare pass.
  snapshotHash(state): string {
    const tail = state.scrollOffset === -1 ? 't' : `s${state.scrollOffset}`;
    const freeze = state.frozenTailIndex != null ? `f${state.frozenTailIndex}` : '';
    const search = state.searchQuery ? `q${state.searchQuery.length}` : '';
    const searchCur = state.searchCursor
      ? `${state.searchCursor.current}/${state.searchCursor.total}`
      : '';
    const filter = state.filterQuery ? `fq${state.filterQuery.length}` : '';
    return `${tail}:${state.scroll}:${state.lines.length}:${state.focused ? 1 : 0}:${freeze}:${search}${searchCur ? `:${searchCur}` : ''}${filter ? `:${filter}` : ''}`;
  },

  // U-4.4 · LLM observability surface for the log pane. DescribeSurface
  // (LLM tool) forwards to `widgetHost.describeSurfaceFor(id)` which
  // calls this method. The caller is typically an agent asking
  // "what's in the log right now?" — so we project the log-specific
  // state the user's mental model cares about: entry count, tail
  // status, active freeze (partial-scroll snapshot), and active search
  // with match counter. Keep the string compact and cheap; the LLM
  // tool also exposes `statePreview` (generic 8-field JSON) for
  // callers that need raw state.
  describeSurface(state, ctx): string {
    const parts = [ctx.character, `${state.lines.length} entries`];
    parts.push(state.scrollOffset === -1 ? 'tail' : `scroll ${state.scrollOffset}`);
    if (state.frozenTailIndex != null) parts.push(`frozen@${state.frozenTailIndex}`);
    if (state.searchQuery) {
      const q = state.searchQuery.length > 24
        ? `${state.searchQuery.slice(0, 21)}...`
        : state.searchQuery;
      const counter = state.searchCursor
        ? ` (${state.searchCursor.current}/${state.searchCursor.total})`
        : '';
      parts.push(`search "${q}"${counter}`);
    }
    if (state.filterQuery) {
      const q = state.filterQuery.length > 24
        ? `${state.filterQuery.slice(0, 21)}...`
        : state.filterQuery;
      parts.push(`filter "${q}"`);
    }
    if (state.footerLine) parts.push('footer-pinned');
    if (state.focused) parts.push('focused');
    return parts.join(' · ');
  },

  configSchema() {
    return {
      type: 'object',
      properties: {
        lines: {
          type: 'array',
          items: { type: 'string' },
          description: 'Initial log lines · prepended to the scrollback on mount.',
        },
      },
      additionalProperties: false,
    };
  },
};

export default logWidget;
