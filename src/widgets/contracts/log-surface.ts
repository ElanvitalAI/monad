import type { LogClickDispatchDeps } from '../../log-pane/click-dispatch.js';
import type { FoldMode } from '../../log-entry.js';

export interface LogSurfaceSearchCursor {
  current: number;
  total: number;
}

/** Shared state contract for log-like feed surfaces.
 *
 * `wd-log` and `wd-debug-log` already share the same widget type; this
 * contract makes that relationship explicit so dashboard sync paths can
 * update them through one vocabulary instead of duplicating shape
 * literals. It is intentionally interface-first rather than an abstract
 * base class: the widgets keep their own render/mouse behavior while the
 * state bag stays structurally reusable. */
export interface LogSurfaceStateContract {
  lines: readonly string[];
  scrollOffset: number;
  focused: boolean;
  /** ⚠️ 상태 «가방»이라 선택이다 — 위젯은 `initialState()` 에서 이 칸 없이 만들어진다.
   *  ⛔ 종전엔 필수로 선언돼 `LogWidgetState`(선택)와 «구조적으로» 어긋나 있었고,
   *    두 파일이 같은 검사 집합에 들어올 때만 드러났다(2026-08-19 실측).
   *  ⭐ 입력 계약(`SyncLogSurfaceStateInput`)은 «필수 그대로» 둔다 — 공급자는 항상 값을 정해야 한다. */
  footerLine?: string | null;
  /** ⭐ `B1`(2026-08-19 · 대표 지시) — 스트리밍 중 «대기 큐» 한 줄.
   *  스트리밍 표시줄 «바로 위»에 그려진다. ⛔ 큐의 자리는 컴포저가 아니다. */
  queueRow?: string | null;
  frozenTailIndex?: number | null;
  filterQuery?: string | null;
  filterHint?: string | null;
  foldMode?: FoldMode;
  searchQuery?: string | null;
  searchCursor?: LogSurfaceSearchCursor | null;
  clickDeps?: LogClickDispatchDeps | null;
}

export interface SyncLogSurfaceStateInput {
  lines: readonly string[];
  scrollOffset: number;
  focused: boolean;
  footerLine: string | null;
  /** ⭐ `B1`(2026-08-19 · 대표 지시) — 스트리밍 중 «대기 큐» 한 줄.
   *  스트리밍 표시줄 «바로 위»에 그려진다. ⛔ 큐의 자리는 컴포저가 아니다. */
  queueRow?: string | null;
  frozenTailIndex?: number | null;
  filterQuery?: string | null;
  filterHint?: string | null;
  foldMode?: FoldMode;
  searchQuery?: string | null;
  searchCursor?: LogSurfaceSearchCursor | null;
  clickDeps?: LogClickDispatchDeps | null;
}

export function applyLogSurfaceState(
  target: LogSurfaceStateContract,
  input: SyncLogSurfaceStateInput,
): void {
  target.lines = input.lines;
  target.scrollOffset = input.scrollOffset;
  target.focused = input.focused;
  target.footerLine = input.footerLine ?? null;
  target.queueRow = input.queueRow ?? null;
  target.frozenTailIndex = input.frozenTailIndex ?? null;
  target.filterQuery = input.filterQuery ?? null;
  target.filterHint = input.filterHint ?? null;
  target.foldMode = input.foldMode ?? 'line';
  target.searchQuery = input.searchQuery ?? null;
  target.searchCursor = input.searchCursor ?? null;
  target.clickDeps = input.clickDeps ?? null;
}
