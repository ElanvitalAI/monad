import type { DebugEvent } from '../debug/log.js';

export interface DashboardDebugEventSnapshot {
  oldest: DebugEvent[];
  newest: DebugEvent[];
  cursor: number;
  selected: DebugEvent | null;
}

export interface DashboardDebugEventRuntime {
  snapshot(
    oldest: readonly DebugEvent[],
    cursor: number,
    manual: boolean,
  ): DashboardDebugEventSnapshot;
}

export function createDashboardDebugEventRuntime(): DashboardDebugEventRuntime {
  return {
    snapshot(oldest, cursor, manual) {
      const newest = [...oldest].reverse();
      const nextCursor = manual
        ? Math.max(0, Math.min(cursor, Math.max(0, newest.length - 1)))
        : 0;
      return {
        oldest: [...oldest],
        newest,
        cursor: nextCursor,
        selected: newest[nextCursor] ?? null,
      };
    },
  };
}
