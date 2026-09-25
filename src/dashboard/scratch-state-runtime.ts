import type { ScratchSurfaceState } from '../display/types.js';

export interface DashboardScratchStateSnapshot {
  title: string;
  lines: string[];
  offset: number;
}

export interface DashboardScratchCommandSnapshot {
  title: string;
  lines: string[];
}

export interface DashboardScratchStateRuntime {
  replace(title: string, lines: readonly string[]): DashboardScratchStateSnapshot;
  resolveCommandSnapshot(
    displayScratch: ScratchSurfaceState | null,
    fallback: DashboardScratchCommandSnapshot,
  ): DashboardScratchCommandSnapshot;
}

export function createDashboardScratchStateRuntime(): DashboardScratchStateRuntime {
  return {
    replace: (title, lines) => ({
      title,
      lines: [...lines],
      offset: 0,
    }),
    resolveCommandSnapshot(displayScratch, fallback) {
      if (displayScratch && displayScratch.mode !== 'agents') {
        return {
          title: displayScratch.title,
          lines: [...displayScratch.lines],
        };
      }
      return {
        title: fallback.title,
        lines: [...fallback.lines],
      };
    },
  };
}
