/**
 * Observable board — reactive wrapper around `computeBoard`.
 *
 * Origin: 내부 문서 `PLAN-session-tox-observable-board`.
 *
 * Widgets that want a live kanban view subscribe once; the factory
 * recomputes the layout whenever graph-mutating events fire on the
 * task event bus. A throttle window coalesces bursts (e.g. a single
 * `applyProposal` adds 5 tasks → one notification, not five).
 *
 * Pure-ish: no IO beyond what `computeBoard` does. All scheduling is
 * injected via `schedule` so tests run deterministically.
 */
import type { TaskGraph } from '../graph.js';
import type {
  TaskEvent,
  TaskEventBus,
  TaskEventDisposable,
  TaskEventKind,
} from '../events.js';
import {
  computeBoard,
  type BoardFilter,
  type BoardLayout,
} from './layout.js';

// ───────────────────────── Types ────────────────────────────────

export interface ObservableBoardOptions {
  graph: TaskGraph;
  bus: TaskEventBus;
  viewport: { width: number; height: number };
  filter?: BoardFilter;
  doneCutoffMs?: number;
  compactPerColumn?: number;
  wideMaxPerColumn?: number;
  titleMaxLen?: number;
  /** Throttle window in ms. Default 16 (60fps). 0 disables — every
   *  trigger recomputes synchronously (useful for tests). */
  throttleMs?: number;
  now?: () => number;
  /** Test seam — returns a cancel fn. Default uses setTimeout. */
  schedule?: (fn: () => void, ms: number) => () => void;
}

export interface ObservableBoard {
  state(): BoardLayout;
  subscribe(fn: (state: BoardLayout) => void): () => void;
  setViewport(vp: { width: number; height: number }): void;
  setFilter(filter: BoardFilter | undefined): void;
  refresh(): BoardLayout;
  dispose(): void;
}

/** Bus event kinds that imply a graph mutation the board cares about. */
const RELEVANT_KINDS: readonly TaskEventKind[] = [
  'task-created',
  'task-status-changed',
  'task-started',
  'task-completed',
  'task-failed',
  'task-cancelled',
  'task-regenerated',
  'task-superseded',
  'task-retry-scheduled',
] as const;

// ───────────────────────── Factory ──────────────────────────────

export function createObservableBoard(opts: ObservableBoardOptions): ObservableBoard {
  const throttleMs = opts.throttleMs ?? 16;
  const schedule = opts.schedule ?? defaultSchedule;

  let viewport = { ...opts.viewport };
  let filter: BoardFilter | undefined = opts.filter;
  let lastState: BoardLayout = buildLayout();
  let dirty = false;
  let pendingCancel: (() => void) | null = null;

  const listeners = new Set<(state: BoardLayout) => void>();
  let disposed = false;

  const subscription: TaskEventDisposable = opts.bus.subscribe(
    (ev: TaskEvent) => {
      if (disposed) return;
      if (!RELEVANT_KINDS.includes(ev.kind)) return;
      markDirtyAndSchedule();
    },
    { kinds: RELEVANT_KINDS },
  );

  function buildLayout(): BoardLayout {
    return computeBoard({
      tasks: opts.graph.listAll(),
      viewport,
      filter,
      now: opts.now?.(),
      doneCutoffMs: opts.doneCutoffMs,
      compactPerColumn: opts.compactPerColumn,
      wideMaxPerColumn: opts.wideMaxPerColumn,
      titleMaxLen: opts.titleMaxLen,
    });
  }

  function recompute(): BoardLayout {
    lastState = buildLayout();
    dirty = false;
    for (const fn of listeners) {
      try {
        fn(lastState);
      } catch {
        // listener error isolation — don't break the loop.
      }
    }
    return lastState;
  }

  function markDirtyAndSchedule(): void {
    dirty = true;
    if (throttleMs <= 0) {
      recompute();
      return;
    }
    if (pendingCancel) return; // already scheduled
    pendingCancel = schedule(() => {
      pendingCancel = null;
      if (!disposed && dirty) recompute();
    }, throttleMs);
  }

  return {
    state() {
      if (dirty) recompute();
      return lastState;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    setViewport(vp) {
      viewport = { ...vp };
      dirty = true;
      recompute(); // immediate — viewport change is a UI event, not throttled
    },
    setFilter(f) {
      filter = f;
      dirty = true;
      recompute();
    },
    refresh() {
      dirty = true;
      return recompute();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        subscription.dispose();
      } catch {
        /* noop */
      }
      if (pendingCancel) {
        try {
          pendingCancel();
        } catch {
          /* noop */
        }
        pendingCancel = null;
      }
      listeners.clear();
    },
  };
}

// ───────────────────────── default schedule ────────────────────

function defaultSchedule(fn: () => void, ms: number): () => void {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
}
