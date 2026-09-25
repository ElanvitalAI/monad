import type { FsEntry, WorkingDirState } from '../working-dir/index.js';

export interface DashboardBrowserWidgetCache {
  entries: readonly FsEntry[] | null;
  selectedSize: number;
  cursor: number;
  offset: number;
}

export interface DashboardBrowserWidgetProjection {
  items: string[];
  icons: string[];
  cursor: number;
  offset: number;
  preserveAnsi: boolean;
  submitText: string[];
  selected: Set<string>;
}

export interface DashboardBrowserWidgetRuntimeDeps {
  fmtEntryColored: (entry: FsEntry) => string;
  iconForEntry: (entry: FsEntry) => string;
  encodeSubmitText: (entry: FsEntry) => string;
}

export interface DashboardBrowserWidgetRuntime {
  shouldRefresh(cache: DashboardBrowserWidgetCache, workingDir: WorkingDirState): boolean;
  buildProjection(workingDir: WorkingDirState): DashboardBrowserWidgetProjection;
  nextCache(workingDir: WorkingDirState): DashboardBrowserWidgetCache;
}

export function createDashboardBrowserWidgetRuntime(
  deps: DashboardBrowserWidgetRuntimeDeps,
): DashboardBrowserWidgetRuntime {
  return {
    shouldRefresh(cache, workingDir) {
      return cache.entries !== workingDir.entries
        || cache.selectedSize !== workingDir.selected.size
        || cache.cursor !== workingDir.cursor
        || cache.offset !== workingDir.offset;
    },
    buildProjection(workingDir) {
      const entriesRef = workingDir.entries;
      const items = entriesRef.map(deps.fmtEntryColored);
      const icons = entriesRef.map(deps.iconForEntry);
      const submitText = entriesRef.map(deps.encodeSubmitText);
      const selected = new Set<string>();
      for (let i = 0; i < entriesRef.length; i += 1) {
        const entry = entriesRef[i];
        if (workingDir.selected.has(entry.absPath)) selected.add(items[i]!);
      }
      return {
        items,
        icons,
        cursor: workingDir.cursor,
        offset: workingDir.offset,
        preserveAnsi: true,
        submitText,
        selected,
      };
    },
    nextCache(workingDir) {
      return {
        entries: workingDir.entries,
        selectedSize: workingDir.selected.size,
        cursor: workingDir.cursor,
        offset: workingDir.offset,
      };
    },
  };
}
